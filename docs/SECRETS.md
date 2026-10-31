# Secrets for a public repo

The repo is public. API keys live in the repo anyway, **encrypted** with [SOPS](https://github.com/getsops/sops)
and [age](https://age-encryption.org): `secrets/prod.enc.env` and `secrets/dev.enc.env`. Only the age public keys
listed in `.sops.yaml` can decrypt them. Each teammate has one age key pair on their laptop; the private key never
leaves it and is never committed (`.gitignore` blocks `*.key`, `age-key*.txt`, `.env*`, `secrets/*.env` plaintext).

## Threat model

- Publishing the encrypted files is safe: age uses X25519 + ChaCha20-Poly1305 per recipient; sops encrypts each
  value with AES-256-GCM and a per-file data key wrapped for every recipient. Git history of encrypted values is fine.
- Compromise of one laptop = compromise of that key. Response: `scripts/secrets.sh remove-member <key>`, commit,
  **and rotate the upstream keys** (Anthropic, LinkedIn, ElevenLabs...). Re-encrypting alone does not revoke what
  that person could already read.
- Never paste a decrypted value into the bus, a PR, a commit message, or a prompt that gets logged.
- Fly holds the live copies (`fly secrets`). Rotating a key = update the encrypted file + `push-to-host` + deploy.

## Daily use

```bash
scripts/secrets.sh init                       # once per laptop; prints your public key
scripts/bus.sh post "age pubkey age1..."      # ask to be added
scripts/secrets.sh add-member age1...         # a member runs this, commits .sops.yaml + secrets/, pushes
scripts/secrets.sh decrypt prod > .env        # local plaintext, gitignored
scripts/secrets.sh set prod ELEVENLABS_API_KEY=sk_...   # change one value, commit the .enc.env
scripts/secrets.sh edit prod                  # or edit everything in $EDITOR
scripts/secrets.sh push-to-host               # stage onto Fly (applied by the next deploy)
```

Placeholders are `CHANGE_ME`; `push-to-host` skips them so a half-filled file never blanks a live key.

Keys in the file: `PUBLIC_BASE_URL`, `ANTHROPIC_API_KEY`, `LINKEDIN_CLIENT_ID/SECRET`, `GITHUB_CLIENT_ID/SECRET`, `GOOGLE_CLIENT_ID/SECRET`,
`APPLE_CLIENT_ID` (Services ID), `APPLE_TEAM_ID`, `APPLE_KEY_ID`, `APPLE_PRIVATE_KEY` (the .p8 with newlines written as `\n`),
`ELEVENLABS_API_KEY`, `ASI_ONE_API_KEY`, `TRUEFOUNDRY_API_KEY`. Add new ones with `set`.

## Why this and not the alternatives

| Option | Verdict |
|---|---|
| **SOPS + age** (chosen) | Two Homebrew packages, no accounts, per-person keys, values encrypted individually so diffs stay reviewable, `sops updatekeys` handles membership. |
| git-crypt | Whole-file encryption, GPG keys, binary diffs, harder to revoke; no advantage here. |
| gcloud KMS / Secret Manager | Works (sops supports GCP KMS as a key backend) but every teammate needs a GCP account and IAM role today; worth it only if the project outlives the hackathon. Switching later is `sops --add-gcp-kms` + `updatekeys`. |
| Fly secrets only (no repo copy) | Fine for prod but nothing for local dev or for teammates to reproduce; keep as the live store, not the source of truth. |
| `.env` passed around in chat | No. |
