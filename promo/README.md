# promo: simulated runs and the promo cut (#15)

Invented attendees run the real pages end to end on a local server, every phone's screen is recorded, and Remotion
cuts the recordings into a ~65 s film. No real person's face is used: the cast is rendered on this Mac, and the
pages see them through Chrome's fake camera. Nothing touches prod.

## The cast (local models, not committed)
- Portraits: Z-Image-Turbo through mflux (`~/repos/reel-studio/.venv/bin/mflux-generate-z-image`, about 20 s each).
- "Across the room" views: FLUX.2 klein edit of the same portrait.
- Camera clips: LTX-2.5 image-to-video, `vidgen -i <still> --portrait --size 480p --seconds 5 --no-audio` (about 50 s each).
- `promo/feed.sh clip.mp4 out.y4m [top] [zoom]` turns a clip into a looping 720x960 fake camera (3:4, forward then backward).

The cast directory needs `theo.png nadia.png kenji.png amara.png lucas.png sofia.png` (registered from photos) and
`priya-selfie.y4m theo-room.y4m nadia-room.y4m stranger-room.y4m` (camera feeds).

## Run the flows
```
PORT=3177 DATA_DIR=<scratch>/data NO_PROFILE=1 node server/index.js &       # fresh data dir, never prod
node promo/sim.mjs --base http://localhost:3177 --cast <cast dir> --out <rec dir>
```
Scenes (`--scenes` picks some): `seed` (six people register from photos, a few haunts), `onboard` (Priya signs up
with the selfie camera), `hunt` (she finds Theo, haunts him, he haunts back; his phone and /screen recorded too),
`vanish` (Nadia unticks Findable and Priya's phone stops naming her), `stranger` (an unregistered face stays
"unknown"), `connections` (Priya's /me afterwards). Each phone is a headless Chrome (playwright-core from the npx
cache) with its own fake camera; recordings land as `<rec>/<scene>-<phone>.mp4` plus `marks.json` (wall-clock moments).

## Cut the film
```
node promo/sfx.mjs <media>                        # shriek.wav (the app's own), shutter.wav, pop.wav
# <media> = rec/*.mp4 + rec/marks.json + the sfx + music.wav + the cast portraits
cd promo/video && npm install
npx remotion render src/index.ts Promo out.mp4 --public-dir=<media> --codec=h264 --crf=18
```
The cut is placed on the recordings by `marks.json`, so a re-run of the sim re-times it by itself. The music bed
came from `~/repos/reel-studio/scripts/music.sh` (MiniMax-Music3, instrumental).
