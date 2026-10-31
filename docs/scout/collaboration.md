# The Scout: scoring pairs for collaboration fit

Extends IDEAS.md 2b. Reads only `GET /api/gallery`, `GET /api/attendee/:id/card`, `GET /api/events`. Adds one route and one event type. Faces never enter any of this.

## 1. What collaboration fit means here

Two people fit when one brings a capability the other's current project is missing, and what each says they want tonight is compatible (cofounder meets cofounder, learner meets mentor, not hirer meets hirer). Similarity is a weak signal: the same stack gives you someone to pair with, a complementary stack gives you someone to ship with, so we score adjacency over identity and keep one shared language as common ground. A big skill gap is a bad match unless one side opted into teaching, in which case it is one of the best matches in the room.

## 2. Scoring model

Features computable today, from the card alone (`publicCard` in `server/index.js`, enrichment in `server/profile.js`):

| Feature | Source | What it tells you | What it cannot tell you |
|---|---|---|---|
| Role buckets | `profile.recentRepos[].language` (5 repos) plus keywords in `blurb` | front (TS, JS, CSS, Svelte), back (Go, Rust, Java, Python, Ruby), ml (Jupyter, Python with model/llm/agent/eval words), systems (C, C++, Zig, Swift) | Python alone is ambiguous; CSV-enrolled people with no handle have no buckets |
| Level | `followers`, max `recentRepos[].stars`, `pushesThisWeek` | rough seniority band 0 to 4 on a log scale | followers reward writing, not building; new accounts look junior |
| Freshness | `pushesThisWeek`, `activeRepos`, `lastPush` | who is shipping right now (the best predictor of someone who will build this week) | private work is invisible |
| Intent | the new field below; today only `blurb` | what they want from the night | the blurb says what they build, not what they need |
| Already met | `haunt` events between the two ids | skip pairs the night already connected | nothing about quality of the meeting |

Not available and not worth adding today: repo topics (`profile.js` fetches the repos list but drops `topics`; a one-field addition `topics: r.topics || []` in the `recentRepos` map would unlock them, optional), org membership, LinkedIn titles (the URL is stored, nothing is fetched).

The one extra field: `lookingFor`, optional select, values `cofounder | collaborator | hiring | job | learn | mentor | curious`. Why this one: stacks say what people can do; this says what they want, and the intent table is the only feature that makes hirer/seeker and learner/mentor pairs scorable at all. "What are you building" already exists as `blurb`. Where it lives: `attendees[].lookingFor` in `data/db.json`; one line each in `POST /api/attendee` (destructure plus whitelist to the seven values), `PATCH /api/attendee/:id`, `publicCard`; one `<select id="lookingFor">` under the blurb in `web/register.html`; one entry in the body object in `web/register.js`. Missing value is treated as `curious`.

Complementarity score, directional (what b brings a), then gated mutually:

```
buckets(x) = role buckets from languages + blurb keywords        level(x)   = clamp(log10(followers+1) + log10(maxStars+1)/2 + min(pushes,10)/10, 0, 4)
intent(x)  = lookingFor || 'curious'                              pushes(x)  = profile.pushesThisWeek || 0
ADJ: front-back 1.0, back-ml 0.8, systems-back 0.7, front-ml 0.6, same bucket 0.35, no buckets on either side 0.5
INTENT (symmetric): cofounder-cofounder 1.0, collaborator-collaborator 0.9, hiring-job 1.0, learn-mentor 1.0,
        collaborator-cofounder 0.7, curious-anything 0.5, learn-learn 0.4, hiring-hiring 0.1, job-job 0.1, mentor-mentor 0.2

score(a, b):                                   # how much b is worth to a
  stack  = max ADJ[x][y] for x in buckets(a), y in buckets(b)
  brings = 1 if buckets(b) - buckets(a) is non-empty else 0.3     # the directional part: b has something a lacks
  common = 1 if a and b share a language else 0
  fit    = INTENT[intent(a)][intent(b)]
  fresh  = min(1, (pushes(a) + pushes(b)) / 10)
  gap    = |level(a) - level(b)|
  gapTerm = gap <= 1.5 ? 1 : ({learn, mentor} meets {intent(a), intent(b)} ? 1.1 : 0.4)
  met    = 0.3 if a haunt exists between a and b else 1
  return (W.stack*stack*brings + W.common*common + W.intent*fit + W.fresh*fresh) * gapTerm * met
W = { stack: 0.40, common: 0.10, intent: 0.35, fresh: 0.15 }      # the weights the ratings move, section 6

pair value = min(score(a, b), score(b, a)); surface only when value >= 0.5 and each is in the other's top 3 (mutual gate).
Round = greedy maximum matching on pair value over consenting attendees without a live match, at most one match per person.
```

