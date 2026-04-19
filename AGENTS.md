# Jarvis — AGENTS.md

## What this is
iOS-only React Native app. Connects Meta Ray-Ban glasses via Meta Wearables Device Access Toolkit (DAT) v0.6.0. Runs on-device AI (Cactus) for STT + LLM. Hybrid routing escalates complex queries to cloud Gemma. No Xcode needed to edit — runs on device via `npx react-native run-ios --device`.

---

## Meta DAT — exact API (v0.6.0)

### Correct imports
```swift
import MWDATCore   // Wearables singleton, PermissionStatus, RegistrationState
import MWDATCamera // StreamSession, StreamSessionState, StreamSessionConfig,
                   // AutoDeviceSelector, SpecificDeviceSelector
```
**NOT** `import MetaWearablesDAT` — that doesn't exist.

Added via SPM in Xcode: `https://github.com/facebook/meta-wearables-dat-ios`

---

### Registration
```swift
Wearables.configure()                     // call ONCE at app launch, reads Info.plist MWDAT dict
Wearables.shared.startRegistration()      // opens Meta AI app pairing flow
Wearables.shared.startUnregistration()    // removes pairing

// Async streams (Combine)
Wearables.shared.registrationStateStream() // AnyPublisher<RegistrationState, Never>
Wearables.shared.devicesStream()           // AnyPublisher<[Device], Never>
// NOTE: devices only appear after user grants at least one permission
```

---

### Permissions
```swift
// Only .camera exists — there is NO microphone permission type in DAT
let status = Wearables.shared.checkPermissionStatus(.camera)  // PermissionStatus
let status = await Wearables.shared.requestPermission(.camera) // deep-links to Meta AI app
// PermissionStatus: .granted | .denied
```

---

### StreamSession — core class
```swift
// Auto-select glasses (preferred)
let s = StreamSession(
    streamSessionConfig: StreamSessionConfig(),
    deviceSelector: AutoDeviceSelector()
)

// Specific device
let s = StreamSession(
    streamSessionConfig: StreamSessionConfig(),
    deviceSelector: SpecificDeviceSelector(device: device)
)

s.start()  // begins session; transitions waitingForDevice → starting → streaming automatically
s.stop()   // ends session and releases Bluetooth connection
// NO pause()/resume() methods — pausing is automatic (state goes to .paused when glasses removed)
```

### StreamSessionState enum
```
.stopped         — not running
.stopping        — shutdown in progress
.waitingForDevice — started, glasses not in range yet (auto-connects when found)
.starting        — connecting
.streaming       — active, frames flowing
.paused          — glasses out of range, connection preserved
```

### Publishers (Combine — no delegate pattern)
```swift
s.statePublisher      // AnyPublisher<StreamSessionState, Never>
s.videoFramePublisher // AnyPublisher<VideoFrame, Never>
s.photoDataPublisher  // AnyPublisher<Data, Never>
s.errorPublisher      // AnyPublisher<Error, Never>
```

### Photo capture
```swift
let accepted = s.capturePhoto(format: .jpeg) // Bool
// photo arrives on s.photoDataPublisher
// video auto-pauses during capture and auto-resumes after
// known cap: ~1.5MP max despite 12MP sensor
```

### Video specs
- Max: 720p @ 30 FPS
- Valid FPS values: 2, 7, 15, 24, 30
- Codec: HEVC primary (v0.5+), H.264 also supported
- SDK auto-reduces resolution then FPS if Bluetooth bandwidth is constrained

---

### Audio — NOT a DAT API
Glasses mic routes through iOS Bluetooth HFP. Access with standard `AVAudioEngine`:
```swift
try AVAudioSession.sharedInstance().setCategory(.playAndRecord, options: [.allowBluetooth])
try AVAudioSession.sharedInstance().setPreferredSampleRate(16_000)
// install tap on inputNode — delivers PCM float32 at 16 kHz mono
```
HFP native rate is 8 kHz (upsampled by iOS). Sufficient for speech.

---

## Info.plist — all required keys

