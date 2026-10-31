// Smoke test: boots the server on a random port with a temp data dir and exercises the API + push path.
// No browser or face model needed (descriptors are random vectors). Run: npm test
import { spawn } from 'node:child_process';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const PORT = 4000 + Math.floor(Math.random() * 1000);
const BASE = `http://localhost:${PORT}`;
const DATA_DIR = mkdtempSync(join(tmpdir(), 'haunt-'));
const server = spawn(process.execPath, [join(ROOT, 'server/index.js')], { env: { ...process.env, PORT: String(PORT), DATA_DIR, NO_PROFILE: '1' }, stdio: ['ignore', 'pipe', 'pipe'] });
let serverLog = ''; server.stdout.on('data', (d) => { serverLog += d; }); server.stderr.on('data', (d) => { serverLog += d; });

const fails = [];
const check = (cond, msg) => { if (!cond) fails.push(msg); };
const vec = (n = 512) => Array.from({ length: n }, () => Math.random() * 2 - 1);
const json = async (path, opts = {}) => { const r = await fetch(BASE + path, { ...opts, headers: opts.body ? { 'content-type': 'application/json' } : {} , body: opts.body ? JSON.stringify(opts.body) : undefined }); return { status: r.status, data: await r.json().catch(() => ({})) }; };

