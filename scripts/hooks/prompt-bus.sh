#!/usr/bin/env bash
# UserPromptSubmit hook: post "[WORKING] <branch>: <first 100 chars of the prompt>" to the team bus,
# at most once per 10 minutes per session. Skips prompts under 15 chars or starting with "/". Prints nothing, never fails.
set -u
input=$(cat 2>/dev/null || true)
line=$(printf '%s' "$input" | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{try{const j=JSON.parse(s);process.stdout.write(String(j.session_id||"na").slice(0,8)+" "+String(j.cwd||"")+" "+String(j.prompt||"").replace(/\s+/g," ").trim().slice(0,100))}catch{}})' 2>/dev/null)
sid=${line%% *}; rest=${line#* }; cwd=${rest%% *}; prompt=${rest#* }
[[ -z "$prompt" || ${#prompt} -lt 15 || "$prompt" == /* || "$prompt" == "$rest" ]] && exit 0
[[ -d "$cwd" ]] && cd "$cwd" 2>/dev/null
root=$(git rev-parse --show-toplevel 2>/dev/null) || exit 0
mkdir -p "$root/.bus"; stamp="$root/.bus/working-$sid"
if [[ -f "$stamp" ]]; then last=$(stat -f %m "$stamp" 2>/dev/null || stat -c %Y "$stamp" 2>/dev/null || echo 0); (( $(date +%s) - last < 600 )) && exit 0; fi
touch "$stamp"
BUS_QUIET=1 BUS_TIMEOUT=6 "$root/scripts/bus.sh" working "$(git branch --show-current 2>/dev/null || echo detached): $prompt"
exit 0
