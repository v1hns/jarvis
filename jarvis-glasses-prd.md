# Jarvis — Voice Agent on Ray-Ban Meta

**Project:** Jarvis-on-Glasses
**Owner:** Patrick
**Status:** Prototype in progress / repo-synced PRD
**Target platform:** iOS + Meta smart glasses
**Date:** April 2026

---

## Problem Statement

When I'm away from my desk — walking around, hands busy, in a conversation, mid-task in the physical world — my most capable computing environment (my laptop, with all my files, apps, accounts, and a full-fledged agentic AI) is effectively inaccessible. I can pull out my phone, but a phone is a narrow, attention-hungry window. The interaction cost of "open phone → open app → type prompt → read response → dismiss" is high enough that most of the time I just don't bother. The result is that my laptop sits idle while I defer tasks ("I'll do that when I get back to my desk") and my physical context — what I'm looking at, what's in front of me — is completely disconnected from the AI I'd otherwise consult about it.

Existing voice assistants (Siri, "Hey Meta") solve a narrow slice of this: set a timer, send a text, answer a trivia question. None of them can see what I see, none of them can reach into my actual desktop environment and *do* things, and none of them orchestrate across devices. Meta's own AI on the Ray-Bans is a closed loop — it answers questions but can't act on my behalf outside its own walled garden.

What I want is a persistent, always-listening agent that lives on my face and in my pocket, sees what I see, and can dispatch real work to my real computer — drafting emails, reading files, using apps — while I continue doing whatever I was doing in meatspace. I want Jarvis, not a chatbot with a microphone.

## Solution

A three-tier voice agent system built on hardware I already own:

1. **Ray-Ban Meta glasses** act as the sensor and output surface — microphone captures my voice, camera captures my environment on demand, speaker delivers responses. Glasses stay on all day.

2. **iPhone** runs the orchestrator in a React Native app with a thin native Swift bridge for Meta DAT. This is the brain. It listens while the glasses session is active, classifies my intent, and decides what to do — answer locally, call cloud models for harder reasoning or live vision questions, search recent episodic memory, or delegate a task to my laptop.

3. **Laptop** runs Claude Code with computer use enabled, acting as the execution surface. When Jarvis decides a task requires my real desktop (read an email, update a spreadsheet, file a PR, draft a message), it ships the task to Claude Code over a local bridge. Claude Code does the work autonomously, can stream progress updates back to the phone, and pauses for confirmation before irreversible actions.

The user experience is: I ask "Jarvis, what's on my desk?" and hear an answer a few seconds later. Or I say "Jarvis, find the Harvard acceptance letter email from March and draft a thank-you reply," keep walking, and later hear "Draft is ready for your review." Or I ask "Where did I leave my keys earlier?" and Jarvis answers from recent episodic memory built from images captured throughout the day. The phone is the brain, the glasses are the I/O, and the laptop is the hands.

## Primary User And Wedge

The initial wedge is **single-user laptop-native power users**:

- founders, engineers, operators, PMs, and researchers
- people whose real work already lives in email, docs, browser apps, code, and files
- people who are frequently away from their desk but still need their computer to keep moving work forward

The core job-to-be-done is:

> "While I am walking, in transit, hands busy, or in the middle of something physical, keep my laptop useful without forcing me back into a phone UI."

The highest-value v1 moments are:

1. **Fast local help** for short spoken questions that should not require pulling out a phone.
2. **Vision help** for "what am I looking at?" moments in the physical world.
3. **Episodic memory recall** for "where did I leave that?" or "what did I do earlier?" moments.
4. **Desktop delegation** for work that already lives on the user's own laptop.

The product is **not** initially optimized for:

- a general consumer voice-assistant replacement
- multi-user households or shared-device memory
- enterprise field-ops deployments with admin, compliance, or fleet-management requirements

This wedge is intentionally narrow because it matches the current architecture: one user, one phone, one laptop, strong desktop leverage, and high tolerance for early-product rough edges in exchange for real time savings.

## User Stories

