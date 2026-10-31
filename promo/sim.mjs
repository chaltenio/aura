#!/usr/bin/env node
// promo/sim.mjs: simulated attendees run HAUNT's real pages end to end while every phone's screen is recorded.
// The people are synthetic (rendered on this Mac, see promo/README.md). Each phone is a headless Chrome whose fake
// camera plays that person's clip. It runs against a local server with its own DATA_DIR, never prod.
//
//   PORT=3177 DATA_DIR=<scratch>/data NO_PROFILE=1 node server/index.js &
//   node promo/sim.mjs --base http://localhost:3177 --cast <stills + .y4m feeds> --out <recordings> [--scenes seed,onboard,...]
//
// Each recorded phone becomes <out>/<scene>-<phone>.mp4 (CDP screencast at device pixels, resampled to 30 fps), and
// <out>/marks.json keeps the wall-clock moments (card shown, haunt sent, haunted, ...) so the edit can cut on them.
import { readdirSync, existsSync, readFileSync, writeFileSync, mkdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { pathToFileURL } from 'node:url';
import { spawn } from 'node:child_process';

const arg = (k, d) => { const i = process.argv.indexOf('--' + k); return i > 0 ? process.argv[i + 1] : d; };
const BASE = arg('base', 'http://localhost:3177');
const CAST = arg('cast');
const OUT = arg('out');
const LIVE = arg('live', 'https://aura-haunt.base44.app'); // what the big screen's join QR points at (the Base44 mirror)
const SCENES = arg('scenes', 'seed,onboard,hunt,vanish,stranger,connections').split(',');
if (!CAST || !OUT) { console.error('usage: node promo/sim.mjs --cast <dir> --out <dir> [--base url] [--scenes a,b]'); process.exit(2); }
mkdirSync(OUT, { recursive: true });

// playwright-core from the npx cache (no project dependency): `npx -y playwright-core@1.64.1 --version` fills it once.
function findPlaywright() {
  if (process.env.PLAYWRIGHT_CORE) return process.env.PLAYWRIGHT_CORE;
  const base = join(homedir(), '.npm/_npx');
  const hits = readdirSync(base).map((d) => join(base, d, 'node_modules/playwright-core')).filter((p) => existsSync(join(p, 'package.json')))
    .map((p) => ({ p, v: JSON.parse(readFileSync(join(p, 'package.json'), 'utf8')).version }));
  const pick = hits.find((h) => /^1\.64\.\d+$/.test(h.v)) || hits.find((h) => /^1\.6\d\./.test(h.v));
  if (!pick) throw new Error('playwright-core not in the npx cache: run npx -y playwright-core@1.64.1 --version');
  return pick.p;
}
const { chromium } = await import(pathToFileURL(join(findPlaywright(), 'index.mjs')).href);

// ---- phones ----
const UA = 'Mozilla/5.0 (Linux; Android 15; Pixel 9) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Mobile Safari/537.36';
const PHONE = { viewport: { width: 393, height: 852 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true, userAgent: UA };
const SCREEN = { viewport: { width: 1600, height: 900 }, deviceScaleFactor: 1.2 };
// a soft white ring wherever a finger lands, so taps read on video
const TAPS = `addEventListener('pointerdown', (e) => {
  if (!document.getElementById('tapviz-css')) { const s = document.createElement('style'); s.id = 'tapviz-css';
    s.textContent = '@keyframes tapviz{0%{transform:scale(.6);opacity:.95}100%{transform:scale(1.7);opacity:0}}.tapviz{position:fixed;width:46px;height:46px;margin:-23px 0 0 -23px;border-radius:50%;background:rgba(255,255,255,.28);border:2px solid rgba(255,255,255,.9);pointer-events:none;z-index:2147483647;animation:tapviz .55s ease-out forwards}';
    document.head.appendChild(s); }
  const d = document.createElement('div'); d.className = 'tapviz'; d.style.left = e.clientX + 'px'; d.style.top = e.clientY + 'px';
  document.documentElement.appendChild(d); setTimeout(() => d.remove(), 700);
}, true);`;
// a first visit: the camera permission is not granted yet, so /hunt shows "Start hunting" instead of starting by itself
const FIRST_VISIT = `{ const q = navigator.permissions?.query?.bind(navigator.permissions);
  if (q) navigator.permissions.query = (d) => d?.name === 'camera' ? Promise.resolve({ state: 'prompt', onchange: null }) : q(d); }`;

const open = [];
async function phone(name, { feed = null, identity = null, device = PHONE, firstVisit = false } = {}) {
  const dir = join(OUT, 'profiles', name); // persistent profile: the face models stay in the HTTP cache between runs
  const ctx = await chromium.launchPersistentContext(dir, {
    channel: 'chrome', headless: true, ...device, permissions: ['camera'],
    args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream', '--autoplay-policy=no-user-gesture-required',
      ...(feed ? [`--use-file-for-fake-video-capture=${join(CAST, feed)}`] : [])],
  });
  // once per launch (the profile persists between runs): this phone is `identity`, or nobody yet
  await ctx.addInitScript((me) => {
    if (sessionStorage.getItem('sim.fresh') != null) return;
    sessionStorage.setItem('sim.fresh', '1');
    if (me) localStorage.setItem('haunt.me', JSON.stringify(me)); else localStorage.removeItem('haunt.me');
  }, identity);
  await ctx.addInitScript(TAPS);
  if (firstVisit) await ctx.addInitScript(FIRST_VISIT);
  const page = ctx.pages()[0] || await ctx.newPage();
  page.on('pageerror', (e) => console.log(`[${name}] pageerror ${e.message}`));
  open.push(ctx);
  return page;
}

// ---- recording: CDP screencast frames with their timestamps, resampled to a constant 30 fps mp4 ----
async function encode(frames, end, mp4) {
  const t0 = frames[0].t, n = Math.max(1, Math.round((end - t0) * 30));
  const ff = spawn('ffmpeg', ['-v', 'error', '-y', '-f', 'image2pipe', '-framerate', '30', '-c:v', 'mjpeg', '-i', '-',
    '-vf', 'scale=trunc(iw/2)*2:trunc(ih/2)*2,format=yuv420p', '-c:v', 'libx264', '-preset', 'medium', '-crf', '15', '-r', '30', mp4], { stdio: ['pipe', 'inherit', 'inherit'] });
  const done = new Promise((r) => ff.on('close', r));
  let j = 0, last = -1, buf = null;
  for (let k = 0; k < n; k++) {
    const t = t0 + k / 30;
    while (j + 1 < frames.length && frames[j + 1].t <= t) j++;
    if (j !== last) { buf = readFileSync(frames[j].f); last = j; }
    if (!ff.stdin.write(buf)) await new Promise((r) => ff.stdin.once('drain', r));
  }
  ff.stdin.end();
  return done;
}
async function record(page, label, { w = 1179, h = 2556 } = {}) {
  const dir = join(OUT, 'frames', label); rmSync(dir, { recursive: true, force: true }); mkdirSync(dir, { recursive: true });
  const cdp = await page.context().newCDPSession(page);
  const frames = [];
  cdp.on('Page.screencastFrame', ({ data, metadata, sessionId }) => {
    const f = join(dir, `${String(frames.length).padStart(6, '0')}.jpg`);
    writeFileSync(f, Buffer.from(data, 'base64')); frames.push({ f, t: metadata.timestamp });
    cdp.send('Page.screencastFrameAck', { sessionId }).catch(() => {});
  });
  const start = () => cdp.send('Page.startScreencast', { format: 'jpeg', quality: 90, maxWidth: w, maxHeight: h, everyNthFrame: 1 }).catch(() => {});
  await start();
  page.on('framenavigated', (fr) => { if (fr === page.mainFrame()) start(); });
  return async () => {
    const end = Date.now() / 1000;
    await cdp.send('Page.stopScreencast').catch(() => {});
    if (!frames.length) { console.log(`[${label}] no frames`); return; }
    const mp4 = join(OUT, `${label}.mp4`);
    await encode(frames, end, mp4);
    marks.push({ label: `${label}:start`, t: frames[0].t }, { label: `${label}:end`, t: end });
    console.log(`[${label}] ${frames.length} frames, ${(end - frames[0].t).toFixed(1)} s -> ${mp4}`);
  };
}

// ---- small helpers that look like a person using the phone ----
const marksPath = join(OUT, 'marks.json');
const marks = existsSync(marksPath) ? JSON.parse(readFileSync(marksPath, 'utf8')) : [];
const mark = (label) => { marks.push({ label, t: Date.now() / 1000 }); console.log(`  mark ${label}`); };
const wait = (page, ms) => page.waitForTimeout(ms);
async function scrollTo(page, sel, block = 'center') {
  await page.evaluate(([s, b]) => document.querySelector(s)?.scrollIntoView({ behavior: 'smooth', block: b }), [sel, block]);
  await wait(page, 650);
}
async function tap(page, sel, { scroll = true } = {}) { if (scroll) await scrollTo(page, sel); await page.locator(sel).first().tap(); }
async function type(page, sel, text) { await tap(page, sel); await page.locator(sel).pressSequentially(text, { delay: 65 }); await wait(page, 250); }
const statusIs = (page, re, timeout = 120000) => page.waitForFunction((src) => new RegExp(src).test(document.getElementById('status')?.textContent || ''), re.source, { timeout });
const filled = (page, n, timeout = 30000) => page.waitForFunction((k) => document.querySelectorAll('#thumbs .slot.filled').length >= k, n, { timeout });
const meOf = (page) => page.evaluate(() => JSON.parse(localStorage.getItem('haunt.me')));
async function api(path, body, method = 'POST') {
  const r = await fetch(BASE + path, { method, headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
  if (!r.ok) console.log(`  api ${path} -> ${r.status} ${await r.text()}`);
}
const haunt = (a, b) => api('/api/haunt', { actorId: ids[a].id, token: ids[a].token, targetId: ids[b].id, similarity: 0.6 });

// ---- the cast: invented people ----
const PEOPLE = {
  priya: { name: 'Priya Raman', handle: 'priya-builds', blurb: 'On-device vision for AR glasses', costume: 'pumpkin' },
  theo: { name: 'Theo Lindqvist', handle: 'theo-ships', blurb: 'Voice agents for haunted houses', costume: 'vampire', photos: ['theo.png'] },
  nadia: { name: 'Nadia Reyes', handle: 'nadia-codes', blurb: 'A tarot deck that reads your git log', costume: 'witch', photos: ['nadia.png'] },
  kenji: { name: 'Kenji Mori', handle: 'kenji-m', blurb: 'Rust for tiny robots', costume: null, photos: ['kenji.png'] },
  amara: { name: 'Amara Eze', handle: 'amara-eze', blurb: 'Fintech for street vendors', costume: 'demon', photos: ['amara.png'] },
  lucas: { name: 'Lucas Ferreira', handle: 'lucasf', blurb: 'Multiplayer music in the browser', costume: 'skeleton', photos: ['lucas.png'] },
  sofia: { name: 'Sofia Marin', handle: 'sofia-marin', blurb: 'Climate data you can hear', costume: 'ghost', photos: ['sofia.png'] },
};
const idsPath = join(OUT, 'identities.json');
const ids = existsSync(idsPath) ? JSON.parse(readFileSync(idsPath, 'utf8')) : {};
const saveIds = () => writeFileSync(idsPath, JSON.stringify(ids, null, 2));

/** Register someone from photos (the page's own "Use photos instead" path): on-device embeddings, no camera. */
async function registerFromPhotos(key) {
  const p = PEOPLE[key];
  const page = await phone(`seed-${key}`);
  await page.goto(BASE + '/register'); await statusIs(page, /Face model ready/);
  await page.setInputFiles('#files', p.photos.map((f) => join(CAST, f)));
  await filled(page, p.photos.length, 60000);
  await page.fill('#name', p.name); await page.fill('#handle', p.handle);
  await page.locator('details.more summary').click(); await page.fill('#blurb', p.blurb);
  if (p.costume) await page.locator(`#costume button.costume[data-id="${p.costume}"]`).click();
  await page.check('#consent'); await page.click('#submit'); await page.waitForURL(/\/me/);
  ids[key] = await meOf(page); saveIds(); console.log(`  registered ${p.name}`);
  await page.context().close(); open.splice(open.indexOf(page.context()), 1);
}

async function scene(name, fn) {
  if (!SCENES.includes(name)) return;
  console.log(`== ${name}`); const t = Date.now();
  try { await fn(); } finally { while (open.length) await open.pop().close().catch(() => {}); writeFileSync(marksPath, JSON.stringify(marks, null, 2)); }
  console.log(`== ${name} done in ${((Date.now() - t) / 1000).toFixed(0)} s`);
}

// The room before Priya arrives: six people registered from photos, a few haunts already on the big screen.
await scene('seed', async () => {
  for (const k of ['theo', 'nadia', 'kenji', 'amara', 'lucas', 'sofia']) if (!ids[k] && existsSync(join(CAST, PEOPLE[k].photos[0]))) await registerFromPhotos(k);
  for (const [a, b] of [['amara', 'kenji'], ['lucas', 'sofia'], ['kenji', 'nadia'], ['sofia', 'amara'], ['nadia', 'lucas'], ['amara', 'theo']]) if (ids[a] && ids[b]) await haunt(a, b);
});

// Flow 1: Priya signs up with the selfie camera.
await scene('onboard', async () => {
  const p = PEOPLE.priya;
  const page = await phone('priya-reg', { feed: 'priya-selfie.y4m' });
  await page.goto(BASE + '/register'); await statusIs(page, /Face model ready/);
  const stop = await record(page, 'onboard-priya');
  mark('onboard:ready'); await wait(page, 1200);
  await type(page, '#name', p.name);
  await type(page, '#handle', p.handle);
  await tap(page, 'details.more summary'); await wait(page, 300);
  await type(page, '#blurb', p.blurb);
  await scrollTo(page, '#costume'); await tap(page, `#costume button.costume[data-id="${p.costume}"]`, { scroll: false }); mark('onboard:costume'); await wait(page, 1300);
  await scrollTo(page, '#selfies', 'start'); await tap(page, '#start', { scroll: false });
  await page.waitForFunction(() => document.getElementById('video').videoWidth > 0); mark('onboard:camera'); await wait(page, 1500);
  for (let n = 1, tries = 0; n <= 3 && tries < 12; tries++) {
    await page.locator('#capture').tap();
    try { await filled(page, n, 8000); mark(`onboard:selfie${n}`); n++; } catch {}
    await wait(page, 1100);
  }
  await wait(page, 600); await tap(page, '#consent'); await wait(page, 700);
  await tap(page, '#submit'); mark('onboard:submit');
  await page.waitForURL(/\/me/); mark('onboard:me'); await wait(page, 4000);
  ids.priya = await meOf(page); saveIds();
  await stop();
});

// Flow 2: Priya points her phone at Theo, his vampire lands on his face, she haunts him, his phone shrieks, he haunts back.
await scene('hunt', async () => {
  const screen = await phone('screen', { device: SCREEN });
  await screen.goto(BASE + '/screen');
  await screen.waitForFunction(() => typeof qrcode === 'function' && document.querySelector('#qr svg'));
  await screen.evaluate((live) => { const q = qrcode(0, 'M'); q.addData(live + '/register'); q.make(); document.getElementById('qr').innerHTML = q.createSvgTag({ cellSize: 8, margin: 2 }); }, LIVE);
  const theo = await phone('theo-me', { identity: ids.theo });
  await theo.goto(BASE + '/me'); await theo.waitForSelector('#name:not(:empty)');
  await theo.locator('h1').tap(); // his first tap anywhere arms the shriek
  const hunter = await phone('priya-hunt', { feed: 'theo-room.y4m', identity: ids.priya, firstVisit: true });
  await hunter.goto(BASE + '/hunt'); await statusIs(hunter, /Ready/);
  const stops = [await record(screen, 'hunt-screen', { w: 1920, h: 1080 }), await record(theo, 'hunt-theo'), await record(hunter, 'hunt-priya')];
  mark('hunt:ready'); await wait(hunter, 1800);
  await tap(hunter, '#start', { scroll: false }); mark('hunt:start');
  if (ids.lucas && ids.amara) setTimeout(() => haunt('lucas', 'amara'), 900); // the room keeps playing on the big screen
  await hunter.waitForSelector('#sheet.show', { timeout: 60000 }); mark('hunt:card');
  await wait(hunter, 2400);
  await hunter.locator('#haunt').tap(); mark('hunt:haunt');
  await theo.waitForSelector('.toast.show', { timeout: 15000 }); mark('hunt:haunted');
  await wait(theo, 1900);
  await theo.locator('.toast .haunt-back').tap(); mark('hunt:back');
  await hunter.waitForSelector('.toast.show', { timeout: 15000 }); mark('hunt:backed');
  if (ids.kenji && ids.sofia) setTimeout(() => haunt('kenji', 'sofia'), 1500);
  await wait(hunter, 4000);
  for (const s of stops) await s();
});

// Flow 3: kill switch. Priya finds Nadia, closes the card; Nadia unticks Findable and Priya's phone stops naming her.
await scene('vanish', async () => {
  await api(`/api/attendee/${ids.nadia.id}`, { token: ids.nadia.token, consent: true }, 'PATCH');
  const nadia = await phone('nadia-me', { identity: ids.nadia });
  await nadia.goto(BASE + '/me'); await nadia.waitForSelector('#name:not(:empty)');
  const hunter = await phone('priya-hunt3', { feed: 'nadia-room.y4m', identity: ids.priya });
  await hunter.goto(BASE + '/hunt'); await statusIs(hunter, /Ready/);
  const stops = [await record(nadia, 'vanish-nadia'), await record(hunter, 'vanish-priya')];
  await wait(hunter, 600);
  if (await hunter.locator('#idle').isVisible()) await tap(hunter, '#start', { scroll: false });
  await hunter.waitForSelector('#sheet.show', { timeout: 60000 }); mark('vanish:card');
  await wait(hunter, 2400);
  await hunter.locator('#dismiss').tap(); mark('vanish:closed');
  await scrollTo(nadia, '#consent'); await wait(nadia, 500);
  await nadia.locator('#consent').tap(); mark('vanish:off');
  await hunter.waitForFunction(() => /Unknown/.test(document.getElementById('hint')?.textContent || ''), null, { timeout: 15000 }); mark('vanish:unknown');
  await wait(hunter, 3500);
  for (const s of stops) await s();
  await api(`/api/attendee/${ids.nadia.id}`, { token: ids.nadia.token, consent: true }, 'PATCH'); // findable again for the next run
});

// Flow 4: a stranger who never registered: a grey box and "Unknown face", never a name.
await scene('stranger', async () => {
  const hunter = await phone('priya-hunt2', { feed: 'stranger-room.y4m', identity: ids.priya });
  await hunter.goto(BASE + '/hunt'); await statusIs(hunter, /Ready/);
  const stop = await record(hunter, 'stranger-priya');
  await wait(hunter, 800);
  if (await hunter.locator('#idle').isVisible()) await tap(hunter, '#start', { scroll: false });
  await hunter.waitForFunction(() => /Unknown/.test(document.getElementById('hint')?.textContent || ''), null, { timeout: 30000 }); mark('stranger:unknown');
  await wait(hunter, 5000);
  await stop();
});

// Flow 5: Priya's card afterwards: tonight's connections.
await scene('connections', async () => {
  if (ids.kenji) await haunt('kenji', 'priya');
  if (ids.amara) await haunt('amara', 'priya');
  const page = await phone('priya-me', { identity: ids.priya });
  await page.goto(BASE + '/me'); await page.waitForSelector('#conns li');
  const stop = await record(page, 'connections-priya');
  await wait(page, 1500); await scrollTo(page, '#conns', 'center'); mark('connections:list'); await wait(page, 3500);
  await stop();
});
console.log('done');
