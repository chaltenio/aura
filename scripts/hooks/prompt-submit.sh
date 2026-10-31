#!/bin/sh
# UserPromptSubmit: (a) post a throttled "working on" gist to the bus so nobody duplicates work,
# (b) keep origin fresh in the background and warn when origin/main moved ahead. Never blocks the prompt.
. "$(dirname "$0")/lib.sh"
input=$(cat)
prompt=$(printf '%s' "$input" | json_get prompt)
session=$(printf '%s' "$input" | json_get session_id)
enter_repo "$(printf '%s' "$input" | json_get cwd)"
branch=$(current_branch); [ -z "$branch" ] && branch="(detached)"
# (a) gist, at most once per 10 minutes per session, only for real task prompts
gist=$(printf '%s' "$prompt" | tr '\n\r' '  ' | cut -c1-100)
case "$prompt" in /*) gist="" ;; esac
if [ ${#prompt} -ge 15 ] && [ -n "$gist" ]; then
  m=".bus/working-${session:-nosession}"
  if [ "$(file_age "$m")" -gt 600 ]; then touch "$m"; bus_bg post "WORKING $branch: $gist"; fi
fi
# (b) fetch in the background every 10 minutes; report drift based on the last completed fetch
if [ "$(file_age .bus/last-fetch)" -gt 600 ]; then touch .bus/last-fetch; nohup git fetch -q origin >/dev/null 2>&1 & fi
ctx=""
n=$(git rev-list --count HEAD..origin/main 2>/dev/null || echo 0)
if [ "${n:-0}" -gt 0 ]; then
  if [ "$branch" = "main" ]; then ctx="Local main is $n commits behind origin/main; run \`git pull --ff-only\` (and remember: edits happen on a branch, see /start)."
  else ctx="origin/main has $n new commits since this branch's base; run scripts/sync.sh before editing so you build on current code."; fi
fi
# (c) first prompt of this session: the steering interview fires now, whatever the prompt says
first=".bus/started-${session:-nosession}"
if [ ! -e "$first" ] && [ -z "$INTEGRATOR" ] && [ -z "$MERGE_SKILL" ]; then
  touch "$first"
  app=$(sed -n 's/^app = "\(.*\)"/\1/p' fly.toml 2>/dev/null); live="https://${app:-aura-haunt}.fly.dev"
  ctx="FIRST PROMPT OF THIS SESSION. Before anything else, run the /start skill (Skill tool, name: start): greet with the live state, interview the idea for fit, claim it on the bus, create the branch. If this prompt is already a concrete task, keep the greeting to two lines but still claim and branch before editing; if it is a tiny fix on a file this person owns, claim and branch, no interview. Live app for any testing: $live (register at /register, hunt at /hunt, screen at /screen; /api/version shows the deployed commit). $ctx"
fi
[ -n "$ctx" ] && json_out_ctx UserPromptSubmit "$ctx"
exit 0
