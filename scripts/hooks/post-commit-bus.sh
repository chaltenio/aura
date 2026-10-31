#!/usr/bin/env bash
# PostToolUse (Bash) hook: after a `git commit` ran, post "[COMMIT] <branch>: <subject> (<sha>)" to the team bus.
# Prints nothing, never fails, posts each commit once. Wired in .claude/settings.json with async: true.
set -u
input=$(cat 2>/dev/null || true)
case "$input" in *"git commit"*) ;; *) exit 0;; esac
# where did the commit happen: a `cd <dir>` in the command wins, else the session cwd from the hook JSON
dir=$(printf '%s' "$input" | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{try{const j=JSON.parse(s);const c=String((j.tool_input||{}).command||"");const m=c.match(/cd\s+"?([^\s"&;|]+)"?/);process.stdout.write((m&&m[1])||j.cwd||"")}catch{}})' 2>/dev/null)
[[ -n "$dir" && -d "$dir" ]] && cd "$dir" 2>/dev/null
git rev-parse --is-inside-work-tree >/dev/null 2>&1 || exit 0
root=$(git rev-parse --show-toplevel 2>/dev/null) || exit 0
sha=$(git rev-parse --short HEAD 2>/dev/null) || exit 0
mkdir -p "$root/.bus"
[[ "$(cat "$root/.bus/last-commit" 2>/dev/null)" == "$sha" ]] && exit 0
age=$(( $(date +%s) - $(git log -1 --format=%ct 2>/dev/null || echo 0) )); [[ $age -gt 180 ]] && exit 0   # the commit command failed; HEAD is old
echo "$sha" > "$root/.bus/last-commit"
BUS_QUIET=1 BUS_TIMEOUT=6 "$root/scripts/bus.sh" commit "$(git branch --show-current 2>/dev/null || echo detached): $(git log -1 --format=%s) ($sha)"
exit 0
