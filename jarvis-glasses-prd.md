# Jarvis — Voice Agent on Ray-Ban Meta

**Project:** Jarvis-on-Glasses
**Owner:** Patrick
**Status:** Pre-build / hackathon spec
**Target platform:** iOS (iPhone 15+) + Ray-Ban Meta (2023 Wayfarer)
**Date:** April 2026

---

## Problem Statement

When I'm away from my desk — walking around, hands busy, in a conversation, mid-task in the physical world — my most capable computing environment (my laptop, with all my files, apps, accounts, and a full-fledged agentic AI) is effectively inaccessible. I can pull out my phone, but a phone is a narrow, attention-hungry window. The interaction cost of "open phone → open app → type prompt → read response → dismiss" is high enough that most of the time I just don't bother. The result is that my laptop sits idle while I defer tasks ("I'll do that when I get back to my desk") and my physical context — what I'm looking at, what's in front of me — is completely disconnected from the AI I'd otherwise consult about it.

Existing voice assistants (Siri, "Hey Meta") solve a narrow slice of this: set a timer, send a text, answer a trivia question. None of them can see what I see, none of them can reach into my actual desktop environment and *do* things, and none of them orchestrate across devices. Meta's own AI on the Ray-Bans is a closed loop — it answers questions but can't act on my behalf outside its own walled garden.

What I want is a persistent, always-listening agent that lives on my face and in my pocket, sees what I see, and can dispatch real work to my real computer — drafting emails, reading files, using apps — while I continue doing whatever I was doing in meatspace. I want Jarvis, not a chatbot with a microphone.

## Solution

A three-tier voice agent system built on hardware I already own:

1. **Ray-Ban Meta glasses** act as the sensor and output surface — microphone captures my voice, camera captures my environment on demand, speaker delivers responses. Glasses stay on all day.

2. **iPhone** runs the orchestrator: Gemma 4 E4B via Cactus on the Apple Neural Engine. This is the brain. It hears everything via the glasses' mic, wakes on "Hey Jarvis," classifies my intent, and decides what to do — answer locally, call a cloud vision model for environmental questions, or delegate a task to my laptop.

3. **Laptop** runs Claude Code with computer use enabled, acting as the execution surface. When Jarvis decides a task requires my real desktop (read an email, update a spreadsheet, file a PR, draft a message), it ships the task to Claude Code over a local bridge. Claude Code does the work autonomously and messages back when done; the phone reads the result aloud through the glasses.

The user experience is: I say "Hey Jarvis, what's on my desk?" and hear an answer 3 seconds later. Or I say "Hey Jarvis, find the Harvard acceptance letter email from March and draft a thank-you reply," keep walking, and 90 seconds later hear "Draft is ready for your review." The phone is the brain, the glasses are the I/O, and the laptop is the hands.

## User Stories

