# RESEARCH.md

Open-source prior art, platform facts, and sponsor-track notes for HAUNT.
Researched 2026-10-31. Each section ends with a "use this" call.

---

## A. Real-time infra, auth, phone-side effects

### Real-time multiplayer

| Option | Status (2026-10) | Verdict |
|---|---|---|
| PartyKit hosted | **Shut down 2026-10-23.** Successor is PartyServer (self-host on Cloudflare Workers + Durable Objects), no lobby template. https://docs.partykit.io/guides/migrate-to-partyserver/ , https://github.com/cloudflare/partykit | skip |
| Cloudflare Durable Objects | Free plan: 100k req/day, SQLite-backed, WebSocket hibernation. https://developers.cloudflare.com/durable-objects/platform/pricing | fine if someone knows Wrangler |
| Colyseus | 7.5k stars, MIT, self-host free; schema sync is heavier than we need. https://github.com/colyseus/colyseus | skip |
| Playroom Kit | Closed SaaS, has "Stream Mode" (big screen + phones). **Free tier = 10 users/day.** https://docs.joinplayroom.com/components/stream | skip, or $10 Lite |
| **Socket.IO** | 63k stars, MIT, rooms + reconnect built in, one Node process. https://github.com/socketio/socket.io | **use this** |
| Supabase Realtime | ~200 concurrent conns free; logic needs Edge Functions. | fallback |
| Liveblocks | Non-commercial free plan, built for docs. | skip |

### Forkable Jackbox-style starters

- **EpiConsole** — React/Vite/Tailwind + Express/Socket.IO, **QR code join**, docker-compose. MIT. https://github.com/muscularbird/EpiConsole . Best page-layout starting point.
- **Rumpus** — Node/Express/Socket.IO, `/host` TV page + `/play` phone page, games as modules. AGPL-3.0 (fine for hackathon). https://github.com/rodwilco/rumpus
- hackbox (abandoned 2023) https://github.com/tomalama/hackbox ; johnbox (protocol reimplementation) https://github.com/InvoxiPlayGames/johnbox ; Elixir options https://github.com/jccr/mpg (One Night Werewolf roles). More: https://github.com/topics/jackbox

### Auth

- Auth.js is in security-patch mode under Better Auth (acquired by Vercel 2026-07). Providers still work; Better Auth is the "new project" pick and has LinkedIn too. https://www.better-auth.com/blog/authjs-joins-better-auth , https://better-auth.com/docs/1.6/authentication/linkedin
- **LinkedIn OIDC:** dev portal -> Products -> "Sign In with LinkedIn using OpenID Connect" (self-serve, typically instant; app needs a Company Page). Scopes `openid profile email`; userinfo at `https://api.linkedin.com/v2/userinfo` returns `picture`. https://learn.microsoft.com/en-us/linkedin/consumer/integrations/self-serve/sign-in-with-linkedin-v2 , Auth.js provider https://authjs.dev/getting-started/providers/linkedin
- **Picture gotcha:** the `picture` URL is a signed CDN link that expires. **Download and store bytes at sign-in.**
- **GitHub OAuth:** Auth.js `GitHub` provider, OAuth App. https://authjs.dev/getting-started/providers/github
- **"Pushed this week":** `GET /users/{username}/events/public` (no auth for public, last 30 days/300 events, delayed 30s to 6h). Filter `PushEvent`, bucket by `created_at`. https://docs.github.com/en/rest/activity/events?apiVersion=2022-11-28

### Phone-side effects (what iOS Safari allows)

- **Audio:** create one `AudioContext`, `resume()` + play a silent 1-sample buffer **synchronously inside the Join tap's `touchend`/`click`**, reuse for every haunt. Ringer switch on silent mutes it; show a hint. https://www.mattmontag.com/web/unlock-web-audio-in-safari-for-ios-and-macos
- **Flash:** CSS keyframes on a full-screen overlay. Screen Wake Lock shipped in Safari 18.4; request it on Join.
- **Vibration:** `navigator.vibrate` **not supported on iOS Safari through 27.2**; Android works. Feature-detect. https://caniuse.com/vibration
- **Web Push:** iOS only for Home Screen-installed PWAs. Not viable for QR join; use the open socket. https://pushpad.xyz/blog/ios-special-requirements-for-web-push-notifications
- **DeviceOrientation:** `DeviceOrientationEvent.requestPermission()` must be called from `click`/`touchend` on HTTPS. Bundle into the same Join tap. https://bugs.webkit.org/show_bug.cgi?id=269706

