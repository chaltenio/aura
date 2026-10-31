# TODO

Claim a task by writing your name in Owner **before** you start. Tick it when it is on `main` and `npm test` is green. Keep this file short; history lives in git.

## STATUS

**2026-10-31 15:21 PT.** LIVE: https://aura-haunt.fly.dev deploys 65ec9cb, which is current `main`; `npm test` green; prod holds 2 attendees and 6 events. Landed since 15:33: tarecq's Shelled run 4 prompt (possession effects) and Matt's #25 sound + vibrate on by default (a haunt vibrates on Android before any tap, the first tap anywhere arms the shriek, /me reads "Sound on"; web/common.js, me.*; ARCHITECTURE/DEMO/DIAGRAM updated), landed by the integrator from a READY line. On `main` besides: FaceX hybrid engine, Express + ws server (gallery, haunt push with Haunt back, no rate limit, kill switch, `/api/version`, `/api/me/:id` connections, `/admin` behind `ADMIN_TOKEN`), API smoke test, four sign-in providers, hooks, `/start`, launcher, Scout plan, room scan brief. `/admin` on prod still needs `ADMIN_TOKEN` in secrets/prod.enc.env + fly secrets (Matt). In flight (Matt): `mthomas100/costumes` (9 commits, costume field + web/costume.js drawing on /hunt; TODO row still 22, must be #23), `mthomas100/linkedin-live` (#22, OAUTH_SETUP + TODO), `mthomas100/ui-polish` (#26, TODO row so far). tarecq: Scout slice 1 (server/scout.js, web/scout.js, `POST /api/rating`, `match` events, `id` on the haunted push); docs/scout and IDEAS 2b still say `/api/attendee/:id/card`; Matt offered #13 room scan to tarecq. #17 Most Wanted and #20 digest are unclaimed. Smoke boot wait fix (test/smoke.mjs i < 450 + actions/cache) still open (Matt). No Shelled run executed yet; EDGE_CASES.md is the template (#6/#7, tarecq). Stale: matt/next (89 min, one 13:51 log line), delete with a bus line; tarecq/scout-explore is gone. Nobody blocked.

## Now (this hour)

| # | Task | Owner | Done |
|---|------|-------|------|
| 1 | Face engine: FaceX (EdgeFace, aligned) as default, Human fallback; separation test passes on fixtures | main session | [ ] |
| 2 | `npm test`: Playwright e2e (register from photos, hunt, match, haunt push) runnable by anyone | main session | [ ] |
| 3 | Real-phone test over the tunnel: register with selfies, hunt a teammate, hear the shriek | (needs a human) | [ ] |
| 4 | Deploy to a public HTTPS URL (Fly/Railway/Render), weights fetched on boot, `data/` persisted | main session | [x] |
| 5 | Register everyone on the team: Luma + sign the pact + activate the Duck on ASI:One | each person | [ ] |
| 6 | First Shelled run on this repo (Run 1 in docs/SHELLED_RUNS.md: narrator on `/screen`). Paste run link in PR body | tarecq | [ ] |
| 7 | EDGE_CASES.md: first two entries from the Shelled run | tarecq | [ ] |
| 22 | Costumes: optional look picked at `/register` or `/me` (Vampire, Witch, Demon, Ghost, Skeleton, Pumpkin; default Plain). `/hunt` draws it on your matched face from the face mesh (on-device) with a sting and a card title | Matt | [ ] |
| 25 | Sound + vibrate on by default: a haunt shrieks and vibrates (Android) without the "arm sound" tap on `/me`; the first tap anywhere arms audio | Matt | [x] |
| 27 | LinkedIn: sign-in live on prod (app HAUNT, redirect `https://aura-haunt.fly.dev/auth/linkedin/callback`, `LINKEDIN_CLIENT_ID/SECRET` in secrets/prod.enc.env and on Fly); signed in, the profile photo is the face signature and selfies are optional | Matt | [ ] |
| 28 | Auto-ready: a finished job runs `scripts/ready.sh` by itself (sync, test, push, open the PR, post [READY]); `/merge` and the integrator land the PR's own head so GitHub shows it merged | Matt | [ ] |

## Next

