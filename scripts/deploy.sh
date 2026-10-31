#!/usr/bin/env bash
# One-shot deploy to Fly.io: creates the app and data volume if missing, stages secrets from secrets/prod.enc.env
# (or a local .env), deploys with Fly's remote builder (no local Docker needed), prints the URL, smoke-checks it.
#   scripts/deploy.sh            deploy
#   scripts/deploy.sh logs       tail logs
#   scripts/deploy.sh rollback   roll back to the previous release
#   scripts/deploy.sh status     machines + URL
set -euo pipefail
ROOT=$(cd "$(dirname "$0")/.." && pwd); cd "$ROOT"
command -v fly >/dev/null || { echo "install flyctl: brew install flyctl"; exit 1; }
APP=${FLY_APP:-$(sed -n 's/^app = "\(.*\)"/\1/p' fly.toml)}
REGION=${FLY_REGION:-$(sed -n 's/^primary_region = "\(.*\)"/\1/p' fly.toml)}
ORG=${FLY_ORG:-personal}
URL="https://$APP.fly.dev"
fly auth whoami >/dev/null 2>&1 || { echo "Not logged in to Fly. In your Claude Code prompt run:   ! fly auth login"; exit 1; }
case "${1:-deploy}" in
  logs) exec fly logs -a "$APP" ;;
  status) fly status -a "$APP"; echo "$URL" ;;
  rollback)
    prev=$(fly releases -a "$APP" --json | python3 -c 'import json,sys; r=json.load(sys.stdin); print(r[1]["ImageRef"] if len(r)>1 else "")')
    [ -n "$prev" ] || { echo "no previous release"; exit 1; }
    fly deploy -a "$APP" --image "$prev" ;;
  deploy)
    if ! fly apps list --json | python3 -c 'import json,sys; a=sys.argv[1]; sys.exit(0 if any(x.get("Name")==a for x in json.load(sys.stdin)) else 1)' "$APP"; then
      echo "creating app $APP in org $ORG"; fly apps create "$APP" --org "$ORG" || { echo "app name taken? set FLY_APP=<other-name> or edit fly.toml"; exit 1; }
    fi
    if ! fly volumes list -a "$APP" --json | python3 -c 'import json,sys; sys.exit(0 if any(v.get("name")=="haunt_data" for v in json.load(sys.stdin)) else 1)'; then
      echo "creating 1 GB volume haunt_data in $REGION"; fly volumes create haunt_data -a "$APP" -r "$REGION" -s 1 -y
    fi
    if [ -f .env ]; then
      echo "staging secrets from .env"; grep -Ev '^\s*(#|$)' .env | grep -v '=CHANGE_ME$' | fly secrets import -a "$APP" --stage || true
    elif [ -f secrets/prod.enc.env ] && command -v sops >/dev/null && sops --decrypt secrets/prod.enc.env >/dev/null 2>&1; then
      echo "staging secrets from secrets/prod.enc.env"; FLY_APP="$APP" scripts/secrets.sh push-to-host prod || true
    else
      echo "no secrets staged (no .env and cannot decrypt secrets/prod.enc.env); app runs without API keys"
    fi
    fly deploy -a "$APP" --remote-only --ha=false --build-arg GIT_SHA="$(git rev-parse --short HEAD)"
    echo "deployed: $URL"
    for i in 1 2 3 4 5 6; do if curl -fsS "$URL/api/gallery" >/dev/null; then echo "smoke OK: $URL/api/gallery"; exit 0; fi; sleep 5; done
    echo "deployed but /api/gallery not answering yet; check: scripts/deploy.sh logs"; exit 1 ;;
  *) sed -n '2,8p' "$0" ;;
esac