### Quick-win libs

- QR generation: `qrcode` (MIT). https://www.npmjs.com/package/qrcode
- QR scanning: **BarcodeDetector is off by default in iOS Safari**; use `qr-scanner` (nimiq, 2.9k stars, MIT, worker fallback). https://github.com/nimiq/qr-scanner , https://caniuse.com/mdn-api_barcodedetector . `html5-qrcode` is unmaintained; `jsQR` works but DIY.
- NFC: NTAG213 holds a ~130-char URL. iPhone XS+ reads URL tags from the lock screen with no app; write with the free **NFC Tools** app. Keep URLs short (`/j/ABC123`). https://www.wakdev.com/en/knowledge-base/nfc-chips/nxp-ntag213.html

### Use this

Next.js (or Vite) pages + Auth.js (LinkedIn OIDC + GitHub, store picture bytes) + a ~150-line **Socket.IO** server on Fly/Railway or a laptop with Cloudflare Tunnel as the single game-state authority. Fork EpiConsole's QR-join layout, not its games. One Join tap unlocks audio, requests orientation permission, and takes a wake lock. Badge QR via `qr-scanner` as the identity fallback when face match fails; optional NTAG213 stickers pointing at the same `/j/<code>` URL.

---

## B. Set dressing: room scan, marker AR, data over sound

### Room scan to big screen

| Tool | Facts | Verdict |
|---|---|---|
| **Scaniverse** (Niantic, free) | Splat mode works **without LiDAR** (toggle "Ignore Lidar"; iPhone 12+ safest). Exports SPZ or PLY, mesh GLB/OBJ/USDZ. A 60 to 120 s room scan is ~10 to 40 MB SPZ (SPZ is ~10x smaller than PLY). https://scaniverse.com/spz , https://scaniverse.com/news/scaniverse-2-0-adds-support-for-non-lidar-devices , SPZ format https://github.com/nianticlabs/spz (MIT) | **use this** |
| Polycam | Free tier exports mesh only; splat PLY is paid. https://learn.poly.cam/hc/en-us/articles/27756102599572 | skip |
| **Spark** (World Labs) | three.js splat renderer, loads SPZ/PLY/SPLAT/KSPLAT/SOG, explicit mobile target. 3.8k stars, MIT, pushed 2026-10-20, npm `@sparkjsdev/spark` 2.4.0, needs three r180+. https://github.com/sparkjsdev/spark , https://sparkjs.dev/docs/overview/ | **use this** |
| GaussianSplats3D | No longer developed, README points to Spark. https://github.com/mkkellogg/GaussianSplats3D | skip |
| gsplat.js | .splat/.ply only. https://github.com/huggingface/gsplat.js | skip |
| **SuperSplat** (PlayCanvas) | Hosted editor imports PLY/SPZ, crop junk, export SPZ or a standalone HTML viewer. 10.5k stars, MIT. https://superspl.at/editor , https://github.com/playcanvas/supersplat | 5-min cleanup step |
| Babylon.js | Loads .spz in v8+; lower phone fps than Spark. https://doc.babylonjs.com/features/featuresDeepDive/mesh/gaussianSplatting | only if already on Babylon |

**Plan:** Scaniverse -> SPZ -> (SuperSplat crop) -> Spark `SplatMesh` in three.js on `/screen`. Event markers are three.js sprites at hand-placed coordinates, pushed over the existing socket. About 1 hour, and it's the visual showpiece.

### Marker / image AR that works in iOS Safari (no install)

