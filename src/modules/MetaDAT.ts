import { NativeEventEmitter, NativeModules, Platform } from 'react-native';

const { MetaDATModule } = NativeModules;

if (!MetaDATModule) {
  throw new Error(
    'MetaDATModule not found. Ensure the native module is linked. ' +
    'Run `cd ios && pod install` or `./gradlew build` in android/.'
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
  /** PCM float32 samples at 16kHz mono */
  samples: number[];
  timestampMs: number;
}

export interface StreamConfig {
  video?: {
    enabled: boolean;
    /** Max 720p @ 30fps over Bluetooth */
    width?: number;
    height?: number;
    fps?: number;
  };
  audio?: {
    enabled: boolean;
    sampleRate?: 16000 | 44100;
  };
}

export const MetaDAT = {
  /**
   * Register this app with the Meta Wearables platform.
   * Call once at app startup before any other DAT methods.
   * applicationId must match the value in AndroidManifest.xml / Info.plist.
   */
  register(applicationId: string): Promise<void> {
    return MetaDATModule.register(applicationId);
  },

  /** Request camera + microphone permissions required by the DAT. */
  requestPermissions(): Promise<{ camera: boolean; microphone: boolean }> {
    return MetaDATModule.requestPermissions();
  },

  /**
   * Scan for paired Ray-Ban glasses and return available devices.
   * The glasses must already be paired via the Meta AI mobile app.
   */
  getAvailableDevices(): Promise<DeviceInfo[]> {
    return MetaDATModule.getAvailableDevices();
  },

  /** Open a device session. Resolves when the session is fully connected. */
  connect(deviceId: string): Promise<void> {
    return MetaDATModule.connect(deviceId);
  },

  /** Start streaming video/audio from the glasses. */
  startStream(config: StreamConfig): Promise<void> {
    return MetaDATModule.startStream(config);
  },

  /** Pause the active stream without disconnecting. */
  pauseStream(): Promise<void> {
    return MetaDATModule.pauseStream();
  },

  /** Resume a paused stream. */
  resumeStream(): Promise<void> {
    return MetaDATModule.resumeStream();
  },

  /** Stop streaming and close the device session. */
  disconnect(): Promise<void> {
    return MetaDATModule.disconnect();
  },

  /** Capture a single still photo from the glasses camera. Returns base64 JPEG. */
  capturePhoto(): Promise<string> {
    return MetaDATModule.capturePhoto();
  },
};

// ─── Event emitter ────────────────────────────────────────────────────────────

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
