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

## 2b. The Scout: find people by face, not by name (second track, tarecq, 14:20)

Where the matchmaker idea went after an hour of talking it through. Short version: **the camera is the lookup, the name is the reward.** An agent decides who in the room should meet, but never tells you who. You get a clue and have to find them with `/hunt`.

Why it beats a "who should I meet" chatbot:
- Every other networking tool starts from a name and sends you looking for a badge. HAUNT inverts it: you look at people, the phone matches on-device, and only the right face unlocks the profile and the reason you were paired.
- A haunt is a consented, timestamped, in-person meeting. That is ground truth no chat product has. Ask both people afterwards "worth it?" and the agent's predictions get scored against reality. That calibration loop is the moat, and we get the signal for free from the event log.
- The face half and the agent half never touch. Faces stay on the phone; the agent only reads profiles, GitHub activity and events. Say that out loud to judges.

The mechanic (one round):
1. **Scout** scores every pair of opt-in attendees for complementarity (GitHub repos, blurb, what they say they are looking for). Surfaces a pair only when it scores well in both directions (mutual gate = symmetric consent).
2. **Clue, not a name.** Both phones get a nudge over the existing `state` socket: "Your match shipped a Rust CLI this week and wants a cofounder." No name, no photo. Clues come from profile + public GitHub only.
3. **Hunt confirms.** `/hunt` marks the card as *your match* only when the camera lands on that person. Optional warmer/colder: the scout can rank the room, near-matches glow a little.
4. **Haunt wins.** Haunting your match scores double, both phones shriek, `/screen` says "Two found each other." Both are hunting at once with their own clue; first to find wins the round.
5. **Rate.** One tap after the haunt: worth it / not. `/screen` shows predicted vs actual as a running score. The agent reads it and changes its prompt or weights (the "one change from feedback" the Fetch.ai track asks for).

Roles fall out of it without a role system: the person being described is the Ghost for that round, the one holding the clue is the Hunter, the scout is the Medium.

Fetch.ai fit: the scout is a uAgent on Agentverse with a mailbox so "Who should I meet at HAUNT?" reaches it through ASI:One (3 tries, one change from feedback). Build order: Agentverse registration first (45 min, human), then pairwise scoring + clue nudge, then match-aware hunt card, then rating + scoreboard.

Dropped on purpose (good ideas, not for today): one agent per person, agent-to-agent negotiation, sender-pays economics, readiness over time, Fetch.ai payments. The scout + mutual gate + one rating question is the whole demo.

Touches: new `server/scout.js` (or its own small process), `POST /api/rating`, a `match` event type, a `state` payload for the clue, a small match badge in `web/hunt.js`. Reads `GET /api/gallery` (ids), `GET /api/attendee/:id/card`, `GET /api/events`.

## 3. Ideas that fit and are free for another teammate to take

All of these sit beside the core. They consume the server's API and WebSocket (ARCHITECTURE.md section 3) and never edit `web/register|hunt|me`, `web/face.js`, or `server/index.js` internals. Claim one in TODO.md before starting.

| Idea | What it is | Why it fits | Needs from the core | Effort | Track |
|---|---|---|---|---|---|
| **CSV + LinkedIn photo pipeline** | Script or page that turns the attendee list (name, LinkedIn URL) into photos on disk, then feeds `/enroll`. A teammate already extracts LinkedIn photos with a v0 app; wrap that. | It is how the room gets pre-registered without selfies | `/enroll` page (CSV columns `name,handle,linkedin,blurb,photo`) | S | all |
| **Narrator / game master** | Server-side loop that batches the event feed every 20 to 30 s, asks Claude for a two-line spooky announcement, pipes to ElevenLabs TTS, plays on `/screen` | Most visible agent in the demo, pure Messages API | `GET /api/events`, screen WS `event` messages; add an audio element on `/screen` | S | Shelled edge cases (agents can't hear TTS) |
| ~~Matchmaker uAgent on Agentverse~~ **became the Scout (section 2b, tarecq)** | Pairwise scoring, clue-not-name nudge, mutual gate, hunt confirms, post-haunt rating | Fetch.ai track; the hunt is the ground truth | `GET /api/gallery`, `GET /api/attendee/:id/card`, `GET /api/events`; adds `POST /api/rating`, `match` event | M | **Fetch.ai** |
| **Demogorgon localizer on TrueForge** | Attendees upload a photo of their surroundings; Claude vision picks the zone/sigil it was taken from; a memory file of confirmed pairs makes run 2 beat run 1 on a fixed held-out set | TrueForge wants "a later run that improves by changing its own skills or instructions" | Nothing from the core; its own `/api/zone` or a separate service; sigil photos | M | **TrueForge** |
| **Room scan on the big screen** | Scaniverse scan (no LiDAR needed) -> SPZ -> Spark in three.js on `/screen`, haunt events as sprites at hand-placed coordinates | The one thing nobody else in the room will have | screen WS `event` messages | M (1 h) | demo |
| **Sigils + `/sigil` page** | Printed high-contrast posters as AR.js pattern markers with a QR per zone; scanning shows a ghost and POSTs the zone | Theming, "where are you" without localization tech | a new `zone` event type (add `POST /api/zone` in a separate route file) | M | demo |
| **Most Wanted bounty** | Every 5 min the server picks a random consenting attendee, broadcasts it on `state`, `/screen` shows "Most Wanted: Sam. First haunt scores 3." | Turns a demo into a room-wide hunt; ~40 server lines + a screen banner | `state` WS message, `/screen` banner | S | demo |
| **Haunt back** | The `haunted` notification already carries the hunter's card; add one button that haunts them back | Closes the social loop in one tap; two phones shriek in sequence on stage | `POST /api/haunt` from the notification in `web/me.js` / `common.js` | S | demo |
| **Tonight's connections on `/me`** | List of everyone you haunted or were haunted by, with GitHub/LinkedIn links and "copy as text" | The networking payoff the pitch promises; nothing shows it to the user yet | `GET /api/events` filtered to me | S | demo |
| **Post-event digest** | Claude writes each person a short "who you met tonight" from events + profiles only (names, repos, times; never faces) | Natural second skill for the Scout; the answer to "where is the LLM" | `GET /api/events`, cards | S | **Fetch.ai** / demo |
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