- **AR.js** — 6k stars, MIT, pushed 2026-06. **Pattern markers (black square fiducials) are the most robust in dim light** because they threshold, not feature-match. NFT image mode is flaky on iOS. https://github.com/AR-js-org/AR.js
- **MindAR** — 2.8k stars, MIT, image targets compiled in-browser to `.mind`, A-Frame and three.js builds, works in Safari. Last push 2024-06. Loses lock in low light and glare: use high-contrast matte sigils, raise `missTolerance`, keep lights on near posters. https://github.com/hiukim/mind-ar-js , compiler https://hiukim.github.io/mind-ar-js-doc/tools/compile
- **8th Wall open source** (2026-02-28) — https://github.com/8thwall/8thwall (MIT glue + examples); the XR engine itself is a free **binary** npm package `@8thwall/engine-binary`, image targets live in its SLAM chunk. Best tracking of the three, no account needed, but a large unfamiliar API for a 4-hour window. https://8thwall.org/docs/engine/overview
- Zappar: stale since 2023, licence tied to ZapWorks. Skip. WebXR image tracking: still not in iOS Safari. Skip.

**Plan:** sigil posters = AR.js pattern marker (or MindAR target) with a **QR code printed on every poster** as the guaranteed fallback. One page shows a ghost and POSTs the zone.

### Data over sound (ghost throw)

- **ggwave** — 7.9k stars, MIT, pushed 2026-04, npm `ggwave` 0.4.0 (wasm). Max 140-byte payload, ~8 to 16 B/s. Demos https://waver.ggerganov.com , https://ggwave-js.ggerganov.com . https://github.com/ggerganov/ggwave
- iOS gotchas: do **not** force `AudioContext({sampleRate:48000})`; create the context on a tap and pass `ctx.sampleRate` to ggwave. **Safari filters ultrasound**, so use `AUDIBLE_FAST` on iOS. https://github.com/ggerganov/ggwave/issues/5
- Reliability: a 2026 measurement paper found audible mode unusable in café-level noise beyond ~1 m. In a loud hackathon room expect phone-to-phone at arm's length only. https://arxiv.org/html/2602.02249v1
- Gibberlink = ggwave + ElevenLabs, nothing extra. Chirp SDK is dead.

**Plan:** stretch demo only: audible-fast, ~20-byte payload, phones held together, tap-to-arm. Server-side fallback: "both phones shaken within 2 s" = a throw.

### Simple fallbacks

- QR per zone with `?zone=X`: native camera apps scan it, zero code. In-page scanning: BarcodeDetector is off in iOS Safari, use `qr-scanner`/jsQR/zxing-wasm.
- Compass: `DeviceOrientationEvent.requestPermission()` from a tap, then `event.webkitCompassHeading` on iOS (Android: `360 - alpha` with absolute). Permission persists per origin. ~20 lines for a "point your phone" effect. https://developer.apple.com/forums/thread/128376

### Use this / skip

Do: Scaniverse scan during setup, Spark on the big screen, AR.js or MindAR sigils with QR fallback, compass effect. Skip: 8th Wall, Polycam, GaussianSplats3D, Zappar, ultrasound. ggwave throw is a stretch demo.

---

## C. Agents and models inside HAUNT

### Hard constraint first

Anthropic's usage policy prohibits using Claude for facial recognition and for
collecting biometric data. So: **never send a face to Claude (or any hosted LLM)
to ask "who is this."** Face ID stays on the open-source, on-device Human library
exactly as in ARCHITECTURE.md. Claude is fine for narration, matchmaking, card
enrichment, and describing scenes or costumes without identifying people. The
"Demogorgon" agent localizes photos against the room (**where**, not who).
Verify the current wording on anthropic.com before the pitch.
https://conductatlas.com/platform/anthropic/anthropic-api-usage-policy/biometric-and-neural-data-prohibition/

### What "jev" is

Jev = TypeSafe AI's "System One" decision model (launched 2026-09-15). Returns
typed decisions only (choice, score, yes/no probability) in 70 to 500 ms, no
text. Waitlist-gated at typesafe.ai. Would suit fast game logic (role assignment,
"should the narrator interrupt now") but only if someone already has access;
otherwise a Claude Haiku 5.5 call with structured output does the same in under a
second. https://www.blogdumoderateur.com/jev-modele-ia/ ,
https://pub.towardsai.net/jev-the-ai-model-that-doesnt-write-it-decides-6f3d91a78c3a
Effort S, payoff low-med.

### Agent roles in the game

