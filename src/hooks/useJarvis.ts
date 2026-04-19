import { useCallback, useEffect, useRef, useState } from 'react';
import { AppState } from 'react-native';
import { CactusLM } from 'cactus-react-native';
import RNFS from 'react-native-fs';
import Voice, { SpeechResultsEvent, SpeechErrorEvent } from '@react-native-voice/voice';
import { MetaDAT, addDATListener, SessionState, DeviceInfo, RegistrationState } from '../modules/MetaDAT';
import { route as routePrompt, Route } from '../modules/Router';
import { cloudComplete, cloudModelName, isCloudConfigured } from '../modules/GemmaCloud';
import { visionQuery, isVisionConfigured } from '../modules/AnthropicVision';
import { speak, stopSpeaking } from '../modules/Speaker';
import {
  sendTask,
  sendConfirmation,
  checkHeartbeat,
  isBridgeConfigured,
  BridgeEvent,
} from '../modules/DesktopBridgeClient';
import {
  TestCase, ReplayResult,
  loadCases, saveCase, deleteCase, buildCase,
} from '../modules/TestHarness';
import { MemoryOrchestrator } from '../modules/memory/MemoryOrchestrator';
import { answerMemoryQuery } from '../modules/memory/MemoryQueryEngine';
import {
  appendTurn as appendConversationTurn,
  clearTurns as clearConversationTurns,
  loadTurns as loadConversationTurns,
} from '../modules/memory/ConversationMemory';
import { planTask, singleStepPlan, TaskPlan, SubTask } from '../modules/TaskPlanner';

const SYSTEM_PROMPT = `You are Jarvis, a personal AI assistant for Vihaan.
You run on-device via Cactus with Google Gemma as your brain. You can escalate
to cloud Gemma for heavy reasoning, use glasses or phone vision when available,
recall the user's episodic memory, and delegate tasks to their laptop via
OpenClaw + Claude Code.

Style:
- Short, natural, spoken-aloud-friendly (1–3 sentences by default).
- Direct and witty. No filler, no apologies, no preamble.
- When given a task you're executing via the laptop, narrate briefly.`;

export interface Message {
  role: 'user' | 'assistant';
  content: string;
  imageBase64?: string;
  source?: 'local' | 'cloud' | 'vision' | 'desktop';
}

