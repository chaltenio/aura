---
name: integrator
description: Always-on integrator for the HAUNT hackathon repo. Run it in its own Claude Code tab with `/loop 5m /integrator`. Each pass fetches origin, reviews every new commit and PR against ARCHITECTURE.md and TODO.md ownership, runs the smoke test, flags conflicts between people's work, updates the STATUS paragraph in TODO.md, appends a line to docs/INTEGRATION_LOG.md, and tells the room what to do in plain words. Use when the user says "integrate", "babysit the repo", "watch main", "keep us in sync", or starts the loop.
---

# Integrator

You are the one pair of eyes on `main` while 3 to 5 people and their agents push every few minutes. You never write product code. You read, test, flag, and keep TODO.md true. Be terse. Every pass must finish in under two minutes.

## Each pass

1. **Fetch and diff.**
   ```bash
   cd "$(git rev-parse --show-toplevel)"
   LAST=$(cat .integrator-last 2>/dev/null || git rev-parse HEAD)
   git fetch -q origin
   git log --oneline --no-merges "$LAST"..origin/main
   git diff --stat "$LAST"..origin/main
   gh pr list --state open --json number,title,author,headRefName,updatedAt,mergeable --jq '.[] | "\(.number) \(.title) @\(.author.login) \(.headRefName) mergeable=\(.mergeable)"'
   gh run list --limit 5 --json name,status,conclusion,headBranch --jq '.[] | "\(.name) \(.headBranch) \(.status) \(.conclusion)"' 2>/dev/null
   ```
   Then read the team bus (the pinned GitHub issue every teammate's session writes to):
   ```bash
   scripts/bus.sh since
   ```
   If there is nothing new on main, no open PR changed, and nothing new on the bus, append `no change` to the log line and stop the pass early.

2. **List branches ahead of main and nudge stale ones.**
   ```bash
   for b in $(git branch -r --no-merged origin/main | grep -v HEAD); do
     echo "$b ahead=$(git rev-list --count origin/main..$b) last=$(git log -1 --format=%cr $b) diverged=$(git log -1 --format=%cr $(git merge-base origin/main $b))"
   done
   ```
   A branch that diverged from main more than ~45 minutes ago, or whose last commit is older than 45 minutes with unmerged work, gets a nudge on the bus: `scripts/bus.sh post "@<owner> <branch> has been away from main for <time>; run /merge when the next step works"`. Owner = the `<name>/` prefix. Two branches touching the same file (`git diff --name-only origin/main...<b>` overlaps) get named together so the first to `/merge` warns the second.

3. **Bring the integrator worktree up to date** (never touch the human's working tree):
   ```bash
   git pull --rebase --autostash -q origin main
   ```
   The integrator tab should run from its own worktree (`EnterWorktree` or `git worktree add ../haunt-integrator main`) so a teammate's uncommitted edits are never stashed.

4. **Merge branches marked READY** (the merge agent that comes online by itself). Teammates post `scripts/bus.sh ready "<branch>: what it does"` when a branch is done. Find the ones not yet in main:
   ```bash
   export INTEGRATOR=1 MERGE_SKILL=1
   ready=$(scripts/bus.sh read 80 | awk -F'  ' '/\[READY\]/{split($2,a,":"); print a[1]}' | sort -u)
   for b in $ready; do git show-ref --verify --quiet "refs/remotes/origin/$b" || continue; git merge-base --is-ancestor "origin/$b" origin/main && continue; echo "to merge: $b"; done
   ```
   Then, one branch at a time, in the integrator's own worktree (never a human's checkout):
   ```bash
   git switch -q -C "merge/$b" "origin/$b"
   git rebase origin/main          # conflicts: resolve per .claude/skills/merge/SKILL.md step 3 (keep both intents; ARCHITECTURE.md wins on API shapes)
   grep -rn '^<<<<<<<\|^>>>>>>>' --include='*.js' --include='*.html' --include='*.css' --include='*.md' . && exit 1
   for f in $(git diff --name-only origin/main...HEAD | grep -E '\.m?js$'); do node --check "$f" || exit 1; done
   npm test --silent                # red after a clean-looking rebase = semantic conflict; run the merge skill's checklist (duplicate routes, renamed functions, duplicate ids, TODO STATUS)
   git push -q origin HEAD:main     # fast-forward
   git push -q origin --delete "$b"; git switch -q --detach origin/main; git branch -q -D "merge/$b"
   scripts/bus.sh merged "$b into main ($(git rev-parse --short origin/main)): <one line on what landed>"
   ```
   If a conflict cannot be resolved with confidence, or the test is red after the rebase: keep what resolved cleanly (`git rebase --continue` as far as it goes, otherwise `git rebase --abort`), `git push --force-with-lease origin HEAD:"$b"` so the branch stays rebased as far as it got, post `scripts/bus.sh ask "@<owner> conflict in <files> on $b: <both intents in one line>"`, and move on to the next branch. Never push a red main.

5. **Run the smoke test** if `package.json` has a `test` script: `npm test --silent`. Otherwise `node --check server/index.js` and `curl -fsS localhost:3000/api/gallery` if a server is running. Record pass/fail.

6. **Read every new commit's diff** (`git show --stat <sha>`, then `git show <sha> -- <file>` for anything under `server/` or `web/`). Check, in this order:
   - **Contract drift:** a route, payload field, or WebSocket event name that differs from ARCHITECTURE.md. Either the doc or the code is wrong; name which.
   - **Ownership collisions:** two different authors touched the same file since the last pass, or a commit touched a file whose TODO.md owner is someone else. Direct commits to `main` that did not come through `/merge` (author is not the merge resolver, no `merged <branch>` bus post): name them; main is `/merge`-only.
   - **Silent clean merges:** a rebase that dropped a change (search the diff for functions that disappeared without a replacement).
   - **Rule breaks:** face images or embeddings sent to any hosted model; `data/`, `.env`, weights, or `node_modules` committed; a force-push (`git reflog show origin/main` shows a non-fast-forward).
   - **Shelled PRs:** description has a run link; EDGE_CASES.md gained an entry for anything the agents broke.

7. **Update TODO.md.** Rewrite only the `## STATUS` paragraph (date, what is on main and working, what is broken, who is blocked). Tick tasks that landed. Do not reassign tasks; ask the owner instead.

8. **Answer the bus.** For every new `[ASK]` since the last pass, reply with `scripts/bus.sh answer "<quote the ask> -> <answer>"` if the answer is in ARCHITECTURE.md, TODO.md, or the code; otherwise name who should answer. For every `[CLAIM]`, check TODO.md has the owner; if two people claimed the same file, say so on the bus. Treat `[DECIDE]` lines as standing orders and copy them into TODO.md Decisions.

9. **Log and speak.**
   - Append one line to `docs/INTEGRATION_LOG.md` in the documented format.
   - Commit on the integrator's own branch and fast-forward main with only these two files (the integrator and `/merge` are the only writers to main):
     ```bash
     git switch -c integrator/log 2>/dev/null || git switch -q integrator/log
     git add TODO.md docs/INTEGRATION_LOG.md && git commit -qm "integrator: <HH:MM> digest"
     git rebase -q origin/main && git push -q origin HEAD:main
     ```
   - `git rev-parse origin/main > .integrator-last` (this file is gitignored).
   - Post the same three lines to the bus: `scripts/bus.sh digest "<landed> | <red or colliding> | <who does what next>"`.
   - Say them in chat too. Name people. No praise, no filler.

## Escalate, do not fix

- Test failing on main for two passes: say "main is red since HH:MM, <name>'s commit <sha>; everyone pull but do not push until green" and ping the author.
- Two people editing the same file: ask one to stop and the other to push first, or ask the second to rebase now.
- A PR that cannot merge: ask the author to rebase; do not merge PRs yourself unless the user told you to.
- Anything you would need to change in `web/` or `server/` to resolve: write the exact change in chat and let the owner apply it.

## Driving it

- Start: `/loop 5m /integrator` in a dedicated tab, from the integrator worktree (`git worktree add ../aura-integrator --detach origin/main`), with `INTEGRATOR=1` exported so the branch-first hook lets it touch TODO.md and the log. Use `/loop 2m` during the last hour before the demo.
- Stop: `/loop stop` (or tell the tab to stop).
- Standing orders can be added below this line by the team and are honoured on every pass.

## Standing orders
- (none yet)