| Agent | What | Stack | Effort / payoff |
|---|---|---|---|
| **Narrator / game master** | Server loop batches the event feed every 20 to 30 s, asks Claude for a two-line spooky announcement, pipes to ElevenLabs TTS, plays on the big screen | Anthropic Messages API, `claude-opus-5-5`, low effort setting, streaming, prompt caching on system prompt + lore | S / high. Most visible agent in the demo |
| **Matchmaker "who should I meet"** | Tool-use agent with `list_attendees(opted_in)` and `github_activity(handle)` | SDK Tool Runner (`client.beta.messages.tool_runner`), wrapped in a Fetch.ai uAgent with the Chat Protocol + Mailbox so it is discoverable in ASI:One. `create-fetch-agent` scaffolds it. https://uagents.fetch.ai/docs/getting-started/chatprotocol , https://uagents.fetch.ai/docs/examples/asi-1 , https://innovationlab.fetch.ai/resources/docs/create-fetch-agent/overview | S / high. Budget 45 to 60 min for Fetch registration. **Fetch.ai track** |
| **Card enrichment** | One Claude call at registration summarizes GitHub Events into "what they're building this week" | Messages API; Batch API if pre-enriching a known list | S / med |
| **Demogorgon** (photo-to-zone localizer that improves) | Attendees upload a photo of their surroundings; Claude vision picks which zone/sigil it was taken from, given reference photos per zone. Run 1 zero-shot. After the room plays, a memory file of confirmed photo-to-zone pairs + confusion table makes run 2 beat run 1 on a fixed 20-photo held-out set | `claude-opus-5-5` vision; host on TrueForge (`npx @truefoundry/trueforge@latest`), whose session traces are the run log. https://www.truefoundry.com/docs/agent-platform/agent-harness/overview , https://www.truefoundry.com/blog/trueforge-agent-events-runtime-contract . Note: TrueFoundry's older agent APIs were cut over 2026-10-15; use TrueForge endpoints only | M / high. **TrueForge track**, stays inside the no-face-ID policy |

Framework: Anthropic SDK + Tool Runner for all of these. Skip LangGraph and MCP
for a 4-hour build. Vercel AI SDK only if the frontend is Next.js and you want
streaming UI helpers.

### Realtime voice (a spooky voice you can talk to)

- **ElevenLabs Agents** — build in dashboard, paste the embed widget into `/me`. Free tier ~15 min of calls, 4 concurrent. Fine for a demo, not a room. https://elevenlabs.io/pricing/agents . Effort S.
- **LiveKit Agents** — Apache-2.0, WebRTC bundled, OpenAI Realtime backend. More wiring. https://livekit.io/field-guides/guide/livekit-vs-pipecat . Effort M. Pipecat is lower-level still.
- Anthropic has no realtime speech-to-speech endpoint; Claude is the brain behind STT/TTS if going the LiveKit route.
- Cheapest with a real room: narrator TTS only, one-way.

### Vision beyond face ID

Claude vision (1 to 3 s per image) for "describe the costume / scene / where was
this taken": theming and the Demogorgon only. Gemini similar. Moondream
on-device: no reliable iPhone-browser evidence, skip. Nothing here helps face
matching; the core stays Human on-device.

### On-device / browser models

WebGPU shipped by default in Safari 26 (iOS 26) but a WebKit bug still breaks
some engines on 26.2; treat WebGPU as a bonus. Transformers.js v4 falls back to
WASM. WebLLM is WebGPU-only and only 360M to 1B models are realistic on phones.
Verdict: Human on WebGL for faces, no browser LLM.
https://bugs.webkit.org/show_bug.cgi?id=301627 , https://howaiworks.ai/blog/transformers-js-v4-release.md

### How agents feed the sponsor tracks

- **Shelled:** have Shelled's agents build the narrator and matchmaker. They cannot hear TTS, judge "spooky", test the Fetch mailbox handshake, or tune the on-device face threshold. Each is an EDGE_CASES.md entry with a role attribution (Tester approving un-hearable audio, Reviewer passing a prompt that produced flat narration).
- **TrueForge:** the Demogorgon's memory file is the self-improvement artifact; report accuracy run 1 vs run 2 on the held-out set. Softer second metric: haunts per minute after each narrator announcement.

### Top 3

1. Narrator with TTS on the big screen (S, high, pure Messages API).
2. Matchmaker on Agentverse (S, high, Fetch.ai track).
3. Demogorgon photo-to-zone localizer with memory on TrueForge (M, high, TrueForge track).

