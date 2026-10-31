#!/usr/bin/env bash
# land.sh: the mechanical end of /merge and of the integrator's READY pass. Run it after origin/main is merged in,
# conflicts are resolved and the checks pass. It lands the checked-out HEAD as <branch> so GitHub shows its PR merged:
#   1. HEAD must contain origin/main and origin/<branch> (a pushed branch is merged with main, never rebased: no force)
#   2. push HEAD to <branch>, make sure the PR exists (scripts/pr.sh), push the same commit to main (fast-forward)
#   3. wait until GitHub marks the PR merged, delete the branch, post [MERGED], print the INTEGRATION_LOG line
# Usage: scripts/land.sh <branch> "<one line on what landed>"
# Exit 3: main moved meanwhile. git fetch && git merge origin/main, re-run the checks, run land.sh again.
set -euo pipefail
cd "$(git rev-parse --show-toplevel)"
b=${1:?usage: scripts/land.sh <branch> "<one line on what landed>"}; what=${2:-}
if [[ "$b" == "main" ]]; then echo "land: name the branch to land, not main"; exit 1; fi
if ! git diff --quiet || ! git diff --cached --quiet; then echo "land: uncommitted changes; commit or stash them first"; exit 1; fi
ghx() { perl -e 'alarm shift; exec @ARGV' 30 gh "$@"; }
push() { git push -q origin "$1" 2>/dev/null || git push -q origin "$1"; }   # GitHub sometimes answers "remote rejected (failed)" once
mkdir -p .bus; repo=$(cat .bus/repo 2>/dev/null || true)
if [[ -z "$repo" ]]; then repo=$(ghx repo view --json nameWithOwner --jq .nameWithOwner); echo "$repo" > .bus/repo; fi

git fetch -q origin
if ! git merge-base --is-ancestor origin/main HEAD; then
  echo "land: HEAD lacks origin/main. git merge origin/main, re-run the checks, run land.sh again."; exit 3
fi
if git show-ref --verify --quiet "refs/remotes/origin/$b" && ! git merge-base --is-ancestor "origin/$b" HEAD; then
  echo "land: origin/$b has commits HEAD lacks (pushed meanwhile, or HEAD was rebased). git merge origin/$b, re-run the checks, run land.sh again. Never force-push."; exit 1
fi
if [[ -z "$(git rev-list origin/main..HEAD)" ]]; then
  echo "land: $b is already on main, nothing to land. Say so on its PR and the bus (not [MERGED])."; exit 0
fi

push "HEAD:refs/heads/$b"
pr=$(scripts/pr.sh "$b" "$what" "Opened at landing: main merged in, npm test passed on $(git rev-parse --short HEAD).") || pr=""
n=${pr%% *}
if ! push "HEAD:refs/heads/main"; then
  echo "land: main moved while landing. git fetch && git merge origin/main, re-run the checks, run land.sh again."; exit 3
fi
sha=$(git rev-parse --short HEAD); state=""
if [[ -n "$n" ]]; then   # GitHub marks the PR merged once its head is on main; deleting the branch first would close it unmerged
  for _ in 1 2 3 4 5 6 7 8 9 10 11 12 13 14 15; do
    state=$(ghx pr view "$n" --repo "$repo" --json state --jq .state 2>/dev/null || true)
    if [[ "$state" == "MERGED" ]]; then break; fi
    sleep 2
  done
  if [[ "$state" != "MERGED" ]]; then
    ghx pr comment "$n" --repo "$repo" --body "Landed on main as $sha by scripts/land.sh. GitHub had not marked it merged after 30 s, so deleting the branch closes it." >/dev/null || true
  fi
fi
git push -q origin --delete "$b" 2>/dev/null || true
scripts/bus.sh merged "$b into main ($sha): ${what:-see the PR}${n:+ (PR #$n)}" || true
echo "land: $b is on main as $sha${n:+; PR #$n is ${state:-in an unknown state}}."
echo "INTEGRATION_LOG line (commit it on your next branch, not on main):"
echo "- $(date '+%Y-%m-%d %H:%M')  merged $b ($sha)${n:+ PR #$n} | test: pass | <conflicts resolved, if any>"