try {
  // wait for boot (weights download may be skipped if already present)
  let up = false;
  for (let i = 0; i < 100 && !up; i++) { try { up = (await fetch(BASE + '/api/gallery')).ok; } catch {} if (!up) await new Promise((r) => setTimeout(r, 200)); }
  check(up, 'server did not boot: ' + serverLog);

  for (const p of ['/', '/register', '/hunt', '/me', '/screen', '/enroll', '/calibrate', '/face.js', '/common.js', '/app.css', '/vendor/facex/facex.js', '/vendor/facex/facex.wasm']) {
    const r = await fetch(BASE + p); check(r.ok, `GET ${p} -> ${r.status}`);
  }

  const ver = (await json('/api/version')).data; check(ver.version && ver.attendees === 0, '/api/version reports version and counts');
  check((await json('/api/attendee', { method: 'POST', body: { name: 'X', consent: false, descriptors: [vec()] } })).status === 400, 'consent=false should be rejected');
  check((await json('/api/attendee', { method: 'POST', body: { name: 'X', consent: true, descriptors: [[1, 2, 3]] } })).status === 400, 'short descriptor should be rejected');

  const a = (await json('/api/attendee', { method: 'POST', body: { name: 'Ada', handle: 'ada', consent: true, descriptors: [vec(), vec()], blurb: 'engines' } })).data;
  const b = (await json('/api/attendee', { method: 'POST', body: { name: 'Bob', handle: 'bob', consent: true, descriptors: [vec()], provider: 'csv', linkedin: 'https://www.linkedin.com/in/bob' } })).data;
  check(a.id && a.token && b.id && b.token, 'register returns id+token');

  const g = (await json('/api/gallery')).data;
  check(Array.isArray(g) && g.length === 2, 'gallery has 2 entries');
  check(g.every((x) => !('token' in x) && !('avatar' in x)), 'gallery must not leak tokens/avatars');
  check(g.find((x) => x.id === a.id)?.descriptors.length === 2, 'gallery keeps all descriptors');

  const card = (await json(`/api/attendee/${b.id}`)).data;
  check(card.name === 'Bob' && card.linkedin === 'https://www.linkedin.com/in/bob' && !card.token, 'public card shape');

  // Bob listens on the socket; Ada haunts Bob
  const ws = new WebSocket(`ws://localhost:${PORT}/ws?attendee=${b.id}`);
  const got = new Promise((res) => ws.addEventListener('message', (e) => { const m = JSON.parse(e.data); if (m.type === 'haunted') res(m); }));
  await new Promise((res, rej) => { ws.addEventListener('open', res); ws.addEventListener('error', rej); });
  const h1 = await json('/api/haunt', { method: 'POST', body: { actorId: a.id, token: a.token, targetId: b.id, similarity: 0.7 } });
  check(h1.status === 200 && h1.data.card?.name === 'Bob', 'haunt succeeds and returns target card');
  const push = await Promise.race([got, new Promise((r) => setTimeout(() => r(null), 3000))]);
  check(push && push.by?.name === 'Ada' && !push.by.token, 'target receives haunted push with actor card');
  check((await json('/api/haunt', { method: 'POST', body: { actorId: a.id, token: a.token, targetId: b.id } })).status === 429, 'second haunt within cooldown -> 429');
  check((await json('/api/haunt', { method: 'POST', body: { actorId: a.id, token: 'nope', targetId: b.id } })).status === 403, 'bad token -> 403');
  check((await json('/api/haunt', { method: 'POST', body: { actorId: a.id, token: a.token, targetId: a.id } })).status === 400, 'self-haunt -> 400');

  const me = (await json(`/api/me/${b.id}?token=${b.token}`)).data;
  check(me.received?.length === 1 && me.received[0].by.name === 'Ada', '/me lists who haunted you');
  check((await json(`/api/me/${b.id}?token=bad`)).status === 403, '/me with bad token -> 403');

  const ev = (await json('/api/events')).data;
  check(ev.events?.length === 1 && ev.attendees?.length === 2, '/api/events feed + attendee list');

  // kill switch removes Bob from the gallery
  check((await json(`/api/attendee/${b.id}`, { method: 'PATCH', body: { token: b.token, consent: false } })).status === 200, 'PATCH consent');
  check((await json('/api/gallery')).data.length === 1, 'opted-out attendee leaves the gallery');

  { // tonight's connections on /me: one row per person, both directions, consenting counterparts only (fresh attendees)
    const reg = async (name) => (await json('/api/attendee', { method: 'POST', body: { name, handle: name.toLowerCase(), consent: true, descriptors: [vec()], linkedin: `https://www.linkedin.com/in/${name.toLowerCase()}` } })).data;
    const cy = await reg('Cy'), di = await reg('Di'), ed = await reg('Ed');
    const haunt = async (x, y) => { await new Promise((r) => setTimeout(r, 5)); return (await json('/api/haunt', { method: 'POST', body: { actorId: x.id, token: x.token, targetId: y.id } })).status; };
    check(await haunt(cy, di) === 200 && await haunt(di, cy) === 200 && await haunt(ed, cy) === 200, 'connections: setup haunts succeed');
    const cyMe = async () => (await json(`/api/me/${cy.id}?token=${cy.token}`)).data;
    const row = (m, x) => m.connections?.find((c) => c.card.id === x.id);
    const m1 = await cyMe();
    check(m1.connections?.length === 2 && m1.received?.length === 2 && m1.given?.length === 1, '/me connections: one row per person');
    check(row(m1, di)?.youHaunted === 1 && row(m1, di)?.hauntedYou === 1 && row(m1, ed)?.youHaunted === 0 && row(m1, ed)?.hauntedYou === 1, '/me connections: counts both directions');
    check(m1.connections?.[0]?.card.id === ed.id && row(m1, ed)?.lastAt === m1.received?.[0]?.createdAt && row(m1, di)?.lastAt === m1.received?.[1]?.createdAt, '/me connections: newest first, lastAt is the latest haunt either way');
    check(row(m1, di)?.card.linkedin === 'https://www.linkedin.com/in/di' && !('token' in (row(m1, di)?.card || {})), '/me connections: public card, no token');
    check((await json(`/api/attendee/${di.id}`, { method: 'PATCH', body: { token: di.token, consent: false } })).status === 200, 'connections: Di opts out');
    const m2 = await cyMe();
    check(m2.connections?.length === 1 && !row(m2, di), 'opted-out counterpart leaves /me connections');
    check(m2.received?.length === 1 && m2.received[0].by.id === ed.id && m2.given?.length === 0, 'opted-out counterpart leaves /me received and given');
  }
  { // haunt back (#18): Cy haunts Dee, Dee haunts back, Cy's socket hears back:true; Eve was never haunted by Cy -> 400
    const reg = async (name) => (await json('/api/attendee', { method: 'POST', body: { name, consent: true, descriptors: [vec()] } })).data;
    const cy = await reg('Cy'), dee = await reg('Dee'), eve = await reg('Eve');
    const haunt = (from, to, extra = {}) => json('/api/haunt', { method: 'POST', body: { actorId: from.id, token: from.token, targetId: to.id, similarity: 0.6, ...extra } });
    const cyWs = new WebSocket(`ws://localhost:${PORT}/ws?attendee=${cy.id}`);
    const cyGot = new Promise((res) => cyWs.addEventListener('message', (e) => { const m = JSON.parse(e.data); if (m.type === 'haunted') res(m); }));
    await new Promise((res, rej) => { cyWs.addEventListener('open', res); cyWs.addEventListener('error', rej); });
    check((await haunt(cy, dee)).status === 200, 'haunt back setup: Cy haunts Dee');
    const hb = await haunt(dee, cy, { similarity: null, back: true });
    check(hb.status === 200 && hb.data.card?.name === 'Cy', 'haunt back after being haunted -> 200 with the card');
    const backPush = await Promise.race([cyGot, new Promise((r) => setTimeout(() => r(null), 3000))]);
    check(backPush?.back === true && backPush.by?.name === 'Dee', 'haunted-back phone gets haunted with back:true and the right by.name');
    check((await haunt(dee, cy, { back: true })).status === 429, 'haunt back keeps the 60 s cooldown');
    check((await haunt(eve, cy, { back: true })).status === 400, 'haunt back toward someone who never haunted you -> 400');
    const evs = (await json('/api/events?limit=50')).data.events || [];
    const pair = (from, to) => evs.find((e) => e.type === 'haunt' && e.actorId === from.id && e.targetId === to.id);
    check(pair(dee, cy)?.back === true && pair(cy, dee) && !('back' in pair(cy, dee)), 'haunt back stored as type haunt with back:true; a plain haunt has no back');
    cyWs.close();
  }
  { // costumes (#22): optional short id, served in the gallery (hunters draw it on the matched face) and on the card; 'plain' or junk clears it
    const reg = async (name, costume) => (await json('/api/attendee', { method: 'POST', body: { name, consent: true, descriptors: [vec()], costume } })).data;
    const vi = await reg('Vi', 'vampire'), pl = await reg('Pl'), bad = await reg('Bad', '<img src=x>');
    const gal = (await json('/api/gallery')).data, costumeOf = (x) => gal.find((y) => y.id === x.id)?.costume;
    check(costumeOf(vi) === 'vampire' && costumeOf(pl) === null && costumeOf(bad) === null, 'costume: gallery carries the picked costume, null when none or junk');
    const patch = async (costume) => (await json(`/api/attendee/${vi.id}`, { method: 'PATCH', body: { token: vi.token, costume } })).data;
    check((await patch('witch')).costume === 'witch' && (await json(`/api/attendee/${vi.id}`)).data.costume === 'witch', 'costume: PATCH changes it and the public card shows it');
    check((await patch('<b>x</b>')).costume === null && (await patch('witch')).costume === 'witch' && (await patch('plain')).costume === null, 'costume: junk and plain clear it');
    check((await json(`/api/attendee/${vi.id}`, { method: 'PATCH', body: { token: 'nope', costume: 'ghost' } })).status === 403, 'costume: PATCH needs the token');
  }
  ws.close();
} catch (e) { fails.push('exception: ' + (e.stack || e)); }
finally { server.kill(); }

if (fails.length) { console.error('SMOKE FAIL\n - ' + fails.join('\n - ')); process.exit(1); }
console.log('SMOKE PASS (api, gallery privacy, haunt push, cooldown, kill switch, costumes, static routes)');