---

## D. Browser face recognition (the core)

### Libraries

| Library | Facts | Verdict |
|---|---|---|
| **@vladmandic/human** | v3.3.6 (Aug 2025), 3.4k stars, MIT. BlazeFace detect (0.5 MB) + FaceMesh (1.5 MB) + FaceRes 1024-d embedding (7 MB) ≈ 9 MB. `human.match.similarity(a,b)`, `human.match.find(emb, db)` -> `{index, similarity}`. Wiki: >0.5 similarity is a match; demo gates at 0.4. Demos ran on iPhone; maintainer calls Safari WebGL "really bad", so use the **wasm** backend. FaceRes is weaker than ArcFace. https://github.com/vladmandic/human , https://github.com/vladmandic/human/wiki/Embedding , demo https://vladmandic.github.io/human/demo/facematch/index.html | **use this** |
| **FaceX** | 350 stars, Apache-2.0, pushed May 2026. ArcFace-style 512-d via onnxruntime-web WASM, 0.8 to 8.4 MB models (LFW 95.6 to 99.1%). Threshold >0.3 cosine. Weights are AES-encrypted and must be decrypted via WebCrypto (extra step). No iOS testing documented. https://github.com/facex-engine/facex , https://github.com/facex-engine/facex/wiki/Browser-Quickstart | alternative if Human's accuracy disappoints |
| InsightFace via onnxruntime-web | Best accuracy (buffalo), but weights are **non-commercial research only**. https://pypi.org/project/insightface/ | skip (license) |
| face-api.js / @vladmandic/face-api | Dead (2020) / archived Feb 2025. | skip |
| MediaPipe | Detect, landmarks, stylize only. **No identity embedding.** | detector only |

### Prior art ("recognize registered people from a phone camera")

- **lazo** — MIT, pushed 2026-10-20, TypeScript + onnxruntime-web. **Consent-first enrollment** (5 guided shots -> centroid template), quality gate (Laplacian blur, pose), 1:N cosine search, **3-zone decision** (≥0.38 affirm, 0.30 to 0.38 abstain, <0.30 discard), 3-of-4-frame voting over 1.5 s dwell, AES-GCM encrypted IndexedDB gallery, HTTPS phone dev mode. Closest match to HAUNT's ethics and pipeline. **Borrow its enrollment UX and decision logic.** iOS untested. https://github.com/nievesjesus/lazo
- eidon — MIT, Rust/WASM + onnxruntime-web, 5-pose enrollment, 0.40 threshold. Reference only. https://github.com/FrancescoCitti/eidon
- Attendance apps on face-api.js (old stack): https://github.com/jolwnn/Student-Attendance-Management-System-MERN , https://github.com/ferryops/facial-recognition-attendance-system (Next.js + Supabase pattern)
- **No OSS "who is this at the conference" camera app exists.** HAUNT is novel here.

### Server-side fallback

- **DeepFace** — 23.6k stars, MIT, pushed today. Docker `serengil/deepface:latest` (227 MB, amd64), REST on :5005 with `/represent`, `/register`, `/search`. ~5 min to stand up; first call downloads weights. https://github.com/serengil/deepface
- CompreFace — amd64 only (no arm64, needs AVX), won't run natively on Apple Silicon. https://github.com/exadel-inc/CompreFace . Skip.
- InsightFace-REST — TensorRT-first. Skip.

### Gotchas (iOS)

- HTTPS required. `<video autoplay muted playsinline>` or Safari shows one frame. Start the stream from a tap. **Only one active getUserMedia at a time.**
- `facingMode: 'environment'` may pick the ultra-wide; enumerate devices and prefer the label containing "Back Camera".
- WebGL context is lost on backgrounding/lock; handle `webglcontextrestored`. Easier: use the **wasm** backend (float32; WebGL on iPhone is float16 and degrades embeddings). tfjs WebGPU on iOS 26 rotates video 90° (open bug) — avoid.
- If using onnxruntime-web: load `ort.wasm.min.js` (not `ort.min.js`, which balloons memory in WebKit), `numThreads = 1` without COOP/COEP. Sustained >8 inferences/s thermally throttles; run detection at 3 to 5 fps and embed only when a face is stable.
- Thresholds: Human similarity ≥ 0.5 (abstain band 0.4 to 0.5); ArcFace-family cosine 0.40 to 0.45. Enrol 3 to 5 selfies, store the normalized centroid, min face box ~80 px, reject blurry frames, vote over 3 consecutive frames. Backlit windows and stage spots are the main failure mode; enable Human's `filter.equalization`.

