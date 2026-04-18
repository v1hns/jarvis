import { NativeEventEmitter, NativeModules } from 'react-native';

const { MetaDATModule } = NativeModules;

if (!MetaDATModule) {
  throw new Error(
    'MetaDATModule not found.\n' +
    'Run: cd ios && pod install\n' +
    'Then rebuild the app on a physical iPhone (Bluetooth required).'
  );
}

export type SessionState =
  | 'idle'
  | 'connecting'
  | 'connected'
  | 'streaming'
  | 'paused'
  | 'disconnected'
  | 'error';

export interface DeviceInfo {
  id: string;
  name: string;
  firmwareVersion: string;
  model: 'ray-ban-meta' | 'ray-ban-meta-display' | 'oakley-meta-hstn';
}

export interface VideoFrame {
  width: number;
  height: number;
  /** Base64-encoded JPEG */
  data: string;
  timestampMs: number;
}

export interface AudioChunk {
  /** PCM float32 samples at 16 kHz mono */
  samples: number[];
  timestampMs: number;
}

export interface StreamConfig {
  video?: { enabled: boolean; width?: number; height?: number; fps?: number };
  audio?: { enabled: boolean; sampleRate?: 16000 | 44100 };
}

export const MetaDAT = {
  register(applicationId: string): Promise<void> {
    return MetaDATModule.register(applicationId);
  },
  requestPermissions(): Promise<{ camera: boolean; microphone: boolean }> {
    return MetaDATModule.requestPermissions();
  },
  getAvailableDevices(): Promise<DeviceInfo[]> {
    return MetaDATModule.getAvailableDevices();
  },
  connect(deviceId: string): Promise<void> {
    return MetaDATModule.connect(deviceId);
  },
  startStream(config: StreamConfig): Promise<void> {
    return MetaDATModule.startStream(config);
  },
  pauseStream(): Promise<void> {
    return MetaDATModule.pauseStream();
  },
  resumeStream(): Promise<void> {
    return MetaDATModule.resumeStream();
  },
  disconnect(): Promise<void> {
    return MetaDATModule.disconnect();
  },
  capturePhoto(): Promise<string> {
    return MetaDATModule.capturePhoto();
  },
};

// ── Events ────────────────────────────────────────────────────────────────────

const emitter = new NativeEventEmitter(MetaDATModule);

export type DATEventMap = {
  onSessionStateChange: SessionState;
  onVideoFrame: VideoFrame;
  onAudioChunk: AudioChunk;
  onError: { code: string; message: string };
};

export function addDATListener<K extends keyof DATEventMap>(
  event: K,
  handler: (payload: DATEventMap[K]) => void
) {
  return emitter.addListener(event as string, handler);
}
