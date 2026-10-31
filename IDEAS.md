# IDEAS.md

Everything we ideated on 2026-10-31, sorted by how it relates to where the project went.
Read "free to take" first if you are looking for something to build that doesn't collide with the core.

## 1. Where we landed

HAUNT: opt-in face-to-profile recognition from a phone browser at a conference. People pre-register (CSV + LinkedIn photo, or a selfie on `/register`), then any phone on `/hunt` recognizes them on-device and shows their card. "Haunting" someone makes their phone shriek and flash and connects you both; a big screen shows the feed. Tracks: Shelled AI (build via Shelled runs + EDGE_CASES.md) plus one of Fetch.ai or TrueForge.

## 2. Ideas we are building (core, in README build order)

| Layer | What | Status (main session owns) |
|---|---|---|
| 1 | Register + consent + on-device face descriptor | done, pushed |
| 2 | Hunt view: camera -> match -> profile card | done, passes e2e test |
| 3 | Haunt event: sound + flash on target's phone, connection saved | done, passes e2e test |
| 2b | Bulk enroll from CSV + photos (`/enroll`) | done, untested with real CSV |
| 2c | Stronger embedder (FaceX EdgeFace via Human landmarks) | in progress, alignment being debugged; Human engine is the default until it wins on `/calibrate` |
| 4 | Roles, leaderboard, big screen | `/screen` feed + leaderboard done; roles not started |
| 5 | Set dressing: room scan, sigils | not started (free to take, below) |
| 6 | Chirp throw, matchmaker agent, treat stations | not started (see below) |

## 3. Ideas that fit and are free for another teammate to take

All of these sit beside the core. They consume the server's API and WebSocket (ARCHITECTURE.md section 3) and never edit `web/register|hunt|me`, `web/face.js`, or `server/index.js` internals. Claim one in TODO.md before starting.

