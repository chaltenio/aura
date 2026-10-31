# The Scout: missed-connection avoidance

Extends IDEAS.md 2b. Written 2026-10-31 14:50 against `server/index.js` as it is on main (events are only `haunt`; `state` is reserved and unsent; `/api/events` returns every consenting card plus the log).

## 1. The problem

At a 3-hour event the value sits in a few pairs who should meet and do not, and nobody notices because a missed connection leaves no trace: no complaint, no metric, no product. HAUNT is the rare system that sees both halves, the profiles that say who should meet and the haunt log that says who actually did. The Scout's job is to find pairs where fit is high and the chance of organic contact is low, and spend its small clue budget there before one of the two walks out.

## 2. Three mechanics, ranked by payoff for today

Signals we actually have: the haunt graph (who met whom, when), per-person degree (`huntCount`, `hauntedCount`), registration order (array order in `/api/events.attendees`), co-haunts (two people who haunted the same third person within 10 minutes are in the same corner), the clock (event ends 18:00), and, if a 2-line presence addition lands, whether a phone's socket is open. Zone events do not exist and are not needed for any of this.

| Rank | Mechanic | Data it needs | Message it sends | Demo moment |
|---|---|---|---|---|
| 1 | **Last Call.** At T-30 and T-10 the Scout fires clues to both sides of the top unmet pairs, with a deadline. | events, cards, clock | `state {scout:{kind:'clue', clue, deadline, round:'lastcall'}}` to both phones; `state {scout:{kind:'lastcall', open:n, deadline}}` to screens | `/screen` flips to "Last Call: 6 pairs have not found each other. 10 minutes." Phones buzz together; someone finds their match before the timer ends and both shriek. |
| 2 | **Wallflower rescue.** Every 5 min, anyone with degree 0 after 15 min in the room is paired with their best-fit active hunter. Only the hunter gets a clue; the wallflower is told to stay findable. | events (degree), registration order, presence if available | hunter: `state {scout:{kind:'clue', clue, reason:'wallflower'}}`; wallflower: `state {scout:{kind:'hunted', text:'Someone has your scent. Stay findable.'}}` | The person who registered 20 minutes ago and talked to nobody gets haunted, and the hunter's card reads "The Scout sent you". |
| 3 | **Bridge pairs.** Score pairs across haunt-graph islands higher; clue carries a direction hint when co-haunts place them in different corners. | events only | same `clue` payload with `hint:'far side of the room'` | Screen line "Two camps have not crossed" that turns into "Bridged" when the haunt lands. |

Last Call ranks first because it is time-triggered, needs no presence data, and lands exactly in the demo window (17:30 to 18:00). Wallflower rescue is the literal missed connection and is second only because it needs 15 minutes of event history to say anything. Bridge pairs are a scoring tweak plus one screen line; take them if the first two are done by 16:30.

Game, not ping. Every clue is a riddle in the Halloween voice ("A ghost in this room shipped a Rust CLI this week and wants a cofounder. Find them before 17:50."), carries a deadline, and the find is public: both phones shriek, `/screen` says "Two found each other". The passive side feels hunted rather than notified. One open clue per person at a time, pairs are never re-fired, 10 minute per-person cooldown after a clue expires, and a clue is never sent to a phone with no open socket when presence is known.

## 3. The scoring change

`fit` is the Scout's existing mutual complementarity score in [0,1] (slice 1). Everything else below is new and comes only from `/api/events`.

```
for each unordered pair (a,b), both consenting, not met(a,b):
  fit      = min(fit(a->b), fit(b->a));  if fit < 0.5: skip     # mutual gate stays
  hops     = hauntGraphDistance(a,b)                               # Infinity = different islands
  shared   = hops == 2 ? 1 : 0                                     # a friend in common will introduce them
  active   = min(1, (deg(a) + deg(b)) / 6)                         # two busy hunters may collide anyway
  nearby   = coHaunt(a,b, 10min) ? 1 : 0                           # haunted the same person recently
  pOrganic = clamp(0.10 + 0.40*shared + 0.30*active + 0.20*nearby, 0, 0.95)
  dark     = max(minsSinceSeen(a), minsSinceSeen(b)) / 20          # 0 without presence data
  minsLeft = eventEnd - now
  urgency  = 1 + min(1, dark) + (minsLeft < 30 ? 1 : 0)
  reach    = (online(a) || online(b)) ? 1 : 0.1                    # 1 when presence is unknown
  score    = reach * fit^2 * (1 - pOrganic) * urgency
budget per 5-minute sweep = minsLeft > 60 ? 2 : minsLeft > 30 ? 4 : 8 clues, highest score first,
one open clue per person, never the same pair twice.
```