1. As a user wearing Ray-Ban Metas, I want to trigger Jarvis hands-free by saying "Hey Jarvis," so that I don't have to touch the glasses or my phone.
2. As a user, I want "Hey Jarvis" wake detection to run fully on-device, so that my audio never leaves my phone unless I intend for it to.
3. As a user, I want the system to distinguish "Hey Jarvis" from "Hey Meta" reliably, so that Meta's own assistant and mine don't fight each other.
4. As a user, I want to ask Jarvis a question about what I'm looking at ("what's this?", "read this to me", "what's on my desk?"), so that my glasses function as my eyes for the AI.
5. As a user, I want the system to keep vision capture intentional — on-demand for live vision questions and low-frequency snapshots for episodic memory — so that battery and privacy stay sane.
6. As a user, I want environmental questions to be answered in under 5 seconds of perceived latency, so that it feels like a conversation, not a query.
7. As a user, I want Jarvis to speak answers through the glasses' speakers, so that I keep my eyes and hands free.
8. As a user, I want Jarvis to use a voice that doesn't sound like a phone GPS, so that talking to it feels natural.
9. As a user, I want to delegate tasks to my laptop by voice ("draft an email to X about Y", "find the file I was editing yesterday and summarize it", "open Gmail and triage my inbox"), so that I can put my computer to work while I'm away from it.
10. As a user, I want the system to route decisions based on task capability — local answer vs. cloud answer vs. vision query vs. memory query vs. desktop action — so that each class of request goes to the right execution surface.
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
21. As a user, I want a fallback mode where if the preferred on-device speech path isn't reliable, the system falls back to Apple on-device STT, so that the voice path never fully breaks.
22. As a user, I want a fallback wake mode (long-press the glasses capture button) available in addition to "Hey Jarvis," so that if the hot-mic misbehaves on stage or in noisy environments I still have a reliable invocation path.
23. As a user, I want the system to gracefully degrade if the laptop is asleep, offline, or Claude Code is down, so that Jarvis still works as an environmental Q&A assistant even when the desktop side is unavailable.
24. As a hackathon demoer, I want a scripted 3-minute demo flow that exercises environment awareness, desktop delegation, and confidence-based clarification, so that I can reliably show the system's capabilities on stage.
25. As a hackathon demoer, I want a canned staging environment (pre-logged-in apps, known desktop state, known physical props) so that computer-use actions on the laptop are reproducible and don't hit login walls or CAPTCHAs mid-demo.
26. As a user, I want Jarvis to answer questions like "where did I leave my keys earlier?" or "what did I do this morning?" by searching a recent episodic memory built from glasses photos.
27. As a user, I want episodic memory to stay local to my phone and expire automatically after a short retention window, so that Jarvis feels useful without becoming creepy.

## Implementation Decisions

### Platform & Stack

- **Glasses:** Meta smart glasses, with Ray-Ban Meta as the primary target. Integrated via the Meta Wearables Device Access Toolkit (iOS SDK, Swift). DAT provides session management, camera capture, and device state; glasses speakers are addressed as a standard iOS Bluetooth audio output.
- **Phone:** iPhone, iOS-only. The app is a React Native shell with a native Swift module for Meta DAT and audio/session control. Rationale: fast product iteration in JS while keeping the hardware integration in the native layer where DAT requires it.
- **On-device AI:** Cactus-hosted local models on the phone handle routing, short answers, memory encoding, and memory-query synthesis. The specific local model can evolve without changing the app surface.
- **Cloud Gemma (escalation path):** Google AI Studio–hosted Gemma 4 (default: `gemma-4-27b-it`, swappable). Cloud Gemma handles long-context or higher-complexity reasoning that the local model should not shoulder. API key stored in `.env` as `GEMMA_API_KEY`, read at app startup and never logged.
- **Desktop agent:** Claude Code with computer use enabled, running on the user's laptop. This is the "Dispatch pattern" — not the Claude-branded Dispatch product, but the same architectural idea: phone sends natural-language tasks to a local Claude instance that owns the desktop.
- **Cloud VLM:** A swappable vision provider called directly from the phone over HTTPS when the router decides a prompt needs vision. Anthropic is the current implementation surface in the repo; Gemini-class alternatives remain viable.

### Audio pipeline

- **Invocation mode:** The current prototype starts listening when the DAT session is actively streaming. A custom wake-word or button-to-arm layer can be added later without changing the downstream routing, memory, or desktop-task pipeline.
- **STT:** The current prototype uses the phone's speech-recognition path for reliable transcription while connected to the glasses. Cactus owns the downstream local reasoning and memory inference. A fully Cactus-native speech path can be swapped in later if it proves reliable enough.
- **TTS:** ElevenLabs Flash v2 streaming TTS for demo-grade voice quality. Audio streamed from phone to glasses as standard BT audio output. Apple `AVSpeechSynthesizer` as free offline fallback.
- **Audio session management:** iOS audio session claimed for Bluetooth-capable voice input/output. Accept that "Hey Meta" or other system audio interruptions may still happen — design around them rather than trying to suppress them.

