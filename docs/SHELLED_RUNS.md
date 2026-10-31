# Shelled runs: what to ask for, in order

The Shelled AI track ("Make coding agents sweat") needs **>= 2 PRs produced by Shelled
runs on this repo, >= 1 merged, plus EDGE_CASES.md**. Nothing so far was built by
Shelled, so these runs are the track. Rules: each PR description must link the Shelled
run behind it; every place the agents guessed wrong becomes an EDGE_CASES.md entry.

Setup (once, needs a human): sign in at https://app.shelled.ai, connect GitHub repo
`chaltenio/aura`, start a run with one of the prompts below. Shelled works on its own
branch and opens a PR; review it, then land it with `/merge` like any other branch. `/merge`
fast-forwards main to the PR's head, so GitHub counts the PR as merged (the track needs one).

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
/me and stored in localStorage; (2) on Android use navigator.vibrate with a spooky pattern,
feature-detected: an irregular rattle or slowing heartbeat (for example [60,40,60,40,200,120,400,300,600]), not one flat buzz; (3) a full-screen flash that respects prefers-reduced-motion; (4) show a
persistent in-page banner listing who haunted you until dismissed, since iOS Safari has no
vibration and audio can be muted by the ringer switch; (5) re-arm the AudioContext on
visibilitychange when the page returns to the foreground, and show a "tap to re-enable
sound" chip if the context is not running; (6) a spooky wobble: a CSS keyframe animation on
<body> (or a wrapper) that shakes and tilts the whole page with decaying amplitude for about 1.2 s
(translate a few px, rotate under 1deg, ease out), triggered alongside the flash, disabled under
prefers-reduced-motion, and working on iOS Safari where there is no vibration at all. Add a
"Test my alert" button on /me that fires sound, flash, vibrate and wobble together.

Document in a comment why Web Push is not used (iOS requires Home Screen install).
Do not change server code except, if needed, a GET /api/ping for the test button. Keep
every change working when the AudioContext fails to construct.
```

Expect: agents assuming vibrate works on iOS, audio that only plays after a gesture,
the ringer switch, reduced-motion, a wobble that moves fixed-position elements (the flash
overlay, toasts) or triggers scrollbars, and nobody able to feel whether the pattern is spooky.

---

## Run 4: Possession effects (everything else iOS Safari will let a page do)

Builds on Run 3. Foreground page only: iOS freezes JS and drops the socket when the phone
locks, so none of this works from a pocket. Proposed by tarecq 15:30; see IDEAS.md section 3.

```
Read web/common.js, web/me.js, web/hunt.js, web/app.css, RESEARCH.md section A (phone-side effects).

Make a haunt feel like a possession on iPhone and Android, in common.js and app.css, all
triggered from the existing hauntedAlert path and all off under prefers-reduced-motion:

(1) Beat the ringer switch: if navigator.audioSession exists, set its type to "playback" on
the Join tap so Web Audio plays with the mute switch on; feature-detect, never throw.
(2) A voice: with speechSynthesis, whisper the hunter's first name in a slow low-pitch English
voice ("<name>... I see you"), rate 0.7, pitch 0.3, after the shriek; pan it left to right with a
StereoPannerNode when the audio graph allows, skip silently when no voices are loaded.
(3) The browser turns red: swap <meta name="theme-color"> to #7a0000 for 2 s with the flash,
then restore; create the tag if the page has none.
(4) The page decays: a 3 s body-level CSS animation (hue-rotate toward green, a blur pulse,
a brief invert, letter-spacing glitch on headings) that leaves the page exactly as it was.
(5) Shake to haunt back: after DeviceMotionEvent.requestPermission() granted inside the Join
tap (iOS) or available without it (Android), a shake over a threshold within 20 s of being
haunted POSTs /api/haunt back at the hunter (actorId me, targetId hunter) and shows "You
haunted them back". Debounce so one shake is one haunt; the server cooldown still applies.
(6) Add all of it to the "Test my alert" button on /me.

Do not open the camera, do not add permissions beyond motion, do not change server code.
Keep every effect working when any single API is missing.
```

Expect: audioSession typed wrong or set too late, speechSynthesis voices empty on first call,
theme-color only updating on some iOS versions, body filters breaking fixed-position overlays,
shake thresholds nobody can tune without a phone in hand, and the retaliation haunt hitting the
60 s pair cooldown.

Parked for a later run, each needs camera or is a gamble: front-camera "look behind you" with a
ghost over your shoulder (on-device only), rear torch strobe via the track torch constraint,
tilt-parallax ghost on DeviceOrientation.

## After each run

1. In the PR description add `Shelled run: <link or id>`.
2. Review with `/merge`; note every fix a human had to make.
3. Add one EDGE_CASES.md entry per incident using the template: asked / agent did (which
   role) / broke / fix / why agents struggle here. Keep the honest wins too ("Tester added
   a cooldown test we had not asked for").
