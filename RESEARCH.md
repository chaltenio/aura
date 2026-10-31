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