### What actually happened when we built it (2026-10-31)

- Human FaceRes on 14 real sample photos: same-person 0.28 to 0.51, strangers up to 0.44 (overlap). `faceres-deep` compressed everything upward (strangers to 0.79). Input equalization changed nothing.
- FaceX: no npm package; the SDK is vendored from `wasm/`. Its detector needs `yunet_fp32.bin`, which is not published anywhere (release ships `det_500m_int8.bin`, which the vendored detect.wasm rejects with "bad magic"). Its SIMD probe bytes were malformed (fixed in our copy). Its `align.js` produced shifted crops.
- Working combination: Human detector + FaceMesh keypoints -> our own canvas similarity-transform alignment -> FaceX EdgeFace-XS embedder. Same-person 0.47 to 0.79 (one 11-year pair 0.36), strangers <= 0.36, threshold 0.4. This is the default engine.
- Calibration page `/calibrate` shows the pairwise matrix; Playwright scripts for the matrix and the end-to-end flow live in the main session's scratchpad (not in the repo).

### Use this

**@vladmandic/human**, wasm backend, ~320 px input, 3 to 5 fps. Enrol with 3 selfies -> centroid 1024-d vector stored with the profile. Ship all opt-in embeddings to `/hunt` as one JSON; match client-side at ≥ 0.5 with 3-frame voting and lazo's abstain band. Keep **DeepFace Docker** as the 20-minute fallback (POST a JPEG every ~500 ms, match server-side).

---

## E. Sponsor tracks: rules, minimal paths, proof

**The official rules page overrides the track blurbs:** https://strangerbuilds.com/rules

### Global rules that bite

- Project must start after Fri 30 Oct 23:00 UTC, in a **new non-forked repo** created after that. (This repo qualifies.)
- Submissions close Sun 8 Nov 23:59 ART. "Best of the Day" SF cut is **16:10 local today**.
- Registration: Luma signup, "sign the pact", and activate **"the Duck on ASI:One"** (an ASI:One account is mandatory for everyone). App: https://app.strangerbuilds.com/home
- **Max 2 challenges open per project, one challenge prize per project.** Sponsor use must be genuine with proof; logos alone don't count.
- Proof of launch: an X post, or a 2-minute demo/pitch video.

### Shelled AI, "Make coding agents sweat" (Hard problems, judge-confirmed)

- One prompt -> Planner/Builder/Tester/Reviewer agents in sandboxed shells -> one reviewed PR in your repo with plan, tests, reasoning. https://shelled.ai/harness , https://shelled.ai/articles/from-prompt-to-production-a-day-with-shelled
- App: https://app.shelled.ai (chat: "Ask Louie or describe your project"). Repo-connection method is **not documented publicly**; expect a GitHub connect inside the app after sign-in.
- Pricing: Open $0 self-host, Plus $25/mo with free trial, Pro $250. https://shelled.ai/harness#pricing
- **No public GitHub org exists** (every plausible name 404s). The "PR to their repo" route is dead; use the **Shelled run** route only.
- EDGE_CASES.md: no template published. Rules call it "an edge-case report (where agents shone and where they broke)". Rules also say PRs appear "with the run behind each", so **put the run link/ID in every PR description.**
- Founder posts: https://x.com/binaryreality/status/2113132592874840185 , https://x.com/binaryreality/status/2116374995194740871
- Gotcha: unverified whether a run works on an existing repo or only scaffolds new projects. Plan for Shelled to build a feature branch/PR, and budget time for sign-up friction with no docs to fall back on.

### TrueFoundry TrueForge, "Build a self-improving agent" (Hard problems, judge-confirmed)