1. As a user wearing Ray-Ban Metas, I want to trigger Jarvis hands-free by saying "Hey Jarvis," so that I don't have to touch the glasses or my phone.
2. As a user, I want "Hey Jarvis" wake detection to run fully on-device, so that my audio never leaves my phone unless I intend for it to.
3. As a user, I want the system to distinguish "Hey Jarvis" from "Hey Meta" reliably, so that Meta's own assistant and mine don't fight each other.
4. As a user, I want to ask Jarvis a question about what I'm looking at ("what's this?", "read this to me", "what's on my desk?"), so that my glasses function as my eyes for the AI.
5. As a user, I want the system to only capture a camera frame when the voice prompt actually needs vision, so that my glasses battery and privacy aren't wrecked by continuous streaming.
6. As a user, I want environmental questions to be answered in under 5 seconds of perceived latency, so that it feels like a conversation, not a query.
7. As a user, I want Jarvis to speak answers through the glasses' speakers, so that I keep my eyes and hands free.
8. As a user, I want Jarvis to use a voice that doesn't sound like a phone GPS, so that talking to it feels natural.
9. As a user, I want to delegate tasks to my laptop by voice ("draft an email to X about Y", "find the file I was editing yesterday and summarize it", "open Gmail and triage my inbox"), so that I can put my computer to work while I'm away from it.
10. As a user, I want the system to route decisions based on task capability — local answer vs. vision query vs. desktop action — so that each class of request goes to the right execution surface.
11. As a user, I want the glasses to give me progress updates during long-running desktop tasks ("opening Gmail... drafting the email... done"), so that I know the system is working and when it's finished.
12. As a user, I want Jarvis to stop *before* sending irreversible actions (sending emails, making payments, deleting files) and ask me to confirm, so that a misheard prompt or misinterpreted intent doesn't cause real-world damage.
13. As a user, I want Jarvis to notice when it's not confident about my intent and ask a one-question clarification, so that ambiguous prompts don't silently go to the wrong execution surface.
14. As a user, I want to correct Jarvis mid-task ("wait, actually do Y instead"), so that I can redirect without starting over.
15. As a user, I want the phone→laptop bridge to work on my home wifi and on hotel wifi and on my phone's hotspot, so that the system is usable on travel and not just at my desk.
16. As a user, I want audio that *is* sent to the cloud (for vision QA or desktop delegation) to go directly from my phone to Anthropic or the VLM provider, not through any third-party relay, so that I have a clear privacy story.
17. As a user, I want the glasses to visibly indicate when the system is actively listening or processing, so that I and people around me can tell when the device is engaged.
18. As a developer, I want the routing logic to be modular and swappable, so that I can replace Gemma 4 with a different planner model later without rewriting the whole pipeline.
19. As a developer, I want the desktop execution surface to be swappable, so that I can add OpenClaw support or a custom local agent later without touching the phone app.
20. As a developer, I want each subsystem (wake word, STT, router, VLM client, bridge client) testable in isolation, so that I can iterate on one without breaking the others.
21. As a user, I want a fallback mode where if Gemma 4 native audio input isn't reliable, the system falls back to Apple on-device STT, so that the voice path never fully breaks.
22. As a user, I want a fallback wake mode (long-press the glasses capture button) available in addition to "Hey Jarvis," so that if the hot-mic misbehaves on stage or in noisy environments I still have a reliable invocation path.
23. As a user, I want the system to gracefully degrade if the laptop is asleep, offline, or Claude Code is down, so that Jarvis still works as an environmental Q&A assistant even when the desktop side is unavailable.
24. As a hackathon demoer, I want a scripted 3-minute demo flow that exercises environment awareness, desktop delegation, and confidence-based clarification, so that I can reliably show the system's capabilities on stage.
25. As a hackathon demoer, I want a canned staging environment (pre-logged-in apps, known desktop state, known physical props) so that computer-use actions on the laptop are reproducible and don't hit login walls or CAPTCHAs mid-demo.

## Implementation Decisions

### Platform & Stack

- **Glasses:** Ray-Ban Meta 2023 Wayfarer. Integrated via the Meta Wearables Device Access Toolkit (iOS SDK, Swift 6). DAT provides camera frame capture and audio streaming. Glasses speakers are addressed as a standard iOS Bluetooth audio output — TTS output routes through normal iOS audio.
- **Phone:** iPhone 15 or newer, iOS 17+. Native Swift app. No React Native, no Flutter. Rationale: Meta DAT is Swift-first, Cactus has a Swift binding with Apple NPU acceleration (shipped Jan 2026), and cross-platform has no demo-day benefit.
- **On-device model:** Gemma 4 E4B (4.5B effective params, multimodal, 128K context) running via Cactus on the Apple Neural Engine. E4B chosen over E2B because E2B is too weak to be a reliable tool-calling planner.
- **Desktop agent:** Claude Code with computer use enabled, running on the user's laptop. This is the "Dispatch pattern" — not the Claude-branded Dispatch product, but the same architectural idea: phone sends natural-language tasks to a local Claude instance that owns the desktop.
- **Cloud VLM:** Claude Sonnet 4.6 (or Gemini, as a swappable provider) called from the phone directly over HTTPS when the router decides a prompt needs vision.

### Audio pipeline

