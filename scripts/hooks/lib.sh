#!/bin/sh
# Shared helpers for the Claude Code hooks in this folder. POSIX sh; python3 for JSON (present on macOS and Linux).
# Every hook: reads the hook JSON from stdin, cd's to the session's cwd, and must finish in well under 2 s.

# json_get <dotted.path>  (stdin = JSON) -> prints the string value or nothing
json_get() {
  python3 -c '
import json, sys
try:
    d = json.load(sys.stdin)
except Exception:
    print(""); sys.exit(0)
for k in sys.argv[1].split("."):
    d = d.get(k) if isinstance(d, dict) else None
print(d if isinstance(d, str) else ("" if d is None else json.dumps(d)))' "$1" 2>/dev/null
}

# json_out <top-level-json-object-as-python-dict-literal-args> : emit a JSON object from key=value pairs
# usage: json_out systemMessage "text"   |   json_out_ctx <HookEventName> "additional context text"
json_out() { python3 -c 'import json,sys; print(json.dumps({sys.argv[1]: sys.argv[2]}))' "$1" "$2"; }
json_out_ctx() { python3 -c 'import json,sys; print(json.dumps({"hookSpecificOutput": {"hookEventName": sys.argv[1], "additionalContext": sys.argv[2]}}))' "$1" "$2"; }

# enter_repo <cwd-from-hook-json> : cd to the repo that the session is working in (worktrees included)
enter_repo() {
  d="$1"; [ -n "$d" ] && [ -d "$d" ] || d="${CLAUDE_PROJECT_DIR:-$PWD}"
  cd "$d" 2>/dev/null || exit 0
  top=$(git rev-parse --show-toplevel 2>/dev/null) || exit 0
  cd "$top" || exit 0
  mkdir -p .bus
}

current_branch() { git branch --show-current 2>/dev/null; }

# cmd_dir (stdin = a shell command) -> the dir of its first `cd <dir>` or `git -C <dir>`, or nothing.
# Agents in other worktrees run `cd <worktree> && git commit ...` while the session cwd stays in the main checkout.
cmd_dir() {
  python3 -c '
import re, sys
c = sys.stdin.read()
arg = r"(?:\"([^\"]+)\"|\x27([^\x27]+)\x27|([^\s;&|)]+))"
m = re.search(r"(?:^|[;&|(]\s*)cd\s+" + arg, c) or re.search(r"\bgit\s+-C\s+" + arg, c)
print(next(g for g in m.groups() if g) if m else "")' 2>/dev/null
}

# file_age <path> -> seconds since mtime, or a huge number if missing
file_age() {
  [ -e "$1" ] || { echo 999999; return; }
  m=$(stat -f %m "$1" 2>/dev/null || stat -c %Y "$1" 2>/dev/null || echo 0)
  echo $(( $(date +%s) - m ))
}

# bus_bg <verb> <text> : post to the team bus without waiting (never blocks a hook)
bus_bg() {
  [ -n "$HOOKS_DRY" ] && { echo "bus(dry): $1 $2" >&2; return 0; }   # HOOKS_DRY=1: print instead of posting (tests)
  [ -x scripts/bus.sh ] || return 0
  nohup scripts/bus.sh "$1" "$2" >/dev/null 2>&1 &
}