- MIT open-source agent harness: models + MCP tools + skills + sandbox + sessions, chat UI, HTTP API/TS SDK. https://github.com/truefoundry/trueforge , docs https://trueforge.dev , quickstart https://trueforge.dev/quickstart.md
- Local: Node 22.14+, `npx @truefoundry/trueforge@latest`, open http://localhost:8790, Settings -> Models -> add Anthropic key, Build Agent -> instructions, MCP servers, skills -> Save -> Try.
- Hosted: https://signup.truefoundry.com/signup , Developer plan $0 (3 users, 10K req/user/month). Agent Harness is under TRUEFORGE -> Build Agents; **unverified whether it's enabled on the free tier.** https://www.truefoundry.com/docs/agent-platform/agent-harness/overview
- Runs: each chat is a Session with turns, duration, tokens, tool calls, errors, and a copyable session ID. No compare view or sessions API; **screenshot both sessions.** https://trueforge.dev/sessions.md
- **Rules wording:** "a later run that improves on run 1 by changing its own skills or instructions." So run 1 must produce or modify a skill/instructions, run 2 must use them and do measurably better (fewer tool calls/tokens/errors, or a task score you define). The Demogorgon's memory file (RESEARCH.md section C) is that artifact.
- Gotchas: old TrueFoundry Agents API deprecated 2026-10-15, use TrueForge only. Sandbox skills need a Daytona API key.

### Fetch.ai, "Get your agent hired" (Real users, GitHub repo required)

- Minimal agent: `pip install uagents openai`; `Agent(name, seed, port=8001, mailbox=True, publish_agent_details=True)`; `Protocol(spec=chat_protocol_spec)`; reply with `ChatAcknowledgement` then `ChatMessage(TextContent + EndSessionContent)`; `agent.include(protocol, publish_manifest=True)`. Full example: https://uagents.fetch.ai/docs/examples/asi-1
- Register: run the agent, open the Agent Inspector link from the log, Connect -> **Mailbox** (no public endpoint needed), Agent Profile -> name + @handle (max 20 chars), README, description, avatar, keywords -> "Chat with Agent" to test in ASI:One. https://docs.agentverse.ai/documentation/agent-discovery/setup-guide , README template https://docs.agentverse.ai/documentation/agent-discovery/readme-guidelines
- ASI:One API: key at https://asi1.ai/dashboard/api-keys , `POST https://api.asi1.ai/v1/chat/completions`, OpenAI-compatible, models `asi1`, `asi1-mini`, `asi1-ultra`. https://innovationlab.fetch.ai/resources/docs/asione/asi-one-quickstart
- Timing: registration is immediate; only **running** agents are prioritized in search, 10+ interactions recommended. **Keep the process alive during judging.** Log in every 30 days to keep the mailbox.
- Rules nuance: the feedback tries must be made **through ASI:One chat**. Cheap extra: the innovationlab shields.io badge in the README (required at other Fetch hackathons).

### Base44, "Find the money" (Real users)

- Build from chat at app.base44.com; Publish gives the public link. https://docs.base44.com/Getting-Started/app-editor-overview
- App ID is in the editor URL `app.base44.com/apps/<app_id>/editor`. Version history icon above the AI chat.
- Proof: app ID + **dated Version history screenshot showing the first version** + editor screenshot with app ID and your account. Take the first screenshot early.
- Stripe needs the Builder plan ($40 to 50/mo), checkout only works on the **published** app. https://docs.base44.com/Integrations/Stripe-integration
- Free plan: ~5 messages/day. Too few for a real build; needs a paid plan or sponsor credits (ask in https://strangerbuilds.com/slack). Phone-camera face recognition inside Base44 is unverified.

### Decision for HAUNT (max 2 challenges)

Open **Shelled** (the whole build runs through it) plus **one** of:

- **Fetch.ai** (Real users): the matchmaker uAgent, ~1 hour, needs 3 tries through ASI:One. Lower risk.
- **TrueForge** (Hard problems): the Demogorgon localizer with a memory file, run 1 vs run 2 screenshots. Higher payoff, more build.

Skip Base44 for this project. Submit for the 16:10 SF "Best of the Day" cut if in SF.

### Could not verify

Shelled's repo-connection mechanics and model list; whether TrueForge Agent Harness is on TrueFoundry's free tier; ASI:One free credits; Agentverse indexing latency; Base44's current official prices.
