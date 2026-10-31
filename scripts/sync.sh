#!/usr/bin/env bash
# sync.sh: run before starting a chunk, after every atomic commit, and at least every 15 minutes.
#   on a branch: fetch, rebase your branch onto origin/main (autostash) while nothing is pushed, merge origin/main in once it is
#                (so the push never needs force), run the smoke test if present, push (-u origin HEAD)
#   on main:     refuse. main moves only through /merge or the integrator (which set MERGE_SKILL=1)
# Usage: scripts/sync.sh [--no-test]     (SKIP_TEST=1 also skips the test)
set -euo pipefail
cd "$(git rev-parse --show-toplevel)"
branch=$(git branch --show-current)
if [[ -z "$branch" ]]; then echo "sync: detached HEAD. git switch -c <name>/<task> first."; exit 1; fi
if [[ "$branch" == "main" && "${MERGE_SKILL:-0}" != "1" ]]; then
  echo "sync: you are on main. Nobody pushes main by hand; work on a branch (run /start) and land it with scripts/bus.sh ready or /merge."; exit 1
fi
git fetch -q origin
if [[ "$branch" != "main" ]]; then
  if git show-ref --verify --quiet "refs/remotes/origin/$branch" && ! git merge-base --is-ancestor "origin/$branch" HEAD; then
    # someone (or another machine) pushed to this branch: take their commits first
    git pull --rebase --autostash -q origin "$branch" || { files=$(git diff --name-only --diff-filter=U | tr '\n' ' '); git rebase --abort || true; echo "sync: conflict with origin/$branch in: $files. Run /merge to resolve."; exit 1; }
  fi
  if ! git merge-base --is-ancestor origin/main HEAD; then
    if git show-ref --verify --quiet "refs/remotes/origin/$branch" && [[ -n "$(git rev-list origin/main..origin/$branch)" ]]; then
      # commits already on origin: a rebase would rewrite them and the push would need force (main moves every few
      # minutes, so this is the normal case). Merge main in instead; /merge flattens the branch when it lands.
      if ! git merge --no-edit -q --autostash origin/main; then
        files=$(git diff --name-only --diff-filter=U | tr '\n' ' ')
        git merge --abort || true
        echo "sync: conflict merging origin/main in: $files. Run /merge to resolve (it keeps both sides' intent)."; exit 1
      fi
      echo "sync: merged origin/main into $branch (already pushed: no rebase, no force-push)"
    else
      if ! git rebase --autostash -q origin/main; then
        files=$(git diff --name-only --diff-filter=U | tr '\n' ' ')
        git rebase --abort || true
        echo "sync: rebase conflict with origin/main in: $files. Run /merge to resolve (it keeps both sides' intent)."; exit 1
      fi
      echo "sync: rebased $branch onto origin/main"
    fi
  fi
fi
if [[ "${1:-}" != "--no-test" && "${SKIP_TEST:-0}" != "1" ]] && node -e 'const p=require("./package.json");process.exit(p.scripts&&p.scripts.test?0:1)' 2>/dev/null; then
  echo "sync: running npm test"; npm test --silent || { echo "sync: TEST FAILED. Fix before pushing (or scripts/sync.sh --no-test for a docs-only change)."; exit 1; }
fi
push() { git push -q "$@" 2>/dev/null || git push -q "$@"; }   # GitHub sometimes answers "remote rejected (failed)" once
if [[ "$branch" == "main" ]]; then push origin main; else push -u origin HEAD; fi
echo "sync: pushed $branch @ $(git log --oneline -1)"
