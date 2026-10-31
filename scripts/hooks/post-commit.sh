#!/bin/sh
# PostToolUse (Bash): after a `git commit`, (a) tell the bus what landed, (b) when the branch is a meaningful chunk,
# ask Claude to ask the developer about merging back. Never blocks.
. "$(dirname "$0")/lib.sh"
input=$(cat)
cmd=$(printf '%s' "$input" | json_get tool_input.command)
case "$cmd" in *"git commit"*) ;; *) exit 0 ;; esac
enter_repo "$(printf '%s' "$input" | json_get cwd)"
branch=$(current_branch)
[ -z "$branch" ] && exit 0
subject=$(git log -1 --format=%s 2>/dev/null)
[ -n "$subject" ] && bus_bg post "COMMIT $branch: $subject"
[ "$branch" = "main" ] && exit 0
ahead=$(git rev-list --count origin/main..HEAD 2>/dev/null || echo 0)
first=$(git log --format=%ct origin/main..HEAD 2>/dev/null | tail -1)
age=0; [ -n "$first" ] && age=$(( ( $(date +%s) - first ) / 60 ))
marker=".bus/merge-asked-$(printf '%s' "$branch" | tr '/' '_')"
if { [ "$ahead" -ge 3 ] || [ "$age" -ge 30 ]; } && [ "$(file_age "$marker")" -gt 1200 ]; then
  touch "$marker"
  json_out_ctx PostToolUse "This branch is a meaningful chunk ($ahead commits ahead of main, $age min old). Ask the developer one question now: merge back to main? If yes: run \`scripts/bus.sh ready\` (the integrator agent merges it) or /merge. If no: continue and ask again later."
fi
exit 0
