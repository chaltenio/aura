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
| `/register` | OAuth login, consent toggle, selfie capture, compute embedding on-device, upload |
| `/hunt` | live camera, face detection + embedding, match against gallery, overlay card, haunt button |
| `/me` | your card, who found you, who you found, kill switch ("stop being findable") |

Framework: plain Vite + vanilla TS or React, whatever Shelled produces fastest.
No SSR needed. Everything the camera does must run after a user gesture and over
HTTPS (camera, mic, and motion sensors are all gated on both).

### 1.2 Face engine (in the browser)

Library: `@vladmandic/human` (TensorFlow.js). It gives face detection, alignment,
and a **face descriptor** (embedding) per face, plus a `human.match.find()` helper
that compares a descriptor against a gallery. It runs in Safari on WebGL. Pending
confirmation from research: current version, model sizes, iPhone frame rate.

Pipeline per video frame (throttle to ~3 to 5 fps on phones):

1. `human.detect(video)` -> faces with box + descriptor.
2. For each face: cosine similarity against every gallery descriptor.
3. Best match above `THRESHOLD` -> show card for that attendee, anchored to the box.
4. Below threshold -> draw a neutral box ("unknown wanderer"), nothing else.

Two descriptors per attendee (profile photo + live selfie) and take the max
similarity. Profile photos are often old or filtered; the live selfie taken in
the room's lighting is the one that actually matches.

Threshold: start at **0.55** cosine similarity (Human's own demos use ~0.5 to
0.6). Tune on the team's faces in the real room before the demo. Prefer false
negatives over false positives: a wrong name on a stranger is the worst outcome.

Model loading: ~10 MB of weights. Load on `/register` while the user is reading
the consent text, cache in the browser, and reuse on `/hunt`. Show a progress bar;
do not open the camera until models are warm.

### 1.3 Server (Node, one process)

- `express` (or Hono) for JSON + static files.
- `ws` for one socket per phone, keyed by attendee id.
- `better-sqlite3`, single file. Fifty attendees is nothing.
- OAuth: GitHub first (instant to set up), LinkedIn OIDC second (needs the
  "Sign In with LinkedIn using OpenID Connect" product on the dev app; usually
  self-serve). Both return name + avatar URL. Download the avatar at registration
  and store bytes; LinkedIn URLs expire.

### 1.4 Big screen (`/screen`)

Same server, a route meant for a TV. Subscribes to the broadcast socket, shows:
live event feed ("Matthew haunted Sam"), most-haunted, most-connected, headcount.
The room scan (Gaussian splat) plugs in here later; it is not part of the core.

## 2. Data model

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
  created_at    INTEGER NOT NULL
);

