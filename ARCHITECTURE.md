# Architecture: recognizing faces in a space

The core primitive is: **a phone browser knows which opted-in attendee it is
looking at.** Everything else (haunting, roles, scores, agents) is an event fired
once that primitive returns a match.

Design goals for a 4-hour build:

- One URL, no app install. Must work in iOS Safari and Android Chrome.
- Recognition runs **on the phone** (no video leaves the device). The server only
  ever sees embeddings, profile data, and events.
- Opt-in only. A face that is not registered with consent is never matched,
  never stored, never shown.
- Boring infrastructure: one Node server, one SQLite file, WebSockets.

```
                 +--------------------------+
   register      |  /register  (phone)      |  LinkedIn / GitHub OAuth
   ------------> |  consent toggle          |  selfie -> embedding (on-device)
                 |  POST /api/attendee      |
                 +------------+-------------+
                              | {profile, embedding[], consent:true}
                              v
                 +--------------------------+        +-------------------+
                 |  server (Node + ws)      | <----> |  SQLite           |
                 |  attendees, events       |        |  attendees        |
                 |  broadcast on change     |        |  events           |
                 +-----+--------------+-----+        +-------------------+
                       |              |
         GET /api/gallery      ws: {type:"haunted", by:...}
         (embeddings of        (push to the target phone)
          consenting users)           |
                       v              v
                 +--------------------------+       +---------------------+
   hunt          |  /hunt  (phone)          |       |  /screen (big TV)   |
   ------------> |  camera -> detect faces  |       |  event feed,        |
                 |  embed -> cosine vs      |       |  leaderboard,       |
                 |  gallery -> card overlay |       |  room scan (later)  |
                 |  POST /api/haunt         |       +---------------------+
                 +--------------------------+
```

## 1. Components

### 1.1 Phone client (one static bundle, three routes)

| Route | Job |
|---|---|
| `/register` | OAuth login (its profile photo is the face signature, embedded on-device), consent toggle, selfie capture (optional when the photo has a face), optional costume, upload |
| `/hunt` | live camera, face detection + embedding, match against gallery, overlay card, haunt button; draws a matched person's costume on their face: the WebGL lens (`web/lens.js`, see 1.2) when it loads, else flat 2D costumes (`web/costume.js`, from the recognition mesh) |
| `/me` | your card, who found you, who you found, change your costume, kill switch ("stop being findable") |

