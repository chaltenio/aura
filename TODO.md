# TODO

Claim a task by writing your name in Owner **before** you start. Tick it when it is on `main` and `npm test` is green. Keep this file short; history lives in git.

## STATUS

**2026-10-31 16:05 PT.** PROD DATA: at 16:02 (deploy v12) production went from 5 attendees / 8 events to 0 / 0 with the same volume and machine and the deploy counter intact, so db.json entries were removed, most likely by DELETE /api/admin/users during the /admin test on prod; asked Matt to confirm; everyone registered before 16:02 registers again. SECURITY follow-up: the ADMIN_TOKEN echoed to the bus at 15:55 was replaced on Fly (digest differs from the leaked value's hash; Matt confirms) and is in secrets/prod.enc.env (PR #9 landed); the hook still echoes raw prompts until fixed. LIVE: https://aura-haunt.fly.dev deploys 21e7dcb (deploy v12+), which is current `main`; `npm test` green. Landed since 16:32: Matt's #32 Base44 mirror via /merge (ticked): the same web/ pages on https://aura-haunt.base44.app call the Fly API and socket cross-origin (server/cors.js exact-origin allowlist from FRONTEND_ORIGINS, no credentials; sign-in handoff returns `#haunt_session=<sid>.<sig>` only to allowed origins and api() sends it as `x-haunt-session`; scripts/base44.mjs builds and deploys; deploy.yml runs it after Fly; BASE44_TOKEN repo secret NOT set, the Base44 job skips); the tracks bullet in Decisions still says max 2 (Shelled + Fetch.ai), so a [DECIDE] is pending. PR #9 (ADMIN_TOKEN on Fly, docs) landed by the integrator. On `main` besides: FaceX hybrid engine, Express + ws server (gallery, haunt push with Haunt back, no rate limit, kill switch, `/api/version` with deploy counter, `/api/me/:id`, `/admin`, instant profile pushes), API smoke test, four sign-in providers with LinkedIn live, costumes on /hunt, sound on by default, the phone UX pass, Scout plan, room scan brief. In flight: tarecq #10 Scout slice 1; Matt #33 presence (code pushed: server/presence.js, ARCHITECTURE, DIAGRAM, smoke), #31 costume lens (code pushed: web/lens.js, web/vendor/facegeom.js, WebGL VideoTexture), #15 promo video (row only). #10 and #33 hook the same four files: own lines, land small, sync. docs/scout and IDEAS 2b still say `/api/attendee/:id/card`. #17 Most Wanted and #20 digest are unclaimed. Smoke boot wait fix (test/smoke.mjs i < 450 + actions/cache) still open (Matt). No Shelled run executed yet; EDGE_CASES.md is the template (#6/#7, tarecq). Stale: matt/next (2 h) and tarecq/next (50 min, nudged), one old log line each. Nobody blocked.

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
| 22 | Costumes: optional look picked at `/register` or `/me` (Vampire, Witch, Demon, Ghost, Skeleton, Pumpkin; default Plain). `/hunt` draws it on your matched face from the face mesh (on-device) with a sting and a card title | Matt | [x] |
| 25 | Sound + vibrate on by default: a haunt shrieks and vibrates (Android) without the "arm sound" tap on `/me`; the first tap anywhere arms audio | Matt | [x] |
| 27 | LinkedIn: sign-in live on prod (app HAUNT, redirect `https://aura-haunt.fly.dev/auth/linkedin/callback`, `LINKEDIN_CLIENT_ID/SECRET` in secrets/prod.enc.env and on Fly); signed in, the profile photo is the face signature and selfies are optional | Matt | [ ] |
| 26 | UI/UX pass: drive every page in an emulated phone (iPhone + Pixel, fake camera) and fix the clunky parts: register, hunt, screen, calibrate, index, app.css | Matt | [x] |
| 28 | Deploy version: the home page footer shows `v<N> · <sha> · deployed <time>`; N goes up by one on every deploy (counter in `data/version.json`, bumped at boot when the deployed image changes); `/api/version` gains `deploy`, `deployedAt` | Matt | [x] |
| 29 | Auto-ready: a finished job runs `scripts/ready.sh` by itself (sync, test, push, open the PR, post [READY]); `/merge` and the integrator land the PR's own head so GitHub shows it merged | Matt | [x] |
| 30 | Instant profile updates: a `/me` edit (costume, GitHub handle, LinkedIn, findable) shows on every open phone at once. The server pushes the changed card (`attendee_changed`, or `attendee_gone {id}` on opt-out) instead of making every `/hunt` refetch the whole gallery; `/hunt` redraws the costume on the next frame and re-renders an open card; `/me` shows the save at once and the GitHub profile arrives by push | Matt | [x] |
| 32 | Base44 mirror: the same `web/` frontend also deployed to Base44 hosting (Base44 "Real users" challenge), calling the Fly API + WebSocket cross-origin (CORS allowlist, sign-in handoff without cookies); every push to `main` deploys Fly, then Base44 (`.github/workflows/deploy.yml`) | Matt | [x] |

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
- sync.sh (9a867ae, 15:06, Matt): once a branch is pushed it merges origin/main in instead of rebasing, so a push never needs force; unpushed branches still rebase; landing keeps those merge commits (#29). Never force-push, even with a lease.
- No haunt rate limit (#24, 8df2d4e, 15:02, Matt): a repeat haunt or haunt back is 200, written and pushed; `/hunt` re-arms the button only after the card closes and the person is found again.
- Row numbers (15:27): #28 deploy-version, #29 auto-ready (both Matt). deploy-version changes the `/api/version` payload (adds `deploy`, `deployedAt`); the ARCHITECTURE row changes in the same commit.
- #30 instant-profile (Matt's [PLAN], 15:38): a profile PATCH pushes `attendee_changed` (the public card) and `attendee_gone {id}` on opt-out instead of `gallery_changed`; the WS row in ARCHITECTURE.md changes in the same commit, and every listener of `gallery_changed` (/hunt, /screen, Scout) moves with it.
- #32 base44-mirror (claimed 15:46, Matt) is hosting only until a [DECIDE] changes the tracks bullet above (max 2 sponsor tracks, Base44 skipped at 13:16). Cross-origin sessions need SameSite=None; Secure cookies, credentials: include and exact-origin CORS; ARCHITECTURE.md auth section in the same commit.
- Secrets never go into a prompt, a commit message or the bus: the [WORKING] and [COMMIT] hooks echo them to a public GitHub issue (ADMIN_TOKEN incident 15:55, comment deleted, token rotated by Matt). Put secrets in secrets/*.enc.env and `fly secrets set` only.
- #33 presence (Matt's [PLAN], 15:56): online/registered counts and per-attendee online state travel over the socket; the WS row and card shape in ARCHITECTURE.md change in the same commit. #10 Scout slice 1 (tarecq, 15:55) and #33 hook the same four files; each hook on its own line.
- Every landing is a PR (#29, 15:36, Matt): a finished job runs `scripts/ready.sh` by itself (sync, test, push, open or reuse the PR, `[READY]` with its link). `/merge` and the integrator merge main into a pushed branch, never rebase it, and `scripts/land.sh` fast-forwards main to the PR's head so GitHub shows it merged. PRs are the record, not a review gate: nobody waits for an approval.
- Never close a PR or issue, or delete a branch, without a comment saying why and where the work went (13:51, CLAUDE.md). `/merge` and the integrator comment on the open PR before deleting its branch.