| Idea | What it is | Why it fits | Needs from the core | Effort | Track |
|---|---|---|---|---|---|
| **CSV + LinkedIn photo pipeline** | Script or page that turns the attendee list (name, LinkedIn URL) into photos on disk, then feeds `/enroll`. A teammate already extracts LinkedIn photos with a v0 app; wrap that. | It is how the room gets pre-registered without selfies | `/enroll` page (CSV columns `name,handle,linkedin,blurb,photo`) | S | all |
| **Narrator / game master** | Server-side loop that batches the event feed every 20 to 30 s, asks Claude for a two-line spooky announcement, pipes to ElevenLabs TTS, plays on `/screen` | Most visible agent in the demo, pure Messages API | `GET /api/events`, screen WS `event` messages; add an audio element on `/screen` | S | Shelled edge cases (agents can't hear TTS) |
| **Matchmaker uAgent on Agentverse** | "Who should I meet" chat agent over the opt-in profiles + GitHub activity, registered with Mailbox so it shows in ASI:One | Fetch.ai track needs an agent with 3 tries through ASI:One | `GET /api/events` (attendees list), `GET /api/attendee/:id` | S to M (45 to 60 min is registration) | **Fetch.ai** |
| **Demogorgon localizer on TrueForge** | Attendees upload a photo of their surroundings; Claude vision picks the zone/sigil it was taken from; a memory file of confirmed pairs makes run 2 beat run 1 on a fixed held-out set | TrueForge wants "a later run that improves by changing its own skills or instructions" | Nothing from the core; its own `/api/zone` or a separate service; sigil photos | M | **TrueForge** |
| **Room scan on the big screen** | Scaniverse scan (no LiDAR needed) -> SPZ -> Spark in three.js on `/screen`, haunt events as sprites at hand-placed coordinates | The one thing nobody else in the room will have | screen WS `event` messages | M (1 h) | demo |
| **Sigils + `/sigil` page** | Printed high-contrast posters as AR.js pattern markers with a QR per zone; scanning shows a ghost and POSTs the zone | Theming, "where are you" without localization tech | a new `zone` event type (add `POST /api/zone` in a separate route file) | M | demo |
| **Roles + scoreboard** | Assign Hunter/Ghost/Medium/Possessed at join; role-gated views; most-haunted and top-hunter boards already exist | Turns networking into a game | `role` column exists in the data model; `state` WS message is reserved for this | M | demo |
| **NFC tap-to-join** | NTAG213 stickers written with the free NFC Tools app pointing at `/register`; iPhone XS+ opens them from the lock screen | Zero-friction onboarding at the door | nothing | S (hardware run) | real users |
| ~~GitHub "pushed this week" on the card~~ **DONE** (main-session, 4be2a21) | Cards now show bio, company, location, followers, pushes this week, active + recent repos, GitHub/LinkedIn links (`server/profile.js`, `renderProfile` in common.js) | | | | demo |
| **Voice widget** | ElevenLabs Agents embed on `/me` for a spooky voice you can talk to | Fast, impressive, free tier is ~15 min of calls | nothing | S | demo |
| **Trick-or-treat stations** | QR/NFC stations that hand out digital treats; one paid treat via a Stripe payment link | Conference reuse (sponsor booths) | a `treat` event type | M | Base44-style, only if we open that track (we won't) |
| **Proof of launch** | 2-minute demo video or X post, required by the rules | Submission blocker | a working deploy | S | all |
| **EDGE_CASES.md curation** | Turn every Shelled run into an entry: asked, agent did, broke, fix, why agents struggle | Shelled prize deliverable | Shelled run links in PR descriptions | ongoing | **Shelled** |
| **Deployment** | Fly.io / Railway / Render with a persistent `data/` volume; the Cloudflare tunnel is the stopgap | Needed before LinkedIn OAuth (callback URL) | `PORT` env, `data/` dir | S | all |

## 4. Ideas we parked and why

| Idea | Why parked | What would un-park it |
|---|---|---|
| The Blob (ARC-style unlabeled alien interface, crowd vs agent) | Great fit for "hard for agents", but the team converged on the people-recognition hook | A second team or a post-hackathon weekend |
| Werewolf with per-phone mics | Audio streaming + diarization is a day of plumbing | A working per-phone audio channel |
| Upside Down light wall (phone flashlights -> webcam -> agent) | Pure gimmick, no sponsor track | A themed demo slot with time to spare |
| ggwave chirp throw | Audible mode fails beyond ~1 m in a loud room; Safari filters ultrasound | A quiet room, phones held together, as a stretch demo only |
| True AR localization / VPS | 8th Wall hosted shut down March 2026; VPS not open-sourced; no WebXR AR in iOS Safari | A native app with ARKit world maps (needs TestFlight, 4 to 48 h review) |
| Reachy Mini robot | No robot in the room; simulator only | Someone brings a Reachy |
| Base44 money-finder | Different project, different builder, 5 free messages/day | Sponsor credits and a second team |
| Jev decision model | Waitlist-gated at typesafe.ai | Someone already has access |
| Bop-It reflex game | Clean "agents are slow" story, weak room interaction | A demo-only side track |
| Haunting (AR Pokémon ghosts at markers) | Folded into sigils; the AR layer eats the day | Sigils working first |
| Human engine's deeper FaceRes model | Compressed all similarities upward, worse separation | nothing |

## 5. Rules that shape all of this

- **No face ever goes to a hosted LLM.** Anthropic's policy prohibits facial recognition with Claude; identification is on-device open-source only. Hosted models get events, profiles, and room photos (where, not who).
- **Opt-in only.** Gallery returns consenting attendees; the kill switch on `/me` works immediately.
- **Max 2 challenges per project, one prize** (strangerbuilds.com/rules). Shelled plus one of Fetch.ai or TrueForge.
- **Every Shelled PR carries its run link** and feeds EDGE_CASES.md.
- **Atomic commits, pull --rebase, push often** (CLAUDE.md).
