# Room scan (#13): brief for whoever takes it

Written 15:05 PT, Sat 31 Oct, from Matt's session. Matt is offering #13 to tarecq. Claim it in TODO.md and on the bus before starting.

## Does it fit the time?

- **Today:** the Best-of-the-Day SF cut is 16:10 (RESEARCH.md §E). Merges stop at about 15:40 for anything not in docs/DEMO.md (docs/TEAMWORK.md), and the room scan is not in it yet. The demo owner adds the beat at the bottom only if slice 1 works on the TV by then.
- **The full version takes about an hour** (RESEARCH.md §B): scan, crop, render on the TV, ghosts on live haunts. Anything started after 14:40 misses 15:40.
- **Slice 1 alone takes 30 to 40 minutes**, so it makes today only if the room is scanned by about 15:15.
- **Final submission (Sun 8 Nov 23:59 ART):** the full version fits easily.
- **Out of scope:** phones knowing where they stand in the room (AR localization / VPS). It is parked in IDEAS.md §4: iOS Safari has no WebXR AR, hosted 8th Wall is gone, and it needs a native ARKit app, which breaks the "no app install" rule.

## Slices

1. **Scan + `/room` viewer (the demoable slice).**
   - Scan in Scaniverse on an iPhone 12 or newer: splat mode ("Ignore Lidar" if the phone has none), walk the room slowly for 60 to 90 s, keep people out of frame. Export SPZ (10 to 40 MB) and AirDrop it to the TV laptop. An optional 5-minute crop in SuperSplat (https://superspl.at/editor) removes junk and people.
   - New page `web/room.html` + `web/room.js`: three.js + Spark `SplatMesh`, OrbitControls with `autoRotate` for a slow orbit, full screen. Load the scan from a file dropped on the page or picked with a file input. `SplatMesh` takes `fileBytes` and `fileName` (`new SplatMesh({ fileBytes: await file.arrayBuffer(), fileName: file.name })`).
   - Build against Spark's sample `https://sparkjs.dev/assets/splats/butterfly.spz` (4 MB) while the real scan processes on the phone.
2. **Ghosts on live haunts.**
   - Hand-place 3 to 6 anchor points in the scan (stage, door, bar). Log the orbit target on a key press and paste the coordinates into `room.js`.
   - Subscribe with `connectWs({ screen: '1' }, onMessage)` from `web/common.js`, the same way `web/screen.js` line 14 does. On `msg.type === 'event'` with `msg.event.type === 'haunt'`, spawn a ghost sprite labelled `actor.name -> target.name` at a random anchor, and fade it out after about 8 s.
   - The anchors are set dressing: the server has no idea where anyone stands (see "Out of scope"). Say so if a judge asks.
3. **Nov 8:** make `/room` the background layer of `/screen` once the Scout panel there has landed.

## Files and contract

- New files only: `web/room.html` and `web/room.js`. No server change is needed: `express.static` (server/index.js line 62) already serves `/room`.
- It consumes `/ws?screen=1` `event` messages (ARCHITECTURE.md §3). The haunt payload is `{ type: 'event', event: { id, type: 'haunt', actorId, targetId, similarity, createdAt, back?, actor, target } }`, where `actor` and `target` are public cards (server/index.js line 157). It adds nothing to the API. Add one line about `/room` to ARCHITECTURE.md §1.4 in the same commit.
- Stay out of `web/screen.*` today, because the Scout slice 1 panel is landing there.
- Spark 2.4.0 imports both `three` and `three/addons/...`, so the import map needs all three entries. Every URL below returned 200 at 15:05.

  ```html
  <script type="importmap">
  { "imports": {
    "three": "https://cdn.jsdelivr.net/npm/three@0.187.0/build/three.module.js",
    "three/addons/": "https://cdn.jsdelivr.net/npm/three@0.187.0/examples/jsm/",
    "@sparkjsdev/spark": "https://cdn.jsdelivr.net/npm/@sparkjsdev/spark@2.4.0/dist/spark.module.js"
  } }
  </script>
  ```

  Spark needs three r180 or newer. The risk is venue Wi-Fi. If the CDN is slow, copy these files into `web/vendor/` (about 5 MB in all): `three.module.js`, `three.core.js` (which `three.module.js` imports), the addons `postprocessing/Pass.js` and `controls/OrbitControls.js`, and `spark.module.js`.
- Expect the scan to appear upside down in three.js. Rotate it 180° about X (Spark's own example sets `quaternion.set(1, 0, 0, 0)`).

## Privacy

- A splat keeps an image of everyone who was in the room at scan time, and the rule is that unregistered faces are never stored. Scan with people out of frame, or crop them out in SuperSplat.
- The `.spz` stays on the TV laptop and is dropped onto the page. Don't commit it (`.gitignore` already blocks `*.spz`, `*.ply`, `*.splat` and `*.ksplat`), and don't upload it to the public server. It never goes to a hosted model.

## How we know it works

- Slice 1: in Chrome on the TV laptop, drop the `.spz` on `/room`. The room renders and turns smoothly. Open it on one phone too (Spark targets mobile).
- Slice 2: haunt someone from `/hunt` on a phone. A ghost appears in the scan within a second, and `/screen` still updates.
- `npm test` stays green. test/smoke.mjs checks a fixed page list (lines 27 and 30); add `/room` to both so the page gets the 200 check and the repeated-id check.

## Demo beat (for the demo owner to accept, only if slice 1 works by 15:40)

| t | Say | Do |
|---|---|---|
| after 1:10 | "This is the room you're standing in, scanned on a phone ten minutes ago." Add "Every haunt lands in it as a ghost." only if slice 2 landed. | Switch the TV to `/room`. |
