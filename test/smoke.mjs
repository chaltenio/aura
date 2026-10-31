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
  ws.close();
} catch (e) { fails.push('exception: ' + (e.stack || e)); }
finally { server.kill(); }

if (fails.length) { console.error('SMOKE FAIL\n - ' + fails.join('\n - ')); process.exit(1); }
console.log('SMOKE PASS (api, gallery privacy, haunt push, cooldown, kill switch, static routes)');
