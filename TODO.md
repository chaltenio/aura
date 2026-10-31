# TODO

Claim a task by writing your name in Owner **before** you start. Tick it when it is on `main` and `npm test` is green. Keep this file short; history lives in git.

## STATUS

**2026-10-31 14:11 PT.** LIVE: https://aura-haunt.fly.dev (Fly app `aura-haunt`, sjc) runs 62083f2, which is current `main`; `/api/version` and `/api/gallery` answer, FaceX wasm and both weight files are served, `data/` sits on the `haunt_data` volume. `FLY_API_TOKEN` is a repo secret now, so every push to `main` deploys; CI green on every commit this hour. On `main`: FaceX hybrid engine default, Express + ws server with gallery, haunt push, cooldown, kill switch and `/api/version`, API smoke test (no browser e2e yet), GitHub/LinkedIn/Google/Apple sign-in behind env vars (docs/OAUTH_SETUP.md), branch-first hooks, `/start` interview that posts `[PLAN]` lines, integrator pipeline watch. Drift: ARCHITECTURE.md does not list `GET /api/version` (7d807ca); Matt adds it. No Shelled run yet; EDGE_CASES.md is still the template (#6/#7, tarecq). `chris/oauth-setup-docs` is fully on main and can be deleted. matt/next (one log line) is the only branch ahead of main. Nobody blocked. A laptop that looked up aura-haunt.fly.dev before 14:05 may hold a cached NXDOMAIN; `dig @1.1.1.1 aura-haunt.fly.dev` shows 66.241.125.24.

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
- Never close a PR or issue, or delete a branch, without a comment saying why and where the work went (13:51, CLAUDE.md). `/merge` and the integrator comment on the open PR before deleting its branch.

| GitHub profile enrichment on cards (bio, location, pushes this week, repos, LinkedIn link) | main-session | 4be2a21 |
