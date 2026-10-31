#!/usr/bin/env bash
# sync.sh: the one command to run before and after every atomic commit.
#   1. fetch + rebase your local commits onto origin/main (autostash keeps your uncommitted edits safe)
#   2. run the smoke test if the project has one
#   3. push
# Usage: scripts/sync.sh            (from anywhere inside the repo)
#        scripts/sync.sh --no-test  (skip the test, e.g. docs-only commit)
set -euo pipefail
cd "$(git rev-parse --show-toplevel)"
branch=$(git branch --show-current)
if [[ "$branch" != "main" ]]; then echo "sync: you are on '$branch', not main. Rebase onto main and merge there." ; fi
git fetch -q origin
if ! git pull --rebase --autostash -q origin "$branch"; then
  echo "sync: REBASE CONFLICT. Fix the files listed above, then: git add <files> && git rebase --continue && scripts/sync.sh"; exit 1
fi
if [[ "${1:-}" != "--no-test" ]] && node -e 'const p=require("./package.json");process.exit(p.scripts&&p.scripts.test?0:1)' 2>/dev/null; then
  echo "sync: running npm test"; npm test --silent || { echo "sync: TEST FAILED. Do not push. Fix first (or scripts/sync.sh --no-test for a docs-only change)."; exit 1; }
fi
git push -q origin "$branch" && echo "sync: pushed $(git log --oneline -1)"
