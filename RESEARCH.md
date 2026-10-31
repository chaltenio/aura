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
