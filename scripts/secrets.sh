#!/usr/bin/env bash
# Team secrets for a public repo: SOPS + age. Encrypted files live in secrets/*.enc.env and are safe to commit.
#   scripts/secrets.sh init                  make your age key (once per laptop) and print the public key
#   scripts/secrets.sh pubkey                print your public key
#   scripts/secrets.sh add-member <age1...>  let a teammate decrypt (re-encrypts every secrets file); commit + push after
#   scripts/secrets.sh remove-member <age1..> revoke a key (then rotate the upstream API keys)
#   scripts/secrets.sh edit [prod|dev]       edit in $EDITOR, re-encrypted on save
#   scripts/secrets.sh set [prod|dev] K=V    set one value without opening an editor
#   scripts/secrets.sh decrypt [prod|dev]    print plaintext (e.g. > .env, which is gitignored)
#   scripts/secrets.sh push-to-host [prod]   fly secrets import (skips CHANGE_ME placeholders)
set -euo pipefail
ROOT=$(cd "$(dirname "$0")/.." && pwd)
KEY=${SOPS_AGE_KEY_FILE:-$HOME/.config/sops/age/keys.txt}
export SOPS_AGE_KEY_FILE="$KEY"
for t in sops age-keygen; do command -v "$t" >/dev/null || { echo "missing $t: brew install sops age"; exit 1; }; done
file() { echo "$ROOT/secrets/${1:-prod}.enc.env"; }
cmd=${1:-help}
case "$cmd" in
  init)
    if [ -f "$KEY" ]; then echo "age key already exists: $KEY"; else mkdir -p "$(dirname "$KEY")"; age-keygen -o "$KEY" 2>/dev/null; chmod 600 "$KEY"; echo "created $KEY (never share or commit this file)"; fi
    echo; echo "Your PUBLIC key. Post it on the bus so someone runs add-member:"; echo "  scripts/bus.sh post \"age pubkey $(age-keygen -y "$KEY")\""; echo; age-keygen -y "$KEY" ;;
  pubkey) age-keygen -y "$KEY" ;;
  add-member|remove-member)
    pk=${2:?age public key required}
    case "$pk" in age1*) ;; *) echo "not an age public key: $pk"; exit 1 ;; esac
    cur=$(sed -n 's/^ *age: *"\(.*\)"/\1/p' "$ROOT/.sops.yaml")
    if [ "$cmd" = add-member ]; then
      case ",$cur," in *",$pk,"*) echo "already a member";; *) cur="$cur,$pk";; esac
    else
      cur=$(echo "$cur" | tr ',' '\n' | grep -vx "$pk" | paste -sd, -)
      [ -n "$cur" ] || { echo "refusing to remove the last key"; exit 1; }
    fi
    sed -i '' "s|^\( *age: *\)\".*\"|\1\"$cur\"|" "$ROOT/.sops.yaml"
    for f in "$ROOT"/secrets/*.enc.env; do sops updatekeys -y "$f"; done
    echo "recipients now: $cur"; echo "commit .sops.yaml and secrets/*.enc.env, then push" ;;
  edit) sops "$(file "${2:-prod}")" ;;
  set) f=$(file "${2:-prod}"); kv=${3:?K=V required}; k=${kv%%=*}; v=${kv#*=}; sops --set "[\"$k\"] \"$v\"" "$f"; echo "set $k in $(basename "$f")" ;;
  decrypt) sops --decrypt "$(file "${2:-prod}")" ;;
  push-to-host)
    app=${FLY_APP:-$(sed -n 's/^app = "\(.*\)"/\1/p' "$ROOT/fly.toml")}
    sops --decrypt "$(file "${2:-prod}")" | grep -Ev '^\s*(#|$)' | grep -v '=CHANGE_ME$' | fly secrets import -a "$app" --stage
    echo "staged secrets on $app (applied on next deploy)" ;;
  *) sed -n '2,11p' "$0" ;;
esac
