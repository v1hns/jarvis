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

const SYSTEM_PROMPT = `You are Jarvis, a concise AI assistant running on Meta Ray-Ban smart glasses.
Responses must be short (1-3 sentences) since they are spoken aloud.
You can see through the glasses camera when the user shares an image.
Be helpful, witty, and direct.`;

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

      const modelPath = `${RNFS.DocumentDirectoryPath}/qwen2.5-0.5b-q4.gguf`;
      const modelUrl  = 'https://huggingface.co/Qwen/Qwen2.5-0.5B-Instruct-GGUF/resolve/main/qwen2.5-0.5b-instruct-q4_k_m.gguf';

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
    } catch (e) {
      console.error('[Voice] start failed', e);
    }
  }

  async function stopVoice() {
    try {
      voiceActive.current = false;
      await Voice.stop();
    } catch {}
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
    if (voiceActive.current || sessionState === 'streaming') startVoice();
  }

  async function reply(userText: string, imageBase64?: string) {
    if (!lm.current) return;

    const userMsg: Message = { role: 'user', content: userText, imageBase64 };
    const nextMessages = [...messagesRef.current, userMsg];
    setMessages(nextMessages);
    setIsThinking(true);

    const decision = await routePrompt(userText, Boolean(imageBase64), lm.current, isCloudConfigured());
    setLastRoute(decision.route);
    lastRouteRef.current = decision.route;
    console.log(`[Router] ${decision.route} (${decision.confidence.toFixed(2)}) — ${decision.reason}`);

    const localComplete = async (withImage: boolean): Promise<string> => {
      const history = nextMessages.map(m => ({
        role: m.role,
        content: m.content,
        ...(m.imageBase64 && withImage ? { images: [m.imageBase64] } : {}),
      }));
      const result = await lm.current!.complete({
        messages: [{ role: 'system', content: SYSTEM_PROMPT }, ...history],
      });
      return result.response;
    };

    try {
      let responseText: string;
      let source: Message['source'] = 'local';

      switch (decision.route) {
        case 'cloud_answer':
          responseText = await cloudComplete({
            system: SYSTEM_PROMPT,
            messages: nextMessages.map(m => ({ role: m.role, content: m.content })),
          });
          source = 'cloud';
          break;

        case 'vision_query': {
          const frame = imageBase64 ?? (await MetaDAT.capturePhoto());
          if (isVisionConfigured()) {
            responseText = await visionQuery(userText, frame);
          } else {
            responseText = await localComplete(true);
          }
          source = 'vision';
          break;
        }

        case 'desktop_action':
          responseText = await handleDesktopAction(userText, nextMessages);
          source = 'desktop';
          break;

        case 'memory_query': {
          await memoryOrch.current?.runRollover();
          const result = await answerMemoryQuery(lm.current, userText);
          responseText = result.answer;
          source = 'local';
          break;
        }

        case 'clarify':
          responseText = `I'm not sure what you meant — ${decision.reason}. Could you rephrase?`;
          source = 'local';
          break;

        case 'local_answer':
        default:
          responseText = await localComplete(false);
          source = 'local';
          break;
      }

      lastResponseRef.current = responseText;
      setMessages(prev => [...prev, { role: 'assistant', content: responseText, source }]);
      await speak(responseText);
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

  async function connect() {
    try { await MetaDAT.startAutoSession(); }
    catch (e) { console.error('[connect]', e); }
  }

  async function connectSpecific(deviceId: string) {
    try { await MetaDAT.startSession(deviceId); }
    catch (e) { console.error('[connectSpecific]', e); }
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
    registered,
    setupError,
    register,
    grantPermission,
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
