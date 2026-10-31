---
name: merge
description: Merge resolver for the HAUNT repo. Lands the current branch on main: fetch, rebase onto origin/main (merge main in if the rebase is messy), resolve conflicts keeping both sides' intent and the API shapes in ARCHITECTURE.md, run the checks, fast-forward main, delete the branch, post to the bus, log it. Stops and asks the owner on the bus if a conflict cannot be resolved with confidence. Use when someone says "merge", "land this", "integrate my branch", "/merge", or a branch is ready for main.
---

# Merge resolver

Only this skill moves `main`. It lands one branch at a time. Never force-push. Never drop a function, route, event, style rule, or doc line from either side to make a conflict go away.

## 1. Preflight

```bash
cd "$(git rev-parse --show-toplevel)"
branch=$(git branch --show-current)
[ "$branch" != "main" ] || { echo "switch to the branch you want to land"; exit 1; }
git status --short            # must be clean; commit or stash first
git fetch -q origin
git log --oneline origin/main..HEAD        # what this branch adds
git log --oneline HEAD..origin/main        # what main gained meanwhile
git diff --stat origin/main...HEAD
```
Read TODO.md and the last 10 bus messages (`scripts/bus.sh read 10`) so you know who owns what.

## 2. Rebase (default) or merge main in (fallback)

```bash
git rebase origin/main
```
If the rebase hits the same conflict in several commits, or the branch has 20+ commits, abort and merge instead:
```bash
git rebase --abort && git merge origin/main
```
Either way, each conflict is resolved the same way, below.

## 3. Resolve each conflict, keeping both intents

For every file in `git diff --name-only --diff-filter=U`:
1. Read the whole file, not just the markers. `git show origin/main:<file>` and `git show <branch-before-rebase>:<file>` (use `ORIG_HEAD` during a rebase) show both complete sides.
2. Keep both changes unless they are literally the same edit. New function on one side plus edited function on the other: keep both. Two different edits to one function: combine them, then re-read the function top to bottom.
3. When both sides changed an API shape (route, payload field, WebSocket event name), the shape in ARCHITECTURE.md wins. If ARCHITECTURE.md is silent, keep the shape from `main` and adapt the branch's callers.
4. Delete every `<<<<<<<`, `=======`, `>>>>>>>` marker. `grep -rn '^<<<<<<<\|^>>>>>>>' --include='*.js' --include='*.html' --include='*.css' --include='*.md' .` must return nothing.
5. `git add <file>` and continue: `git rebase --continue` (or `git commit` when merging).

### Semantic conflicts (no markers, still broken)

Check these even when git merged cleanly:
- Same Express route or WebSocket message type defined twice (`grep -n "app\.\(get\|post\|patch\)\|type: '" server/index.js`).
- A function or export renamed on one side while the other side still calls the old name (`grep -rn "<oldName>" web server`).
- Duplicate element ids or CSS selectors in `web/*.html` and `web/app.css` (`grep -o 'id="[^"]*"' web/*.html | sort | uniq -d`).
- Two edits to the `## STATUS` paragraph of TODO.md: keep the newer timestamp and fold in facts from the older one.
- A gallery/descriptor length or threshold changed on one side (`face.js`) with the other side still assuming the old value.
- package.json dependencies added on both sides: keep both, then `npm install`.
- EDGE_CASES.md or INTEGRATION_LOG.md: append-only files; keep every entry from both sides in time order.

## 4. Check

```bash
for f in $(git diff --name-only origin/main...HEAD | grep -E '\.(m?js)$'); do node --check "$f" || exit 1; done
node -e 'const p=require("./package.json");process.exit(p.scripts&&p.scripts.test?0:1)' && npm test --silent
```
A failing test after a clean-looking merge is a semantic conflict. Fix it on the branch before landing.

## 5. Land: fast-forward main, delete the branch, tell the team

```bash
export MERGE_SKILL=1
git push -q -u origin HEAD                          # rebased branch, so reviewers can see it
git switch main && git pull --ff-only -q origin main
git merge --ff-only "$branch" && git push -q origin main
pr=$(gh pr list --head "$branch" --state open --json number --jq '.[0].number')   # deleting the branch closes its PR: say why first (CLAUDE.md)
[ -n "$pr" ] && gh pr comment "$pr" --body "Landed on main as $(git rev-parse --short origin/main) via /merge. The commits were rebased, so GitHub shows this PR as closed, not merged."
git branch -d "$branch" && git push -q origin --delete "$branch"
git switch -c "$(git config user.name | tr ' ' '-' | tr 'A-Z' 'a-z')/next" 2>/dev/null || true   # never stay on main
scripts/bus.sh post "merged $branch into main: <one line on what landed>"
echo "- $(date '+%Y-%m-%d %H:%M')  merged $branch ($(git rev-parse --short origin/main)) | test: pass | <conflicts resolved, if any>" >> docs/INTEGRATION_LOG.md
```
If `git log origin/main..HEAD` is empty after the rebase, the branch was already landed: comment that on its PR and post it on the bus, never `[MERGED]`. Commit the INTEGRATION_LOG line on your next branch, not on main. If `--ff-only` fails because main moved while you were resolving, go back to step 2.

## 6. When you cannot resolve with confidence

Stop. Do not guess at someone else's intent.
```bash
git add -A -- <files you did resolve>; git rebase --continue   # as far as it goes
git push -q -u origin HEAD                                       # branch stays rebased as far as it got
scripts/bus.sh ask "merge blocked on <branch>: <file> <what both sides want>. @<owner> which wins?"
```
Then report in chat which file, which two intents, and the question you asked.
