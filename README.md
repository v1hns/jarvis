# Jarvis

An on-device AI assistant for Meta Ray-Ban smart glasses (iOS). Jarvis runs entirely on your iPhone using [Cactus](https://github.com/cactus-compute/cactus) for inference — no cloud required. It connects to your glasses via the [Meta Wearables Device Access Toolkit](https://developers.meta.com/wearables/), listens through the glasses microphone, transcribes speech, and responds.

```
Ray-Ban Glasses (mic + camera)
        │ Bluetooth
        ▼
     iPhone
  ├── Meta DAT   →  audio & video frames
  ├── CactusSTT  →  on-device transcription
  └── CactusLM   →  on-device LLM response
```

---

## Requirements

- iPhone running iOS 15.2+
- Mac running Xcode 14+ (for building and deploying)
- Node 18+
- Meta Ray-Ban glasses with firmware v20+ (Ray-Ban Meta) or v21+ (Display)
- Meta AI app v254+ on your iPhone

> **Xcode runs on your Mac. The app runs on your iPhone.**
> Connect iPhone to Mac via USB cable, select it as the build target in Xcode, and hit Run. Bluetooth is required for glasses connectivity — the iOS Simulator won't work.

---

## 1 — Enable Developer Mode on your glasses

The Meta AI app moved this setting around between versions. Try these in order:

**Option A — Meta AI app (newer versions)**
1. Open the **Meta AI** app on your iPhone
2. Tap **☰ Menu → Devices → [your glasses name]**
3. Scroll to the bottom → tap **About**
4. Tap the **firmware version number 5 times** quickly
5. A toast should say "Developer mode enabled"

**Option B — if you don't see it under Devices**
1. Open **Meta AI** → tap your **profile avatar** (top left)
2. Tap **Settings → Connected devices → [your glasses]**
3. Scroll down to **About** and tap the version number 5 times

**Option C — via the older Meta View app**
If you have the **Meta View** app installed instead:
1. Open **Meta View** → tap **Device → [glasses name]**
2. Tap **More info** → tap the version number 5 times

Once enabled, a **Developer** section or badge should appear in the device settings. You only need to do this once per glasses pairing.

---

## 2 — Register at the Meta Wearables Developer Center

1. Go to [wearables.developer.meta.com](https://wearables.developer.meta.com/) and sign in with your Meta account
2. Create a project — use bundle ID `com.jarvis.app` and platform **iOS**
3. Your credentials are shown on the dashboard — you've already added them to `Secrets.xcconfig`

---

## 3 — Clone and install

```bash
git clone https://github.com/v1hns/jarvis.git
cd jarvis
npm install
```

---

## 4 — iOS setup

### 4a — Create your Secrets.xcconfig

```bash
cp ios/Jarvis/Secrets.xcconfig.example ios/Jarvis/Secrets.xcconfig
```

Fill in `ios/Jarvis/Secrets.xcconfig` with your credentials (already done if you followed initial setup):

```
META_APP_ID = 1487636526490742
META_CLIENT_TOKEN = AR|1487636526490742|...
```

### 4b — Open in Xcode

```bash
cd ios && pod install && cd ..
open ios/Jarvis.xcodeproj
```

### 4c — Attach Secrets.xcconfig to your build configuration

1. In Xcode, click the **Jarvis** project (blue icon, top of file tree)
2. Select the **Project** (not the target) → **Info** tab
3. Under **Configurations**, expand **Debug** and **Release**
4. For each, set the configuration file to **Secrets.xcconfig**

### 4d — Sign the app

1. Select the **Jarvis** target → **Signing & Capabilities**
2. Check **Automatically manage signing**
3. Set your **Team** to your Apple Developer account

### 4e — Add the Meta DAT Swift package

1. **File → Add Package Dependencies…**
2. Paste: `https://github.com/facebook/meta-wearables-dat-ios`
3. Select the latest version and add to the **Jarvis** target

### 4f — Run on your iPhone

1. Plug your iPhone into your Mac via USB
2. Unlock your iPhone and tap **Trust This Computer** if prompted
3. In Xcode, select your iPhone from the device dropdown (top center)
4. Hit **⌘R** to build and run

---

## 5 — Using the app

1. Jarvis downloads on-device AI models on first launch (~200–400 MB) — wait for "Ready"
2. Make sure Bluetooth is on and glasses are on your face / nearby
3. Tap **Scan for Ray-Ban Glasses** — your glasses appear by name within a few seconds
4. Tap them to connect — Jarvis starts listening through the glasses mic
5. Speak naturally. After a short pause Jarvis transcribes and responds
6. Tap **Enable Vision** to stream camera, or **Snap + Ask** to take a photo and ask about it

---

## 6 — Testing without physical glasses

Swap in the MockDevice in `MetaDATModule.swift` to run in Simulator:

```swift
// Add MetaWearablesDAT MockDeviceKit via the same SPM package
// then at the top of MetaDATModule.swift:
import MetaWearablesDATMock

// In register():
MetaWearablesDAT.shared.useMockDevice()
```

---

## 7 — Project structure

```
jarvis/
├── src/
│   ├── App.tsx                     Entry point
│   ├── screens/HomeScreen.tsx      Main UI
│   ├── hooks/useJarvis.ts          Cactus AI + DAT orchestration
│   └── modules/MetaDAT.ts          JS ↔ native bridge
└── ios/
    ├── Jarvis/MetaDATModule.swift  Native module (Meta DAT)
    ├── Jarvis/MetaDATModule.m      Obj-C bridge header
    ├── Jarvis/Info.plist           Permissions & build vars
    ├── Jarvis/Secrets.xcconfig     Your credentials (gitignored)
    ├── Jarvis/Secrets.xcconfig.example  Template
    └── Podfile
```

---

## 8 — Common issues

| Problem | Fix |
|---|---|
| Glasses don't appear in scan | Meta AI app must be open in background on the same iPhone |
| Developer mode option missing | Try Options A / B / C in Step 1 above — UI varies by app version |
| `MetaDATModule not found` | Run `pod install` in `ios/` and rebuild |
| `$(META_APP_ID)` not resolving | Make sure Secrets.xcconfig is attached in Xcode → Project → Info → Configurations |
| Build fails on Simulator | Must run on a physical iPhone — Bluetooth is required |
| Glasses connect but no audio | Re-enable Developer Mode; it can reset after a firmware update |

---

## Useful links

| Resource | URL |
|---|---|
| Meta Wearables Developer Center | https://wearables.developer.meta.com/ |
| Meta DAT iOS SDK | https://github.com/facebook/meta-wearables-dat-ios |
| Meta DAT iOS API reference | https://wearables.developer.meta.com/docs/reference/ios_swift/dat/0.6 |
| Cactus React Native | https://github.com/cactus-compute/cactus-react-native |

---

## License

MIT