## 3. Clue and talking points

One Messages API call per surfaced pair, `model: 'claude-opus-5-5'`, `@anthropic-ai/sdk` from Node (the repo is ESM JS). Omit `thinking` (adaptive is the default and cannot be disabled on this model), `output_config: { effort: 'low', format: <JSON schema> }`, `max_tokens: 1000`, `betas: ['server-side-fallback-2026-07-01'], fallbacks: 'default'` so a refusal does not stall a round. No prefill (rejected on this model). Structured output schema: `{ clueForA, clueForB, talkingPoints: [string, string], why }`, `additionalProperties: false`.

System prompt (stable, cached with `cache_control` on the system block; the pair goes in the user turn):

```
You are the Scout at HAUNT, a hackathon networking game. You receive two attendee profiles (name, handle, blurb,
public GitHub summary, lookingFor) and the computed features (complement bucket, shared language, intent pair, level gap).
Write for each person a clue that describes the OTHER person so they can find them with a camera. Rules:
1. Never include a name, handle, company, employer, exact city or anything that identifies the person. Describe what they do.
2. The clue must name the complement: say what the other person has that this person is missing, from the features.
3. Only state facts present in the input. Never invent repos, counts or roles.
4. Under 140 characters per clue. Two talking points, each one sentence, each usable by both people once they meet.
Return only the JSON object.
```

