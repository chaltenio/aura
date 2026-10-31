# secrets/

Encrypted with SOPS + age. Safe to commit and publish; only the age keys listed in `.sops.yaml` can decrypt.

- `prod.enc.env`: what the deployed app gets (`scripts/secrets.sh push-to-host`).
- `dev.enc.env`: local defaults (`scripts/secrets.sh decrypt dev > .env`).

Never commit a plaintext `.env` or `*.env` here (gitignored). See docs/SECRETS.md.
