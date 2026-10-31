# The Scout: the calibration loop is the product

## 1. Why the loop is the product

Every matchmaking product predicts that two people should meet and then never finds out whether they did or whether it was any good. A haunt is a consented, timestamped, face-to-face meeting written to our own event log, so the Scout's prediction and the real outcome land in the same table within minutes. That lets the Scout be scored, corrected and re-scored inside one evening, in public, on the big screen, which is the one thing a chatbot that answers "who should I meet" cannot show a judge.

## 2. The rating interaction

Ask both people, one tap each, on the surface they are already looking at. No modal, no typing, never asked twice for the same haunt, never a push notification.

| Who | Where | Trigger |
|---|---|---|
| The haunted person | the existing `haunted` toast (`hauntedAlert` in web/common.js), made sticky for this one toast | arrives with the shriek |
| The hunter | the "You haunted X" line in web/hunt.js (line 39), one appended span | after the POST succeeds |

Copy, under the other person's name: **"Worth meeting?"** with two buttons, **Worth it** and **Not for me**, and one small text link, **Already knew them**. The third option is a data filter, not a grade: coworkers haunting each other tell us nothing about the Scout and would pollute the sample. The buttons stay until tapped or dismissed; people tap when they look back at the phone after talking, which is the moment we want. We record the delay but do not nag.

The tap pays back: it reveals the one-line reason the Scout paired you ("paired on: you want a cofounder, they shipped a CLI this week"), or "this one was not my call" for organic haunts. Withholding the reason until the rating is what keeps the rating from being the annoying part.

Every haunt gets the prompt, not only Scout pairs. Organic haunts are the control group and give the screen its baseline.

Payload, `POST /api/rating` (the one new route, mounted from server/scout.js):

```
{ raterId, token, hauntId, verdict: "yes" | "no" | "knew", source: "phone" | "asi1" }
```

Server rules: token must match the rater; the rater must be the actor or target of `hauntId`; one verdict per rater per haunt (a second POST overwrites, so a mis-tap is fixable); the verdict is written onto the existing haunt event as `meta.ratings[raterId] = {verdict, at}` rather than as a new event. The one new event type stays `match`: `{type:"match", actorId, targetId, meta:{score, features, clue, scoutVersion}}`, written before the clue is pushed over `state`, so every prediction is pre-registered against the later haunt.

Asymmetry rule, fixed up front: the screen counts ratings, not pairs. "7 of 9 ratings" is true whoever answered. A pair-level "both said yes" line appears only when both sides rated. For learning, `no` from either side is a full negative (the mutual gate was wrong), a lone `yes` is a half positive, silence is zero, `knew` drops the pair from the sample.

## 3. The screen widget

A new panel `#scout` in the right column of web/screen.html, rendered by `renderScout(s)` in web/screen.js (about ten lines). It answers one question in five seconds: are the Scout's pairs better than chance pairs?

```
THE SCOUT  v2                        changed 15:42
Scout pairs rated worth it    7 of 9    #######--
Other haunts rated worth it   5 of 11   #####-----
Clues sent 12   found 9   still hunting 3
v1 -> v2: pairs sharing only a language were worth it 2 of 5 times,
so shared_language weight 2 -> 1. Next review at 16 ratings.
small sample: a few more ratings will move these bars
```

Bars are drawn in characters so nothing new is styled. Numbers appear as "x of n" always; a percentage only once n is 10 or more.

Feed: the server computes the block once (`scoutState()` in server/scout.js) so the screen, the log and the ASI:One answer all quote identical numbers. It is included as a `scout` field in the `GET /api/events` response for first paint (one added field, not a new route) and pushed live to screen sockets as a new screen message:

```
{ type: "scout", scout: { version, changedAt, changelog: [...], predicted: {yes, no, n},
  baseline: {yes, no, n}, clues: {sent, found, pending}, nextReviewAt } }
```

sent on every rating, every clue and every version bump. web/screen.js adds one branch: `if (msg.type === 'scout') renderScout(msg.scout)`.

## 4. What the agent changes from 10 to 30 ratings, ranked by provability

Scoring is deliberately a weighted sum of a handful of named features, not an opaque prompt, because a weight table can be printed before and after and a prompt cannot be scored. The Scout runs two signals: findability (did the clue produce a haunt within 20 minutes, automatic, n = clues sent) and worth (ratings, smaller n). Findability tunes clue wording; worth tunes weights.

| Rank | Change | Rule | Why it is provable |
|---|---|---|---|
| 1 | One feature weight | after 8 rated Scout pairs, any feature that fired in 3 or more of them with a yes rate of 0.4 or less has its weight halved; one change per version | weights before and after are printed, and the same roster re-ranks differently; show the top-5 diff |
| 2 | Per-person note | a person who gave two `no` verdicts on the same feature gets `prefers: complement`; their next clue is drawn from pairs where that feature did not fire | visible per person on ASI:One try 3, but n is 2, so call it a rule, not learning |
| 3 | Clue prompt wording | if found rate is under 0.5 after 6 clues, the clue template must name one concrete artifact (a repo) instead of a category | the two clue strings and the two found rates are shown side by side; attribution is weak and we say so |
| 4 | "Take the ratings into account" in an LLM prompt | never | unfalsifiable; do not ship this |

