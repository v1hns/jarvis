import { ELEVENLABS_API_KEY, ELEVENLABS_VOICE_ID } from '@env';
import Tts from 'react-native-tts';
import RNFS from 'react-native-fs';
import Sound from 'react-native-sound';

const DEFAULT_VOICE_ID = 'pNInz6obpgDQGcFmaJgB'; // Adam — clear, neutral
const ENDPOINT = 'https://api.elevenlabs.io/v1/text-to-speech';

let ttsInitialized = false;

function initTts() {
  if (ttsInitialized) return;
  Tts.setDefaultRate(0.5, false);
  Tts.setDefaultPitch(1.0, false);
  ttsInitialized = true;
}

function isElevenLabsConfigured(): boolean {
  return typeof ELEVENLABS_API_KEY === 'string' && ELEVENLABS_API_KEY.length > 0;
}

function voiceId(): string {
  return ELEVENLABS_VOICE_ID || DEFAULT_VOICE_ID;
}

/**
 * Fetch audio from ElevenLabs Flash v2, write to a temp file, and play it
 * through the glasses speakers (standard iOS Bluetooth audio output).
 */
async function speakElevenLabs(text: string): Promise<void> {
  const res = await fetch(`${ENDPOINT}/${voiceId()}?optimize_streaming_latency=3`, {
    method: 'POST',
    headers: {
      'xi-api-key': ELEVENLABS_API_KEY,
      'Content-Type': 'application/json',
      Accept: 'audio/mpeg',
    },
    body: JSON.stringify({
      text,
      model_id: 'eleven_flash_v2',
      voice_settings: { stability: 0.5, similarity_boost: 0.75 },
    }),
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`ElevenLabs ${res.status}: ${body.slice(0, 200)}`);
  }

  // React Native fetch returns a blob — convert to base64 then write to disk
  const blob = await res.blob();
  const reader = new FileReader();
  const base64Audio = await new Promise<string>((resolve, reject) => {
    reader.onloadend = () => {
      const result = reader.result as string;
      // Strip the data URL prefix
      resolve(result.split(',')[1] ?? result);
    };
    reader.onerror = reject;
    reader.readAsDataURL(blob);
  });

  const tmpPath = `${RNFS.TemporaryDirectoryPath}/jarvis_tts_${Date.now()}.mp3`;
  await RNFS.writeFile(tmpPath, base64Audio, 'base64');

  await new Promise<void>((resolve, reject) => {
    Sound.setCategory('Playback', true);
    const sound = new Sound(tmpPath, '', err => {
      if (err) { reject(err); return; }
      sound.play(success => {
        sound.release();
        RNFS.unlink(tmpPath).catch(() => {});
        if (success) resolve(); else reject(new Error('Sound playback failed'));
      });
    });
  });
}

/** Apple on-device TTS fallback. Always available, no API key needed. */
function speakApple(text: string): Promise<void> {
  initTts();
  return new Promise((resolve, reject) => {
    Tts.addEventListener('tts-finish', () => resolve());
    Tts.addEventListener('tts-error', (e: unknown) => reject(e));
    Tts.speak(text);
  });
}

/**
 * Speak text through glasses speakers.
 * Primary: ElevenLabs Flash v2 (if API key set).
 * Fallback: Apple AVSpeechSynthesizer.
 */
export async function speak(text: string): Promise<void> {
  if (!text.trim()) return;
  if (isElevenLabsConfigured()) {
    try {
      await speakElevenLabs(text);
      return;
    } catch (err) {
      console.warn('[Speaker] ElevenLabs failed, falling back to Apple TTS:', err);
    }
  }
  await speakApple(text);
}

/** Stop any in-progress speech. */
export function stopSpeaking(): void {
  Tts.stop();
}
