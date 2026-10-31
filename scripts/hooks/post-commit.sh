#!/bin/sh
# PostToolUse (Bash): after a `git commit`, (a) tell the bus what landed, (b) when the branch is a meaningful chunk and
# not queued yet, tell Claude to run scripts/ready.sh once the job is done (no question to the developer). Never blocks.
. "$(dirname "$0")/lib.sh"
input=$(cat)
cmd=$(printf '%s' "$input" | json_get tool_input.command)
case "$cmd" in *"git commit"*) ;; *) exit 0 ;; esac
# the repo the commit ran in: `cd <dir>` / `git -C <dir>` in the command wins (agents commit in other worktrees),
# else the session cwd; relative paths resolve from the session cwd
sess=$(printf '%s' "$input" | json_get cwd); [ -n "$sess" ] && cd "$sess" 2>/dev/null
dir=$(printf '%s' "$cmd" | cmd_dir)
case "$dir" in "~"/*) dir="$HOME/${dir#\~/}" ;; esac
{ [ -n "$dir" ] && [ -d "$dir" ]; } || dir="$sess"
enter_repo "$dir"
branch=$(current_branch)
[ -z "$branch" ] && exit 0
sha=$(git rev-parse --short HEAD 2>/dev/null)
[ "$(cat .bus/last-commit 2>/dev/null)" = "$sha" ] && exit 0                                   # this commit was already posted
[ $(( $(date +%s) - $(git log -1 --format=%ct 2>/dev/null || echo 0) )) -gt 180 ] && exit 0    # the commit failed; HEAD is old
echo "$sha" > .bus/last-commit
subject=$(git log -1 --format=%s 2>/dev/null)
[ -n "$subject" ] && bus_bg post "COMMIT $branch: $subject ($sha)"
[ "$branch" = "main" ] && exit 0
ready_pending "$branch" && exit 0                                                             # ready.sh already queued it
ahead=$(git rev-list --count origin/main..HEAD 2>/dev/null || echo 0)
first=$(git log --format=%ct origin/main..HEAD 2>/dev/null | tail -1)
age=0; [ -n "$first" ] && age=$(( ( $(date +%s) - first ) / 60 ))
marker=".bus/merge-asked-$(printf '%s' "$branch" | tr '/' '_')"
if { [ "$ahead" -ge 3 ] || [ "$age" -ge 30 ]; } && [ "$(file_age "$marker")" -gt 1200 ]; then
  touch "$marker"
  json_out_ctx PostToolUse "This branch is a meaningful chunk ($ahead commits ahead of main, $age min old). If the job, or a demoable slice of it, is done and npm test is green, run \`scripts/ready.sh \"<what it does>\"\` now, without asking: it syncs, tests, pushes, opens the PR and posts [READY], and the integrator lands it. If it is not done, keep going."
fi
exit 0