- **Wake word:** Always-on hot-mic streaming from glasses over BT LE Audio to the phone. Wake detection is on-device. Primary path: Gemma 4 audio input (stretch / risky) if the Cactus Swift pipeline supports it end-to-end. **Fallback path: Picovoice Porcupine with a custom "Hey Jarvis" keyword.** The fallback is built in parallel from day one, not after the primary fails.
- **Wake word phonetic isolation:** "Jarvis" chosen to be phonetically distant from "Meta" so the glasses' built-in Meta AI wake word and Jarvis don't collide on the same utterance.
- **STT:** Primary path: Gemma 4 native audio input (ship audio tokens straight into E4B). **Fallback: Apple on-device `SFSpeechRecognizer`.** Fallback is not optional; it's the demo-safe path.
- **TTS:** ElevenLabs Flash v2 streaming TTS for demo-grade voice quality. Audio streamed from phone to glasses as standard BT audio output. Apple `AVSpeechSynthesizer` as free offline fallback.
- **Audio session management:** iOS audio session claimed for voice chat category. Accept that "Hey Meta" may still interrupt — design around it rather than trying to suppress it.

### Camera pipeline

- **Capture mode:** On-demand only. Frames are grabbed via DAT when the router determines the current prompt requires vision. No continuous streaming. No background capture.
- **Frame handling:** Captured frame is base64-encoded and sent along with the transcribed prompt directly to the cloud VLM. Frames are not persisted on the phone beyond the current request.

### Routing

- **Router model:** Gemma 4 E4B with a fixed system prompt describing available capabilities and a JSON-output tool-call format.
- **Routing strategy:** Capability-based. Gemma 4 classifies each prompt into one of:
  - `local_answer` — general knowledge, chit-chat, simple reasoning the model can handle itself
  - `vision_query` — requires a camera frame; routed to cloud VLM
  - `desktop_action` — requires the laptop; routed to the desktop agent bridge
  - `clarify` — confidence is low, ask a one-question follow-up before proceeding
