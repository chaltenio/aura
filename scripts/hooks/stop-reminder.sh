#!/bin/sh
# Stop: one-line reminder to the developer when a branch has uncommitted or unpushed work. Never blocks.
. "$(dirname "$0")/lib.sh"
input=$(cat)
enter_repo "$(printf '%s' "$input" | json_get cwd)"
branch=$(current_branch)
[ -z "$branch" ] || [ "$branch" = "main" ] && exit 0
dirty=$(git status --porcelain 2>/dev/null | grep -cv '^??' )
if git rev-parse --abbrev-ref --symbolic-full-name '@{u}' >/dev/null 2>&1; then unpushed=$(git rev-list --count '@{u}..HEAD' 2>/dev/null || echo 0)
else unpushed=$(git rev-list --count origin/main..HEAD 2>/dev/null || echo 0); fi
if [ "${dirty:-0}" -gt 0 ] || [ "${unpushed:-0}" -gt 0 ]; then
  json_out systemMessage "Uncommitted/unpushed work on $branch ($dirty changed files, $unpushed unpushed commits): commit and run scripts/sync.sh before you leave."
fi
exit 0
