#!/bin/sh
# SessionStart (startup|resume|clear): show the teammate a visible welcome (systemMessage) and give Claude the
# steering convention as hidden context. Must finish fast; the only network call is a 2 s version probe.
. "$(dirname "$0")/lib.sh"
input=$(cat)
enter_repo "$(printf '%s' "$input" | json_get cwd)"
app=$(sed -n 's/^app = "\(.*\)"/\1/p' fly.toml 2>/dev/null); live="https://${app:-aura-haunt}.fly.dev"
ver=$(curl -s --max-time 2 "$live/api/version" 2>/dev/null | python3 -c 'import json,sys; d=json.load(sys.stdin); print(d.get("version","?"))' 2>/dev/null || echo "unreachable")
branch=$(current_branch); [ -z "$branch" ] && branch="(detached)"
bus=$(scripts/bus.sh read 8 2>/dev/null | cut -c1-110)
status=$(sed -n '/^## STATUS/,/^## Now/p' TODO.md 2>/dev/null | sed '1d;$d' | head -n 6)
flight=$(for b in $(git branch -r --no-merged origin/main 2>/dev/null | grep -v HEAD); do echo "  $b  ahead=$(git rev-list --count origin/main..$b)  last=$(git log -1 --format=%cr $b)"; done)
visible="HAUNT team session on branch $branch
LIVE APP (test on your phone): $live   deployed $ver   (/register, /hunt, /me, /screen)
STATUS: $(printf '%s' "$status" | tr '\n' ' ' | cut -c1-400)
BOARD (last 8):
$bus
IN FLIGHT:
${flight:-  (nothing unmerged)}
Type anything to begin: your steering agent will greet you, interview your idea for fit, claim it and branch. Next time open with: npm run go"
hidden="Project convention: this Claude is the steering agent for the teammate who just came online. On the first user prompt of a fresh session, run the /start skill (.claude/skills/start/SKILL.md) before anything else: greeting from the state above, the four-question fit interview, verdict, [PLAN] on the bus, claim, branch. A concrete first task skips the greeting but is still claimed and branched before any edit. Nobody edits on main. Live app: $live (deployed $ver)."
python3 -c 'import json,sys; print(json.dumps({"systemMessage": sys.argv[1], "hookSpecificOutput": {"hookEventName": "SessionStart", "additionalContext": sys.argv[2]}}))' "$visible" "$hidden"
exit 0