CREATE TABLE events (
  id         INTEGER PRIMARY KEY,
  type       TEXT NOT NULL,            -- 'haunt' | 'connect' | 'zone' (later)
  actor_id   TEXT NOT NULL,
  target_id  TEXT,
  meta       TEXT,                     -- JSON
  created_at INTEGER NOT NULL
);
```

Consent is a column, not a filter in the client: the gallery endpoint only ever
returns rows with `consent = 1`, and flipping it to 0 removes you from every
phone's gallery on the next refresh (clients re-fetch the gallery every 30 s and
on a `gallery_changed` socket message).

## 3. API

| Method | Path | Body / returns |
|---|---|---|
| GET | `/auth/github`, `/auth/linkedin` | OAuth redirect; sets session cookie |
| POST | `/api/attendee` | `{descriptors, consent, blurb}` -> `{id}` (profile comes from session) |
| PATCH | `/api/attendee/me` | `{consent}` kill switch |
| GET | `/api/gallery` | `[{id, name, handle, descriptors}]` for consenting attendees only. Avatars are a separate lazy endpoint |
| GET | `/api/attendee/:id/card` | name, handle, avatar URL, blurb, GitHub "this week" summary |
| POST | `/api/haunt` | `{targetId, similarity}` -> writes event, pushes `haunted` to target socket, returns the target card |
| WS | `/ws?attendee=<id>` | server -> phone: `haunted`, `gallery_changed`, `state` (roles/scores) |

Rate-limit haunts per pair (one per 60 s) so a phone pointed at someone does not
spam them.

## 4. Flows

**Register (60 s per person, at the door or from a QR on the screen)**

1. Scan QR -> `/register`. Models start loading in the background.
2. Tap "Sign in with GitHub" (or LinkedIn). Back with name, handle, avatar.
3. Consent screen in plain words: "Other players' phones can recognize my face
   in this room, during this event. I can turn this off any time on /me."
   Toggle must be on to continue.
4. Selfie: front camera, one capture, run `human.detect`, require exactly one
   face with a good detection score. Compute descriptor. Also compute a
   descriptor from the downloaded avatar on the server side? **No**: keep all
   embedding on the client so the server never runs a face model. The client
   fetches the avatar, embeds it, and sends both descriptors.
5. POST attendee. Land on `/me` with your card and a "Go hunt" button.

**Hunt**

1. `/hunt` opens the rear camera at 640x480 (enough for faces at 2 to 3 m).
2. Fetch gallery once, subscribe to `gallery_changed`.
3. Detect loop at 3 to 5 fps. On match above threshold for 3 consecutive frames
   (debounce), show the card overlay and a "Haunt" button.
4. Haunt -> POST, target's phone receives `haunted`: plays the shriek (Web Audio,
   unlocked at registration by a silent play on tap), flashes the screen, shows
   who found them. Both see each other's card; a `connect` event is written.

**Opt out**

`/me` -> toggle off -> PATCH -> server broadcasts `gallery_changed` -> gone from
every phone within one refresh.

## 5. Privacy posture (say this out loud in the pitch)

- Video frames never leave the phone. Only 1024-float descriptors are uploaded,
  and only for people who opted in.
- The gallery is event-scoped: the server is torn down after the event, the
  SQLite file deleted.
- Matching only runs against people who opted in; everyone else is drawn as an
  anonymous box, never named, never stored.
- One-tap kill switch, and it works immediately.

## 6. Failure modes and what to do

| Failure | Mitigation |
|---|---|
| Dim party lighting, no match | Live selfie taken in the same room; lower threshold only after testing; QR on badge as fallback identity |
| iOS kills camera when tab backgrounds | Re-acquire stream on `visibilitychange`; show a "tap to resume" overlay |
| Audio does not play on the haunted phone | Unlock Web Audio with a silent buffer on the register tap; keep the page open (no Web Push in the core) |
| Phone too slow for the model | Downscale video to 320 px for detection; detect every Nth frame; fall back to a server-side match endpoint (one JPEG frame) if research finds a quick OSS service |
| Two attendees look alike / twins | Show top-2 when the margin between them is < 0.05 and let the hunter pick |
| OAuth provider slow to approve | `manual` provider: name + handle + selfie, no login. Keep this path regardless; it is also the fastest at the door |

## 7. Build order (maps to Shelled PRs)

1. **PR 1, skeleton:** server, SQLite, `/register` with manual provider + consent +
   selfie + descriptor upload, `/api/gallery`, `/me`. Deployed over HTTPS.
2. **PR 2, hunt:** `/hunt` camera loop, matching, card overlay, `/api/haunt`,
   socket push, shriek + flash. This is the demo.
3. **PR 3, polish:** GitHub OAuth, LinkedIn OIDC, `/screen` feed and leaderboard,
   rate limits, kill switch broadcast.

Then layers 4 to 6 from the README.

## 8. Repo layout (proposed)

```
/server        express + ws + better-sqlite3, auth routes
/web           vite app: register, hunt, me, screen
/web/src/face  human.js wrapper: load(), embed(imageOrVideo), match(desc, gallery)
/docs          this file, RESEARCH.md, EDGE_CASES.md
```