```xml
<!-- Deep-link callback from Meta AI app after permission grant -->
<key>CFBundleURLTypes</key>
<array><dict><key>CFBundleURLSchemes</key><array><string>jarvis</string></array></dict></array>

<!-- ExternalAccessory protocol used internally by Meta DAT -->
<key>UISupportedExternalAccessoryProtocols</key>
<array><string>com.meta.ar.wearable</string></array>

<!-- Background streaming -->
<key>UIBackgroundModes</key>
<array>
  <string>bluetooth-peripheral</string>
  <string>external-accessory</string>
  <string>audio</string>
</array>

<!-- Meta DAT config dict — values injected from Secrets.xcconfig -->
<key>MWDAT</key>
<dict>
  <key>AppLinkURLScheme</key><string>jarvis://</string>
  <key>MetaAppID</key><string>$(META_APP_ID)</string>
  <key>ClientToken</key><string>$(META_CLIENT_TOKEN)</string>
  <key>TeamID</key><string>$(DEVELOPMENT_TEAM)</string>
</dict>
```

---

## Secrets — gitignored credentials

`ios/Jarvis/Secrets.xcconfig` (gitignored, copy from `.example`):
```
META_APP_ID = 1487636526490742
META_CLIENT_TOKEN = AR|1487636526490742|...
```
Must be attached in Xcode → Project (blue icon) → Info → Configurations → Debug + Release → Secrets.xcconfig.

---

## Native module

`MetaDATModule.swift` — React Native native module wrapping the DAT.
`MetaDATModule.m` — Obj-C bridge header declaring all methods.

Methods exposed to JS:
- `configure()` — call at app launch
- `startRegistration()` — opens Meta AI pairing
- `checkPermission()` / `requestPermission()` — camera only
- `startAutoSession()` / `startSession(deviceId)` — start streaming
- `stopSession()` — stop streaming
- `capturePhoto()` — returns base64 JPEG
- `startAudio()` — starts AVAudioEngine tap on BT mic

Events emitted to JS:
- `onSessionStateChange` — StreamSessionState raw value string
- `onDevicesChanged` — array of `{id, name, model}`
- `onVideoFrame` — `{width, height, data (base64 JPEG), timestampMs}`
- `onAudioChunk` — `{samples (float32[]), timestampMs}`
- `onError` — `{code, message}`

---

## JS layer

`src/modules/MetaDAT.ts` — typed JS bridge  
`src/hooks/useJarvis.ts` — orchestrates DAT + Cactus STT + LLM + routing  
`src/screens/HomeScreen.tsx` — UI with 3-step registration/permission/connect flow  

### Connection flow in the app
1. `MetaDAT.configure()` at launch
2. `MetaDAT.checkPermission()` → if denied show "Register" → `startRegistration()` then `requestPermission()`
3. `MetaDAT.startAutoSession()` → waits for glasses → auto-transitions to streaming
4. Audio starts automatically when state hits `.streaming`
5. VAD silence timer (1.5 s) triggers CactusSTT → router → CactusLM or cloud Gemma

---

## Routing system (`src/modules/Router.ts`)

Classifies every spoken request into one of:
- `local_answer` — small Cactus model handles it
- `cloud_answer` — escalates to Gemma 4 27B via Google AI Studio
- `vision_query` — uses image from glasses camera
- `desktop_action` — laptop bridge (not yet implemented)
- `clarify` — ambiguous, asks follow-up

Heuristic fast-path runs first (no model inference cost). Falls back to on-device Gemma router model for ambiguous cases.

Cloud Gemma key in `.env` as `GEMMA_API_KEY`. If unset, all queries stay local.

---

## Known DAT limitations

| Issue | Notes |
|---|---|
| App Store blocked | ExternalAccessory/MFi requirement. Use TestFlight or direct install only. Full release planned 2026. |
| Photo resolution | ~1.5MP cap |
| Audio quality | HFP 8 kHz upsampled |
| Max 30 FPS | Bluetooth bandwidth limit |
| Gestures/tap events | Not exposed by DAT |
| Custom wake word | Not available in preview |

## Supported hardware
Ray-Ban Meta Gen 1+2, Ray-Ban Meta Display (v0.6.0+), Oakley Meta HSTN/Vanguard

## Requirements
- iPhone iOS 15.2+, Xcode 14+ on Mac, Node 18+
- Meta AI app v247+ on same iPhone
- Glasses firmware v20+ (Ray-Ban Meta) / v21+ (Display)
- Developer Mode: tap version 5x in Meta AI app → Device → About


<claude-mem-context>
# Memory Context

# [jarvis] recent context, 2026-04-18 9:04pm PDT

No previous sessions found.
</claude-mem-context>