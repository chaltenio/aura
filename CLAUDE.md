# HAUNT — team rules (humans and agents)

Point your phone at someone in the room and know who they are. Opt-in, on-device face-to-profile for events.
Read README.md, then ARCHITECTURE.md (the contract), then TODO.md (who is doing what).


Open Claude with plain `claude` after a one-time `scripts/install-launcher.sh` (makes bare `claude` in this repo submit the start prompt), or `npm run go`; either way the interview, claim and branch happen before you type anything.

## Where to find work
- **IDEAS.md section 3** ("Ideas that fit and are free for another teammate to take"): the backlog of pickable, independent features, each with effort and sponsor track. Start there.
- **TODO.md** Now/Next: what is claimed and by whom; Done: what landed. STATUS at the top is the one-paragraph truth.
- **docs/SHELLED_RUNS.md**: the three Shelled prompts. The Shelled track needs 2 Shelled PRs (1 merged) plus EDGE_CASES.md.
- **docs/DEMO.md**: what we show the judges. Nothing lands in the last 30 minutes that is not on it.

## Where things live
- `server/` Node + Express + ws, JSON-file storage in `data/` (gitignored). One process, port 3000.
- `web/` static pages: `register`, `hunt`, `me`, `screen`, `calibrate`. Shared: `face.js` (engine), `common.js`.
- `web/vendor/facex/` vendored FaceX SDK; weights (`*.bin`) are gitignored and fetched on setup.
- `docs/` TEAMWORK.md (how we work), INTEGRATION_LOG.md (integrator digests). Root: RESEARCH.md, EDGE_CASES.md.

## Git: own branch, small commits, push often, merge through /merge
- Every session (human or agent) works on its own branch: `git switch -c <name>/<task>` (e.g. `matt/hunt-votes`, `sam/screen-leaderboard`). Never commit to `main` directly; only the merge resolver (`/merge`) moves `main`.
- Several sessions on one laptop: one worktree each. `git worktree add ../aura-<task> -b <name>/<task>` then `cd ../aura-<task> && npm install && claude`.
- One logical change per commit. Commit as soon as a step works; never batch an hour of work.
- Message style: `area: what changed` (e.g. `hunt: 3-frame vote before showing card`). Body only if the why is not obvious.
- Stage explicitly (`git add <paths>`), never `git add -A`.
- Rebase on main often: `scripts/sync.sh` (pulls your branch with `--rebase --autostash`, rebases it onto `origin/main` until the branch is pushed and merges `origin/main` in after that, so a push never needs force; runs the test, pushes `origin HEAD`; refuses on `main`) before starting a chunk, after every commit, and at least every 15 minutes. Never work more than 15 minutes on a stale base; never let work sit unpushed across a context switch; before leaving the keyboard, push.
- When the job (or a demoable slice of it) works: run `scripts/ready.sh "<what it does>"` yourself, without asking. It syncs, runs the test, pushes, opens the branch's PR (or reuses it) and posts `[READY]` with the PR link; the integrator lands it within a pass, or run `/merge` to land it now. Landing merges `origin/main` into the branch (a pushed branch is never rebased), runs the test, and `scripts/land.sh` fast-forwards `main` to the PR's head so GitHub shows the PR merged, deletes the branch and posts `[MERGED]`. Never merge by hand.
- Hooks enforce this (`.claude/settings.json`): an edit while on `main` is blocked with "On main: run /start to claim a task and create your branch"; after about 3 commits or 30 minutes the commit hook, and the Stop hook once per new commit, tell the session to run `scripts/ready.sh` when the job is done; every commit posts `[COMMIT]` and every tenth minute of prompting posts `[WORKING]` to the bus; stopping with unpushed work prints a reminder.
- Never force-push a shared branch, never rewrite `main`, never commit `data/`, `.env`, weights, or `node_modules`.
- Never close anything silently. Before you close a PR or issue, comment on it saying why and where the work went (e.g. "already on main as 0c350a3..681fd87"). Deleting a branch closes its open PR, so before `git push origin --delete <branch>` check `gh pr list --head <branch>` and comment on that PR first. Say the same on the bus in one line. If a branch has nothing left after rebasing onto main, it was already landed: say so, don't report it as merged.
- If `npm test` fails on `main`, fixing it is the next thing anyone does. Say so on the bus.
- End commit messages with the Co-Authored-By line when an agent wrote the change.

