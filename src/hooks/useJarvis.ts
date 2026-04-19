import { useCallback, useEffect, useRef, useState } from 'react';
import { CactusLM, CactusSTT } from 'cactus-react-native';
import { MetaDAT, addDATListener, SessionState, DeviceInfo } from '../modules/MetaDAT';
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
  const lm  = useRef<CactusLM | null>(null);
  const stt = useRef<CactusSTT | null>(null);

  const [sessionState, setSessionState]       = useState<SessionState>('stopped');
  const [devices, setDevices]                 = useState<DeviceInfo[]>([]);
  const [messages, setMessages]               = useState<Message[]>([]);
  const [isThinking, setIsThinking]           = useState(false);
  const [modelsReady, setModelsReady]         = useState(false);
  const [transcript, setTranscript]           = useState('');
  const [lastRoute, setLastRoute]             = useState<Route | null>(null);
  const [permStatus, setPermStatus]           = useState<'unknown' | 'granted' | 'denied'>('unknown');
  const [laptopOnline, setLaptopOnline]       = useState<boolean | null>(null);
  const [desktopProgress, setDesktopProgress] = useState<string>('');
  const [needsConfirm, setNeedsConfirm]       = useState<string | null>(null);
  const [isRecording, setIsRecording]         = useState(false);
  const [testCases, setTestCases]             = useState<TestCase[]>([]);

  const audioBuffer     = useRef<number[]>([]);
  const silenceTimer    = useRef<ReturnType<typeof setTimeout> | null>(null);
  const abortDesktop    = useRef<AbortController | null>(null);
  const desktopSession  = useRef<string | null>(null);
  const confirmResolve  = useRef<((ans: boolean) => void) | null>(null);
  const isRecordingRef  = useRef(false);
  const lastRouteRef    = useRef<Route>('local_answer');
  const lastResponseRef = useRef<string>('');
  const latestFrameRef  = useRef<string | null>(null);

  // ─── Boot SDK + AI models ─────────────────────────────────────────────────

  useEffect(() => {
    async function init() {
      await MetaDAT.configure();
      const perm = await MetaDAT.checkPermission();
      setPermStatus(perm);

      lm.current  = new CactusLM({ options: { quantization: 'int4' } });
      stt.current = new CactusSTT({ options: { quantization: 'int4' } });
      await Promise.all([lm.current.download(), stt.current.download()]);
      await Promise.all([lm.current.init(),     stt.current.init()]);
      setModelsReady(true);
    }
    init().catch(console.error);
    loadCases().then(setTestCases).catch(console.error);
  }, []);

  // ─── Laptop heartbeat — probe every 30s while bridge is configured ────────

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

  // ─── Meta DAT event subscriptions ───────────────────────────────────────

  useEffect(() => {
    const subs = [
      addDATListener('onSessionStateChange', setSessionState),
      addDATListener('onDevicesChanged', setDevices),

      addDATListener('onVideoFrame', ({ data }) => {
        latestFrameRef.current = data;
      }),

      addDATListener('onAudioChunk', ({ samples }) => {
        audioBuffer.current.push(...samples);
        if (silenceTimer.current) clearTimeout(silenceTimer.current);
        silenceTimer.current = setTimeout(() => {
          const audio = audioBuffer.current.splice(0);
          if (audio.length > 0) transcribeAndReply(audio);
        }, 1500);
      }),

      addDATListener('onError', ({ message }) => {
        console.error('[MetaDAT]', message);
      }),
    ];
    return () => subs.forEach(s => s.remove());
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [modelsReady]);

  // ─── Core logic ─────────────────────────────────────────────────────────

  async function transcribeAndReply(audio: number[], imageBase64?: string) {
    if (!stt.current || !lm.current || !modelsReady) return;
    const shouldCapture = isRecordingRef.current;
    const { text } = await stt.current.transcribe({ audio });
    if (!text.trim()) return;
    setTranscript(text);
    await reply(text, imageBase64);
    if (shouldCapture) {
      isRecordingRef.current = false;
      setIsRecording(false);
      const capturedImage = imageBase64 ?? latestFrameRef.current ?? undefined;
      const tc = buildCase(audio, text, lastRouteRef.current, lastResponseRef.current, capturedImage);
      await saveCase(tc);
      setTestCases(await loadCases());
    }
  }

  async function reply(userText: string, imageBase64?: string) {
    if (!lm.current) return;

    const userMsg: Message = { role: 'user', content: userText, imageBase64 };
    const nextMessages = [...messages, userMsg];
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
      const errMsg = `(${decision.route} failed: ${errText})`;
      setMessages(prev => [...prev, {
        role: 'assistant',
        content: errMsg,
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
      if (abortDesktop.current === desktopAbort) {
        abortDesktop.current = null;
      }
      if (desktopSession.current === sessionId) {
        desktopSession.current = null;
      }
      confirmResolve.current = null;
    }
  }

  // Called by HomeScreen when user voice-confirms or cancels a desktop action
  function confirmDesktopAction(confirmed: boolean) {
    setNeedsConfirm(null);
    confirmResolve.current?.(confirmed);
    confirmResolve.current = null;
  }

  // ─── Public controls ─────────────────────────────────────────────────────

  async function register() {
    await MetaDAT.startRegistration();
  }

  async function grantPermission() {
    const status = await MetaDAT.requestPermission();
    setPermStatus(status);
  }

  async function connect() {
    await MetaDAT.startAutoSession();
  }

  async function connectSpecific(deviceId: string) {
    await MetaDAT.startSession(deviceId);
  }

  async function snapAndAsk(question?: string) {
    const imageBase64 = await MetaDAT.capturePhoto();
    if (question) await reply(question, imageBase64);
    else await transcribeAndReply([], imageBase64);
  }

  async function disconnect() {
    stopSpeaking();
    confirmResolve.current?.(false);
    confirmResolve.current = null;
    desktopSession.current = null;
    abortDesktop.current?.abort();
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
    if (!stt.current || !lm.current || !modelsReady) {
      throw new Error('Models not ready');
    }
    const { text } = await stt.current.transcribe({ audio: tc.audioSamples });
    const effectiveText = text.trim() || tc.capturedTranscript;

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
          responseText = 'Desktop bridge not yet implemented.';
          break;
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
