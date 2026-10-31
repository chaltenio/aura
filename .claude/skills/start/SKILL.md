---
name: start
description: Onboarding interview for anyone coming online in the HAUNT repo. Reads the bus, TODO.md and the branches in flight, greets the person by name with a five-line picture of what is live, claimed, unclaimed and in flight, asks what they want to build, then interviews their idea (four questions) for fit against ARCHITECTURE.md, the parked list and current claims, gives a fit verdict, writes a five-line plan to the board, claims it, creates their branch (or worktree), adds the TODO row, pushes it, and explains the loop. Use at the start of every fresh session, or when someone says "what should I work on", "where are we", "onboard me", "/start".
---

# /start: steer a teammate into work that fits everyone else's

You are this person's steering agent. Be brief: under 15 lines before the question. Facts, names, files. No praise.

## 1. Gather (silently)

```bash
cd "$(git rev-parse --show-toplevel)"
git fetch -q origin 2>/dev/null
scripts/bus.sh since 2>/dev/null | tail -n 20 || scripts/bus.sh read 12
sed -n '/^## STATUS/,/^## Next/p' TODO.md          # STATUS paragraph + Now table
sed -n '/^## Next/,/^## Done/p' TODO.md             # Next table
sed -n '/^## 3/,/^## 4/p' IDEAS.md                 # the pickable backlog (table: idea, what, why, needs, effort, track)
app=$(sed -n 's/^app = "\(.*\)"/\1/p' fly.toml); live="https://${app:-aura-haunt}.fly.dev"; echo "$live $(curl -s --max-time 3 $live/api/version)"   # the live app; every merge to main redeploys it
for b in $(git branch -r --no-merged origin/main | grep -v HEAD); do echo "$b ahead=$(git rev-list --count origin/main..$b) last=$(git log -1 --format=%cr $b) files=$(git diff --name-only origin/main...$b | tr '\n' ' ' | cut -c1-120)"; done
git config user.name; gh api user --jq .login 2>/dev/null
name=$(gh api user --jq .login 2>/dev/null || git config user.name | tr ' ' '-' | tr 'A-Z' 'a-z')
git branch --list "$name/*"; git branch -r --no-merged origin/main | grep "origin/$name/"     # branches this person already has
```
Unclaimed = rows of the IDEAS.md section 3 table whose idea name does not appear in TODO.md Now or Done, plus TODO.md Next rows with an empty Owner cell. Cross out anything already claimed. Live URL = `https://<fly.toml app>.fly.dev` (currently https://aura-haunt.fly.dev); say it with the deployed version so people test on real phones from the first minute. Fallback for a laptop-only server: `npm run tunnel`.

## 2. Greet (five lines, then one question)

```
Hi <first name>. <time> on <date>.
Live: <URL> (deployed <sha>, use it on your phone for testing). Main is <green/red per last integrator line>.
Claimed: <name>: <task> (<files>); <name>: <task>.
Unclaimed: <#> <task>; <#> <task>; <#> <task>.
In flight: <branch> (<owner>, <ahead> commits, <files>) ...
Yours: <name>/<task> (<ahead> commits, last <when>)        <- only if they already have an unmerged branch
```
Then ask exactly one question: **"What do you want to build?"** If they already have an unmerged branch, the first option is "Continue <branch>". Then the top three unclaimed items from IDEAS.md section 3 (show effort and track; prefer S effort, items that unblock others, and files nobody is touching), then "something else". Use `AskUserQuestion` when it is available, otherwise plain text with numbered options.

Skip the greeting only if the person's first message is already a concrete task; then go straight to step 3 with that task. Tiny fixes (a typo, a one-line bug on a file they own) skip the interview: claim, branch, go.

## 3. Interview the idea (the part that keeps the project coherent)

If they picked a backlog item, the row already answers most of this; confirm scope and skip to the verdict. If they brought their own idea, or a vague one, ask these four questions in one message (numbered, short), then wait:

1. **What will someone see?** The one demo moment: which page, who is holding the phone, what appears. If they cannot say it in one sentence, help them find it before anything else.
2. **Why does it fit HAUNT?** HAUNT = opt-in face-to-profile recognition at an event plus the haunt interaction; everything else is a layer on top (README "Layers"). Which layer is this, or which sponsor track does it serve (Shelled runs, Fetch.ai matchmaker, TrueForge self-improving agent)? Check IDEAS.md section 4 (parked ideas): if it is parked, read the "what would un-park it" cell aloud and ask whether that condition is now met.
3. **What does it need from the core?** Which endpoints, events or pages (ARCHITECTURE.md section 3 API table, docs/DIAGRAM.md message table). If the core must change, name the exact field or route to add and who owns that file right now.
4. **How will we know it works, and by when?** A test in `npm test`, a phone check, or a screen check; and whether it is demoable in under 90 minutes. If not, cut it to the first demoable slice and park the rest as a TODO Next row.

Then give the **fit verdict** in three lines:

- **Fits** / **Fits with a cut** / **Conflicts** / **Parked for a reason**. Name the reason from ARCHITECTURE.md, IDEAS.md, a bus `[DECIDE]`, or a CLAUDE.md rule (no face or embedding to a hosted model; consent is not optional; main is merge-only).
- **Overlap:** any in-flight branch whose `files=` intersects, any Now row on the same files. Say who, which file, and the smallest split ("take the `/screen` side; Sam has `server/index.js` until 2:15"), or "none".
- **Plan:** five lines max: slice 1 (demoable), slice 2, files touched, endpoints/events used or added, verification. Post it: `scripts/bus.sh post "[PLAN] @<name> <task>: <slice 1> | files <..> | needs <..> | verify <..>"`. The integrator reads plans each pass and will flag collisions before code exists.

A "Conflicts" verdict is not a refusal: offer the nearest version that fits (same demo moment, different file or layer). If they insist on an idea outside HAUNT, say so once, record it on the bus as `[DECIDE]`-pending for the user, and let them proceed on their branch; the merge step is where it gets judged.

## 4. Claim, branch (or continue), record, push

Continuing an existing branch: `git switch <name>/<task> && scripts/sync.sh --no-test` (rebases it onto main and pushes), confirm the TODO row still has their name, skip the claim unless the bus has no `[CLAIM]` for it. Then go to step 5.

New task:

```bash
name=$(gh api user --jq .login 2>/dev/null || git config user.name | tr ' ' '-' | tr 'A-Z' 'a-z')
task=<short-kebab-task>
scripts/bus.sh claim "#<row> <task>: <files> (@$name)"
git switch -c "$name/$task"                      # or, if they run parallel sessions:
# git worktree add "../aura-$task" -b "$name/$task" && echo "cd ../aura-$task && npm install && claude"
```
Edit TODO.md: add or update the row in **Now** with their name in Owner (never touch STATUS; the integrator owns it). Then:
```bash
git add TODO.md && git commit -qm "todo: $name claims $task" && scripts/sync.sh --no-test
```

## 5. Tell them the loop (three lines)

- Commit each working step; `scripts/sync.sh` after every commit (pushes your branch; 15-minute rule).
- `scripts/bus.sh post` when something others should know lands; `scripts/bus.sh ask` when stuck.
- `scripts/bus.sh ready` (the integrator merges it) or `/merge` when the slice is demoable. Never edit on `main`; never edit before claiming.
- Changed your plan? Post a new `[PLAN]` line; silent scope drift is how two people end up building the same thing.
