#!/usr/bin/env bash
# pr.sh: make sure <branch> has an open pull request into main, then print "<number> <url>" (the only stdout line).
#   none open: open one (title = the summary, body = how it lands + commits + files)
#   one open:  reuse it as it is (a body someone wrote, e.g. a Shelled run link, is never rewritten); a draft is
#              taken out of draft
# The branch must be pushed first. Used by scripts/ready.sh (job done) and scripts/land.sh (landing).
# Usage: scripts/pr.sh <branch> ["<title>"] ["<one line for the body, e.g. what was checked>"]
set -euo pipefail
cd "$(git rev-parse --show-toplevel)"
b=${1:?usage: scripts/pr.sh <branch> [title] [note]}; title=${2:-}; note=${3:-}
ghx() { perl -e 'alarm shift; exec @ARGV' "${PR_TIMEOUT:-30}" gh "$@"; }   # gh with a hard timeout
mkdir -p .bus; repo=$(cat .bus/repo 2>/dev/null || true)
if [[ -z "$repo" ]]; then repo=$(ghx repo view --json nameWithOwner --jq .nameWithOwner); echo "$repo" > .bus/repo; fi

open=$(ghx pr list --repo "$repo" --head "$b" --base main --state open --json number,url,isDraft \
  --jq '.[0] // empty | "\(.number) \(.url) \(.isDraft)"')
if [[ -n "$open" ]]; then
  read -r n url draft <<<"$open"
  if [[ "$draft" == "true" ]]; then ghx pr ready "$n" --repo "$repo" >/dev/null; echo "pr: #$n is out of draft" >&2; fi
  echo "$n $url"; exit 0
fi

if ! git show-ref --verify --quiet "refs/remotes/origin/$b"; then echo "pr: origin/$b does not exist; push the branch first" >&2; exit 1; fi
range="origin/main..origin/$b"
if [[ -z "$(git rev-list "$range")" ]]; then echo "pr: origin/$b has nothing that main lacks" >&2; exit 1; fi
if [[ -z "$title" ]]; then
  title=$(git log --reverse --no-merges --format=%s "$range" | grep -v -E '^(todo|integration log|integrator):' | head -1 || true)
  title=${title:-$b}
fi
commits=$(git rev-list --count --no-merges "$range")
files=$(git diff --name-only "origin/main...origin/$b" | wc -l | tr -d ' ')
body=$(mktemp); trap 'rm -f "$body"' EXIT
{
  echo "$title"
  echo
  echo "Branch \`$b\`: $commits commits, $files files.${note:+ $note}"
  echo "Lands through \`/merge\` or the integrator, which picks up the \`[READY]\` line on the team bus. \`main\` fast-forwards to this PR's head, so GitHub shows it as merged. CI runs on this PR."
  echo
  echo "### Commits"
  git log --reverse --no-merges --format='- %s (%h)' "$range" | head -40 || true
  echo
  echo "### Files"
  echo '```'
  git diff --stat=100 "origin/main...origin/$b" | tail -n 30
  echo '```'
  if [[ "${CLAUDECODE:-}" == "1" ]]; then echo; echo "🤖 Generated with [Claude Code](https://claude.com/claude-code)"; fi
} > "$body"
url=$(ghx pr create --repo "$repo" --base main --head "$b" --title "$title" --body-file "$body" | tail -1)
echo "pr: opened $url" >&2
echo "${url##*/} $url"
