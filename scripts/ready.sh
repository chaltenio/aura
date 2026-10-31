#!/usr/bin/env bash
# ready.sh: the last step of every job. Run it when the job, or a demoable slice of it, works and is committed.
# Agents run it by themselves; nobody has to ask. It:
#   1. runs scripts/sync.sh: brings origin/main in, runs npm test, pushes the branch (stops here if the test fails)
#   2. opens the branch's pull request into main, or reuses the open one and takes it out of draft (scripts/pr.sh)
#   3. posts [READY] "<branch>: <what it does> (PR #n <url>)" on the bus. The integrator lands it within a pass, or
#      run /merge to land it now. Either way main fast-forwards to the PR's head and GitHub shows the PR merged.
# Usage: scripts/ready.sh "<what it does, one line>" [--no-test] [--dry-run]
#   --no-test  docs-only change, skip npm test        --dry-run  say what would happen, change nothing
set -euo pipefail
cd "$(git rev-parse --show-toplevel)"
summary=""; notest=""; dry=""
for a in "$@"; do
  case "$a" in
    --no-test) notest=1 ;;
    --dry-run) dry=1 ;;
    -*) echo "ready: unknown flag $a (use --no-test or --dry-run)"; exit 1 ;;
    *) summary="${summary:+$summary }$a" ;;
  esac
done
branch=$(git branch --show-current)
if [[ -z "$branch" || "$branch" == "main" ]]; then echo "ready: run this on your branch (you are on ${branch:-a detached HEAD})"; exit 1; fi
if ! git diff --quiet || ! git diff --cached --quiet; then
  echo "ready: uncommitted changes. Commit what belongs to this job (stash the rest), then run it again:"
  git status --short --untracked-files=no | head -10; exit 1
fi
untracked=$(git ls-files --others --exclude-standard | head -5 | tr '\n' ' ' || true)
if [[ -n "$untracked" ]]; then echo "ready: note, untracked files stay out of the PR: $untracked"; fi
git fetch -q origin
if [[ -z "$(git rev-list origin/main..HEAD)" ]]; then echo "ready: $branch has nothing that main lacks; nothing to land."; exit 0; fi
summary=${summary#"$branch: "}
if [[ -z "$summary" ]]; then
  summary=$(git log --reverse --no-merges --format=%s origin/main..HEAD | grep -v -E '^(todo|integration log|integrator):' | head -1 || true)
  summary=${summary:-$branch}
fi

if [[ -n "$dry" ]]; then
  open=$(gh pr list --head "$branch" --base main --state open --json number --jq '.[0].number // empty' 2>/dev/null || true)
  echo "ready (dry run) on $branch, $(git rev-list --count --no-merges origin/main..HEAD) commits main lacks:"
  git log --reverse --no-merges --format='  - %s (%h)' origin/main..HEAD | head -20 || true
  if [[ -n "$notest" ]]; then echo "  1. scripts/sync.sh --no-test (main in, push)"; else echo "  1. scripts/sync.sh (main in, npm test, push)"; fi
  if [[ -n "$open" ]]; then echo "  2. reuse open PR #$open"; else echo "  2. open a PR titled: $summary"; fi
  echo "  3. scripts/bus.sh ready \"$branch: $summary (PR #<n> <url>)\""
  exit 0
fi

scripts/sync.sh ${notest:+--no-test} || { echo "ready: NOT ready. Sync or the test failed (above); fix, commit, run scripts/ready.sh again."; exit 1; }
if [[ -n "$notest" ]]; then checked="npm test skipped (--no-test, docs only)."; else checked="npm test passed on $(git rev-parse --short HEAD) before it was marked ready."; fi
pr=$(scripts/pr.sh "$branch" "$summary" "$checked") || { echo "ready: the branch is pushed but the PR could not be opened (above). Run scripts/ready.sh again."; exit 1; }
n=${pr%% *}; url=${pr#* }
scripts/bus.sh ready "$branch: $summary (PR #$n $url)" || { echo "ready: PR #$n is open but the bus post failed. Post it: scripts/bus.sh ready \"$branch: $summary (PR #$n)\""; exit 1; }
mkdir -p .bus; git rev-parse HEAD > ".bus/ready-$(printf '%s' "$branch" | tr '/' '_')"   # the Stop and commit hooks stop nudging
echo "ready: PR #$n $url is open and [READY] is on the bus. The integrator lands it within a pass, or run /merge to land it now."
