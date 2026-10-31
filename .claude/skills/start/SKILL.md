---
name: start
description: Onboarding conversation for anyone coming online in the HAUNT repo. Reads the bus, TODO.md and the branches in flight, greets the person by name with a five-line picture of what is live, claimed, unclaimed and in flight, asks what they want to build, maps the answer to ARCHITECTURE.md and to who is near those files, then claims it on the bus, creates their branch (or worktree), adds the TODO row, pushes it, and explains the loop. Use at the start of every fresh session, or when someone says "what should I work on", "where are we", "onboard me", "/start".
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
[ -f docs/DEPLOY.md ] && grep -m2 -i "https://" docs/DEPLOY.md
for b in $(git branch -r --no-merged origin/main | grep -v HEAD); do echo "$b ahead=$(git rev-list --count origin/main..$b) last=$(git log -1 --format=%cr $b) files=$(git diff --name-only origin/main...$b | tr '\n' ' ' | cut -c1-120)"; done
git config user.name; gh api user --jq .login 2>/dev/null
name=$(gh api user --jq .login 2>/dev/null || git config user.name | tr ' ' '-' | tr 'A-Z' 'a-z')
git branch --list "$name/*"; git branch -r --no-merged origin/main | grep "origin/$name/"     # branches this person already has
```
Unclaimed = rows of the IDEAS.md section 3 table whose idea name does not appear in TODO.md Now or Done, plus TODO.md Next rows with an empty Owner cell. Cross out anything already claimed. Live URL = the first https URL in docs/DEPLOY.md, else the one in STATUS, else "nothing deployed yet".

## 2. Greet (five lines, then one question)

```
Hi <first name>. <time> on <date>.
Live: <URL or "nothing deployed; local + tunnel only">. Main is <green/red per last integrator line>.
Claimed: <name>: <task> (<files>); <name>: <task>.
Unclaimed: <#> <task>; <#> <task>; <#> <task>.
In flight: <branch> (<owner>, <ahead> commits, <files>) ...
Yours: <name>/<task> (<ahead> commits, last <when>)        <- only if they already have an unmerged branch
```
Then ask exactly one question: **"What do you want to build?"** If they already have an unmerged branch, the first option is "Continue <branch>". Then the top three unclaimed items from IDEAS.md section 3 (show effort and track; prefer S effort, items that unblock others, and files nobody is touching), then "something else". Use `AskUserQuestion` when it is available, otherwise plain text with numbered options.

Skip the greeting only if the person's first message is already a concrete task; then go straight to step 3 with that task.

## 3. Map the answer to the contract

- Name which pages, endpoints and events in ARCHITECTURE.md it touches (`/register`, `/hunt`, `/screen`, `POST /api/haunt`, ws `haunted`, ...), and the files that implement them (`web/<page>.js`, `server/index.js`).
- Check overlap: any in-flight branch whose `files=` list intersects, any Now row whose files are the same. If there is overlap, say who, which file, and propose the smallest split (e.g. "take the `/screen` side; Sam has `server/index.js` until 2:15").
- If the idea is not in TODO.md, write a one-line task for it. If it breaks a DECIDE on the bus or a product rule in CLAUDE.md (faces to a hosted model, consent as a UI nicety), say so and offer the nearest allowed version.

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
- `/merge` when the step is demoable. Never edit on `main`; never edit before claiming.
