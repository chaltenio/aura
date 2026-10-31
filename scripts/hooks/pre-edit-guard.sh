#!/bin/sh
# PreToolUse (Edit|Write|MultiEdit|NotebookEdit): work starts on a branch, never on main.
# Bypass: MERGE_SKILL=1 or INTEGRATOR=1 in the environment. Always allowed: TODO.md, docs/INTEGRATION_LOG.md, files outside the repo.
. "$(dirname "$0")/lib.sh"
[ -n "$MERGE_SKILL" ] && exit 0
[ -n "$INTEGRATOR" ] && exit 0
input=$(cat)
file=$(printf '%s' "$input" | json_get tool_input.file_path)
[ -z "$file" ] && file=$(printf '%s' "$input" | json_get tool_input.notebook_path)
enter_repo "$(printf '%s' "$input" | json_get cwd)"
top=$(pwd)
case "$file" in
  "$top"/*) rel=${file#"$top"/} ;;
  /*) exit 0 ;;              # outside this repo (scratchpad, other projects): not our business
  *) rel=$file ;;
esac
case "$rel" in TODO.md|docs/INTEGRATION_LOG.md) exit 0 ;; esac
branch=$(current_branch)
if [ -z "$branch" ] || [ "$branch" = "main" ]; then
  echo "On main: run /start to claim a task and create your branch (name/task) before editing. (Hook: scripts/hooks/pre-edit-guard.sh; bypass with MERGE_SKILL=1 only when landing a merge.)" >&2
  exit 2
fi
exit 0
