# TODO

Claim a task by writing your name in Owner **before** you start. Tick it when it is on `main` and `npm test` is green. Keep this file short; history lives in git.

## STATUS

**2026-10-31 13:05 PT.** Repo is on GitHub (chaltenio/aura, created 12:38 PT today, non-fork). On `main`: docs (README, ARCHITECTURE, RESEARCH, EDGE_CASES template, CLAUDE.md, TEAMWORK, integrator skill). The main session is finishing the face-engine swap to FaceX in `web/` and `server/` (uncommitted, landing shortly). Nothing deployed yet; local server + cloudflared tunnel only. No Shelled run has been made yet. Nobody is blocked.

## Now (this hour)

| # | Task | Owner | Done |
|---|------|-------|------|
| 1 | Face engine: FaceX (EdgeFace, aligned) as default, Human fallback; separation test passes on fixtures | main session | [ ] |
| 2 | `npm test`: Playwright e2e (register from photos, hunt, match, haunt push) runnable by anyone | main session | [ ] |
| 3 | Real-phone test over the tunnel: register with selfies, hunt a teammate, hear the shriek | (needs a human) | [ ] |
| 4 | Deploy to a public HTTPS URL (Fly/Railway/Render), weights fetched on boot, `data/` persisted | main session | [ ] |
| 5 | Register everyone on the team: Luma + sign the pact + activate the Duck on ASI:One | each person | [ ] |
| 6 | First Shelled run on this repo (PR 3 scope: `/screen` + leaderboard polish). Paste run link in PR body | | [ ] |
| 7 | EDGE_CASES.md: first two entries from the Shelled run | | [ ] |

## Next

| # | Task | Owner | Done |
|---|------|-------|------|
| 8 | GitHub OAuth, then LinkedIn OIDC (store picture bytes, not the URL) on `/register` | | [ ] |
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
- Git: direct to `main`, atomic commits, `scripts/sync.sh` before every push, no force-push.
- Face matching is on-device only. No face image or embedding reaches a hosted model.
