#!/usr/bin/env bash
# sync.sh: run after every atomic commit.
#   on a branch: pull your own branch if it exists on origin, run the smoke test if present, push the branch (-u origin HEAD)
#   on main:     refuse. main moves only through /merge (which sets MERGE_SKILL=1)
# Usage: scripts/sync.sh [--no-test]
set -euo pipefail
cd "$(git rev-parse --show-toplevel)"
branch=$(git branch --show-current)
if [[ -z "$branch" ]]; then echo "sync: detached HEAD. git switch -c <name>/<task> first."; exit 1; fi
if [[ "$branch" == "main" && "${MERGE_SKILL:-0}" != "1" ]]; then
  echo "sync: you are on main. Nobody pushes main by hand; work on a branch (git switch -c <name>/<task>) and land it with /merge."; exit 1
fi
git fetch -q origin
if git show-ref --verify --quiet "refs/remotes/origin/$branch"; then
  if ! git pull --rebase --autostash -q origin "$branch"; then
    echo "sync: REBASE CONFLICT on your own branch. Fix the files listed above, then: git add <files> && git rebase --continue && scripts/sync.sh"; exit 1
  fi
fi
if [[ "${1:-}" != "--no-test" ]] && node -e 'const p=require("./package.json");process.exit(p.scripts&&p.scripts.test?0:1)' 2>/dev/null; then
  echo "sync: running npm test"; npm test --silent || { echo "sync: TEST FAILED. Fix before pushing (or scripts/sync.sh --no-test for a docs-only change)."; exit 1; }
fi
if [[ "$branch" == "main" ]]; then git push -q origin main; else git push -q -u origin HEAD; fi
echo "sync: pushed $branch @ $(git log --oneline -1)"