### Camera pipeline

- **Live vision capture:** Frames are grabbed via DAT when the router determines the current prompt requires vision. These frames are sent with the transcribed prompt to the cloud VLM and are not persisted as part of the live-vision request path.
- **Episodic memory capture:** While the glasses session is streaming, the phone can sample a still photo roughly once per minute. Each sample is encoded into a compact `EpisodeRecord` (`sceneSummary`, `placeLabel`, `objects`, `ocrText`, `activityHint`, `salience`) and stored locally under a day key.
- **Memory compression:** Older raw episode sets are rolled into a `DailyMemoryPalace` with canonical places, ordered day segments, object last-seen data, and a short day summary. Raw episodes for prior days are deleted after compression. This is not continuous video recording and not a permanent archive.

### Routing

- **Router layer:** Routing always runs on-device. The current implementation uses a cheap heuristic fast-path first, then falls back to an on-device model classifier with a fixed system prompt and JSON output.
- **Routing strategy:** Capability-based. Jarvis classifies each prompt into one of:
  - `local_answer` — general knowledge, chit-chat, simple reasoning the model can handle itself on-device
  - `cloud_answer` — long-context, multi-step reasoning, code generation, or anything the router flags as beyond the local model's comfort zone; routed to cloud Gemma (`gemma-4-27b-it` via Google AI Studio)
  - `vision_query` — requires a camera frame; routed to cloud VLM
  - `memory_query` — asks about the recent past ("what did I do this morning?", "where did I leave my keys?", "when did I last see my notebook?")
  - `desktop_action` — requires the laptop; routed to the desktop agent bridge
  - `clarify` — confidence is low, ask a one-question follow-up before proceeding
- **Local vs. cloud escalation:** Obvious high-complexity prompts are heuristically escalated to cloud even if the local model under-calls them. Prompts about the past preferentially route to `memory_query`, even if a live camera frame is available, because "where did I leave my keys?" is a retrieval problem, not a scene-description problem.
- **Confidence threshold:** Low-confidence decisions are rewritten to `clarify`. This is the routing safety net.
- **Heuristics vs. model:** v1 does not use a giant hand-built rule engine, but it does use thin heuristics for obvious desktop / memory / vision / complexity cases before asking the local model.

### Desktop bridge