- **Confidence threshold:** Gemma 4 emits a confidence score (via prompt structure or logprob heuristic). Below threshold → `clarify` path. This is the routing safety net.
- **No rule-based override layer** in v1. Router is pure Gemma. Confidence threshold + clarify path is the only safety net. (Rule-based overrides are a v2 addition if Gemma's routing proves unreliable in practice.)

### Desktop bridge

- **Architecture:** Phone runs a client that POSTs task payloads to a small relay process running on the laptop alongside Claude Code. Relay translates into Claude Code CLI invocations with computer use enabled. Claude Code does the work. Result is streamed back to the phone over the same channel.
- **Transport:** Tailscale between phone and laptop (or equivalent zero-config mesh VPN). Justification: works on home wifi, hotel wifi, and hotspot without port forwarding or NAT hell. Demo-critical.
- **Auth:** Tailscale handles identity; the relay additionally validates a shared secret on each request. No API keys on the phone side for the relay itself (the phone's Anthropic API key is separate and stays on the phone).
- **Progress updates:** Relay streams partial output back to the phone as Claude Code emits it (structured JSON events from Claude Code's streaming output mode). Phone TTS speaks stage updates ("opening Gmail... drafting the email... done") through the glasses during long tasks, rather than leaving dead air.
- **Irreversible-action guardrail:** Task payloads from the phone include a `confirm_before: ["send", "pay", "delete", "submit"]` field. Claude Code is instructed in its system prompt to pause and request confirmation before any action matching the list. Confirmation comes back to the phone, user responds via voice.

### Degradation modes

- **Laptop offline / Claude Code unreachable:** Phone detects via bridge heartbeat. `desktop_action` prompts are responded to with "Your laptop isn't reachable right now — want me to remember this for later, or try to answer here?" Local and vision paths continue to work.
- **Cloud VLM unavailable:** `vision_query` prompts fall back to Gemma 4 E4B's own vision capability on-device (slower, lower quality, but works).
- **Primary wake-word path fails:** Fall back to Porcupine. No user-visible change.
- **Primary STT path fails:** Fall back to Apple `SFSpeechRecognizer`. No user-visible change.
- **All voice paths fail:** Long-press glasses capture button to manually open a listening window (DAT supports standard button events).

### Modules

The system decomposes into these deep modules, each with a narrow tested interface:

1. **GlassesIO** — wraps Meta DAT. Exposes: `startAudioStream()`, `stopAudioStream()`, `captureFrame()`, `playAudio(pcmStream)`, `onButtonEvent(callback)`. Hides all DAT / BT plumbing behind these calls.
2. **WakeDetector** — consumes an audio stream, fires a callback on wake. Two implementations behind a common protocol: `GemmaAudioWakeDetector` (primary) and `PorcupineWakeDetector` (fallback). Swappable at runtime.
3. **Transcriber** — consumes an audio buffer, returns text. Two implementations: `GemmaTranscriber` and `AppleTranscriber`. Same protocol.
4. **Router** — takes `{prompt: String, hasRecentFrame: Bool}`, returns a `RouteDecision` enum (`.localAnswer | .visionQuery | .desktopAction | .clarify`) with optional structured parameters. Wraps Gemma 4 E4B inference via Cactus.
5. **LocalAnswerer** — takes text prompt, returns text reply via Gemma 4 E4B.
6. **VisionClient** — takes `{prompt: String, frame: Image}`, returns text reply. Wraps the cloud VLM API.
7. **DesktopBridgeClient** — takes a structured task, returns a stream of progress events and a final result. Wraps the Tailscale-hosted relay.
8. **Speaker** — takes text, plays it through glasses audio output. Two implementations: `ElevenLabsSpeaker` and `AppleSpeaker`. Same protocol.
9. **Orchestrator** — the top-level coordinator. Subscribes to `WakeDetector`, runs the full turn: wake → transcribe → route → execute → speak. Owns the session state machine (idle / listening / thinking / executing / speaking).

On the laptop:

10. **DesktopRelay** — small Node or Swift-on-macOS process. Exposes an HTTP endpoint over Tailscale. Translates incoming tasks into Claude Code CLI invocations with computer use. Streams output back.

### API contracts

- **Phone → Desktop relay:** JSON POST `{task: String, context: [...], confirm_before: [String], session_id: String}`. Streaming response of JSON events: `{type: "progress" | "needs_confirmation" | "result" | "error", payload: ...}`.
- **Phone → Cloud VLM:** standard Anthropic Messages API with an image content block and a text prompt. No intermediary.
- **Phone → Gemma 4 (via Cactus):** Cactus Swift SDK native call. Router uses a structured-output prompt format returning JSON.

## Testing Decisions

Good tests for this system exercise externally observable behavior through module boundaries, not internal implementation. Inference-layer stuff (Cactus, Gemma output) is mockable because every module consuming it depends on a protocol, not a concrete class.

Priority modules for tests:

- **Router** — highest-value tests. Table-driven: (prompt, expected route, expected confidence band). Test the actual Gemma output against a fixed prompt set. Include adversarial ambiguous prompts that should land in `.clarify`. This is the module most likely to silently misbehave in production.
- **DesktopBridgeClient** — tests against a mock relay. Verify streaming progress events are forwarded, confirmation flow round-trips, errors surface cleanly, heartbeat / offline detection works.
- **Orchestrator state machine** — tests the turn lifecycle. Given mocked Router / VisionClient / etc., verify state transitions are correct and that concurrent wake events during an active turn are handled (probably: ignored until idle).
- **GlassesIO** — integration test with the DAT Mock Device Kit (Meta ships one). Verify audio stream start/stop, frame capture, button events.
- **Degradation paths** — explicit tests that with primary wake/STT disabled, the system still completes a full turn via fallbacks.

Deprioritized for v1 (but should exist eventually): WakeDetector implementations (hard to unit-test audio models reliably — rely on manual test in loud / quiet / "Hey Meta" collision scenarios), Speaker implementations (output quality is subjective).

No prior art in this codebase — greenfield project. Pattern to borrow from: Swift `protocol`-based DI with a `TestHarness` entry point that swaps concrete module implementations for mocks.

## Out of Scope

- **Android support.** iOS only, full stop. Ports are post-hackathon.
- **Multi-user / multi-account.** One user, one phone, one laptop. No account system.
- **Ray-Ban Meta Display (HUD).** Not in the Meta DAT preview, and not needed for a voice-first product.
- **On-glasses UI rendering.** DAT doesn't support it in preview and we don't need it.
- **Running Claude Code sessions without a laptop** — we are not trying to host Claude Code in the cloud for this project.
- **Background / heartbeat autonomous tasks** (OpenClaw-style cron work). v1 is strictly reactive — user says something, system responds.
- **Persistent memory across sessions.** No long-term user memory in v1. Each invocation starts from a clean router context. (Claude Code retains its own session state on the laptop.)
- **Multi-turn conversations within a single wake event.** v1 is one turn per wake. Future work.
- **Integration with Meta AI itself.** We do not try to suppress, replace, or hook into "Hey Meta."
- **OpenClaw integration.** Architecturally possible via the swappable desktop agent interface, but not built in v1.
- **MedSentinel.** Separate project. Any Jarvis infrastructure is not shared with that pitch.
- **Production-grade security hardening** of the Tailscale relay. Shared-secret + Tailscale identity is good enough for personal use and demo; not for multi-tenant shipping.

## Further Notes

### Known risks (ordered by likelihood)

1. **"Hey Meta" collides with "Hey Jarvis" on stage.** Mitigation: rehearse with glasses in hand, test phonetic distance empirically, have button-to-arm fallback ready one keystroke away.
2. **Gemma 4 native audio input path isn't fully supported by Cactus's Swift SDK yet.** Mitigation: Porcupine + Apple STT fallback is built in parallel from day one, same protocol, swap is a config change.
3. **Claude Code computer use fails mid-demo on a live website.** Mitigation: canned staging environment, pre-logged-in apps, demo the draft not the send.
4. **Hotel wifi blocks Tailscale.** Mitigation: test on the actual venue network days before; fallback is phone hotspot with the laptop tethered.
5. **Glasses battery dies during extended demo rehearsal.** Mitigation: charge between run-throughs, have a second charged pair if possible, don't stream mic for longer than actually needed in rehearsal.
6. **Gemma 4 router misroutes a prompt in a way the confidence threshold doesn't catch.** Mitigation: rehearse the demo script's prompts extensively so the team knows which prompts Gemma reliably routes correctly; for demo day, the script sticks to rehearsed prompts.
7. **Meta DAT rate-limits audio streaming or camera capture in ways not yet documented in the preview.** Mitigation: hit this early in build and design around whatever limit we find. Nothing to do before then.

### The ambitious bets (on the record)

Three non-default choices were made with full awareness of the risks:

- Hot-mic always-on wake detection (instead of button-to-arm)
- Gemma 4 native audio as the primary STT path (instead of Apple STT)
- Capability-based routing (instead of fixed tool routing)

Each has a documented fallback. None are allowed to block the demo path; the fallbacks are wired in parallel.

### Demo script (reference, to be iterated)

3-minute flow, glasses-first:

- **Scene 1 (30s) — environment QA:** User looks at a specific object ("what's this?"). Jarvis routes to cloud VLM, answers in ~3s through glasses.
- **Scene 2 + 3 as one continuous flow (90s) — delegation with live narration:** User delegates a multi-step task to the laptop ("draft a thank-you email for the acceptance letter in my inbox"). Glasses give progress updates in real time while Claude Code works on the big screen behind the demo stage. Task stops at "draft ready for your review" — no auto-send.
- **Scene 4 (30s) — mid-task correction:** User redirects Jarvis mid-execution ("wait, add a line about visiting campus in May"). System pivots, finishes. Shows that the orchestration is live, not a pre-recorded video.
- **Close (30s):** Pitch the architecture — phone is the brain, glasses are the I/O, laptop is the hands. Gemma 4 on-device for privacy + routing; Claude Code for execution; all modular. Hand off.

### Open items

- **The user story is underspecified.** This PRD describes what Jarvis *is* without pinning down *who it's for* beyond "power user / me." That's fine for a hackathon demo and a build spec, but before any shipping / fundraising conversation the wedge has to be sharpened. Candidate framings (founders/power users, field workers, accessibility, dev platform) remain open.
- **Latency budget isn't formally measured yet.** Estimates in this doc are extrapolations from Cactus's published numbers and ElevenLabs' docs. First week of build should establish real measurements for: wake-to-transcribe, transcribe-to-route, route-to-cloud-VLM-first-audio, desktop-task-first-progress-event. Demo pacing depends on these being real numbers, not guesses.