Every main page (`/hunt`, `/me`, home) carries the presence chip in its header (`web/presence.js`, #33):
"● N online / M registered", always visible; a tap opens the list of who is online (a haunt
makes their phone shriek) and who is registered but not online. The `/hunt` card says which of
the two the matched person is.

Two origins, one room. Fly serves the pages and the API together (https://aura-haunt.fly.dev). The Base44 mirror
(https://aura-haunt.base44.app, built by `scripts/base44.mjs`) serves the same `web/` pages from Base44 hosting with
`window.HAUNT_API` = the Fly URL, so its phones call the Fly API and socket and meet the Fly phones in one gallery.
Pages reach the API only through `api()` / `connectWs()` / `API` in `web/common.js` (the build fails on a bare
`fetch('/api…')`), import modules by absolute path (`/x.js`), and link pages without `.html` (`/register`; the
mirror's `index.html` routes those to `/register.html`, because Base44 answers every non-file path with `index.html`).

Framework: plain Vite + vanilla TS or React, whatever Shelled produces fastest.
No SSR needed. Everything the camera does must run after a user gesture and over
HTTPS (camera, mic, and motion sensors are all gated on both).

### 1.2 Face engine (in the browser)

Implemented in `web/face.js` as a switchable engine; everything runs on the phone.

**Default: `facex` hybrid.** Human (`@vladmandic/human` 3.3.6, MIT) does detection
(BlazeFace) and 468-point FaceMesh landmarks on the TensorFlow.js **wasm** backend.
From the mesh we take the five ArcFace keypoints (eye centers, nose tip, mouth
corners), warp the face to a 112x112 ArcFace-aligned crop with a canvas similarity
transform (`alignToArcFace`), and feed it to FaceX's EdgeFace-XS wasm embedder
(Apache-2.0, 7 MB, vendored in `web/vendor/facex/`), which returns a 512-float
vector. Matching is cosine similarity. FaceX's own detector is not used: its weight
file is unpublished, and its bundled align.js produced shifted crops.

**Costume lens (effects only, `web/lens.js`).** Once recognition has confirmed a
face (the card's 3-frame vote) and that person picked a costume, MediaPipe Face
Landmarker (`@mediapipe/tasks-vision` 1.2.0, Apache-2.0, GPU delegate, CPU fallback)
tracks it at camera rate inside a square crop around it (its own detector only
finds selfie-distance faces). three.js (0.184) then draws the costume over the camera:
face paint in UV space (`web/vendor/facegeom.js`, MediaPipe's canonical face model)
wrapped onto the 478 landmarks and shaded by the real skin, irises recoloured inside
the eyelids (stencil), a mouth that goes black or glows, fangs inside the open mouth,
and 3D props posed by MediaPipe's head-pose matrix (63 degree camera, rendered
through a viewport matching the crop) and hidden behind a head occluder. The lens
never names anyone: it only draws on ids recognition handed it, and a tracked face
that drifts from recognition's box is reset. Nothing leaves the phone; the libraries
and the 3.7 MB model come from jsDelivr and Google's model bucket on the first match.
`?lens=2d` forces the flat costumes.

**Fallback: `human`** (`?engine=human`): Human's FaceRes 1024-float descriptor with
Human's distance-based similarity. Weaker separation, kept for comparison.

Measured on 14 real photos from Human's sample set (same people years apart,
strangers), see RESEARCH.md section D:

| engine | same-person similarity | highest stranger pair |
|---|---|---|
| facex (default) | 0.47 to 0.79 (one 11-years-apart pair at 0.36) | 0.36 |
| human | 0.28 to 0.51 | 0.44 (overlaps) |

Thresholds (`THRESHOLD` in face.js, override with `?t=`): facex **0.4**, human 0.5.
Below `THRESHOLD - 0.1` a face is drawn as "unknown"; in between it is drawn as
"?" with no name (abstain band). A match must hold for **3 consecutive frames**
before the card appears. Same-session selfies in the same light will score higher
than these cross-year photos, so tune the threshold on the team's faces in the
room with `/calibrate` before the demo. Prefer false negatives over false
positives: a wrong name on a stranger is the worst outcome.

Enrollment: signed in, the provider's profile photo is embedded on the client as
soon as `/register` loads (drawn up to 400 px first: LinkedIn sends 100x100) and is
enough to register. Without a sign-in photo with a face: 3 selfies (or photos).
Every descriptor is stored and the best one wins at match time. A live selfie in
the room's lighting still matches best, since profile photos are often old or
filtered, so `/register` keeps offering one as optional.

Per video frame on `/hunt` (throttled to roughly 3 to 5 fps; more than ~8
inferences/s thermally throttles iPhones): detect -> landmarks -> align -> embed ->
cosine against the gallery -> vote.

Model loading: ~9 MB Human + 7 MB FaceX, from jsDelivr and our own origin, HTTP
cached after the first visit. Load while the user reads the consent text; do not
open the camera until models are warm.

Server-side fallback if phones are too slow: DeepFace in Docker (MIT, `/register`
and `/search` REST endpoints); the phone would post one JPEG every ~500 ms. Faces
then do leave the phone, so the consent screen must say so if this path is taken.

### 1.3 Server (Node, one process)

- `express` (or Hono) for JSON + static files.
- `ws` for one socket per phone, keyed by attendee id.
- CORS on `/api` for the origins in `FRONTEND_ORIGINS` (fly.toml; `server/cors.js`): exact origins only, no
  credentials. The cross-origin sign-in session travels in the `x-haunt-session` header, never a third-party cookie.
- One JSON file (`data/db.json`), written on every change. Fifty attendees is nothing; SQLite if it ever matters.
  `data/version.json` holds the deploy counter (`server/version.js`, see `/api/version`).
- OAuth: GitHub first (instant to set up), LinkedIn OIDC second (needs the
  "Sign In with LinkedIn using OpenID Connect" product on the dev app; usually
  self-serve). Both return name + avatar URL. Download the avatar at registration
  and store bytes; LinkedIn URLs expire.

### 1.4 Big screen (`/screen`)

Same server, a route meant for a TV. Subscribes to the broadcast socket, shows:
live event feed ("Matthew haunted Sam"), most-haunted, most-connected, headcount
(registered, online now, and the faces of who is online).
The room scan (Gaussian splat) plugs in here later; it is not part of the core.

## 2. Data model

The MVP stores this as one JSON file (`data/db.json`, or `DATA_DIR`); the SQL below is
the shape, and the migration target if we outgrow a file.

```sql
CREATE TABLE attendees (
  id            TEXT PRIMARY KEY,      -- uuid
  provider      TEXT NOT NULL,         -- 'github' | 'linkedin' | 'manual'
  provider_id   TEXT,
  name          TEXT NOT NULL,
  handle        TEXT,                  -- github login / linkedin vanity
  avatar        BLOB,                  -- downloaded at registration
  descriptors   TEXT NOT NULL,         -- JSON: [[...1024 floats], [...]]
  consent       INTEGER NOT NULL,      -- 1 = findable; 0 = hidden (kept so they can re-enable)
  role          TEXT,                  -- 'hunter' | 'ghost' | 'medium' | 'possessed' (later)
  blurb         TEXT,                  -- "what I'm building today"
  costume       TEXT,                  -- optional look: 'vampire' | 'witch' | 'demon' | 'ghost' | 'skeleton' | 'pumpkin' (web/costume.js); NULL = plain
  created_at    INTEGER NOT NULL
);

CREATE TABLE events (
  id         INTEGER PRIMARY KEY,
  type       TEXT NOT NULL,            -- 'haunt' | 'match' (the Scout, server/scout.js) | 'connect' | 'zone' (later)
  actor_id   TEXT NOT NULL,
  target_id  TEXT,
  meta       TEXT,                     -- JSON. haunt: {ratings: {raterId: {verdict, at, source}}}. match: {round, scoutVersion, fit, pOrganic, features[], weights, clueA, clueB, deadline, status: open|found|expired, hauntId?, foundAt?}
  created_at INTEGER NOT NULL
);
```

Consent is a column, not a filter in the client: the gallery endpoint only ever
returns rows with `consent = 1`, and flipping it to 0 removes you from every
phone at once: the server pushes `attendee_gone {id}` and every `/hunt` drops that
face from its gallery (phones also refetch the gallery on `gallery_changed` and
whenever their socket reconnects).

## 3. API

| Method | Path | Body / returns |
|---|---|---|
| GET | `/auth/github`, `/auth/linkedin`, `/auth/google`, `/auth/apple` | OAuth redirect; sets session cookie. A second provider while signed in links to the same session. `?return=<page>` (a page on a `FRONTEND_ORIGINS` origin, else 400) sends the callback back there instead of `/register` |
| GET, POST | `/auth/:provider/callback` | Provider return (Apple uses `form_post`, so POST). Redirects to `/register`, or to the `return` page with `#haunt_session=<sid>.<sig>`; that page sends it back as the `x-haunt-session` header (`web/common.js`), which works wherever the cookie does |
| POST | `/api/session/logout` | Clears the session cookie |
| GET | `/api/auth/providers`, `/api/session` | Configured providers; current session `{provider, linked[], name, handle, avatar}` (cookie or `x-haunt-session` header) |
| POST | `/api/attendee` | `{name, handle?, blurb?, linkedin?, consent: true, descriptors: [[...]], avatar?, costume?}` -> `{id, token}`. A signed-in session fills provider, name, handle, avatar. 400 unless `consent === true` and every descriptor has at least 128 finite numbers. `costume` is a short lowercase id (`web/costume.js`); anything else, or `'plain'`, stores `null` |
| PATCH | `/api/attendee/:id` | `{token, consent?, blurb?, handle?, linkedin?, costume?}` -> public card. `consent: false` is the kill switch; `costume: null` or `'plain'` clears the costume; a changed `handle` starts a GitHub lookup (the same handle keeps its profile). Every edit reaches every socket at once (#30): `attendee_changed` with the card, or `attendee_gone {id}` when the person is not findable (opted out or blocked; never their card). Turning consent back on broadcasts `gallery_changed` instead, because phones need the face descriptors again |
| GET | `/api/gallery` | `[{id, name, costume, descriptors}]` for consenting attendees only (the matching set `/hunt` loads; `costume` so it can draw it the moment a face matches). Cards and avatars come from `/api/attendee/:id` |
| GET | `/api/attendee/:id` | Public card: `id, name, handle, blurb, linkedin, profile` (GitHub enrichment or null), `avatar, consent, costume, hauntedCount, huntCount`, plus `profileLoading` (true only while a GitHub lookup runs for a handle with nothing cached; the card is pushed again when it lands). A cached profile comes back at once even when over an hour old; it is refreshed in the background and pushed. 404 if unknown |
| POST | `/api/haunt` | `{actorId, token, targetId, similarity, back?}` -> writes event, pushes `haunted` to target socket, returns the target card. Response and the `haunted` push both carry `hauntId` so the rating can name the haunt. Optional `back: true` is a haunt back: it needs an earlier haunt from the target to you (else 400 `nothing to haunt back`); the event stays `type: 'haunt'` and carries `back: true` |
| POST | `/api/rating` | `{raterId, token, hauntId, verdict: 'yes' \| 'no' \| 'knew', source?: 'phone' \| 'asi1'}` -> `{ok, scout, reason, changed}`. The Scout's one question after any haunt, from either side: "Would you build something with them?" Stored on that haunt event as `meta.ratings[raterId]` (a second answer overwrites). `knew` is kept but never counted. 403 bad token, 404 a haunt you were not part of, 400 any other verdict. `scout` says whether the Scout arranged that haunt, `reason` why ("Paired on: complement, intent match") or that it was not the Scout's call, `changed` is a changelog entry when this rating tripped a weight change (server/scout.js) |
| GET | `/api/me/:id?token=` | 403 on a bad token. `{me, received, given, connections}`: `me` is your public card; `received` = haunts on you, each with `by` (actor card); `given` = your haunts, each with `target` (target card); `connections` = one row per person you haunted or who haunted you, `{card, youHaunted, hauntedYou, lastAt}`. All newest first. Consenting counterparts only: someone who opts out (or is gone) drops out of all three |
| GET | `/api/events` | `?limit=` (default 50, max 500) -> `{events, attendees, scout}`: newest first, each event with `actor` and `target` cards, plus every consenting attendee's card. Bootstraps `/screen`; `scout` is the Scout state block (same shape as the `scout` socket message) |
| GET | `/api/presence` | `{online, findable, people}`: `online` = ids of findable people with a phone page open right now (a haunt makes that phone shriek), `findable` = how many are registered and findable, `people` = every findable person `{id, name, handle, avatar, costume, online}`, online first, then by name. No tokens, no descriptors. Live updates come as the `presence` push |
| GET | `/api/version` | `{version, deploy, deployedAt, startedAt, attendees, events}`: deployed git sha (`APP_VERSION`); `deploy` = the deploy number, one more on every deploy (a new Fly image, `FLY_IMAGE_REF`; off Fly a new `APP_VERSION`), kept with `deployedAt` (ms, when that deploy first booted) in `data/version.json`, both `null` on a dev build and on Vercel (no volume; `version` is `VERCEL_GIT_COMMIT_SHA`, first 7 characters); boot time; counts. The home page footer shows `v<deploy> · <version> · deployed <time>`, or just the sha when there is no number, or `dev build` when there is no sha. Used by deploy and integrator checks |
| GET | `/admin` | Admin page; asks for the token, calls the routes below |
| any | `/api/admin/*` | Needs `ADMIN_TOKEN` (header `x-admin-token`); 503 if unset, 401 if wrong. `GET overview`, `GET users` (no tokens/descriptors), `PATCH users/:id {blocked}`, `DELETE users/:id`, `POST messages {to \| group, text}`, `GET messages`, `GET/POST events {name}`, `POST events/:id/start\|end` (one active at a time; haunts carry `meetupId`). Blocked attendees leave the gallery and cannot haunt or be haunted |
| WS | `/ws?attendee=<id>` (phones), `/ws?screen=1` (`/screen`) | server -> phone: `hello` (on every connect; a phone refetches the gallery on a reconnect's `hello`), `haunted` (`{by, at}`, plus `back: true` for a haunt back), `gallery_changed` (someone joined, came back or was unblocked: refetch the gallery), `attendee_changed {attendee}` (a profile edit or a GitHub lookup landing: the public card without `avatar`, applied in place), `attendee_gone {id}` (no longer findable: drop that face), `presence {online, findable}` (on every connect, then whenever who is online or the findable count changes; see Presence below), `state` (roles/scores), `admin_message {text}`, `admin_status {blocked}`, `event_changed` |
| WS | the Scout, same sockets | phone: `state {scout: {phase: 'clue', matchId, clue, deadline, round}}` when the Scout pairs you with someone (the clue describes the other person from profile and public GitHub, never a name, handle or photo), `state {scout: {phase: 'found', matchId, hauntId, reason}}` when a haunt between the pair lands. Screen: `scout {version, changedAt, weights, predicted {yes, no, n}, baseline {yes, no, n}, clues {sent, found, pending, expired}, changelog[], minN, ratedPairs, nextReviewAt}` on every clue, confirmation, rating and version change |

Every `/api` route answers CORS for the `FRONTEND_ORIGINS` origins (preflight 204, methods GET POST PATCH DELETE,
headers `content-type`, `x-haunt-session`, `x-admin-token`); `/ws` accepts any origin, as before.

No haunt rate limit: a repeat `POST /api/haunt` on the same person is written and
pushed like the first (no 429). `/hunt` still sends one haunt per card: the button
re-arms only after the card closes and that person is found again. A closed card
(Close, or 3.5 s after a sent haunt) stays closed while that person is still in
frame; it re-arms once they have been out of frame for 2.5 s, or when the hunter
taps the camera. An open card stays on its person until they leave the frame.

Presence (#33, `server/presence.js`): someone is **online** while a page that plays the
shriek (`/hunt` or `/me`) holds `/ws?attendee=<id>` open on their phone, so a haunt reaches
them live. Everyone findable is still recognised by `/hunt` when offline, and a haunt on them
is saved to their card, without the shriek. Only findable people (opted in, not blocked) are
counted or listed; "registered" in the UI means this findable count. The server pings every
socket every 15 s (`PRESENCE_HEARTBEAT_MS`) and drops one that missed its pong, which is how a
locked phone or a lost network goes offline; a 4 s grace after a page's last socket closes
(`PRESENCE_GRACE_MS`) keeps a reload, or the hop from `/hunt` to `/me`, from flickering. A
`presence` push goes out at most every 250 ms, and only when the online set or the count changed.

## 4. Flows

**Register (60 s per person, at the door or from a QR on the screen)**

1. Scan QR -> `/register`. Models start loading in the background.
2. Tap "Sign in with GitHub" (or LinkedIn). Back with name, handle, avatar.
3. Consent screen in plain words: "Other players' phones can recognize my face
   in this room, during this event. I can turn this off any time on /me."
   Toggle must be on to continue.
4. Face signature: the client embeds the sign-in avatar by itself; with a face in
   it, no selfie is needed. Selfie (optional then, required otherwise): front
   camera, one capture, run `human.detect`, require exactly one
   face with a good detection score. Compute descriptor. Also compute a
   descriptor from the downloaded avatar on the server side? **No**: keep all
   embedding on the client so the server never runs a face model. The client
   fetches the avatar, embeds it, and sends both descriptors.
5. POST attendee. Land on `/me?welcome=1` with your card and a "Go hunt" button.
   Registering again on a phone that already has a card replaces it: the old card
   is switched off (`PATCH consent:false` with the old token), so one face never
   has two findable cards.

**Hunt**

1. `/hunt` opens the rear camera at 640x480 (enough for faces at 2 to 3 m). On
   Apple Vision Pro it runs in snap mode instead (section 6).
2. Fetch gallery once; refetch it on `gallery_changed` and on a reconnect. On
   `attendee_changed` patch that person in place (a new costume is drawn on the
   next frame, an open card re-renders); on `attendee_gone` drop their face.
3. Detect loop at 3 to 5 fps. On match above threshold for 3 consecutive frames
   (debounce), show the card overlay and a "Haunt" button.
4. Haunt -> POST, target's phone receives `haunted`: plays the shriek (Web Audio,
   on by default: unlocked by a silent play on the first tap anywhere on the
   page), vibrates on Android, flashes the screen, shows who found them. Both see
   each other's card; a `connect` event is written.

**Opt out**

`/me` -> toggle off -> PATCH -> server broadcasts `attendee_gone {id}` -> every
phone drops that face at once (an open card closes) and `/screen` recounts.

## 5. Privacy posture (say this out loud in the pitch)

- Video frames never leave the phone. Only 1024-float descriptors are uploaded,
  and only for people who opted in.
- The gallery is event-scoped: the server is torn down after the event, the
  SQLite file deleted.
- Matching only runs against people who opted in; everyone else is drawn as an
  anonymous box, never named, never stored.
- One-tap kill switch, and it works immediately.
- No face ever goes to a hosted LLM. Anthropic's usage policy prohibits facial
  recognition and biometric collection with Claude, so identification is only
  ever the open-source on-device library. Hosted models get events, profiles,
  and room photos (where, not who).

## 6. Failure modes and what to do

| Failure | Mitigation |
|---|---|
| Dim party lighting, no match | Live selfie taken in the same room; lower threshold only after testing; QR on badge as fallback identity |
| iOS kills camera when tab backgrounds | Re-acquire stream on `visibilitychange`; show a "tap to resume" overlay. Only one active getUserMedia at a time; `<video autoplay muted playsinline>` is mandatory; `facingMode: 'environment'` may pick the ultra-wide lens, so prefer the device labelled "Back Camera" |
| Apple Vision Pro: Safari lends web pages only the Persona camera (your own avatar, or a crossed-out placeholder), never the cameras that see the room | `/hunt` spots visionOS Safari (a Mac user agent with touch points and WebXR or `<model>`) and never opens the camera: snap mode. Look at someone, take a screenshot (top button + Digital Crown), pick it; one photo stands in for the 3-frame vote, every face is labelled, the best match opens its card, a tap on another name opens theirs. The photo never leaves the headset. `?snap=1` forces snap mode anywhere, `?snap=0` the live camera. The room cameras need a native app with Apple's Enterprise main-camera license |
| Audio does not play on the haunted phone | Unlock Web Audio with a silent buffer on the register tap; keep the page open (no Web Push in the core) |
| Phone too slow for the model | Lower video resolution; detect every Nth frame; `?engine=human` skips the second model; last resort is the DeepFace server-side path |
| Two attendees look alike / twins | Show top-2 when the margin between them is < 0.05 and let the hunter pick |
| OAuth provider slow to approve | `manual` provider: name + handle + selfie, no login. Keep this path regardless; it is also the fastest at the door |

## 7. Build order (maps to Shelled PRs)

1. **PR 1, skeleton:** server, SQLite, `/register` with manual provider + consent +
   selfie + descriptor upload, `/api/gallery`, `/me`. Deployed over HTTPS.
2. **PR 2, hunt:** `/hunt` camera loop, matching, card overlay, `/api/haunt`,
   socket push, shriek + flash. This is the demo.
3. **PR 3, polish:** GitHub OAuth, LinkedIn OIDC, `/screen` feed and leaderboard,
   kill switch broadcast.

Then layers 4 to 6 from the README.

## 8. Repo layout (proposed)

```
/server        express + ws + better-sqlite3, auth routes
/web           vite app: register, hunt, me, screen
/web/src/face  human.js wrapper: load(), embed(imageOrVideo), match(desc, gallery)
/docs          this file, RESEARCH.md, EDGE_CASES.md
```
