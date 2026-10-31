#!/bin/sh
# Stop: (a) once per new commit, when a clean branch has work main lacks and no [READY] yet, keep Claude going one
#           step: run scripts/ready.sh if the job is done, otherwise end the turn (the second stop always goes through);
#       (b) otherwise a one-line reminder to the developer when the branch has uncommitted or unpushed work.
. "$(dirname "$0")/lib.sh"
input=$(cat)
enter_repo "$(printf '%s' "$input" | json_get cwd)"
branch=$(current_branch)
[ -z "$branch" ] || [ "$branch" = "main" ] && exit 0
dirty=$(git status --porcelain 2>/dev/null | grep -cv '^??' )
if git rev-parse --abbrev-ref --symbolic-full-name '@{u}' >/dev/null 2>&1; then unpushed=$(git rev-list --count '@{u}..HEAD' 2>/dev/null || echo 0)
else unpushed=$(git rev-list --count origin/main..HEAD 2>/dev/null || echo 0); fi
if [ "${dirty:-0}" -eq 0 ] && [ "$(printf '%s' "$input" | json_get stop_hook_active)" != "true" ] && ! ready_pending "$branch"; then
  head=$(git rev-parse HEAD 2>/dev/null)
  work=$(git log --no-merges --format=%s origin/main..HEAD 2>/dev/null | grep -cv -E '^(todo|integration log|integrator):')
  nudged=".bus/ready-nudged-$(printf '%s' "$branch" | tr '/' '_')"
  if [ "${work:-0}" -gt 0 ] && [ "$(cat "$nudged" 2>/dev/null)" != "$head" ]; then
    echo "$head" > "$nudged"
    json_block "$branch has $work commit(s) that main lacks and no [READY] yet. If the job, or a demoable slice of it, is done and npm test is green, run scripts/ready.sh \"<what it does>\" now, without asking: it syncs, tests, pushes, opens the PR and posts [READY], and the integrator lands it. If it is not done, or you are waiting on the developer, just end your turn; this comes back only after the next commit."
    exit 0
  fi
fi
if [ "${dirty:-0}" -gt 0 ] || [ "${unpushed:-0}" -gt 0 ]; then
  json_out systemMessage "Uncommitted/unpushed work on $branch ($dirty changed files, $unpushed unpushed commits): commit and run scripts/sync.sh before you leave."
fi
exit 0
