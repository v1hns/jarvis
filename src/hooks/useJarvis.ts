import { useEffect, useRef, useState } from 'react';
import { CactusLM, CactusSTT } from 'cactus-react-native';
import { MetaDAT, addDATListener, SessionState, DeviceInfo } from '../modules/MetaDAT';

const SYSTEM_PROMPT = `You are Jarvis, a concise AI assistant running on Meta Ray-Ban smart glasses.
Responses must be short (1-3 sentences) since they are spoken aloud.
You can see through the glasses camera when the user shares an image.
Be helpful, witty, and direct.`;

export interface Message {
  role: 'user' | 'assistant';
  content: string;
  imageBase64?: string;
}

export function useJarvis() {
  const lm = useRef<CactusLM | null>(null);
  const stt = useRef<CactusSTT | null>(null);

  const [sessionState, setSessionState] = useState<SessionState>('idle');
  const [devices, setDevices] = useState<DeviceInfo[]>([]);
  const [messages, setMessages] = useState<Message[]>([]);
  const [isThinking, setIsThinking] = useState(false);
  const [modelsReady, setModelsReady] = useState(false);
  const [transcript, setTranscript] = useState('');

  // Audio buffer collected from the glasses microphone
  const audioBuffer = useRef<number[]>([]);
  const silenceTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // ─── Boot AI models ──────────────────────────────────────────────────────

  useEffect(() => {
    async function loadModels() {
      lm.current = new CactusLM({ options: { quantization: 'int4' } });
      stt.current = new CactusSTT({ options: { quantization: 'int4' } });

      await Promise.all([
        lm.current.download(),
        stt.current.download(),
      ]);
      await Promise.all([
        lm.current.init(),
        stt.current.init(),
      ]);

      setModelsReady(true);
    }
    loadModels().catch(console.error);
  }, []);

  // ─── Meta DAT event subscriptions ───────────────────────────────────────

  useEffect(() => {
    const subs = [
      addDATListener('onSessionStateChange', setSessionState),

      addDATListener('onAudioChunk', ({ samples }) => {
        audioBuffer.current.push(...samples);

        // Simple VAD: after 1.5 s of received audio with no new chunks, transcribe
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
    setMessages(prev => [...prev, userMsg]);
    setIsThinking(true);

    const history = [...messages, userMsg].map(m => ({
      role: m.role,
      content: m.content,
      ...(m.imageBase64 ? { images: [m.imageBase64] } : {}),
    }));

    const result = await lm.current.complete({
      messages: [
        { role: 'system', content: SYSTEM_PROMPT },
        ...history,
      ],
    });

    const assistantMsg: Message = { role: 'assistant', content: result.response };
    setMessages(prev => [...prev, assistantMsg]);
    setIsThinking(false);
  }

  // ─── Public controls ─────────────────────────────────────────────────────

  async function scanDevices() {
    const found = await MetaDAT.getAvailableDevices();
    setDevices(found);
    return found;
  }

  async function connectDevice(deviceId: string) {
    await MetaDAT.connect(deviceId);
    await MetaDAT.startStream({ audio: { enabled: true, sampleRate: 16000 } });
  }

  async function enableVision() {
    await MetaDAT.startStream({ video: { enabled: true, width: 1280, height: 720, fps: 10 } });
  }

  async function snapAndAsk(question?: string) {
    const imageBase64 = await MetaDAT.capturePhoto();
    await transcribeAndReply([], imageBase64);
    if (question) await reply(question, imageBase64);
  }

  async function disconnect() {
    await MetaDAT.disconnect();
    setSessionState('disconnected');
    setMessages([]);
  }

  return {
    sessionState,
    devices,
    messages,
    isThinking,
    modelsReady,
    transcript,
    scanDevices,
    connectDevice,
    enableVision,
    snapAndAsk,
    disconnect,
  };
}