export function useJarvis() {
  const lm         = useRef<CactusLM | null>(null);
  const memoryLM   = useRef<CactusLM | null>(null);
  const memoryOrch = useRef<MemoryOrchestrator | null>(null);

  const [sessionState, setSessionState]       = useState<SessionState>('stopped');
  const [devices, setDevices]                 = useState<DeviceInfo[]>([]);
  const [messages, setMessages]               = useState<Message[]>([]);
  const [isThinking, setIsThinking]           = useState(false);
  const [modelsReady, setModelsReady]         = useState(false);
  const [transcript, setTranscript]           = useState('');
  const [lastRoute, setLastRoute]             = useState<Route | null>(null);
  const [permStatus, setPermStatus]           = useState<'unknown' | 'granted' | 'denied'>('unknown');
  const [registered, setRegistered]           = useState(false);
  const [setupError, setSetupError]           = useState<string | null>(null);
  const [laptopOnline, setLaptopOnline]       = useState<boolean | null>(null);
  const [desktopProgress, setDesktopProgress] = useState<string>('');
  const [needsConfirm, setNeedsConfirm]       = useState<string | null>(null);
  const [isRecording, setIsRecording]         = useState(false);
  const [testCases, setTestCases]             = useState<TestCase[]>([]);
  // Phone-only chat: usable without glasses. Reuses the full routing / memory
  // / desktop-delegation pipeline and phone mic + Apple/ElevenLabs speaker.
  const [chatMode, setChatMode]               = useState(true);
  const [isPhoneListening, setPhoneListening] = useState(false);
  const [currentPlan, setCurrentPlan]         = useState<TaskPlan | null>(null);
  const [activeStepId, setActiveStepId]       = useState<string | null>(null);

  const voiceActive     = useRef(false);
  const abortDesktop    = useRef<AbortController | null>(null);
  const desktopSession  = useRef<string | null>(null);
  const confirmResolve  = useRef<((ans: boolean) => void) | null>(null);
  const isRecordingRef  = useRef(false);
  const lastRouteRef    = useRef<Route>('local_answer');
  const lastResponseRef = useRef<string>('');
  const latestFrameRef  = useRef<string | null>(null);
  const messagesRef     = useRef<Message[]>([]);

  // Keep messagesRef in sync so async handlers always see latest messages
  useEffect(() => { messagesRef.current = messages; }, [messages]);

  // ─── Boot SDK + AI models ─────────────────────────────────────────────────

  useEffect(() => {
    async function init() {
      await MetaDAT.configure();
      const perm = await MetaDAT.checkPermission();
      setPermStatus(perm);

      // Gemma is the only on-device model Jarvis uses. Gemma 2 2B IT Q4 is
      // the nearest Cactus-compatible GGUF build; the PRD's "Gemma 4 E4B"
      // target drops in here when an official GGUF ships.
      const modelPath = `${RNFS.DocumentDirectoryPath}/gemma-2-2b-it-q4.gguf`;
      const modelUrl  = 'https://huggingface.co/bartowski/gemma-2-2b-it-GGUF/resolve/main/gemma-2-2b-it-Q4_K_M.gguf';

      const exists = await RNFS.exists(modelPath);
      if (!exists) {
        console.log('[CactusLM] Downloading model…');
        await RNFS.downloadFile({ fromUrl: modelUrl, toFile: modelPath }).promise;
        console.log('[CactusLM] Model downloaded');
      }

      const { lm: mainModel, error: lmErr } = await CactusLM.init({ model: modelPath });
      if (lmErr || !mainModel) { console.error('[CactusLM] init failed', lmErr); return; }
      lm.current = mainModel;
      // Share one model instance — loading twice causes ~700 MB peak and OOM crash
      memoryLM.current = mainModel;

      memoryOrch.current = new MemoryOrchestrator(memoryLM.current);
      await memoryOrch.current.init();

      setModelsReady(true);

      // Replay persistent chat history into the visible message list
      const prior = await loadConversationTurns();
      if (prior.length > 0) {
        setMessages(prior.map(t => ({
          role: t.role,
          content: t.content,
          source: (t.route as Message['source']) ?? 'local',
        })));
      }
    }
    init().catch(console.error);
    loadCases().then(setTestCases).catch(console.error);
  }, []);

  // Re-check permission when app returns to foreground (e.g. after Meta AI redirect)
  useEffect(() => {
    const sub = AppState.addEventListener('change', state => {
      if (state === 'active') {
        MetaDAT.checkPermission().then(setPermStatus).catch(() => {});
      }
    });
    return () => sub.remove();
  }, []);

  // ─── Voice (Speech Recognition) setup ───────────────────────────────────

  useEffect(() => {
    Voice.onSpeechResults = (e: SpeechResultsEvent) => {
      const text = e.value?.[0]?.trim();
      if (!text) return;
      setTranscript(text);
      stopVoice();
      replyFromText(text);
    };

    Voice.onSpeechError = (e: SpeechErrorEvent) => {
      if (voiceActive.current) startVoice();
    };

    return () => {
      Voice.destroy().then(Voice.removeAllListeners);
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [modelsReady]);

  async function startVoice() {
    try {
      await Voice.start('en-US');
      voiceActive.current = true;
      setPhoneListening(true);
    } catch (e) {
      console.error('[Voice] start failed', e);
      setPhoneListening(false);
    }
  }

  async function stopVoice() {
    try {
      voiceActive.current = false;
      setPhoneListening(false);
      await Voice.stop();
    } catch {}
  }

  /** Phone-only push-to-talk — toggles the mic on/off when glasses aren't live. */
  async function togglePhoneMic() {
    if (voiceActive.current) await stopVoice();
    else await startVoice();
  }

  /** Text input from the phone UI (chat mode or diagnostics). */
  async function askText(text: string) {
    const trimmed = text.trim();
    if (!trimmed) return;
    setTranscript(trimmed);
    await reply(trimmed);
  }

  async function clearConversation() {
    await clearConversationTurns();
    setMessages([]);
  }

  // ─── Laptop heartbeat ────────────────────────────────────────────────────

  useEffect(() => {
    if (!isBridgeConfigured()) return;
    let active = true;
    async function probe() {
      while (active) {
        const ok = await checkHeartbeat();
        if (active) setLaptopOnline(ok);
        await new Promise(r => setTimeout(r, 30_000));
      }
    }
    probe();
    return () => { active = false; };
  }, []);

  // ─── Memory orchestrator lifecycle ───────────────────────────────────────

  useEffect(() => {
    const orch = memoryOrch.current;
    if (!orch) return;
    if (sessionState === 'streaming') {
      orch.runRollover().catch(err => console.warn('[Memory] rollover failed:', err));
      orch.start();
    } else {
      orch.stop();
    }
  }, [sessionState]);

  // ─── Meta DAT event subscriptions ───────────────────────────────────────

  useEffect(() => {
    const subs = [
      addDATListener('onSessionStateChange', (state: SessionState) => {
        setSessionState(state);
        if (state === 'streaming') startVoice();
        if (state === 'stopped' || state === 'stopping') stopVoice();
      }),

      addDATListener('onDevicesChanged', setDevices),

      addDATListener('onVideoFrame', ({ data }: { data: string }) => {
        latestFrameRef.current = data;
      }),

      addDATListener('onError', ({ message }: { message: string }) => {
        console.error('[MetaDAT]', message);
      }),

      addDATListener('onRegistrationStateChange', (state: RegistrationState) => {
        setRegistered(state === 'registered');
      }),
    ];
    return () => subs.forEach(s => s.remove());
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [modelsReady]);

  // ─── Core logic ─────────────────────────────────────────────────────────

  async function replyFromText(text: string, imageBase64?: string) {
    const shouldCapture = isRecordingRef.current;
    await reply(text, imageBase64);
    if (shouldCapture) {
      isRecordingRef.current = false;
      setIsRecording(false);
      const capturedImage = imageBase64 ?? latestFrameRef.current ?? undefined;
      const tc = buildCase([], text, lastRouteRef.current, lastResponseRef.current, capturedImage);
      await saveCase(tc);
      setTestCases(await loadCases());
    }
    // Glasses path is hot-mic; phone chat is push-to-talk — no auto-restart.
    if (sessionState === 'streaming') startVoice();
  }

  async function executeStep(
    step: SubTask,
    userText: string,
    history: Message[],
    imageBase64: string | undefined,
  ): Promise<{ text: string; source: Message['source'] }> {
    const localComplete = async (withImage: boolean): Promise<string> => {
      const hist = history.map(m => ({
        role: m.role,
        content: m.content,
        ...(m.imageBase64 && withImage ? { images: [m.imageBase64] } : {}),
      }));
      const result = await lm.current!.complete({
        messages: [{ role: 'system', content: SYSTEM_PROMPT }, ...hist],
      });
      return result.response;
    };

    switch (step.route) {
      case 'cloud_answer': {
        if (!isCloudConfigured()) {
          return { text: await localComplete(false), source: 'local' };
        }
        const text = await cloudComplete({
          system: SYSTEM_PROMPT,
          messages: history.map(m => ({ role: m.role, content: m.content })),
        });
        return { text, source: 'cloud' };
      }

      case 'vision_query': {
        const frame = imageBase64 ?? (sessionState === 'streaming'
          ? await MetaDAT.capturePhoto().catch(() => null)
          : null);
        if (frame && isVisionConfigured()) {
          const text = await visionQuery(step.description || userText, frame);
          return { text, source: 'vision' };
        }
        if (!frame) {
          return {
            text: "I'd need a photo to answer that. Connect the glasses or snap an image, then ask again.",
            source: 'local',
          };
        }
        return { text: await localComplete(true), source: 'vision' };
      }

      case 'desktop_action': {
        const text = await handleDesktopAction(step.description || userText, history);
        return { text, source: 'desktop' };
      }

      case 'memory_query': {
        await memoryOrch.current?.runRollover();
        const result = await answerMemoryQuery(lm.current!, step.description || userText);
        return { text: result.answer, source: 'local' };
      }

      case 'clarify':
        return {
          text: `Quick check — ${step.description}. Want me to continue?`,
          source: 'local',
        };

      case 'local_answer':
      default:
        return { text: await localComplete(false), source: 'local' };
    }
  }

  async function reply(userText: string, imageBase64?: string) {
    if (!lm.current) return;

    const userMsg: Message = { role: 'user', content: userText, imageBase64 };
    const nextMessages = [...messagesRef.current, userMsg];
    setMessages(nextMessages);
    setIsThinking(true);

    void appendConversationTurn({
      role: 'user', content: userText, timestampMs: Date.now(),
    });

    const decision = await routePrompt(userText, Boolean(imageBase64), lm.current, isCloudConfigured());
    setLastRoute(decision.route);
    lastRouteRef.current = decision.route;
    console.log(`[Router] ${decision.route} (${decision.confidence.toFixed(2)}) — ${decision.reason}`);

    // Planner only runs for the heavy routes; simple ones stay single-step
    // to preserve low-latency conversational feel.
    const shouldPlan =
      decision.route === 'desktop_action' ||
      decision.route === 'cloud_answer' ||
      userText.length > 160;
    const plan: TaskPlan = shouldPlan
      ? (await planTask(lm.current, userText)) ?? singleStepPlan(userText, decision.route)
      : singleStepPlan(userText, decision.route);

    setCurrentPlan(plan.steps.length > 1 ? plan : null);

    try {
      let finalText = '';
      let finalSource: Message['source'] = 'local';

      for (const step of plan.steps) {
        setActiveStepId(step.id);
        if (plan.steps.length > 1) {
          setDesktopProgress(`${step.description}`);
        }
        const { text, source } = await executeStep(
          step, userText, nextMessages, imageBase64,
        );
        finalText = text;
        finalSource = source;

        if (plan.steps.length > 1) {
          setMessages(prev => [...prev, {
            role: 'assistant',
            content: `• ${step.description}\n${text}`,
            source,
          }]);
        }
      }

      if (plan.steps.length === 1) {
        setMessages(prev => [...prev, { role: 'assistant', content: finalText, source: finalSource }]);
      }

      lastResponseRef.current = finalText;
      void appendConversationTurn({
        role: 'assistant', content: finalText, route: finalSource, timestampMs: Date.now(),
      });
      await speak(finalText);
    } catch (err: unknown) {
      const errText = err instanceof Error ? err.message : String(err);
      console.error(`[${decision.route}]`, errText);
      setMessages(prev => [...prev, {
        role: 'assistant',
        content: `(${decision.route} failed: ${errText})`,
        source: decision.route === 'cloud_answer' ? 'cloud' : 'local',
      }]);
      await speak('Something went wrong. ' + errText.slice(0, 80));
    } finally {
      setIsThinking(false);
      setDesktopProgress('');
      setActiveStepId(null);
      setCurrentPlan(null);
    }
  }

  async function handleDesktopAction(userText: string, history: Message[]): Promise<string> {
    if (!isBridgeConfigured()) {
      return "Desktop bridge not configured. Set RELAY_URL in your .env file and start the desktop-relay on your laptop.";
    }

    const online = await checkHeartbeat();
    setLaptopOnline(online);
    if (!online) {
      return "Your laptop isn't reachable right now. Make sure Tailscale is running on both devices and desktop-relay is started.";
    }

    const sessionId = `jarvis-${Date.now()}`;
    const desktopAbort = new AbortController();
    abortDesktop.current = desktopAbort;
    desktopSession.current = sessionId;

    const handleEvent = async (event: BridgeEvent) => {
      switch (event.type) {
        case 'progress':
          setDesktopProgress(event.payload);
          await speak(event.payload);
          break;

        case 'needs_confirmation': {
          setNeedsConfirm(event.payload);
          await speak(`I need your confirmation before continuing. ${event.payload} Say yes to confirm or no to cancel.`);
          const confirmed = await new Promise<boolean>(resolve => {
            confirmResolve.current = resolve;
          });
          if (desktopAbort.signal.aborted) break;
          setDesktopProgress(confirmed ? 'Confirmation sent…' : 'Cancelling task…');
          try {
            await sendConfirmation(
              sessionId,
              confirmed ? 'CONFIRMED' : 'CANCELLED',
              desktopAbort.signal,
            );
          } catch (err: unknown) {
            const errText = err instanceof Error ? err.message : String(err);
            setDesktopProgress('');
            setMessages(prev => [...prev, {
              role: 'assistant',
              content: `Desktop confirmation failed: ${errText}`,
              source: 'desktop',
            }]);
            await speak('I could not send that confirmation to your laptop.');
            desktopAbort.abort();
          }
          break;
        }

        case 'error':
          console.error('[Bridge]', event.payload);
          break;
      }
    };

    try {
      const result = await sendTask(
        {
          task: userText,
          context: history.slice(-6).map(m => ({ role: m.role, content: m.content })),
          confirm_before: ['send', 'pay', 'delete', 'submit', 'post'],
          session_id: sessionId,
        },
        handleEvent,
        desktopAbort.signal,
      );
      setNeedsConfirm(null);
      return result || 'Task completed on your laptop.';
    } finally {
      setNeedsConfirm(null);
      if (abortDesktop.current === desktopAbort) abortDesktop.current = null;
      if (desktopSession.current === sessionId) desktopSession.current = null;
      confirmResolve.current = null;
    }
  }

  function confirmDesktopAction(confirmed: boolean) {
    setNeedsConfirm(null);
    confirmResolve.current?.(confirmed);
    confirmResolve.current = null;
  }

  // ─── Public controls ─────────────────────────────────────────────────────

  async function register() {
    setSetupError(null);
    try {
      await MetaDAT.startRegistration();
      // Swift resolves on both fresh registration and alreadyRegistered. The
      // stream may not re-emit in the alreadyRegistered case, so mirror the
      // state here so Step 2 can render immediately.
      setRegistered(true);
      const perm = await MetaDAT.checkPermission();
      setPermStatus(perm);
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      console.error('[register]', msg);
      setSetupError(msg);
    }
  }

  async function grantPermission() {
    setSetupError(null);
    try {
      const status = await MetaDAT.requestPermission();
      setPermStatus(status);
      if (status === 'denied') setSetupError('Camera access denied in Meta AI app. Tap to try again.');
    } catch (e: unknown) {
      const code = (e as { code?: string })?.code;
      const msg = e instanceof Error ? e.message : String(e);
      console.error('[grantPermission]', code, msg);
      if (code === 'PERMISSION_NO_DEVICE') {
        setSetupError('Glasses not found. Power them on and put them nearby, then try again.');
      } else {
        setSetupError(msg);
      }
    }
  }

  function friendlyConnectError(msg: string): string {
    const lower = msg.toLowerCase();
    if (lower.includes('no eligible') || lower.includes('no device')) {
      return "Glasses aren't registering with Meta AI right now. Open the Meta AI app, make sure your glasses show as the active device there, then come back and tap Connect again.";
    }
    if (lower.includes('bluetooth')) {
      return 'Bluetooth unavailable. Enable Bluetooth on your iPhone, then try Connect again.';
    }
    return msg;
  }

  async function waitForDevice(timeoutMs: number = 6000): Promise<boolean> {
    // Meta DAT streams devices via onDevicesChanged — give it a moment to populate
    // after Bluetooth wakes up before calling startAutoSession.
    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
      if (devices.length > 0) return true;
      await new Promise(r => setTimeout(r, 250));
    }
    return devices.length > 0;
  }

  async function connect() {
    setSetupError(null);
    // First attempt: immediate — for users whose glasses are already in DAT
    try {
      await MetaDAT.startAutoSession();
      return;
    } catch (firstErr: unknown) {
      const firstMsg = firstErr instanceof Error ? firstErr.message : String(firstErr);
      const noDevice = /no eligible|no device/i.test(firstMsg);
      if (!noDevice) {
        console.warn('[connect]', firstMsg);
        setSetupError(friendlyConnectError(firstMsg));
        return;
      }
      // Glasses not yet discovered — wait up to 6s for DAT to see them
      setSetupError('Looking for your glasses…');
      const found = await waitForDevice(6000);
      if (!found) {
        setSetupError(friendlyConnectError(firstMsg));
        return;
      }
      try {
        await MetaDAT.startAutoSession();
        setSetupError(null);
      } catch (secondErr: unknown) {
        const msg = secondErr instanceof Error ? secondErr.message : String(secondErr);
        console.warn('[connect retry]', msg);
        setSetupError(friendlyConnectError(msg));
      }
    }
  }

  async function resetPairing() {
    setSetupError(null);
    try {
      await MetaDAT.startUnregistration();
      setRegistered(false);
      setPermStatus('unknown');
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      console.error('[resetPairing]', msg);
      setSetupError(msg);
    }
  }

  async function connectSpecific(deviceId: string) {
    setSetupError(null);
    try { await MetaDAT.startSession(deviceId); }
    catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      console.warn('[connectSpecific]', msg);
      setSetupError(friendlyConnectError(msg));
    }
  }

  async function snapAndAsk(question?: string) {
    try {
      const imageBase64 = await MetaDAT.capturePhoto();
      if (question) await reply(question, imageBase64);
      else {
        await stopVoice();
        await startVoice();
      }
    } catch (e) { console.error('[snapAndAsk]', e); }
  }

  async function disconnect() {
    stopSpeaking();
    confirmResolve.current?.(false);
    confirmResolve.current = null;
    desktopSession.current = null;
    abortDesktop.current?.abort();
    memoryOrch.current?.stop();
    await stopVoice();
    await MetaDAT.stopSession();
    setMessages([]);
    setDesktopProgress('');
    setNeedsConfirm(null);
  }

  // ─── Test Harness ────────────────────────────────────────────────────────

  function armRecording() {
    isRecordingRef.current = true;
    setIsRecording(true);
  }

  function disarmRecording() {
    isRecordingRef.current = false;
    setIsRecording(false);
  }

  async function replayCase(tc: TestCase): Promise<ReplayResult> {
    if (!lm.current || !modelsReady) throw new Error('Models not ready');
    const effectiveText = tc.capturedTranscript;

    setIsThinking(true);
    const decision = await routePrompt(effectiveText, Boolean(tc.imageBase64), lm.current, isCloudConfigured());

    const localComplete = async (withImage: boolean): Promise<string> => {
      const result = await lm.current!.complete({
        messages: [
          { role: 'system', content: SYSTEM_PROMPT },
          { role: 'user', content: effectiveText,
            ...(tc.imageBase64 && withImage ? { images: [tc.imageBase64] } : {}) },
        ],
      });
      return result.response;
    };

    let responseText: string;
    try {
      switch (decision.route) {
        case 'cloud_answer':
          responseText = await cloudComplete({
            system: SYSTEM_PROMPT,
            messages: [{ role: 'user', content: effectiveText }],
          });
          break;
        case 'vision_query':
          responseText = await localComplete(true);
          break;
        case 'desktop_action':
          responseText = 'Desktop bridge replay not supported.';
          break;
        case 'memory_query': {
          const result = await answerMemoryQuery(lm.current, effectiveText);
          responseText = result.answer;
          break;
        }
        case 'clarify':
          responseText = `Ambiguous: ${decision.reason}`;
          break;
        default:
          responseText = await localComplete(false);
      }
    } finally {
      setIsThinking(false);
    }

    return { caseId: tc.id, newTranscript: effectiveText, newRoute: decision.route, newResponse: responseText };
  }

  async function removeTestCase(id: string) {
    await deleteCase(id);
    setTestCases(await loadCases());
  }

  return {
    sessionState,
    isStreaming:    sessionState === 'streaming',
    isConnecting:   sessionState === 'waitingForDevice' || sessionState === 'starting',
    devices,
    messages,
    isThinking,
    modelsReady,
    permStatus,
    transcript,
    lastRoute,
    laptopOnline,
    desktopProgress,
    needsConfirm,
    cloudModel: cloudModelName(),
    cloudEnabled:   isCloudConfigured(),
    visionEnabled:  isVisionConfigured(),
    bridgeEnabled:  isBridgeConfigured(),
    registered,
    setupError,
    chatMode,
    isPhoneListening,
    currentPlan,
    activeStepId,
    toggleChatMode: () => setChatMode(m => !m),
    askText,
    togglePhoneMic,
    clearConversation,
    register,
    grantPermission,
    resetPairing,
    connect,
    connectSpecific,
    snapAndAsk,
    disconnect,
    confirmDesktopAction,
    isRecording,
    armRecording,
    disarmRecording,
    testCases,
    replayCase,
    removeTestCase,
  };
}

export type JarvisState = ReturnType<typeof useJarvis>;
