# Shelled runs: what to ask for, in order

The Shelled AI track ("Make coding agents sweat") needs **>= 2 PRs produced by Shelled
runs on this repo, >= 1 merged, plus EDGE_CASES.md**. Nothing so far was built by
Shelled, so these runs are the track. Rules: each PR description must link the Shelled
run behind it; every place the agents guessed wrong becomes an EDGE_CASES.md entry.

Setup (once, needs a human): sign in at https://app.shelled.ai, connect GitHub repo
`chaltenio/aura`, start a run with one of the prompts below. Shelled works on its own
branch and opens a PR; review it with `/merge` like any other branch.

Pick features that agents **cannot verify from text**: camera, audio, timing, phones.
Each prompt is self-contained and names the files to read first.

---

## Run 1: Narrator on the big screen (recommended first; hits audio + LLM + timing)

```
Read README.md, ARCHITECTURE.md, server/index.js, web/screen.html, web/screen.js, web/common.js.

Add a spooky narrator to the big screen (/screen).

Server: every 30 seconds, if new haunt events arrived since the last narration, call the
Anthropic Messages API (model claude-opus-5-5, API key from process.env.ANTHROPIC_API_KEY,
skip silently if unset) with the last 10 events (actor name, target name, time) and a system
prompt that makes it a Halloween game-master; ask for at most two sentences, under 160
characters, no emojis, mentioning at least one name. Broadcast the text to screen sockets as
{ type: 'narration', text, at }. Keep a rolling "lore" of the last 5 narrations in memory and
pass it in the prompt so it does not repeat itself. Never send attendee photos or
descriptors to the API, only names and times.

Screen: show the newest narration in a large banner that fades in, speak it with the Web
Speech API (speechSynthesis, pick a low-pitch English voice if available, rate 0.9), and
keep the last 3 in a small list. Add a mute toggle that persists in localStorage.

Tests: add a unit test for the prompt builder (pure function) to test/narrator.test.mjs run
by `npm test` (extend the existing test script to run both files). Do not change the face
engine, register, hunt or me pages.
```

Expect agents to struggle with: Web Speech voices (none in headless), the 30 s loop
in tests, knowing whether narration "sounds spooky", the no-descriptors rule.

## Run 2: Sigil zones (QR posters) and "last seen near"

```
Read README.md, ARCHITECTURE.md, server/index.js, web/common.js, web/app.css, web/screen.js, web/hunt.js.

Add physical zones. Server: a ZONES list in server/zones.js (id, name, emoji), e.g. kitchen,
stage, window, door, bar, with GET /api/zones. A page /sigil/:id (web/sigil.html + sigil.js,
served for any id) that shows the zone name and a big "I'm here" button; tapping it POSTs
/api/zone { attendeeId, token, zoneId } which writes an event { type: 'zone' } and
broadcasts { type: 'zone', attendee, zone } to screen sockets. If the phone has no attendee
in localStorage, show a "Register first" link that returns to the sigil after registering.

A print page /sigils (web/sigils.html) that renders one poster per zone: zone name, a QR
code (qrcode-generator is already loaded on index.html, reuse the same CDN script) pointing
at `${location.origin}/sigil/${id}`, spooky styling, page-break between posters, print-ready.

Hunt card: when a match is shown, add "last seen near <zone> <n> min ago" from
GET /api/attendee/:id (extend the public card with lastZone { id, name, at } or null).
Screen: a "Where is everyone" panel listing zones with the names last seen there.

Extend test/smoke.mjs with the zone endpoint and the card field. Do not change the face
engine.
```

Expect: express route ordering for `/sigil/:id` vs static, QR SVG sizing for print, iOS
camera-app QR scanning of a tunnel URL, the 403/400 paths.

## Run 3: Haunt feedback on real phones (pure "cannot test by reading")

```
Read web/common.js, web/me.js, web/hunt.js, web/app.css, RESEARCH.md section A (phone-side effects).

Make being haunted unmistakable on iPhone and Android. In common.js: (1) three distinct
sound effects generated with Web Audio (shriek, bell toll, whisper noise) selectable on
/me and stored in localStorage; (2) on Android use navigator.vibrate with a pattern,
feature-detected; (3) a full-screen flash that respects prefers-reduced-motion; (4) show a
persistent in-page banner listing who haunted you until dismissed, since iOS Safari has no
vibration and audio can be muted by the ringer switch; (5) re-arm the AudioContext on
visibilitychange when the page returns to the foreground, and show a "tap to re-enable
sound" chip if the context is not running. Add a "Test my alert" button on /me.

Document in a comment why Web Push is not used (iOS requires Home Screen install).
Do not change server code except, if needed, a GET /api/ping for the test button. Keep
every change working when the AudioContext fails to construct.
```

Expect: agents assuming vibrate works on iOS, audio that only plays after a gesture,
the ringer switch, reduced-motion.

---

## After each run

1. In the PR description add `Shelled run: <link or id>`.
2. Review with `/merge`; note every fix a human had to make.
3. Add one EDGE_CASES.md entry per incident using the template: asked / agent did (which
   role) / broke / fix / why agents struggle here. Keep the honest wins too ("Tester added
   a cooldown test we had not asked for").
