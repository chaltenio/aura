# Integration log

One dated line per integrator pass. Newest at the bottom. Written by the `/integrator` skill (another Claude Code tab) or by whoever is integrating by hand.

Format: `- YYYY-MM-DD HH:MM  <new commits since last pass> | test: pass/fail | <conflicts or risks> | <what was asked of whom>`

---
- 2026-10-31T20:25Z main-session: merged main-session/core (FaceX hybrid engine default, OAuth sign-in behind env vars, smoke test, Dockerfile/fly.toml, doc fixes) into main, npm test green
- 2026-10-31T20:27Z main-session: merged devops/deploy (Fly deploy script, SOPS+age secrets, .mcp.json, CI/CD, DEPLOY/SECRETS docs) into main
- 2026-10-31 13:47  first integrator pass, baseline at 6da13ca, 0 new commits | test: pass | not deployed: FLY_API_TOKEN not a repo secret so the deploy job skips, aura-haunt.fly.dev does not resolve; no Shelled run, EDGE_CASES.md still the template; no branch ahead of main | main session: set FLY_API_TOKEN (#4); tarecq: Shelled run 1 + two EDGE_CASES entries (#6/#7)