`fit` is squared so unlikelihood cannot promote a mediocre pair. `pOrganic` is the number the post-haunt question calibrates (section 6).

## 4. Smallest demoable slice (under 60 minutes)

In-process, template clues, confirm on haunt. No LLM, no Agentverse, no presence needed.

| Min | File | Change |
|---|---|---|
| 0-20 | `server/scout.js` (new) | `mountScout(app, {sendTo, broadcastScreen, db, save})`. Every 60 s: `fetch(localhost/api/events?limit=500)`, build the haunt graph, score pairs with section 3 (crude fit if slice 1 is not landed: +0.3 shared language, +0.2 complementary primary language, +0.3 blurb of one mentions a word in the other's blurb or repo descriptions, +0.2 both have blurbs), fire clues within budget, write a `match` event `{type:'match', actorId:hunter, targetId:ghost, meta:{clue, reason, status:'open', deadline}}`. On each sweep, any `haunt` between an open pair sets `meta.status='found'`, `meta.foundAt`, and sends `state {scout:{kind:'found'}}` to both plus `event` to screens. Clock: `SCOUT_END_AT` env, default 18:00 today. |
| 20-30 | `server/scout.js` | Clue template from card fields only: primary language, one active repo short name (dropped if it contains the handle or name), blurb snippet, company or location. Never name, handle, avatar, LinkedIn. |
| 30-45 | `web/common.js` (new export `scoutNudge(msg)`), `web/hunt.js` and `web/me.js` (one line each: `if (msg.type === 'state' && msg.scout) scoutNudge(msg.scout);`) | Toast with the clue and a deadline, vibrate, and on `found` a shriek plus "You found your match". |
| 45-55 | `web/screen.js`, `web/screen.html` | Counter "Missed connections prevented: N" (section 6) and the Last Call banner on `state`. |
| 55-60 | `server/index.js` | One named line: `mountScout(app, { sendTo, broadcastScreen, db, save });`. `npm test` stays green because nothing existing changes shape. |

Endpoints: reads `GET /api/events` only; the planned `POST /api/rating` is the one new route (section 6); `match` is the one new event type; `state` carries the clue. The server already shrieks the target on a haunt, so the found moment needs no new sound.

## 5. Cut and park

| Item | Why | Un-park when |
|---|---|---|
| "Your match" badge before the haunt | The clue would have to carry the target id, and `/api/gallery` maps ids to names, so the name leaks to anyone reading the socket | Hashed target key with a per-round salt, after the demo |
| Warmer / colder ranking of the room | Needs the same leak, plus camera-side changes in `web/hunt.js` | Same as above |
| Departure prediction | Needs socket open/close timestamps in `publicCard` (2 lines in `server/index.js`, owned by someone else); urgency falls back to the event clock | Main session agrees to the `lastSeenAt` field |
| Zone or sigil "different corners" | No `zone` events exist; co-haunts are a good enough proxy tonight | Sigils (TODO #14) land |
| Claude-written clues | Template first; same fields, swap the function later | Slice is demoable |
| Graph drawing on `/screen` | A line of text says "two camps have not crossed" well enough | Spare hour |
| Double points for match haunts | Leaderboard would have to read `match` events | Roles / scoreboard (TODO #11) |

## 6. How to measure it

One number for the screen: **Missed connections prevented** = count of `match` events with `status:'found'` whose `pOrganic` at fire time was below 0.4 (store it in `meta`). Small print next to it: "of M clues sent". Honest by construction: a pair that already shared a friend or was already in the same corner does not count even if the clue worked.

One question for the post-haunt rating (both sides, `POST /api/rating {matchId, answer}`), three buttons: **"Would have met anyway" / "Glad the Scout did it" / "Not for me"**. Each answer feeds a different term: the first raises `pOrganic` weights for that pattern (shared neighbour, co-haunt), the third marks `fit` wrong for that pair, the second is a confirmed prevented miss and the number the pitch quotes. This is the "one change from feedback" the Fetch.ai track asks for, with the change made to the weights in section 3, not to a prompt.

## 7. Open questions

1. In-process `scout.js` mounted by one line in `index.js`, or an Agentverse agent polling the Fly URL? Today: in-process; the uAgent answers ASI:One and calls the same scorer later.
2. Will the main session accept `lastSeenAt` and `online` in `publicCard` (socket open/close, 2 lines)? Without it, urgency is the event clock only, which is enough for Last Call but not for catching one person leaving early.
3. Clue to both sides or hunter only? Both doubles the chance of a find and halves the budget; two people hunting each other across the room is good on stage and confusing in practice. Default: both for Last Call, hunter only for wallflowers.
