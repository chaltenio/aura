#!/usr/bin/env bash
# bus.sh: the team bus = one pinned GitHub issue ("BUS") that every teammate's Claude Code session reads and writes with `gh`.
# Any machine with `gh auth login` done and push access to the repo. No server, no new accounts.
#
#   scripts/bus.sh read [N]            last N messages (default 15), oldest first
#   scripts/bus.sh since               messages since this machine last read (integrator loop)
#   scripts/bus.sh post   "<text>"     STATUS: what you just landed / are doing (name the files)
#   scripts/bus.sh claim  "<text>"     CLAIM: "#7 hunt.js 3-frame vote" before you start (and put your name in TODO.md)
#   scripts/bus.sh ask    "<text>"     ASK: a question for the team / integrator
#   scripts/bus.sh answer "<text>"     ANSWER: reply to an ASK (quote it)
#   scripts/bus.sh decide "<text>"     DECIDE: a decision everyone must follow (also add to TODO.md Decisions)
#   scripts/bus.sh digest "<text>"     INTEGRATOR: digest from the integrator pass
#   scripts/bus.sh url                 print the issue URL
#   scripts/bus.sh init                create + label + pin the BUS issue (idempotent)
set -euo pipefail
cd "$(git rev-parse --show-toplevel)"
REPO=$(gh repo view --json nameWithOwner --jq .nameWithOwner 2>/dev/null || true)
if [[ -z "$REPO" ]]; then echo "bus: gh is not authenticated or there is no GitHub remote. Run: gh auth login"; exit 0; fi
STATE=".bus"; mkdir -p "$STATE"
TITLE="BUS: team channel (do not close)"

issue_number() {
  if [[ -s "$STATE/issue" ]]; then cat "$STATE/issue"; return 0; fi
  local n
  n=$(gh issue list --repo "$REPO" --state open --label bus --limit 1 --json number --jq '.[0].number // empty' 2>/dev/null || true)
  [[ -n "$n" ]] && echo "$n" > "$STATE/issue"
  echo "$n"
}

cmd=${1:-read}; [[ $# -gt 0 ]] && shift
case "$cmd" in
  init)
    gh label create bus --repo "$REPO" --color 5319e7 --description "team bus" >/dev/null 2>&1 || true
    n=$(issue_number)
    if [[ -z "$n" ]]; then
      tmp=$(mktemp)
      printf '%s\n' "This issue is the team bus. Every teammate's Claude Code session reads and writes it with \`scripts/bus.sh\`." \
        "One comment = one message. First line: \`[KIND] @who HH:MM sha\`. Kinds: STATUS, CLAIM, ASK, ANSWER, DECIDE, INTEGRATOR." \
        "Read: \`scripts/bus.sh read\`. Humans can also type a comment here from a phone." "" "Do not close this issue." > "$tmp"
      url=$(gh issue create --repo "$REPO" --title "$TITLE" --label bus --body-file "$tmp"); rm -f "$tmp"
      n=${url##*/}; echo "$n" > "$STATE/issue"
      id=$(gh api "repos/$REPO/issues/$n" --jq .node_id)
      gh api graphql -f query="mutation { pinIssue(input: {issueId: \"$id\"}) { issue { number } } }" >/dev/null 2>&1 || echo "bus: could not pin the issue (needs write access); the 'bus' label still finds it"
    fi
    echo "bus: issue #$n  https://github.com/$REPO/issues/$n";;
  url) n=$(issue_number); echo "https://github.com/$REPO/issues/$n";;
  read|since)
    n=$(issue_number); if [[ -z "$n" ]]; then echo "bus: no BUS issue yet. Run: scripts/bus.sh init"; exit 0; fi
    limit=${1:-15}; q="per_page=100"
    if [[ "$cmd" == "since" ]]; then limit=200; [[ -s "$STATE/last" ]] && q="$q&since=$(cat "$STATE/last")"; fi
    gh api --paginate "repos/$REPO/issues/$n/comments?$q" \
      --jq '.[] | (.body | split("\n")) as $l | "\(.created_at[11:16])Z " + $l[0] + "  " + (($l[1:] | map(select(length > 0)) | join(" / ")) | .[0:240])' \
      | tail -n "$limit"
    date -u +%Y-%m-%dT%H:%M:%SZ > "$STATE/last"
    echo "(bus: https://github.com/$REPO/issues/$n  post with scripts/bus.sh post|claim|ask|answer|decide)";;
  post|claim|ask|answer|decide|digest)
    n=$(issue_number); if [[ -z "$n" ]]; then echo "bus: no BUS issue yet. Run: scripts/bus.sh init"; exit 1; fi
    text="$*"; if [[ -z "$text" ]]; then echo "bus: give the message text"; exit 1; fi
    kind=$(printf '%s' "$cmd" | tr '[:lower:]' '[:upper:]'); [[ "$cmd" == "post" ]] && kind=STATUS; [[ "$cmd" == "digest" ]] && kind=INTEGRATOR
    who=$(gh api user --jq .login 2>/dev/null || whoami)
    sha=$(git rev-parse --short HEAD 2>/dev/null || echo "-")
    tmp=$(mktemp); printf '[%s] @%s %s %s\n\n%s\n' "$kind" "$who" "$(date +%H:%M)" "$sha" "$text" > "$tmp"
    gh issue comment "$n" --repo "$REPO" --body-file "$tmp" >/dev/null; rm -f "$tmp"
    echo "bus: posted [$kind] to #$n";;
  *) sed -n '2,13p' "$0"; exit 1;;
esac