## Working in parallel
- New session: `/start` runs by itself (state of the room, the top picks from IDEAS.md section 3, then it claims and branches, or continues your existing branch). Never edit before claiming.
- Claim a task in TODO.md (put your name in the Owner column) before starting; tick it when it is on main.
- One owner per file at a time. Touching someone else's file: tell them first, keep the diff tiny.
- Agents: one git worktree and one branch per task (`EnterWorktree` or `git worktree add`), landed with `/merge`, deleted when done.
- The contract is ARCHITECTURE.md: API paths, payload shapes, event names. Change the doc in the same commit as the code.
- Integration checkpoint every 30 min: everyone pushes their branch, anyone with a working step runs `/merge`, integrator runs the smoke test on `main`, STATUS in TODO.md updated. A branch older than 45 minutes gets a nudge.
- Integrator tab: `/loop 5m /integrator` (see `.claude/skills/integrator/SKILL.md`).

## Talking to the team bus
The bus is one pinned GitHub issue (label `bus`) that every teammate's Claude Code reads and writes with `scripts/bus.sh`. It is how sessions on different laptops stay aligned; SendMessage only reaches sessions on your own machine.
- Every session start shows the last 12 bus messages and the STATUS paragraph (SessionStart hook in `.claude/settings.json`). Read them before doing anything.
- Before starting a task: `scripts/bus.sh claim "#7 hunt.js: 3-frame vote"` and put your name in TODO.md.
- After each atomic commit that others should know about: `scripts/bus.sh post "hunt: card needs 3 frames (web/hunt.js)"`.
- Stuck or unsure what someone else is doing: `scripts/bus.sh ask "..."`. Answer others' ASKs with `scripts/bus.sh answer "..."`.
- Anything everyone must follow: `scripts/bus.sh decide "..."` and add it to TODO.md Decisions.
- Catch up any time: `scripts/bus.sh read 30`. The integrator reads the bus every pass and posts `[INTEGRATOR]` digests.
- Humans can post from a phone by commenting on the issue (`scripts/bus.sh url`). Keep messages to one or two lines; name files.

## Product rules
- No face image or embedding ever goes to a hosted LLM (Anthropic policy forbids facial recognition). Matching is on-device only; hosted models get events, profiles, room photos.
- Consent is a server-side filter, not a UI nicety. Unregistered faces are never named, never stored.
- Works on iOS Safari and Android Chrome from one HTTPS URL. No app install. Test on a real phone before calling anything done.

## Sponsor tracks (max 2 per project)
- Shelled AI: features go through Shelled runs. Every Shelled PR description carries the run link/ID. Every place the agents shone or broke becomes an entry in EDGE_CASES.md the same hour.
- Second track (Fetch.ai matchmaker or TrueForge Demogorgon): see TODO.md for the decision.
- Keep proof as you go: screenshots of runs, the X post / 2-minute video for proof of launch.

## Deploy and secrets
- Host is Fly.io; `scripts/deploy.sh` does the whole deploy (app, volume, secrets, remote build, smoke check). Pushes to `main` auto-deploy once `FLY_API_TOKEN` is a repo secret. Details: docs/DEPLOY.md.
- Secrets are committed only as `secrets/*.enc.env` (SOPS + age). Never commit `.env`, plaintext `*.env`, or an age private key. Join with `scripts/secrets.sh init`, read with `scripts/secrets.sh decrypt prod`. Details: docs/SECRETS.md.
- Agents use the project MCP servers in `.mcp.json` (`github`, `fly`, `playwright`) for DevOps; `gh` and `fly` CLIs are the fallback.
