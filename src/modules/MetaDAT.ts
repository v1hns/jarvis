import { NativeEventEmitter, NativeModules } from 'react-native';

const { MetaDATModule } = NativeModules;

if (!MetaDATModule) {
  throw new Error(
    'MetaDATModule not found.\n' +
    'Run: cd ios && pod install, then rebuild on a physical iPhone.'
  );
}

// Mirrors StreamSessionState enum from MWDATCamera
export type SessionState =
  | 'stopped'
  | 'stopping'
  | 'waitingForDevice'
  | 'starting'
  | 'streaming'
  | 'paused';

export type PermissionStatus = 'granted' | 'denied';

export interface DeviceInfo {
  id: string;
  name: string;
  model: string;
}

export interface VideoFrame {
  width: number;
  height: number;
  /** Base64-encoded JPEG */
  data: string;
  timestampMs: number;
}

export interface AudioChunk {
  /** PCM float32 samples at 16 kHz mono (via Bluetooth HFP) */
  samples: number[];
  timestampMs: number;
}

export const MetaDAT = {
  /** Call once at app launch — reads MWDAT dict from Info.plist */
  configure(): Promise<void> {
    return MetaDATModule.configure();
  },

  /** Opens Meta AI app pairing flow. User approves once ever. */
  startRegistration(): Promise<string> {
    return MetaDATModule.startRegistration();
  },

  /** Returns current camera permission without prompting */
  checkPermission(): Promise<PermissionStatus> {
    return MetaDATModule.checkPermission();
  },

  /** Deep-links to Meta AI app for camera permission grant */
  requestPermission(): Promise<PermissionStatus> {
    return MetaDATModule.requestPermission();
  },

  /** SDK auto-selects paired glasses. Transitions through waitingForDevice → starting → streaming. */
  startAutoSession(): Promise<void> {
    return MetaDATModule.startAutoSession();
  },

  /** Connect to a specific device by id from onDevicesChanged event */
  startSession(deviceId: string): Promise<void> {
    return MetaDATModule.startSession(deviceId);
  },

  stopSession(): Promise<void> {
    return MetaDATModule.stopSession();
  },

  /** Capture a still photo. Video pauses briefly then auto-resumes. Returns base64 JPEG. */
  capturePhoto(): Promise<string> {
    return MetaDATModule.capturePhoto();
  },

  /** Start capturing audio from glasses mic via Bluetooth HFP (AVAudioEngine) */
  startAudio(): Promise<void> {
    return MetaDATModule.startAudio();
  },
};

// ── Events ────────────────────────────────────────────────────────────────────

const emitter = new NativeEventEmitter(MetaDATModule);

// RegistrationState mirrors RegistrationState enum from MWDATCore
export type RegistrationState = 'unavailable' | 'available' | 'registering' | 'registered';

export type DATEventMap = {
  onSessionStateChange: SessionState;
  onDevicesChanged: DeviceInfo[];
  onVideoFrame: VideoFrame;
  onAudioChunk: AudioChunk;
  onError: { code: string; message: string };
  onRegistrationStateChange: RegistrationState;
};

export function addDATListener<K extends keyof DATEventMap>(
  event: K,
  handler: (payload: DATEventMap[K]) => void
) {
  return emitter.addListener(event as string, handler);
}