User turn: `{ a: cardA, b: cardB, features: { complementAtoB, complementBtoA, sharedLanguage, intents, gap, fresh } }` with `avatar` stripped (never send image bytes, even though avatars are not faces for the model's purposes; keep the rule simple: profiles and events only). Fallback if the call fails: a template clue, `Your match has the ${bucket} you are missing and pushed ${n} times this week.`

Worked example 1 (complement, cofounders). Priya: blurb "Rust CLI that diffs Terraform plans, needs a UI for the output", repos Rust/Go/Rust, 11 pushes, 90 followers, `cofounder`. Marco: blurb "React dashboards for devtools, poking at agents", repos TypeScript/TypeScript/CSS, 6 pushes, 40 followers, `cofounder`. Features: stack front-back 1.0, brings 1 both ways, no shared language, intent 1.0, gap 0.3, fresh 1.0; score 0.90 each way, surfaced.
Clue for Marco: "Pushed Rust eleven times this week and wants a cofounder who can turn a terminal tool into a product. They are the backend you are missing." Clue for Priya: "Builds React dashboards for devtools and wants a cofounder with a backend worth a dashboard. They are the UI your CLI is missing." Talking points: "Ask what the Terraform diff output looks like today; that is exactly what a dashboard needs." "Both of you pushed this week; name one thing you could demo together by Monday."

Worked example 2 (same stack, teach and learn). Dana: blurb "Learning to fine-tune small models, one notebook so far", repos Jupyter/Python, 2 pushes, 5 followers, `learn`. Wei: blurb "Eval harness for LLM agents at work, happy to pair", repos Python/Python/Shell, 400 stars, 900 followers, 8 pushes, `mentor`. Features: stack ml-ml 0.35, brings 0.3 for Dana to Wei, shared language Python, intent learn-mentor 1.0, gap 2.4 so gapTerm 1.1, fresh 1.0; scores 0.76 and 0.70, surfaced. Without the intent field this pair scores 0.33 and is never shown: that is the argument for the field.
Clue for Dana: "Already shipped the eval harness your notebook is missing, and said they would teach tonight." Clue for Wei: "Two weeks into fine-tuning small models and asked to learn; they are the student you offered to take." Talking points: "Ask which model and dataset; the mentor can say in two minutes whether the evals will show progress." "Agree on one metric to report back before the night ends."

## 4. Trios: park them

Park. The hunt mechanic is one face unlocking one card and "first to find wins"; a trio needs two finds and the round loses its ending. The mutual gate becomes three pairwise gates and the rating becomes six directional answers, so the calibration data gets three times sparser from the same room on the one night we have to collect it. Trios fall out of pairs for free: after A and B both answer yes, the next round can hand A and B the same target C whose complement neither has. Record `meta.round` on every `match` event now so that chaining is a later feature with no schema change.

## 5. Smallest demoable slice, under 60 minutes

| Minutes | Work | Files and endpoints |
|---|---|---|
| 0 to 20 | `scoreRoom()` with the formula above, template clues, greedy matching, write `match` events, push the clue | new `server/scout.js`; one line in `server/index.js`: `mountScout(app, { db, save, sendTo, broadcastScreen })`; in-process reads of the same data `GET /api/gallery`, `/api/attendee/:id/card`, `/api/events` expose |
| 20 to 35 | Claude clue and talking points with structured output, template fallback | `server/scout.js` only; `ANTHROPIC_API_KEY` in env, `NO_SCOUT_LLM=1` to skip |
| 35 to 50 | Clue banner, found banner with talking points, rating buttons | new `web/scout.js`; one `<script>` tag in `web/hunt.html` and `web/me.html`; one branch each in `web/hunt.js:14` and `web/me.js:21`: `if (msg.type === 'state' && msg.scout) scoutState(msg.scout)` |
| 50 to 60 | "Scout: predicted vs actual" line on the big screen | `web/screen.js` reads `match` events from `GET /api/events` it already fetches |

Round trigger: a round runs when at least two consenting attendees have no live match and 60 s have passed since the last round (no organizer button needed; restart the server to force one during the demo). Confirmation: `scout.js` watches `db.events` every 2 s for a `haunt` in either direction between a matched pair, then sets `meta.confirmedAt`, sends both phones `{ type: 'state', scout: { phase: 'found', matchId, talkingPoints } }` and tells the screen. No change to `POST /api/haunt`.

The one route: `POST /api/rating` `{ id, token, matchId, wouldBuild: 'yes' | 'maybe' | 'no' }`, stored as `meta.ratings[raterId]` on the `match` event (ratings are not a second event type). The one event type: `match`, `{ type: 'match', actorId: a, targetId: b, meta: { round, score, features, clueA, clueB, talkingPoints, weights, confirmedAt, ratings } }`. `state` payloads: `{ scout: { phase: 'clue', round, clue } }` and the `found` one above. Slice 1 skips the match-aware glow on the hunt card so the client never learns the target id before the haunt.

## 6. The rating question and the one visible change

Ask one question on both phones right after the confirmed haunt: "Would you build something with them?" with Yes / Maybe / No (1, 0.5, 0). This asks about collaboration, not whether the chat was pleasant, so it scores exactly what the formula predicted. Pair outcome is the mean of the two answers; the screen shows "Scout: 4 of 6 pairs would build together" and the predicted value next to the actual.

The one change from feedback, applied between round 1 and round 2 and announced on the screen: group round 1 pairs by their dominant term (stack complement or intent fit) and compare mean outcomes. If intent-led pairs outscored stack-led pairs, move 0.10 from `W.stack` to `W.intent`, and the reverse otherwise; clamp each weight to [0.10, 0.60]. Write the new weights into `meta.weights` of every round 2 match, so the screen can say "Round 2: the Scout now trusts stated intent more than stacks (0.35 to 0.45)". Second-order and optional: feed the rated round 1 clues into the user turn of round 2 as "clues that led to yes / no" so the writing adapts too.

## 7. Open questions

1. A room enrolled from CSV with no GitHub handles has no buckets, so the score collapses to intent plus blurb keywords. Is that enough, or should one batched Claude call per round extract buckets from blurbs before scoring?
2. Both people rate on their phones while standing together, which inflates Yes. Accept the inflation tonight, or re-ask on `/me` ten minutes later and keep the later answer?
3. The hunt-card glow needs the client to know the target id before the haunt (visible in devtools). Ship without it, or send a salted hash the client compares against gallery ids?