| # | Task | Owner | Done |
|---|------|-------|------|
| 8 | GitHub OAuth, then LinkedIn OIDC (store picture bytes, not the URL) on `/register` | main session (GitHub/LinkedIn), Chris (Google/Apple) | [x] |
| 9 | Decide the second track: **Fetch.ai, as the Scout** (IDEAS.md 2b: find people by face not name, clue nudge, hunt confirms, post-haunt rating). TrueForge dropped: needs venue photos + two measured runs. | tarecq | [x] |
| 10 | Scout (Fetch.ai): Agentverse registration (mailbox) -> pairwise scoring + clue nudge over `state` -> match badge on `/hunt` -> post-haunt rating + predicted-vs-actual on `/screen`; 3 tries through ASI:One, one change from feedback | tarecq | [ ] |
| 21 | Admin panel `/admin`: attendees, allow/disallow, direct + group messages, open/close events (`ADMIN_TOKEN`) | Chris | [ ] |
| 11 | Roles on join (Hunter / Ghost / Medium / Possessed) and role-gated views | | [ ] |
| 12 | Narrator agent: event feed -> Claude -> TTS on `/screen` | | [ ] |
| 13 | Room scan: Scaniverse -> SPZ -> Spark on a new `/room` page, ghosts on live haunts. Brief: docs/ROOM_SCAN.md. Matt is offering it to tarecq (15:05) | | [ ] |
| 14 | Sigil posters (AR.js pattern markers + QR fallback) and `/zone` events | | [ ] |
| 15 | Proof of launch: X post or 2-minute demo video; screenshots of Shelled runs | | [ ] |
| 16 | Feedback swap with one other team (Stranger Builds requirement) and one change from it | | [ ] |
| 17 | Most Wanted bounty: server picks a consenting attendee every 5 min, `state` broadcast, `/screen` banner, first haunt scores 3 (IDEAS.md 3) | | [ ] |
| 18 | Haunt back: one button on the `haunted` notification that haunts the hunter back (IDEAS.md 3) | Matt | [x] |
| 19 | Tonight's connections on `/me`: who you haunted / were haunted by, links, copy as text (IDEAS.md 3) | Matt | [x] |
| 20 | Post-event digest: Claude writes "who you met tonight" from events + profiles only (IDEAS.md 3) | | [ ] |

## Done

| # | Task | Owner |
|---|------|-------|
| 0 | Repo, README, ARCHITECTURE, RESEARCH (5 sections), EDGE_CASES template, CLAUDE.md, integrator skill, sync.sh | main session + fork |
| - | GitHub profile enrichment on cards (bio, location, pushes this week, repos, LinkedIn link), 4be2a21 | main session |
| 24 | No haunt rate limit: `/api/haunt` drops the 60 s per-pair cooldown (429); a repeat haunt is written and pushed like the first, 8df2d4e | Matt |

## Decisions

- Tracks: **Shelled AI** + **Fetch.ai** (the Scout, below; decided 14:14, max 2 per project). TrueForge dropped, Base44 skipped.
- Git: one branch per session (`<name>/<task>`), atomic commits, `scripts/sync.sh` after every commit, land with `/merge`. Nobody commits to `main` by hand. (Replaced direct-to-main at 13:40: parallel sessions were colliding on the same files.)
- Face matching is on-device only. No face image or embedding reaches a hosted model.
- Second track is **Fetch.ai**, built as the Scout (IDEAS.md 2b): the agent pairs people and gives clues, the camera finds them, the haunt is the ground truth. Clues come from profiles and public GitHub only, never from faces. (14:20, tarecq)
- The Scout adds `POST /api/rating`, a `match` event and a clue payload on `state`; ARCHITECTURE.md changes in the same commit as the code (tarecq's [PLAN], 14:14).
- Haunt back adds `back:true` on `POST /api/haunt` and a haunted-back push; connections adds `GET /api/me/:id`. Both land in ARCHITECTURE.md in the same commit as the code (Matt's [PLAN]s, 14:31).
- Admin panel adds `/admin` behind `ADMIN_TOKEN`, admin block/unblock (separate from the attendee kill switch), direct and group ws messages and event open/close; ARCHITECTURE.md in the same commit as the code (Chris's [PLAN], 14:44).
- Costumes add an optional `costume` field on the attendee (picked at /register or /me, drawn on-device on /hunt); the attendee shape in ARCHITECTURE.md changes in the same commit (Matt's [PLAN], 15:00). Row numbers: #21 admin panel (Chris), #22 LinkedIn live (Matt), #23 costumes (Matt).
- sync.sh (9a867ae, 15:06, Matt): once a branch is pushed it merges origin/main in instead of rebasing, so a push never needs force; unpushed branches still rebase; /merge flattens at landing. Never force-push, even with a lease.
- No haunt rate limit (#24, 8df2d4e, 15:02, Matt): a repeat haunt or haunt back is 200, written and pushed; `/hunt` re-arms the button only after the card closes and the person is found again.
- Never close a PR or issue, or delete a branch, without a comment saying why and where the work went (13:51, CLAUDE.md). `/merge` and the integrator comment on the open PR before deleting its branch.

