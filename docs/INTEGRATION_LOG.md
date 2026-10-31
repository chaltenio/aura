# Integration log

One dated line per integrator pass. Newest at the bottom. Written by the `/integrator` skill (another Claude Code tab) or by whoever is integrating by hand.

Format: `- YYYY-MM-DD HH:MM  <new commits since last pass> | test: pass/fail | <conflicts or risks> | <what was asked of whom>`

---
- 2026-10-31T20:25Z main-session: merged main-session/core (FaceX hybrid engine default, OAuth sign-in behind env vars, smoke test, Dockerfile/fly.toml, doc fixes) into main, npm test green
- 2026-10-31T20:27Z main-session: merged devops/deploy (Fly deploy script, SOPS+age secrets, .mcp.json, CI/CD, DEPLOY/SECRETS docs) into main
- 2026-10-31 13:47  first integrator pass, baseline at 6da13ca, 0 new commits | test: pass | not deployed: FLY_API_TOKEN not a repo secret so the deploy job skips, aura-haunt.fly.dev does not resolve; no Shelled run, EDGE_CASES.md still the template; no branch ahead of main | main session: set FLY_API_TOKEN (#4); tarecq: Shelled run 1 + two EDGE_CASES entries (#6/#7)
- 2026-10-31 13:50  no change (main 0b15041, no PRs, no branch ahead of main, bus quiet) | test: pass (13:47) | - | -
- 2026-11-01 09:36  merged chris/social-login (681fd87) | test: pass | rebased onto deb2d0e, no conflicts; pushed via HTTPS URL (SSH key rejected)
- 2026-10-31 13:56  5 new commits 1ac490b..b13df01: Chris docs/OAUTH_SETUP.md + .gitignore *.p8 + log line (PR #3, merged with the GitHub button, no /merge, no [MERGED] post); Matt close-with-comment rule in CLAUDE.md + merge/integrator skills | test: pass, CI green | no server/web changes, no contract drift; matt/next and the integrator both append INTEGRATION_LOG.md, expect a trivial conflict on its rebase | Chris: land through /merge or bus ready next time, delete chris/oauth-setup-docs (already on main); main session: FLY_API_TOKEN (#4); tarecq: #6/#7
- 2026-10-31 13:59  no change (main 4df3326, no PRs, matt/next 1 log-line commit 8 min old, bus: Matt's [TEAM] pull-then-/start notes only) | test: pass (13:56), CI green | - | -
- 2026-10-31 14:04  no change (main 31941c3, no PRs, matt/next 1 log-line commit 13 min old, bus quiet) | test: pass (13:56), CI green | - | -
