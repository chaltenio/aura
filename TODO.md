# TODO

Claim a task by writing your name in Owner **before** you start. Tick it when it is on `main` and `npm test` is green. Keep this file short; history lives in git.

## STATUS

**2026-10-31 14:52 PT.** LIVE: https://aura-haunt.fly.dev runs 0904246, which is current `main`; `npm test` and CI green. On `main`: FaceX hybrid engine, Express + ws server (gallery, haunt push with Haunt back, cooldown, kill switch, `/api/version`, `/api/me/:id` with tonight's connections), API smoke test, four sign-in providers behind env vars, hooks, `/start`, launcher, docs/scout/README.md Scout plan. Landed since 14:48: Matt's #18 Haunt back (ticked; `/api/haunt` back:true needs a prior haunt from the target, the push carries `back`, no button on a haunt back so it cannot ping-pong; ARCHITECTURE and DEMO updated) via /merge. In flight: tarecq Scout slice 1 (server/scout.js, web/scout.js, /screen panel, `POST /api/rating`, `match` events); the `haunted` push still has no event id, so tarecq adds `id: ev.id` to that one line in server/index.js (tell Matt first, tiny diff). Chris claimed #21 admin panel (server/admin.js, web/admin.*, hooks in server/index.js + web/common.js), branch not pushed yet. Matt is ideating personalised reactions on recognition (no claim yet). #17 Most Wanted and #20 digest are unclaimed. Drift: ARCHITECTURE.md still lacks `GET /api/version` (Matt); smoke boot wait fix (test/smoke.mjs line 24 i < 450 + actions/cache) still open (Matt). No Shelled run yet; EDGE_CASES.md is the template (#6/#7, tarecq). Stale: matt/next (61 min, one 13:51 log line) and tarecq/scout-explore (fully on main); delete both with a bus line. Nobody blocked.

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

## Next

| # | Task | Owner | Done |
|---|------|-------|------|
| 8 | GitHub OAuth, then LinkedIn OIDC (store picture bytes, not the URL) on `/register` | main session (GitHub/LinkedIn), Chris (Google/Apple) | [x] |
| 9 | Decide the second track: **Fetch.ai, as the Scout** (IDEAS.md 2b: find people by face not name, clue nudge, hunt confirms, post-haunt rating). TrueForge dropped: needs venue photos + two measured runs. | tarecq | [x] |
| 10 | Scout (Fetch.ai): Agentverse registration (mailbox) -> pairwise scoring + clue nudge over `state` -> match badge on `/hunt` -> post-haunt rating + predicted-vs-actual on `/screen`; 3 tries through ASI:One, one change from feedback | tarecq | [ ] |
| 11 | Roles on join (Hunter / Ghost / Medium / Possessed) and role-gated views | | [ ] |
| 12 | Narrator agent: event feed -> Claude -> TTS on `/screen` | | [ ] |
| 13 | Room scan: Scaniverse -> SPZ -> Spark on `/screen` with live markers | | [ ] |
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

## Decisions

- Tracks: **Shelled AI** + **Fetch.ai** (the Scout, below; decided 14:14, max 2 per project). TrueForge dropped, Base44 skipped.
- Git: one branch per session (`<name>/<task>`), atomic commits, `scripts/sync.sh` after every commit, land with `/merge`. Nobody commits to `main` by hand. (Replaced direct-to-main at 13:40: parallel sessions were colliding on the same files.)
- Face matching is on-device only. No face image or embedding reaches a hosted model.
- Second track is **Fetch.ai**, built as the Scout (IDEAS.md 2b): the agent pairs people and gives clues, the camera finds them, the haunt is the ground truth. Clues come from profiles and public GitHub only, never from faces. (14:20, tarecq)
- The Scout adds `POST /api/rating`, a `match` event and a clue payload on `state`; ARCHITECTURE.md changes in the same commit as the code (tarecq's [PLAN], 14:14).
- Haunt back adds `back:true` on `POST /api/haunt` and a haunted-back push; connections adds `GET /api/me/:id`. Both land in ARCHITECTURE.md in the same commit as the code (Matt's [PLAN]s, 14:31).
- Admin panel adds `/admin` behind `ADMIN_TOKEN`, admin block/unblock (separate from the attendee kill switch), direct and group ws messages and event open/close; ARCHITECTURE.md in the same commit as the code (Chris's [PLAN], 14:44).
- Never close a PR or issue, or delete a branch, without a comment saying why and where the work went (13:51, CLAUDE.md). `/merge` and the integrator comment on the open PR before deleting its branch.

