# Deploy

Host: **Fly.io** (one Node machine, WebSockets, a 1 GB volume for `data/`, HTTPS at `https://aura-haunt.fly.dev`).
Why Fly over Railway/Render: the Dockerfile and `fly.toml` already exist, Fly builds remotely (no local Docker),
WebSockets and persistent volumes work on the cheapest machine (shared-cpu-1x, about $2 to 3 a month), and the
whole deploy is one CLI command. Railway is the fallback (needs a card too; `railway up`). Render's free tier
sleeps and has no disk, so it is out for a live event.

## 5-minute path (first time on a laptop)

```bash
brew install flyctl sops age            # once
fly auth login                          # in Claude Code type:  ! fly auth login
scripts/secrets.sh init                 # prints your age public key; post it on the bus
#   someone who already has access runs: scripts/secrets.sh add-member <your key> && git commit && push
scripts/secrets.sh decrypt prod > .env  # optional, .env is gitignored
scripts/deploy.sh                       # creates app + volume, stages secrets, deploys, smoke-checks /api/gallery
```

Then: `scripts/deploy.sh logs`, `scripts/deploy.sh status`, `scripts/deploy.sh rollback`.

If `aura-haunt` is taken on Fly, set `FLY_APP=<other-name>` or change `app` in `fly.toml`; `PUBLIC_BASE_URL`
in the secrets must match the final URL (OAuth callbacks use it).

## CI/CD (GitHub Actions)

- `ci.yml`: every push and PR runs `npm ci`, `node --check server/*.js`, `npm test` (the API smoke test).
- `deploy.yml`: every push to `main` deploys to Fly **if** the repo secret `FLY_API_TOKEN` exists. Create it once:

```bash
fly tokens create deploy -a aura-haunt -x 999h    # prints FlyV1 ...
gh secret set FLY_API_TOKEN --repo chaltenio/aura # paste the token
```

Without the secret the deploy job prints a notice and passes, so CI stays green for forks and teammates.

## No account yet? Tunnel fallback

`npm start` plus `npm run tunnel` (cloudflared quick tunnel) gives a public HTTPS URL to the laptop in 10 seconds.
The URL changes on every restart and dies with the laptop, so use it for phone tests, not the demo.

## What runs where

- One machine, `PORT=3000`, `DATA_DIR=/data` (the volume). The JSON store is `/data/db.json`; delete it after the event.
- FaceX weights are baked into the image at build time (Dockerfile), so cold starts do not download anything.
- Secrets reach the app as Fly secrets (`fly secrets list -a aura-haunt`), never as files in the image.

## MCP servers for agents (`.mcp.json`, project scope)

| Server | What it is for | Needs |
|---|---|---|
| `github` | issues, PRs, the team bus issue, Actions runs, from any Claude Code session | `GITHUB_TOKEN` (or `GITHUB_PERSONAL_ACCESS_TOKEN`) in the shell; `gh auth token` gives one |
| `fly` | app status, logs, machines, secrets from Claude Code | `fly auth login` done on that laptop |
| `playwright` | open the deployed site in a headless browser and check pages | nothing (npx) |

Claude Code asks once to trust the project's `.mcp.json`; say yes. `claude mcp list` shows health.
