# Jarvis — Complete Setup Guide
## iPhone + Meta Ray-Ban (Developer Mode)

This guide assumes your Ray-Ban Meta glasses are already in Developer Mode (tap the firmware version 5× in Meta AI app → Devices → About). If you see a "Developer" badge in device settings, you're set.

---

## What you'll need

| Item | Notes |
|---|---|
| iPhone 15+ running iOS 17+ | Must be physical device — Bluetooth required |
| Mac with Xcode 14+ | For building and signing the app |
| Node 18+ on Mac | `brew install node` |
| Meta AI app v254+ on iPhone | Latest version from App Store |
| Ray-Ban Meta glasses, firmware v20+ | Already in Developer Mode |
| Laptop (Mac) for desktop delegation | Needs Claude Code + Tailscale |
| Apple Developer account (free tier ok) | For signing the app |

---

## Part 1 — Credentials & API Keys

### 1a — Meta Developer credentials (already set up)
Your `ios/Jarvis/Secrets.xcconfig` should already have:
```
META_APP_ID = 1487636526490742
META_CLIENT_TOKEN = AR|1487636526490742|...
```
If not, go to [wearables.developer.meta.com](https://wearables.developer.meta.com/), open your project, and copy the credentials.

### 1b — Create your `.env` file
```bash
cd ~/jarvis
cp .env.example .env
```

Fill in `.env`:

**Anthropic (vision queries via Claude Sonnet):**
- Go to [console.anthropic.com/settings/keys](https://console.anthropic.com/settings/keys)
- Create an API key → paste as `ANTHROPIC_API_KEY`

**Google AI Studio (cloud Gemma for complex reasoning):**
- Go to [aistudio.google.com/apikey](https://aistudio.google.com/apikey)
- Create an API key → paste as `GEMMA_API_KEY`

**ElevenLabs (natural-sounding TTS through glasses speakers):**
- Go to [elevenlabs.io](https://elevenlabs.io) → Profile → API Keys
- Free tier gives 10,000 chars/month — enough for heavy daily use
- Paste as `ELEVENLABS_API_KEY`
- Leave `ELEVENLABS_VOICE_ID` blank to use the default (Adam voice)

**Desktop relay (skip if you don't want laptop delegation yet):**
- Set `RELAY_SECRET` to any random string (e.g. `openssl rand -hex 16`)
- Come back to set `RELAY_URL` after Part 4

---

## Part 2 — iPhone app: build & deploy

### 2a — Install JS dependencies
```bash
cd ~/jarvis
npm install
```

### 2b — Install CocoaPods
```bash
cd ~/jarvis/ios
pod install
cd ..
```

### 2c — Open in Xcode
```bash
open ~/jarvis/ios/Jarvis.xcodeproj
```

### 2d — Attach Secrets.xcconfig
1. In Xcode's left panel, click **Jarvis** (blue icon at top)
2. Click the **Project** (not a target) → **Info** tab
3. Under **Configurations**, expand **Debug** and **Release**
4. Set both to **Secrets.xcconfig**

### 2e — Add Meta DAT Swift package
1. **File → Add Package Dependencies…**
2. Paste: `https://github.com/facebook/meta-wearables-dat-ios`
3. Select latest version → add to the **Jarvis** target

### 2f — Sign the app
1. Select the **Jarvis target** → **Signing & Capabilities** tab
2. Check **Automatically manage signing**
3. Set **Team** to your Apple Developer account

### 2g — Deploy to iPhone
1. Plug iPhone into Mac via USB cable
2. Unlock iPhone and tap **Trust This Computer** if prompted
3. Select your iPhone from the device dropdown at the top of Xcode
4. Press **⌘R** — Xcode builds and installs the app

**First launch:** The app downloads Cactus AI models (~200–400 MB). Wait for "Ready" before proceeding. Use WiFi, not cellular.

---

## Part 3 — Pair glasses with the app

### 3a — Open Meta AI app on iPhone
Make sure the Meta AI app is running in the background whenever you use Jarvis — it acts as the Bluetooth bridge.

### 3b — Register in Jarvis
1. Open **Jarvis** on iPhone
2. Tap **Register with Meta AI App**
3. The Meta AI app opens and asks you to approve the pairing — tap **Allow**
4. You're returned to Jarvis automatically (via the `jarvis://` deep link)

### 3c — Grant camera permission
1. Tap **Grant Camera Access**
2. Meta AI app opens again asking for camera permission — tap **Allow**
3. Return to Jarvis

### 3d — Connect to glasses
1. Put on your Ray-Ban Meta glasses (or leave them nearby)
2. Tap **Connect to Glasses** in Jarvis
3. Status changes: `stopped` → `waitingForDevice` → `starting` → **`streaming`**
4. The green dot in the header = connected and listening

### 3e — Test it
Speak naturally. After a ~1.5s pause, Jarvis transcribes and responds. You should hear the response through your glasses speakers.

Try:
- "What's the capital of Japan?" → local answer (no internet needed)
- "Write me a Python function that reverses a string" → escalates to cloud Gemma
- Point glasses at something and say "What's this?" → captures a photo, sends to Claude Vision

---

## Part 4 — Desktop relay (laptop delegation)

This enables "Hey Jarvis, draft an email to X about Y" — the phone dispatches the task to Claude Code running on your laptop.

### 4a — Install Tailscale on both devices
- Mac: [tailscale.com/download](https://tailscale.com/download) → install and sign in
- iPhone: Tailscale app from App Store → sign in with same account
- Verify: `tailscale status` on Mac shows your iPhone

### 4b — Install Claude Code on laptop
```bash
npm install -g @anthropic-ai/claude-code
claude login
```

### 4c — Start the desktop relay
```bash
cd ~/jarvis/desktop-relay
cp .env.example .env
# Edit .env — set RELAY_SECRET to the same value you put in the app's .env
npm install
npm start
```

You'll see:
```
[Jarvis Desktop Relay] listening on port 7878
[relay] Tailscale: set RELAY_URL=http://100.x.x.x:7878 in the app's .env
```

### 4d — Set RELAY_URL in the app's .env
```
# On Mac:
tailscale ip -4
# → e.g. 100.64.1.5
```

Edit `~/jarvis/.env`:
```
RELAY_URL=http://100.64.1.5:7878
```

### 4e — Rebuild the app
Any `.env` change requires a full rebuild (Metro caches env vars at bundle time):
```bash
cd ~/jarvis
npx react-native start --reset-cache &
# then in Xcode, press ⌘R
```

### 4f — Test desktop delegation
Say: "Draft an email to Patrick about the hackathon progress"

You'll see in Jarvis:
- Progress banner: "Received task — starting Claude Code…"
- Progress updates spoken aloud: "Opening Gmail… Drafting email… Ready for review"
- The header shows a second dot indicating laptop online status

For irreversible actions (send, delete, etc.) Jarvis pauses and asks for confirmation before proceeding.

---

## Part 5 — Daily use checklist

Before using Jarvis out in the world:

- [ ] **iPhone**: Jarvis app open (can be backgrounded after connecting)
- [ ] **iPhone**: Meta AI app running in background
- [ ] **iPhone**: Bluetooth enabled
- [ ] **Glasses**: Firmware v20+ (check in Meta AI app → Devices → About)
- [ ] **Glasses**: Charged (check in Meta AI app)
- [ ] **Laptop** (if delegating tasks): Tailscale running, `npm start` in `desktop-relay/`

---

## Troubleshooting

| Symptom | Fix |
|---|---|
| Glasses don't appear after "Connect" | Open Meta AI app → ensure it's in foreground once, then background it |
| "MetaDATModule not found" | Run `cd ios && pod install` then rebuild in Xcode |
| `$(META_APP_ID)` appears literally in build | Secrets.xcconfig not attached — see step 2d |
| No audio from glasses | Re-pair Bluetooth in iOS Settings. Re-enable Developer Mode if it reset after firmware update. |
| Responses silent (no TTS) | Check ELEVENLABS_API_KEY in .env. Apple TTS fallback still works — check iPhone volume. |
| Vision query returns generic response | Check ANTHROPIC_API_KEY. Falls back to on-device Gemma if key missing. |
| Desktop tasks fail: "not reachable" | Check Tailscale on both devices. Verify `desktop-relay` is running. |
| Desktop tasks fail: "claude CLI not found" | Run `npm install -g @anthropic-ai/claude-code` on laptop. |
| App Store install blocked | Expected — ExternalAccessory/MFi requirement. Use direct Xcode install or TestFlight only. |
| App crashes on launch | Check Xcode logs. Usually means Info.plist MWDAT keys are empty (Secrets.xcconfig not attached). |

---

## Architecture at a glance

```
Ray-Ban Glasses (mic + speakers + camera)
         │ Bluetooth HFP (audio) + DAT SDK (camera)
         ▼
      iPhone
  ├── MetaDATModule.swift  — native bridge to Meta DAT
  ├── AVAudioEngine         — glasses mic → PCM at 16 kHz
  ├── CactusSTT             — on-device speech-to-text (Gemma 4 E4B)
  ├── Router.ts             — classify intent (heuristic + on-device LLM)
  ├── CactusLM              — on-device answers (Gemma 4 E4B)
  ├── GemmaCloud.ts         — complex reasoning (Gemma 4 27B via Google AI)
  ├── AnthropicVision.ts    — what do I see? (Claude Sonnet 4.6)
  ├── DesktopBridgeClient   — dispatch tasks to laptop
  └── Speaker.ts            — ElevenLabs TTS → glasses speakers
         │ Tailscale (or LAN)
         ▼
      Laptop
  └── desktop-relay/        — Node.js HTTP server → claude CLI (computer use)
```

**Route decisions:**
- `local_answer` → answered on-device, ~200ms
- `cloud_answer` → cloud Gemma, ~2–3s
- `vision_query` → capture frame → Claude Sonnet, ~3–5s
- `desktop_action` → relay → Claude Code on laptop, 10–90s with progress audio
- `clarify` → ask follow-up question, no round-trip

---

## Notes on "Hey Jarvis" wake word

The current build uses a 1.5-second silence VAD (voice activity detection) — you speak, pause, and Jarvis responds. A true "Hey Jarvis" wake word (Porcupine) is the next step and requires:

1. A Picovoice access key (free tier available at [picovoice.ai](https://picovoice.ai))
2. A trained custom keyword model for "Hey Jarvis"
3. `@picovoice/porcupine-react-native` package + native setup

Until then, the silence-trigger works well and is demo-safe.
