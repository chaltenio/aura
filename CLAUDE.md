# HAUNT — team rules (humans and agents)

Point your phone at someone in the room and know who they are. Opt-in, on-device face-to-profile for events.
Read README.md, then ARCHITECTURE.md (the contract), then TODO.md (who is doing what).

## Where things live
- `server/` Node + Express + ws, JSON-file storage in `data/` (gitignored). One process, port 3000.
- `web/` static pages: `register`, `hunt`, `me`, `screen`, `calibrate`. Shared: `face.js` (engine), `common.js`.
- `web/vendor/facex/` vendored FaceX SDK; weights (`*.bin`) are gitignored and fetched on setup.
- `docs/` TEAMWORK.md (how we work), INTEGRATION_LOG.md (integrator digests). Root: RESEARCH.md, EDGE_CASES.md.

## Git: small, atomic, often
- One logical change per commit. Commit as soon as a step works; never batch an hour of work.
- Message style: `area: what changed` (e.g. `hunt: 3-frame vote before showing card`). Body only if the why is not obvious.
- Stage explicitly (`git add <paths>`), never `git add -A`; teammates have uncommitted work in the same tree.
- Direct to `main`, no feature branches, for this hackathon. Branch only for a risky spike you may throw away.
- Before every push: `scripts/sync.sh` (= `git pull --rebase`, run `npm test` if present, `git push`). Pull-rebase first, always.
- Push after every atomic commit with `scripts/sync.sh`. Unpushed work is invisible to the team and the integrator.
- Never let local work sit unpushed for more than 15 minutes or across a context switch. Before leaving the keyboard, push.
- Never force-push, never rewrite shared history, never commit `data/`, `.env`, weights, or `node_modules`.
- If `npm test` fails on main, fixing it is the next thing anyone does. Say so in the room.
- End commit messages with the Co-Authored-By line when an agent wrote the change.

## Working in parallel
- Claim a task in TODO.md (put your name in the Owner column) before starting; tick it when it is on main.
- One owner per file at a time. Touching someone else's file: tell them first, keep the diff tiny.
- Agents: one git worktree per task (`EnterWorktree`), rebase onto main before merging, delete when done.
- The contract is ARCHITECTURE.md: API paths, payload shapes, event names. Change the doc in the same commit as the code.
- Integration checkpoint every 30 min: everyone pushes, integrator runs the smoke test, STATUS in TODO.md updated.
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