Before and after, worked example. v1 weights: `complementary_need 3, shared_language 2, active_this_week 1, same_company -2`. Nine ratings on Scout pairs: pairs where `shared_language` fired were worth it 2 of 5 times; `complementary_need` 5 of 5. Rule 1 fires once: v2 sets `shared_language` to 1. Re-rank on the live roster: a Rust-and-Rust pair drops from first to sixth; a "wants a cofounder" x "shipped a CLI this week" pair becomes first. The changelog entry stored in data/scout-log.jsonl and shown on the screen:

```
{ from:"v1", to:"v2", at:1761950520000, rule:"weight_halve", feature:"shared_language",
  evidence:{yes:2, n:5}, before:{...}, after:{...}, rerank:[["Sam x Priya",1,6],["Sam x Lee",3,1]] }
```

For the demo only, `SCOUT_MIN_N` can be set to 4 so a bump can happen with a room of ten; the screen prints the threshold it used.

## 5. The three ASI:One tries, scripted

The agent is a thin Python uAgent (`agent/scout_agent.py`, mailbox, chat protocol) that reads `GET /api/events` for the `scout` block and the pair list, and POSTs `/api/rating` with `source: "asi1"`. It does no scoring of its own, so the chat and the screen never disagree.

| Try | You type | The agent answers |
|---|---|---|
| 1 | "Who should I meet at HAUNT? I'm @tarecq" | "Scout v1, 0 ratings so far, so this is profiles only. Of 23 findable people your best pair scores 0.71. Clue: they shipped a Rust CLI this week and want a cofounder. No name: open /hunt and find them." |
| 2 | "Met them. Not for me, we just both write Rust. Who else?" | records a `no` with `source: "asi1"`, which is the ninth rating and trips rule 1. "Noted. Scout is now v2 (changed 15:42: language-only pairs were worth it 2 of 5 times, so that weight is halved). Your best pair is different now, score 0.68: they are looking for someone who ships and you pushed 14 times this week. Your earlier match is now fourth." |
| 3 | "Why did you change your answer?" | prints the changelog entry in words: weights before and after, the 2 of 5 evidence, the re-rank, and "nine ratings is a small sample; I review again at sixteen". |

The visible change for the judges is three things at once: a different answer to the same question, the version line on /screen flipping from v1 to v2, and the logged entry with the evidence. All three come from the same `scoutState()` call.

## 6. The smallest demoable slice, under 60 minutes

| Piece | File | What |
|---|---|---|
| Scout core | server/scout.js (new, about 120 lines) | weights table, pair scoring with the mutual gate, template clues (no LLM in the slice), `match` event, clue over `state`, `POST /api/rating`, `scoutState()`, rule 1, jsonl log, `scout` broadcast |
| Mount | server/index.js | one line: `mountScout(app, { db, save, sendTo, broadcastScreen, publicCard })`; one added field `scout: scoutState()` in the `GET /api/events` handler |
| Rating, haunted side | web/common.js | `rateButtons(hauntId)` (about six lines) appended inside `hauntedAlert`, toast duration 0 for that toast; needs `hauntId` added to the `haunted` message, one field in `/api/haunt` |
| Rating, hunter side | web/hunt.js line 39 | the same `rateButtons` span after "You haunted X" |
| Widget | web/screen.html, web/screen.js | one `#scout` panel, `renderScout`, one `scout` branch in the socket handler |

Endpoints touched: reads `GET /api/gallery`, `GET /api/attendee/:id/card`, `GET /api/events`; adds `POST /api/rating`; adds the `match` event type; adds the `scout` screen message and a clue payload on `state`. The Python uAgent and Agentverse registration are the next 30 minutes and run in parallel with a human doing the mailbox setup. Order: scout.js with a unit-less smoke (`curl` a rating, watch the log), then the toast buttons, then the widget, then the bridge.

## 7. Honesty rules for the stage

Say: "the Scout's pairs were rated worth it 7 of 9 times, organic haunts 5 of 11, nine is a small sample." Say that predictions are logged before the haunt, so they cannot be back-fitted. Say which single weight changed, from what to what, and which five ratings caused it. Say the review threshold was lowered for the demo if it was.

Do not say "learned" for fewer than 8 ratings; say "adjusted one weight". Do not show percentages under n of 10. Do not claim the Scout caused the meeting: it picks active people who meet anyway, and the baseline line is there precisely so nobody has to take our word for the lift. Do not call a first-impression tap a verdict on the connection. Do not describe the agent as reasoning about faces: it never sees one, and the clue pipeline is profile and public GitHub text only. If n is 0 at demo time, the widget says "no ratings yet" and we demo the loop live with two teammates rather than quoting numbers.

## 8. Open questions

1. Rating buttons on every haunt give us the baseline, but a busy hunter might see six prompts in ten minutes. Do we cap the prompt to the first three organic haunts per person?
2. A clue followed by a haunt within 20 minutes counts as found. Lucky haunts of the right person inflate findability; is that acceptable for tonight, or should the hunter's camera card have to show the match badge first?
3. On ASI:One the person identifies themselves by typing a handle, unverified. Is a chat-sourced `no` from an unverified handle allowed to trip a version bump, or should `asi1` ratings count toward the display but not the rule?
