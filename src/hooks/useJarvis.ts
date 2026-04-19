import { useCallback, useEffect, useRef, useState } from 'react';
import { CactusLM, CactusSTT } from 'cactus-react-native';
import { MetaDAT, addDATListener, SessionState, DeviceInfo } from '../modules/MetaDAT';
import { route as routePrompt, Route } from '../modules/Router';
import { cloudComplete, cloudModelName } from '../modules/GemmaCloud';
import { visionQuery, isVisionConfigured } from '../modules/AnthropicVision';
import { speak, stopSpeaking } from '../modules/Speaker';
import {
  sendTask,
  checkHeartbeat,
  isBridgeConfigured,
  BridgeEvent,
} from '../modules/DesktopBridgeClient';

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

  const audioBuffer    = useRef<number[]>([]);
  const silenceTimer   = useRef<ReturnType<typeof setTimeout> | null>(null);
  const abortDesktop   = useRef<AbortController | null>(null);
  const confirmResolve = useRef<((ans: boolean) => void) | null>(null);

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
    const { text } = await stt.current.transcribe({ audio });
    if (!text.trim()) return;
    setTranscript(text);
    await reply(text, imageBase64);
  }

  async function reply(userText: string, imageBase64?: string) {
    if (!lm.current) return;

    const userMsg: Message = { role: 'user', content: userText, imageBase64 };
    const nextMessages = [...messages, userMsg];
    setMessages(nextMessages);
    setIsThinking(true);

    const decision = await routePrompt(userText, Boolean(imageBase64), lm.current);
    setLastRoute(decision.route);
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

    abortDesktop.current = new AbortController();

    const handleEvent = async (event: BridgeEvent) => {
      switch (event.type) {
        case 'progress':
          setDesktopProgress(event.payload);
          await speak(event.payload);
          break;

        case 'needs_confirmation': {
          setNeedsConfirm(event.payload);
          await speak(`I need your confirmation before continuing. ${event.payload} Say yes to confirm or no to cancel.`);
          // Wait for voice confirmation (resolved by confirmDesktopAction)
          await new Promise<boolean>(resolve => {
            confirmResolve.current = resolve;
          });
          break;
        }

        case 'error':
          console.error('[Bridge]', event.payload);
          break;
      }
    };

    const result = await sendTask(
      {
        task: userText,
        context: history.slice(-6).map(m => ({ role: m.role, content: m.content })),
        confirm_before: ['send', 'pay', 'delete', 'submit', 'post'],
      },
      handleEvent,
      abortDesktop.current.signal,
    );

    setNeedsConfirm(null);
    return result || 'Task completed on your laptop.';
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
    abortDesktop.current?.abort();
    await MetaDAT.stopSession();
    setMessages([]);
    setDesktopProgress('');
    setNeedsConfirm(null);
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
  };
}
