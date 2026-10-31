# HAUNT

A Halloween conference game for the Stranger Builds hackathon (2026-10-31).

**Core:** attendees pre-register by linking an account (LinkedIn or GitHub) and
taking a selfie, with explicit consent to be found. Any phone in the room can then
open a web page, point its camera at a person, and recognize them against the
opt-in set. Finding someone "haunts" them: their phone shrieks and flashes, and
both people get each other's profile.

No app install. One URL, works in iOS Safari and Android Chrome.

## Run it

```
npm install
npm start            # http://localhost:3000  (needs HTTPS on phones: use the tunnel or Fly)
npm run tunnel       # prints a public https://*.trycloudflare.com URL for phones
npm test             # API smoke test
scripts/deploy.sh    # Fly.io (see docs/DEPLOY.md)
```

Live: https://aura-haunt.fly.dev. The same pages are mirrored on Base44 at https://aura-haunt.base44.app; they call
the Fly API and socket, so phones on either URL are in one room (`node scripts/base44.mjs deploy`, docs/DEPLOY.md).

Pages: `/register` (LinkedIn photo or 3 selfies, + consent), `/hunt` (camera -> card -> haunt), `/me` (your card, kill switch),
`/screen` (big screen), `/enroll` (organizer: CSV + photos), `/calibrate` (threshold tuning).
Optional sign-in appears when `GITHUB_CLIENT_ID/SECRET` or `LINKEDIN_CLIENT_ID/SECRET` are set (see docs/SECRETS.md).

## Docs

- [ARCHITECTURE.md](ARCHITECTURE.md): the core "recognize faces in a space" feature.
- [RESEARCH.md](RESEARCH.md): open-source prior art and sponsor-track notes.
- [EDGE_CASES.md](EDGE_CASES.md): where the coding agents sweated (Shelled AI track).
- [docs/DEMO.md](docs/DEMO.md): 2-minute demo script, pitch, numbers.
- [docs/SHELLED_RUNS.md](docs/SHELLED_RUNS.md): prompts for the Shelled runs.
- [docs/DEPLOY.md](docs/DEPLOY.md), [docs/SECRETS.md](docs/SECRETS.md), [docs/TEAMWORK.md](docs/TEAMWORK.md), [IDEAS.md](IDEAS.md).

## Layers (build in this order)

1. Register + consent + face embedding (core)
2. Hunt view: camera -> match -> profile card
3. Haunt event: sound + flash on the target's phone, connection saved
4. Roles, leaderboard, big screen
5. Set dressing: room scan on the big screen, sigil posters (QR/NFC zones)
6. Stretch: chirp throw (data over sound), matchmaker agent, treat stations

## Tracks this build targets

Rules (https://strangerbuilds.com/rules): max 2 challenges per project, one prize.

- Shelled AI "Make coding agents sweat": built via Shelled runs, 2+ PRs (run link in each), EDGE_CASES.md
- Second track, pick one: Fetch.ai "Get your agent hired" (matchmaker agent on Agentverse, 3 tries via ASI:One) or TrueForge "Build a self-improving agent" (Demogorgon photo-to-zone localizer, run 2 beats run 1)
- Stranger Builds community cup (free)

Hard constraint: no face ever goes to a hosted LLM (Anthropic policy). Face ID is on-device only.
