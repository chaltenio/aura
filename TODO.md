# TODO

Claim a task by writing your name in Owner **before** you start. Tick it when it is on `main` and `npm test` is green. Keep this file short; history lives in git.

## STATUS

**2026-10-31 13:47 PT.** On `main` (6da13ca), `npm test` green: FaceX hybrid engine default in `web/face.js`, Express + ws server with gallery, haunt push, cooldown and kill switch, API smoke test in `test/smoke.mjs` (no browser e2e yet), GitHub/LinkedIn/Google/Apple sign-in behind env vars, Dockerfile + fly.toml + `scripts/deploy.sh`, CI on every push, branch-first hooks, `/start`, bus `ready`/`merged`, IDEAS.md backlog. Not deployed: `FLY_API_TOKEN` is not a repo secret, so the deploy job skips on every push to main and aura-haunt.fly.dev does not resolve (#4, main session). No Shelled run yet; EDGE_CASES.md is still the template (#6/#7, tarecq). No branch is ahead of main, no open PR, nobody blocked. Integrator loop runs every 5 min from `../aura-integrator`.

## Now (this hour)

| # | Task | Owner | Done |
|---|------|-------|------|
| 1 | Face engine: FaceX (EdgeFace, aligned) as default, Human fallback; separation test passes on fixtures | main session | [ ] |
| 2 | `npm test`: Playwright e2e (register from photos, hunt, match, haunt push) runnable by anyone | main session | [ ] |
| 3 | Real-phone test over the tunnel: register with selfies, hunt a teammate, hear the shriek | (needs a human) | [ ] |
| 4 | Deploy to a public HTTPS URL (Fly/Railway/Render), weights fetched on boot, `data/` persisted | main session | [ ] |
| 5 | Register everyone on the team: Luma + sign the pact + activate the Duck on ASI:One | each person | [ ] |
| 6 | First Shelled run on this repo (Run 1 in docs/SHELLED_RUNS.md: narrator on `/screen`). Paste run link in PR body | tarecq | [ ] |
| 7 | EDGE_CASES.md: first two entries from the Shelled run | tarecq | [ ] |

## Next

| # | Task | Owner | Done |
|---|------|-------|------|
| 8 | GitHub OAuth, then LinkedIn OIDC (store picture bytes, not the URL) on `/register` | main session (GitHub/LinkedIn), Chris (Google/Apple) | [x] |
| 9 | Decide the second track: Fetch.ai matchmaker (lower risk) vs TrueForge Demogorgon (higher payoff). Record the decision here | | [ ] |
| 10 | Fetch.ai: matchmaker uAgent on Agentverse (mailbox), 3 tries through ASI:One, one change from feedback | | [ ] |
| 11 | Roles on join (Hunter / Ghost / Medium / Possessed) and role-gated views | | [ ] |
| 12 | Narrator agent: event feed -> Claude -> TTS on `/screen` | | [ ] |
| 13 | Room scan: Scaniverse -> SPZ -> Spark on `/screen` with live markers | | [ ] |
| 14 | Sigil posters (AR.js pattern markers + QR fallback) and `/zone` events | | [ ] |
| 15 | Proof of launch: X post or 2-minute demo video; screenshots of Shelled runs | | [ ] |
| 16 | Feedback swap with one other team (Stranger Builds requirement) and one change from it | | [ ] |

## Done

| # | Task | Owner |
|---|------|-------|
| 0 | Repo, README, ARCHITECTURE, RESEARCH (5 sections), EDGE_CASES template, CLAUDE.md, integrator skill, sync.sh | main session + fork |

## Decisions

- Tracks: **Shelled AI** + one of Fetch.ai / TrueForge (max 2 per project). Base44 skipped.
- Git: one branch per session (`<name>/<task>`), atomic commits, `scripts/sync.sh` after every commit, land with `/merge`. Nobody commits to `main` by hand. (Replaced direct-to-main at 13:40: parallel sessions were colliding on the same files.)
- Face matching is on-device only. No face image or embedding reaches a hosted model.

| GitHub profile enrichment on cards (bio, location, pushes this week, repos, LinkedIn link) | main-session | 4be2a21 |