- **Architecture:** Phone runs a client that POSTs task payloads to a small relay process running on the laptop alongside Claude Code. Relay translates into Claude Code CLI invocations with computer use enabled. Claude Code does the work. Result is streamed back to the phone over the same channel.
- **Transport:** Tailscale between phone and laptop (or equivalent zero-config mesh VPN). Justification: works on home wifi, hotel wifi, and hotspot without port forwarding or NAT hell. Demo-critical.
- **Auth:** Tailscale handles identity; the relay additionally validates a shared secret on each request. No API keys on the phone side for the relay itself (the phone's Anthropic API key is separate and stays on the phone).
- **Progress updates:** Relay streams partial output back to the phone as Claude Code emits it (structured JSON events from Claude Code's streaming output mode). Phone TTS speaks stage updates ("opening Gmail... drafting the email... done") through the glasses during long tasks, rather than leaving dead air.
- **Irreversible-action guardrail:** Task payloads from the phone include a `confirm_before: ["send", "pay", "delete", "submit"]` field. Claude Code is instructed in its system prompt to pause and request confirmation before any action matching the list. Confirmation comes back to the phone, user responds via voice.

### Degradation modes

- **Laptop offline / Claude Code unreachable:** Phone detects via bridge heartbeat. `desktop_action` prompts are responded to with "Your laptop isn't reachable right now — want me to remember this for later, or try to answer here?" Local and vision paths continue to work.
- **Cloud VLM unavailable or unconfigured:** `vision_query` prompts fall back to the local model with the captured image when possible; if that is not good enough, Jarvis should fail softly and ask the user to retry or rephrase.
- **Speech recognition glitches:** The app keeps the session alive and returns to listening, so the user can repeat themselves without re-pairing or rebuilding state.
- **Laptop-side failure mid-task:** Relay errors surface back to the phone as spoken failure states rather than silent hangs.

### Modules

The system decomposes into these modules, each with a narrow interface:

1. **MetaDATModule / MetaDAT** — native bridge to Meta DAT. Exposes session state, registration state, device state, and photo capture to the React Native app.
2. **Transcriber** — turns the current spoken utterance into text while the glasses session is active.
3. **Router** — takes `{prompt, hasImage, cloudEnabled}` and returns `local_answer | cloud_answer | vision_query | memory_query | desktop_action | clarify`. Thin heuristics run first; the on-device model resolves the ambiguous cases.
4. **LocalAnswerer** — takes a text prompt and returns a short on-device spoken reply via Cactus.
5. **CloudGemmaClient** — takes text prompt (+ optional history), returns text reply via Google AI Studio Gemma API. Reads `GEMMA_API_KEY` from env. Model configurable (default `gemma-4-27b-it`).
6. **VisionClient** — takes `{prompt, frame}`, returns text reply. Wraps the cloud vision API.
7. **DesktopBridgeClient** — takes a structured task, returns progress events, confirmation requests, and a final result. Wraps the laptop relay.
8. **MemoryOrchestrator** — starts and stops with the glasses streaming session, samples periodic photos, and runs daily rollover work.
9. **MemoryEncoder** — turns a sampled image into a structured `EpisodeRecord`.
10. **MemoryStore** — local phone storage for day-partitioned `episodes.json` and `palace.json`, plus retention cleanup.
11. **DailyPalaceBuilder** — compresses a day's raw episodes into a `DailyMemoryPalace` with places, segments, object last-seen lookup, and day summary.
12. **MemoryQueryEngine** — parses temporal scope, gathers evidence from today's raw episodes plus prior day palaces, and synthesizes a short spoken answer.
13. **Speaker** — takes text and plays it through the glasses audio output. Two implementations: `ElevenLabsSpeaker` and `AppleSpeaker`.
14. **useJarvis / Orchestrator** — the top-level coordinator in the React Native app. Owns session state, routing, memory lifecycle, desktop relay interactions, and speech output.

On the laptop:

15. **DesktopRelay** — small Node process. Exposes an HTTP endpoint over Tailscale. Translates incoming tasks into Claude Code CLI invocations with computer use and streams output back.

### API contracts

- **Phone → Desktop relay:** JSON POST `{task: String, context: [...], confirm_before: [String], session_id: String}`. Streaming response of JSON events: `{type: "progress" | "needs_confirmation" | "result" | "error", payload: ...}`.
- **Phone → Cloud VLM:** standard Anthropic Messages API with an image content block and a text prompt. No intermediary.
- **Phone → local model (via Cactus):** Cactus call from the mobile app. Router uses a structured-output prompt format returning JSON; local answering and memory synthesis use the same local inference surface.

## Testing Decisions

Good tests for this system exercise externally observable behavior through module boundaries, not internal implementation. Inference-layer behavior is mockable because every module consuming it depends on a protocol, not a concrete class.

Priority modules for tests:

- **Router** — highest-value tests. Table-driven: (prompt, expected route, expected confidence band). Test the actual local-router output against a fixed prompt set. Include adversarial ambiguous prompts that should land in `.clarify`. This is the module most likely to silently misbehave in production.
- **MemoryQueryEngine + DailyPalaceBuilder** — retrieval tests for temporal prompts, "last seen" questions, broad summaries ("what did I do this morning?"), and compression correctness from raw episodes into palaces.
- **DesktopBridgeClient** — tests against a mock relay. Verify streaming progress events are forwarded, confirmation flow round-trips, errors surface cleanly, heartbeat / offline detection works.
- **Orchestrator state machine** — tests the turn lifecycle. Given mocked Router / VisionClient / MemoryQueryEngine / etc., verify state transitions are correct and that memory sampling only runs while the glasses session is streaming.
- **Meta DAT bridge** — integration test with the DAT Mock Device Kit (Meta ships one). Verify audio stream start/stop, frame capture, and state propagation into JS.
- **Retention / rollover** — explicit tests that older day folders age out, previous days compress into palaces, and raw episodes for prior days are deleted after successful compression.

Deprioritized for v1 (but should exist eventually): custom wake/invocation experiments (hard to unit-test audio-trigger reliability — rely on manual testing in loud / quiet / interruption-heavy environments), Speaker implementations (output quality is subjective).

No prior art in this codebase — greenfield project. Pattern to borrow from: Swift `protocol`-based DI with a `TestHarness` entry point that swaps concrete module implementations for mocks.

## Out of Scope

- **Android support.** iOS only, full stop. Ports are post-hackathon.
- **Multi-user / multi-account.** One user, one phone, one laptop. No account system.
- **Ray-Ban Meta Display (HUD).** Not in the Meta DAT preview, and not needed for a voice-first product.
- **On-glasses UI rendering.** DAT doesn't support it in preview and we don't need it.
- **Running Claude Code sessions without a laptop** — we are not trying to host Claude Code in the cloud for this project.
- **Background / heartbeat autonomous tasks** (OpenClaw-style cron work). v1 is still not an autonomous agent. The system reacts to user requests; episodic snapshots during an active glasses session are in scope only because they support memory recall.
- **Open-ended long-term autobiographical memory.** v1 keeps a short rolling episodic window on-device, compresses prior days into daily palaces, and expires older data automatically. This is working memory, not a permanent life log.
- **Open-ended multi-turn conversations while continuously listening.** v1 is optimized for one request / one response loops, even if the glasses session itself stays connected.
- **Integration with Meta AI itself.** We do not try to suppress, replace, or hook into "Hey Meta."
- **OpenClaw integration.** Architecturally possible via the swappable desktop agent interface, but not built in v1.
- **MedSentinel.** Separate project. Any Jarvis infrastructure is not shared with that pitch.
- **Production-grade security hardening** of the Tailscale relay. Shared-secret + Tailscale identity is good enough for personal use and demo; not for multi-tenant shipping.

## Further Notes

### Known risks (ordered by likelihood)

1. **Audio-session interruptions or speech-recognition misses make Jarvis feel flaky on stage.** Mitigation: rehearse in noisy settings, keep the glasses session warm before demo prompts, and make reconnect / retry flows fast and obvious.
2. **Low-frequency episodic snapshots feel creepy or cost more battery than expected.** Mitigation: keep cadence conservative, keep storage on-device, expire old data automatically, and be explicit in the UX that memory is recent working memory rather than a permanent archive.
3. **Claude Code computer use fails mid-demo on a live website.** Mitigation: canned staging environment, pre-logged-in apps, demo the draft not the send.
4. **Hotel wifi blocks Tailscale.** Mitigation: test on the actual venue network days before; fallback is phone hotspot with the laptop tethered.
5. **Glasses battery dies during extended demo rehearsal.** Mitigation: charge between run-throughs, have a second charged pair if possible, don't stream mic for longer than actually needed in rehearsal.
6. **The local router misroutes a prompt in a way the confidence threshold doesn't catch.** Mitigation: rehearse the demo script's prompts extensively so the team knows which prompts the router reliably classifies; for demo day, the script sticks to rehearsed prompts.
7. **Meta DAT rate-limits audio streaming or camera capture in ways not yet documented in the preview.** Mitigation: hit this early in build and design around whatever limit we find. Nothing to do before then.

### The ambitious bets (on the record)

Three non-default choices were made with full awareness of the risks:

- React Native for the product shell, with a native Swift bridge only where Meta DAT requires it
- Capability-based routing with local-first answers and selective cloud escalation
- Episodic working memory built from low-frequency photos, rather than keeping the assistant stateless between turns

Each has a documented fallback. None are allowed to block the demo path; the fallbacks are wired in parallel.

### Demo script (reference, to be iterated)

3-minute flow, glasses-first:

- **Scene 1 (30s) — environment QA:** User looks at a specific object ("what's this?"). Jarvis routes to vision, answers in a few seconds through glasses.
- **Scene 2 (30s) — episodic memory recall:** User asks "where did I leave my keys earlier?" or "what did I do this morning?" Jarvis routes to `memory_query` and answers from recent memory evidence.
- **Scene 3 (90s) — delegation with live narration:** User delegates a multi-step task to the laptop ("draft a thank-you email for the acceptance letter in my inbox"). Glasses give progress updates in real time while Claude Code works on the big screen behind the demo stage. Task stops at "draft ready for your review" — no auto-send.
- **Close (30s):** Pitch the architecture — phone is the brain, glasses are the I/O, laptop is the hands, and episodic memory turns sampled images into working memory. Hand off.

### Open items

- **The second wedge after laptop-native power users is still open.** Candidate expansions include accessibility, field workers, and a broader prosumer wearable-assistant market, but the current PRD is intentionally centered on the single-user power-user case.
- **Latency budget isn't formally measured yet.** Estimates in this doc are extrapolations from Cactus's published numbers and ElevenLabs' docs. First week of build should establish real measurements for: utterance-end-to-transcribe, transcribe-to-route, route-to-cloud-VLM-first-audio, memory-query-answer latency, and desktop-task-first-progress-event. Demo pacing depends on these being real numbers, not guesses.
