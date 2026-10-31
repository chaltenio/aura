#!/usr/bin/env bash
# bus.sh: the team bus = one pinned GitHub issue ("BUS") that every teammate's Claude Code session reads and writes with `gh`.
# Any machine with `gh auth login` done and push access to the repo. No server, no new accounts.
#
#   scripts/bus.sh read [N]            last N messages (default 15), oldest first
#   scripts/bus.sh board               last 30 messages grouped by person
#   scripts/bus.sh since               messages since this machine last read (integrator loop)
#   scripts/bus.sh post   "<text>"     STATUS: what you just landed / are doing (name the files)
#   scripts/bus.sh claim  "<text>"     CLAIM: "#7 hunt.js 3-frame vote" before you start (and put your name in TODO.md)
#   scripts/bus.sh ready  "<text>"     READY: "<branch>: what it does" -> the integrator merges it into main
#                                      (a finished job runs scripts/ready.sh instead: it syncs, tests, opens the PR, then posts this)
#   scripts/bus.sh ask    "<text>"     ASK: a question for the team / integrator
#   scripts/bus.sh answer "<text>"     ANSWER: reply to an ASK (quote it)
#   scripts/bus.sh decide "<text>"     DECIDE: a decision everyone must follow (also add to TODO.md Decisions)
#   scripts/bus.sh digest "<text>"     INTEGRATOR: digest from the integrator pass
#   scripts/bus.sh merged "<text>"     MERGED: posted by the integrator / merge skill
#   scripts/bus.sh commit|working ...  COMMIT / WORKING: posted automatically by hooks (see scripts/hooks/)
#   scripts/bus.sh url | init          issue URL | create + label + pin the BUS issue (idempotent)
#
# Env: BUS_QUIET=1 never fails and prints nothing (for hooks). BUS_TIMEOUT=seconds per gh call (default 8).
set -uo pipefail
TITLE="BUS: team channel (do not close)"

ghx() { perl -e 'alarm shift; exec @ARGV' "${BUS_TIMEOUT:-8}" gh "$@"; }   # gh with a hard timeout (alarm survives exec)

main() {
  cd "$(git rev-parse --show-toplevel)" || return 1
  STATE=".bus"; mkdir -p "$STATE"
  REPO=$(cat "$STATE/repo" 2>/dev/null || true)
  if [[ -z "$REPO" ]]; then REPO=$(ghx repo view --json nameWithOwner --jq .nameWithOwner 2>/dev/null || true); [[ -n "$REPO" ]] && echo "$REPO" > "$STATE/repo"; fi
  if [[ -z "$REPO" ]]; then echo "bus: gh is not authenticated or there is no GitHub remote. Run: gh auth login"; return 1; fi

  issue_number() {
    if [[ -s "$STATE/issue" ]]; then cat "$STATE/issue"; return 0; fi
    local n; n=$(ghx issue list --repo "$REPO" --state open --label bus --limit 1 --json number --jq '.[0].number // empty' 2>/dev/null || true)
    [[ -n "$n" ]] && echo "$n" > "$STATE/issue"; echo "$n"
  }
  fetch_lines() {  # $1 = extra query
    ghx api --paginate "repos/$REPO/issues/$n/comments?per_page=100$1" \
      --jq '.[] | (.body | split("\n")) as $l | "\(.created_at[11:16])Z " + $l[0] + "  " + (($l[1:] | map(select(length > 0)) | join(" / ")) | .[0:240])'
  }

  local cmd=${1:-read}; [[ $# -gt 0 ]] && shift
  case "$cmd" in
    init)
      ghx label create bus --repo "$REPO" --color 5319e7 --description "team bus" >/dev/null 2>&1 || true
      n=$(issue_number)
      if [[ -z "$n" ]]; then
        local tmp url id; tmp=$(mktemp)
        printf '%s\n' "This issue is the team bus. Every teammate's Claude Code session reads and writes it with \`scripts/bus.sh\`." \
          "One comment = one message. First line: \`[KIND] @who HH:MM sha\`. Kinds: STATUS, CLAIM, READY, ASK, ANSWER, DECIDE, INTEGRATOR, MERGED, COMMIT, WORKING." \
          "Read: \`scripts/bus.sh read\` or \`board\`. Humans can also type a comment here from a phone." "" "Do not close this issue." > "$tmp"
        url=$(ghx issue create --repo "$REPO" --title "$TITLE" --label bus --body-file "$tmp"); rm -f "$tmp"
        n=${url##*/}; echo "$n" > "$STATE/issue"
        id=$(ghx api "repos/$REPO/issues/$n" --jq .node_id)
        ghx api graphql -f query="mutation { pinIssue(input: {issueId: \"$id\"}) { issue { number } } }" >/dev/null 2>&1 || echo "bus: could not pin the issue (needs write access); the 'bus' label still finds it"
      fi
      echo "bus: issue #$n  https://github.com/$REPO/issues/$n";;
    url) n=$(issue_number); echo "https://github.com/$REPO/issues/$n";;
    read|since|board)
      n=$(issue_number); if [[ -z "$n" ]]; then echo "bus: no BUS issue yet. Run: scripts/bus.sh init"; return 0; fi
      local limit=${1:-15} q=""
      if [[ "$cmd" == "since" ]]; then limit=200; [[ -s "$STATE/last" ]] && q="&since=$(cat "$STATE/last")"; fi
      if [[ "$cmd" == "board" ]]; then
        fetch_lines "" | tail -n 30 | awk '{ who=$3; if (!(who in seen)) { order[++k]=who; seen[who]=1 } lines[who]=lines[who] "\n  " $0 } END { for (i=1;i<=k;i++) print order[i] ":" lines[order[i]] }'
      else
        fetch_lines "$q" | tail -n "$limit"
      fi
      date -u +%Y-%m-%dT%H:%M:%SZ > "$STATE/last"
      echo "(bus: https://github.com/$REPO/issues/$n  post with scripts/bus.sh post|claim|ready|ask|answer|decide)";;
    post|claim|ready|ask|answer|decide|digest|merged|commit|working)
      n=$(issue_number); if [[ -z "$n" ]]; then echo "bus: no BUS issue yet. Run: scripts/bus.sh init"; return 1; fi
      local text="$*"; if [[ -z "$text" ]]; then echo "bus: give the message text"; return 1; fi
      local kind; kind=$(printf '%s' "$cmd" | tr '[:lower:]' '[:upper:]'); [[ "$cmd" == "post" ]] && kind=STATUS; [[ "$cmd" == "digest" ]] && kind=INTEGRATOR
      local who; who=$(cat "$STATE/who" 2>/dev/null || true)
      if [[ -z "$who" ]]; then who=$(ghx api user --jq .login 2>/dev/null || whoami); echo "$who" > "$STATE/who"; fi
      local sha tmp; sha=$(git rev-parse --short HEAD 2>/dev/null || echo "-")
      tmp=$(mktemp); printf '[%s] @%s %s %s\n\n%s\n' "$kind" "$who" "$(date +%H:%M)" "$sha" "$text" > "$tmp"
      ghx issue comment "$n" --repo "$REPO" --body-file "$tmp" >/dev/null; local rc=$?; rm -f "$tmp"
      [[ $rc -eq 0 ]] && echo "bus: posted [$kind] to #$n"; return $rc;;
    *) sed -n '2,17p' "$0"; return 1;;
  esac
}
if [[ "${BUS_QUIET:-0}" == "1" ]]; then main "$@" >/dev/null 2>&1 || true; exit 0; fi
main "$@"
