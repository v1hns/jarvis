# Jarvis

An on-device AI assistant for Meta Ray-Ban smart glasses. Jarvis runs entirely on your phone using [Cactus](https://github.com/cactus-compute/cactus) for inference — no cloud required by default. It connects to your glasses via the [Meta Wearables Device Access Toolkit](https://developers.meta.com/wearables/) and listens through the glasses microphone, transcribes your voice, and speaks responses back.

```
Ray-Ban Glasses (mic + camera)
        │ Bluetooth
        ▼
  iOS / Android App
  ├── Meta DAT   →  audio & video frames
  ├── CactusSTT  →  on-device transcription
  └── CactusLM   →  on-device LLM response
```

---

## Requirements

| | iOS | Android |
|---|---|---|
| OS | iOS 15.2+ | Android 10+ (API 29+) |
| Tooling | Xcode 14+ | Android Studio Flamingo+ |
| Node | 18+ | 18+ |
| Glasses firmware | v20+ (Ray-Ban Meta) / v21+ (Display) | same |
| Meta AI app | v254+ | v254+ |

---

## 1 — Developer access (required before anything else)

Jarvis uses the Meta Wearables Device Access Toolkit, which requires a registered developer account.

1. Go to the [Meta Wearables Developer Center](https://wearables.developer.meta.com/) and sign in with your Meta account.
2. Create a new project. Copy the **Application ID** — you will need it in the steps below.
3. Enable **Developer Mode** on your glasses:
   - Open the **Meta AI** app on your phone.
   - Go to **Settings → Devices → [your glasses] → App Info**.
   - Tap the version number **5 times** until a toast confirms developer mode is on.

---

## 2 — Clone and install

```bash
git clone https://github.com/v1hns/jarvis.git
cd jarvis
npm install
```

---

## 3 — iOS setup

### 3a — Add the Meta DAT Swift package

1. Open `ios/Jarvis.xcodeproj` in Xcode (or run `xed ios`).
2. **File → Add Package Dependencies…**
3. Enter the URL: `https://github.com/facebook/meta-wearables-dat-ios`
4. Select the latest version from the tags list and add it to the **Jarvis** target.

### 3b — Set your Application ID in Info.plist

Open `ios/Jarvis/Info.plist` and replace the placeholder values. The bundle identifier must match what you registered in the Developer Center:

```xml
<key>CFBundleIdentifier</key>
<string>com.yourcompany.jarvis</string>   <!-- must match Developer Center -->
```

### 3c — Install pods and run

```bash
cd ios && pod install && cd ..
npx react-native run-ios
```

---

## 4 — Android setup

### 4a — Create a GitHub personal access token

The Meta DAT Android SDK is distributed via GitHub Packages and requires a token with `read:packages` scope.

1. Go to [github.com/settings/tokens](https://github.com/settings/tokens) → **Generate new token (classic)**.
2. Select the `read:packages` scope.
3. Add the token to `~/.gradle/gradle.properties` (create the file if it doesn't exist):

```properties
GITHUB_TOKEN=ghp_your_token_here
```

### 4b — Set your Application ID in AndroidManifest.xml

Open `android/app/src/main/AndroidManifest.xml` and replace the placeholder:

```xml
<meta-data
    android:name="com.meta.wearable.mwdat.APPLICATION_ID"
    android:value="YOUR_META_DAT_APPLICATION_ID" />   <!-- from Developer Center -->
```

### 4c — Register the native module

In your `MainApplication.kt` (or `.java`) add `MetaDATPackage` to the package list:

```kotlin
override fun getPackages(): List<ReactPackage> = listOf(
    MainReactPackage(),
    MetaDATPackage(),   // add this
)
```

### 4d — Run

```bash
npx react-native run-android
```

---

## 5 — Using the app

1. Launch Jarvis on your phone. It will download on-device AI models on first run (~200–400 MB depending on quantization).
2. Make sure your Ray-Ban glasses are powered on and the **Meta AI** app is running in the background.
3. Tap **Scan for Ray-Ban Glasses** — your glasses should appear within a few seconds.
4. Tap your device name to connect. Jarvis starts listening immediately.
5. Speak naturally. After a brief pause, Jarvis transcribes your speech and responds.
6. Tap **Enable Vision** to start the camera stream, or **Snap + Ask** to take a photo and ask a question about what you see.

---

## 6 — Testing without physical glasses

Both platforms ship a **MockDevice** library that simulates a connected device.

**iOS** — In Xcode, add the `MockDeviceKit` product from the same SPM package, then call:
```swift
MetaWearablesDAT.shared.useMockDevice()
```

**Android** — Uncomment the `mwdat-mockdevice` dependency in `android/app/build.gradle.kts`:
```kotlin
implementation("com.meta.wearable:mwdat-mockdevice:0.6.0")
```
Then initialize the mock in your Application class before calling any DAT APIs.

---

## 7 — Project structure

```
jarvis/
├── src/
│   ├── App.tsx                     Entry point
│   ├── screens/HomeScreen.tsx      Main UI
│   ├── hooks/useJarvis.ts          Cactus AI + DAT orchestration
│   └── modules/MetaDAT.ts          JS bridge to native DAT module
├── ios/
│   ├── Jarvis/MetaDATModule.swift  Native iOS module (Meta DAT)
│   ├── Jarvis/MetaDATModule.m      Obj-C bridge header
│   ├── Jarvis/Info.plist           Permissions & DAT config
│   └── Podfile
└── android/
    ├── app/src/main/
    │   ├── java/com/jarvis/
    │   │   ├── MetaDATModule.kt    Native Android module
    │   │   └── MetaDATPackage.kt   Module registration
    │   └── AndroidManifest.xml     Permissions & DAT app ID
    ├── app/build.gradle.kts        DAT dependency declarations
    └── settings.gradle.kts        GitHub Packages repository
```

---

## 8 — Cactus model configuration

By default `useJarvis.ts` uses Cactus's default models with `int4` quantization. You can pin specific models by passing them to the constructors:

```ts
// src/hooks/useJarvis.ts
lm.current = new CactusLM({
  model: 'llama-3.2-3b-instruct',   // override default
  options: { quantization: 'int8' },
});
stt.current = new CactusSTT({
  model: 'whisper-base',
  options: { quantization: 'int4' },
});
```

See [Cactus model catalog](https://github.com/cactus-compute/cactus-react-native) for available options.

---

## 9 — Useful links

| Resource | URL |
|---|---|
| Meta Wearables Developer Center | https://wearables.developer.meta.com/ |
| Meta DAT iOS SDK | https://github.com/facebook/meta-wearables-dat-ios |
| Meta DAT Android SDK | https://github.com/facebook/meta-wearables-dat-android |
| Meta DAT API reference (iOS) | https://wearables.developer.meta.com/docs/reference/ios_swift/dat/0.6 |
| Meta DAT full docs | https://wearables.developer.meta.com/docs/develop/ |
| Cactus React Native | https://github.com/cactus-compute/cactus-react-native |
| Cactus main repo | https://github.com/cactus-compute/cactus |

---

## License

MIT
