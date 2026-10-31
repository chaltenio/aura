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

Implemented in `web/face.js` as a switchable engine; everything runs on the phone.

**Default: `facex` hybrid.** Human (`@vladmandic/human` 3.3.6, MIT) does detection
(BlazeFace) and 468-point FaceMesh landmarks on the TensorFlow.js **wasm** backend.
From the mesh we take the five ArcFace keypoints (eye centers, nose tip, mouth
corners), warp the face to a 112x112 ArcFace-aligned crop with a canvas similarity
transform (`alignToArcFace`), and feed it to FaceX's EdgeFace-XS wasm embedder
(Apache-2.0, 7 MB, vendored in `web/vendor/facex/`), which returns a 512-float
vector. Matching is cosine similarity. FaceX's own detector is not used: its weight
file is unpublished, and its bundled align.js produced shifted crops.

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

Enrollment: 3 selfies (or photos) at registration; every descriptor is stored and
the best one wins at match time. The live selfie taken in the room's lighting is
the one that actually matches; profile photos are often old or filtered.

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
- One JSON file (`data/db.json`), written on every change. Fifty attendees is nothing; SQLite if it ever matters.
- OAuth: GitHub first (instant to set up), LinkedIn OIDC second (needs the
  "Sign In with LinkedIn using OpenID Connect" product on the dev app; usually
  self-serve). Both return name + avatar URL. Download the avatar at registration
  and store bytes; LinkedIn URLs expire.

### 1.4 Big screen (`/screen`)

Same server, a route meant for a TV. Subscribes to the broadcast socket, shows:
live event feed ("Matthew haunted Sam"), most-haunted, most-connected, headcount.
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
| GET | `/auth/github`, `/auth/linkedin`, `/auth/google`, `/auth/apple` | OAuth redirect; sets session cookie. A second provider while signed in links to the same session |
| GET, POST | `/auth/:provider/callback` | Provider return (Apple uses `form_post`, so POST). Redirects to `/register` |
| GET | `/api/auth/providers`, `/api/session` | Configured providers; current session `{provider, linked[], name, handle, avatar}` |
| POST | `/api/attendee` | `{descriptors, consent, blurb}` -> `{id}` (profile comes from session) |
| PATCH | `/api/attendee/me` | `{consent}` kill switch |
| GET | `/api/gallery` | `[{id, name, handle, descriptors}]` for consenting attendees only. Avatars are a separate lazy endpoint |
| GET | `/api/attendee/:id/card` | name, handle, avatar URL, blurb, GitHub "this week" summary |
| POST | `/api/haunt` | `{targetId, similarity}` -> writes event, pushes `haunted` to target socket, returns the target card |
| GET | `/api/me/:id?token=` | 403 on a bad token. `{me, received, given, connections}`: `me` is your public card; `received` = haunts on you, each with `by` (actor card); `given` = your haunts, each with `target` (target card); `connections` = one row per person you haunted or who haunted you, `{card, youHaunted, hauntedYou, lastAt}`. All newest first. Consenting counterparts only: someone who opts out (or is gone) drops out of all three |
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
- No face ever goes to a hosted LLM. Anthropic's usage policy prohibits facial
  recognition and biometric collection with Claude, so identification is only
  ever the open-source on-device library. Hosted models get events, profiles,
  and room photos (where, not who).

## 6. Failure modes and what to do

| Failure | Mitigation |
|---|---|
| Dim party lighting, no match | Live selfie taken in the same room; lower threshold only after testing; QR on badge as fallback identity |
| iOS kills camera when tab backgrounds | Re-acquire stream on `visibilitychange`; show a "tap to resume" overlay. Only one active getUserMedia at a time; `<video autoplay muted playsinline>` is mandatory; `facingMode: 'environment'` may pick the ultra-wide lens, so prefer the device labelled "Back Camera" |
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
   rate limits, kill switch broadcast.

Then layers 4 to 6 from the README.

## 8. Repo layout (proposed)

```
/server        express + ws + better-sqlite3, auth routes
/web           vite app: register, hunt, me, screen
/web/src/face  human.js wrapper: load(), embed(imageOrVideo), match(desc, gallery)
/docs          this file, RESEARCH.md, EDGE_CASES.md
```
