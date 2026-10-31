# The Scout: the plan (reconciled from three explorations)

Written 2026-10-31 15:05 PT by tarecq from `missed-connections.md`, `collaboration.md` and `calibration.md` in this folder. Those three are the reasoning; this file is what we build. Extends IDEAS.md 2b. Fetch.ai track.

One sentence: the Scout pairs people who could build together and would otherwise never meet, sends each a clue instead of a name, the camera finds them, the haunt confirms it, and one tap afterwards scores the Scout in public.

## 1. What the three explorations agreed on

- One new server module, `server/scout.js`, mounted by one line in `server/index.js`. It reads `GET /api/events` (cards plus the log) and nothing else from the core.
- One new route, `POST /api/rating`. One new event type, `match`, written before the clue goes out so every prediction is pre-registered.
- The clue travels on the reserved `state` WebSocket message, which is sent nowhere today and ignored by both phone pages, so the phone side is a one-line branch each in `web/hunt.js` and `web/me.js` plus a small shared helper.
- No pre-haunt "your match" badge and no warmer or colder. The clue would have to carry the target id and `/api/gallery` maps ids to names, so the name would leak to anyone reading the socket. The Scout confirms a match by watching the event log for a haunt between the pair.
- Template clues first, Claude second. Faces, avatars and descriptors never enter the pipeline; clues are built from profile text, public GitHub and events only.
- Scoring is a named weight table, not a prompt, so the change from feedback can be printed before and after.

## 2. The three decisions

**Rating question.** The docs proposed three different questions. We ask one, on every haunt (Scout pairs and organic alike, so the screen has a baseline): under the other person's name, **"Would you build something with them?"** with **Yes** and **No**, and a small link **Already knew them**. "Build with" is what the collaboration score predicts, so the answer scores the prediction. "Already knew them" filters coworkers out of the sample and doubles as the "would have met anyway" signal for the missed-connection term. The buttons live on the existing `haunted` toast and on the "You haunted X" line in hunt; the tap reveals why the Scout paired you, or "this one was not my call". Payload: `POST /api/rating { raterId, token, hauntId, verdict: yes|no|knew, source: phone|asi1 }`, stored on the haunt event as `meta.ratings[raterId]`.

**Priority formula.** Collaboration fit decides who should meet; the missed-connection term decides who gets the scarce clue budget.

```
fit(a,b)    = min(score(a->b), score(b->a))            # collaboration.md section 2, weights W
pOrganic    = 0.10 + 0.40*sharedNeighbour + 0.30*active + 0.20*coHaunt   # missed-connections.md section 3
urgency     = 1 + (minsLeft < 30 ? 1 : 0)              # presence term added only if lastSeenAt lands
priority    = fit^2 * (1 - pOrganic) * urgency
gate: fit >= 0.5, each in the other's top 3, pair never fired before, one open clue per person
budget per 60 s sweep: 2 clues if more than 60 min left, 4 if more than 30, else 8
```

**The change from feedback.** One deterministic rule, one weight per version, logged with evidence: after 8 rated Scout pairs (`SCOUT_MIN_N`, lowered to 4 for a ten-person demo and printed on the screen), any feature that fired in 3 or more rated pairs with a yes rate of 0.4 or less has its weight halved. Before and after weights plus the top-5 re-rank diff go to `data/scout-log.jsonl` and the screen. This subsumes the simpler "shift 0.10 between stack and intent" proposal.

## 3. Build order

| Slice | Minutes | What lands | Files |
|---|---|---|---|
| 1 | 0 to 60 | `scout.js`: weight table, directional score, mutual gate, pOrganic, template clues, 60 s sweep, `match` events, clue over `state`, found detection, `POST /api/rating`, `scoutState()`, rule 1, jsonl log. Phone: `scoutNudge` toast with clue and deadline, found shriek, rating buttons. Screen: `#scout` panel with two "x of n" bars, clues sent / found, version line. | new `server/scout.js`, new `web/scout.js`; one line each in `server/index.js`, `web/hunt.js`, `web/me.js`, `web/screen.js`; one panel in `web/screen.html` |
| 2 | 60 to 90 | Claude clues and two talking points: one structured-output call per pair to `claude-opus-5-5`, system prompt in `collaboration.md` section 3, template fallback, `NO_SCOUT_LLM=1` to skip. Last Call: at 17:30 and 17:50 fire the top unmet pairs with a deadline and a screen banner. | `server/scout.js` only |
| 3 | parallel, human + 30 min | Agentverse registration with mailbox (human, start now). Thin Python uAgent `agent/scout_agent.py` that reads `scoutState()` and the pair list from `GET /api/events` and POSTs ratings with `source: asi1`. Scripted tries in `calibration.md` section 5: who should I meet, met them and no, why did you change. | new `agent/` |
| 4 | if time | `lookingFor` select on register (`cofounder, collaborator, hiring, job, learn, mentor, curious`), the one field that makes learn/mentor and hiring/job pairs scorable. Wallflower rescue (degree 0 after 15 min gets paired with an active hunter). | register files, ask the owner first |

## 4. What we need from other people's files

Each is one or two lines; ask on the bus before touching.

- `server/index.js`: the mount line; `hauntId` added to the `haunted` message and to the `/api/haunt` response (needed to rate the right haunt); optional `scout: scoutState()` field in `GET /api/events` for first paint.
- `server/index.js`, optional: `lastSeenAt` and `online` in `publicCard` from the sockets map, two lines, unlocks the presence term in urgency.
- `web/register.html` and `web/register.js`, slice 4 only: the `lookingFor` select and one body field.
- ARCHITECTURE.md: it lists `GET /api/attendee/:id/card` but the server serves `GET /api/attendee/:id`; `GET /api/version` is also missing. Someone should fix the doc.

## 5. Honesty rules for the stage

Always "x of n", never a percentage under n of 10, never the word "learned" under 8 ratings (say "adjusted one weight"). Always show the organic baseline next to the Scout's bar. Say that predictions were logged before the haunt. Say the review threshold was lowered for the demo if it was. Never claim the Scout caused a meeting; the baseline is there so nobody has to take our word for the lift. If n is 0 at demo time the panel says "no ratings yet" and we run the loop live with two teammates.

## 6. Parked, with the un-park condition

Pre-haunt match badge and warmer/colder (salted target hash); trios (chained rounds, `meta.round` is recorded now so no schema change later); departure prediction (needs `lastSeenAt`); zone hints (needs sigils); graph drawing on the screen; double points for match haunts (needs the scoreboard to read `match` events); "stuff the ratings into a prompt" (never, unfalsifiable).

## 7. Open questions still open

1. Cap the rating prompt at the first three organic haunts per person so a busy hunter is not asked six times in ten minutes? Default: yes, cap at three.
2. Do unverified ASI:One ratings count toward the weight rule or only toward the display? Default: display only.
3. Clue to both sides or hunter only? Default: both for Last Call, hunter only for wallflowers.
