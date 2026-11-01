# Deploy

Host: **Fly.io** (one Node machine, WebSockets, a 1 GB volume for `data/`, HTTPS at `https://aura-haunt.fly.dev`).
Why Fly over Railway/Render: the Dockerfile and `fly.toml` already exist, Fly builds remotely (no local Docker),
WebSockets and persistent volumes work on the cheapest machine (shared-cpu-1x; see "Costs and caps"), and the
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

After the Fly job, the `base44` job deploys the Base44 mirror (below) **if** the repo secret `BASE44_TOKEN` exists.

## Base44 mirror (second URL, Base44 "Real users" challenge)

The same `web/` pages also live on Base44 hosting: **https://aura-haunt.base44.app** (Base44 app `HAUNT`, id
`6ae6701d773bec7f249e1409`, created 2026-10-31 22:47 UTC in Matt's workspace). Only the pages move. The API, the
socket, the JSON store and the OAuth apps stay on Fly, so a phone on either URL hunts and haunts phones on the other.

- **Build:** `node scripts/base44.mjs build` writes `dist/base44/`: the FaceX weights, `window.HAUNT_API` (the Fly
  URL) in every page, a router in `index.html` (Base44 answers any path that is not a file with `index.html`, so
  `/register` goes to `/register.html`), and `?v=<sha>` on every local script and stylesheet, because Base44 caches
  those for an hour.
- **Deploy:** `node scripts/base44.mjs deploy` builds, uploads a tar.gz to Base44's deploy-dist API, waits for the new
  build and runs the live checks. It needs `BASE44_TOKEN`, or your own Base44 CLI login (`npx base44 login`, once).
  Base44's CLI does the same upload: `BASE44_APP_ID=6ae6701d773bec7f249e1409 npx base44 site deploy --build -y`
  (`base44/config.jsonc`). The limits are 50 MB, 1,000 files and 5 deploys a minute per workspace.
- **Check only:** `node scripts/base44.mjs check` confirms the live pages are this build and that Fly accepts the mirror's origin.
- **Fly side:** `FRONTEND_ORIGINS` in `fly.toml` lists the origins allowed to call the API and to receive sign-in
  handoffs (`server/cors.js`). A new domain for the mirror (a custom domain on Base44) goes there first.
- **Sign-in on the mirror:** the button goes to Fly's `/auth/<provider>?return=<mirror page>`; the callback returns to
  that page with `#haunt_session=...`, and the page sends it as a header. A third-party cookie would not work, because
  iOS Safari drops them. The LinkedIn app's redirect URL is unchanged (Fly's callback).
- **CI secret, once:** in Base44, open the workspace name (bottom left), then Settings, Secrets, Personal access tokens,
  Create access token. Pick Access: one app, `HAUNT`, and Permission: Full access. Then:

```bash
gh secret set BASE44_TOKEN --repo chaltenio/aura   # paste the token
```

Nothing about faces goes to Base44: matching runs on the phone and the gallery stays on Fly. Base44 sees page views
(its analytics tag sits on `index.html`, which every pretty URL passes through).

## No account yet? Tunnel fallback

`npm start` plus `npm run tunnel` (cloudflared quick tunnel) gives a public HTTPS URL to the laptop in 10 seconds.
The URL changes on every restart and dies with the laptop, so use it for phone tests, not the demo.

## What runs where

- One machine, `PORT=3000`, `DATA_DIR=/data` (the volume). The JSON store is `/data/db.json`; delete it after the event.
- The machine stops when nobody is connected and the next visit starts it (a cold start of a second or two).
- FaceX weights are baked into the image at build time (Dockerfile), so cold starts do not download anything.
- Secrets reach the app as Fly secrets (`fly secrets list -a aura-haunt`), never as files in the image.

## Costs and caps

Fly has no spending limit, so the caps are in `fly.toml` and the server. Nothing else the app uses bills by usage.

| Service | Runs | Cap | Worst month |
|---|---|---|---|
| Fly `aura-haunt` | one shared-cpu-1x 512 MB machine in sjc, 1 GB volume | the machine stops when idle and Fly never adds machines by itself (`fly.toml`); outbound data stops at `BANDWIDTH_CAP_GB` = 10 GB a month (`server/bandwidth.js`, 503 past it until the 1st) | machine awake all month $4.41 + volume $0.15 + 10 GB of data $0.20 (North America, Europe) to $1.20 (Africa, India): **under $6** |
| Fly builds | remote builder on each deploy | Fly: "There's currently no charge for builders" | $0 |
| Base44 mirror | static copy of `web/` | billed by plan, not traffic; the mirror calls no Base44 integrations, so it uses no credits | $0 on the Free plan |
| GitHub Actions | `ci`, `deploy` | public repo, standard runners are free | $0 |
| Anthropic, ElevenLabs, ASI:One, TrueFoundry | nothing: no server code calls them and none is set on Fly | wire one only after setting a monthly limit at the provider and a per-day call cap in the server | $0 |
| LinkedIn, GitHub, Google sign-in; GitHub API | sign-in, profile lookups | free | $0 |

Fly prices used: shared-cpu-1x 512 MB in sjc ~$0.0060/hour ($4.41/month), volumes and stopped-machine root
filesystems $0.15/GB-month, data out $0.02/GB (North America, Europe), $0.04 (Asia Pacific, Oceania, South America),
$0.12 (Africa, India), inbound free, shared IPv4 and IPv6 free (docs.fly.io/about/pricing, November 2026).

**Cost so far** (2026-10-31 21:03 UTC, when the app was created, to 2026-11-01 22:00 UTC; from Fly's metrics): machine
~25 hours, $0.15; volume $0.01; data out 0.56 GB in 5,621 responses, 97% of it to North America, $0.01; builds and
IPs $0. About **$0.17**.

Check it:
- `curl -s https://aura-haunt.fly.dev/api/version | jq .bandwidth`: this month's data against the cap.
- `fly machine list -a aura-haunt`: `started` or `stopped`.
- The bill itself: fly.io/dashboard → Billing. Data out per region: fly-metrics.net (Fly's Grafana), or Fly's
  Prometheus API (`https://api.fly.io/prometheus/<org raw slug>/api/v1/query`, header `Authorization: FlyV1 <fly auth
  token>`, not `Bearer`; query `sum by (region) (increase(fly_edge_data_out{app="aura-haunt"}[30d]))`).

Change it:
- More data for a bigger event: raise `BANDWIDTH_CAP_GB` in `fly.toml` (each GB is at most $0.12) and merge.
- Always warm for a live event: `min_machines_running = 1` in `fly.toml` for the night (the machine stays up, $0.15 a
  day), back to `0` after.
- Off entirely: `fly scale count 0 -a aura-haunt` (the volume and its data stay, $0.15 a month); `fly scale count 1`
  brings it back. `fly apps destroy aura-haunt` ends every charge and deletes the data.

## MCP servers for agents (`.mcp.json`, project scope)

| Server | What it is for | Needs |
|---|---|---|
| `github` | issues, PRs, the team bus issue, Actions runs, from any Claude Code session | `GITHUB_TOKEN` (or `GITHUB_PERSONAL_ACCESS_TOKEN`) in the shell; `gh auth token` gives one |
| `fly` | app status, logs, machines, secrets from Claude Code | `fly auth login` done on that laptop |
| `playwright` | open the deployed site in a headless browser and check pages | nothing (npx) |

Claude Code asks once to trust the project's `.mcp.json`; say yes. `claude mcp list` shows health.
