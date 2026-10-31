// Smoke test: boots the server on a random port with a temp data dir and exercises the API + push path.
// No browser or face model needed (descriptors are random vectors). Run: npm test
import { spawn } from 'node:child_process';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { deployInfo } from '../server/version.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const PORT = 4000 + Math.floor(Math.random() * 1000);
const BASE = `http://localhost:${PORT}`;
const DATA_DIR = mkdtempSync(join(tmpdir(), 'haunt-'));
const server = spawn(process.execPath, [join(ROOT, 'server/index.js')], { env: { ...process.env, PORT: String(PORT), DATA_DIR, NO_PROFILE: '1', ADMIN_TOKEN: 'test-admin', APP_VERSION: 'smoke1', SCOUT_SWEEP_MS: '400', SCOUT_MIN_N: '2' }, stdio: ['ignore', 'pipe', 'pipe'] });
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

  for (const p of ['/', '/register', '/hunt', '/me', '/screen', '/enroll', '/calibrate', '/admin', '/face.js', '/common.js', '/app.css', '/vendor/facex/facex.js', '/vendor/facex/facex.wasm']) {
    const r = await fetch(BASE + p); check(r.ok, `GET ${p} -> ${r.status}`);
  }
  for (const p of ['/', '/register', '/hunt', '/me', '/screen', '/enroll', '/calibrate']) { // a repeated id makes $('x') grab the wrong element
    const ids = [...(await (await fetch(BASE + p)).text()).matchAll(/[\s<]id="([^"]+)"/g)].map((m) => m[1]);
    const dup = ids.filter((x, i) => ids.indexOf(x) !== i); check(!dup.length, `${p} repeats ids: ${dup.join(', ')}`);
  }

  const ver = (await json('/api/version')).data; check(ver.version === 'smoke1' && ver.deploy === 1 && ver.deployedAt > 0 && ver.attendees === 0, '/api/version reports version, deploy number and counts');
  { // deploy counter (server/version.js): +1 per new Fly image, same number on a restart or secrets change, none on a dev build
    const dir = mkdtempSync(join(tmpdir(), 'haunt-ver-'));
    const img = (n, sha = 'abc1234') => ({ APP_VERSION: sha, FLY_IMAGE_REF: `registry.fly.io/aura-haunt:deployment-${n}` });
    const got = [img(1), img(1), img(2), img(3, 'def5678'), {}, img(3, 'def5678')].map((env, i) => deployInfo(dir, env, 1000 + i));
    const want = [[1, 1000], [1, 1000], [2, 1002], [3, 1003], [null, null], [3, 1003]];
    check(JSON.stringify(got.map((v) => [v.deploy, v.deployedAt])) === JSON.stringify(want), `deploy counter: ${JSON.stringify(got)}`);
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
  const h2 = await json('/api/haunt', { method: 'POST', body: { actorId: a.id, token: a.token, targetId: b.id } });
  check(h2.status === 200 && h2.data.card?.name === 'Bob', 'no rate limit: a second haunt right away -> 200 with the card');
  check((await json('/api/haunt', { method: 'POST', body: { actorId: a.id, token: 'nope', targetId: b.id } })).status === 403, 'bad token -> 403');
  check((await json('/api/haunt', { method: 'POST', body: { actorId: a.id, token: a.token, targetId: a.id } })).status === 400, 'self-haunt -> 400');

  const me = (await json(`/api/me/${b.id}?token=${b.token}`)).data;
  check(me.received?.length === 2 && me.received.every((r) => r.by.name === 'Ada'), '/me lists who haunted you, one row per haunt');
  check((await json(`/api/me/${b.id}?token=bad`)).status === 403, '/me with bad token -> 403');

  const ev = (await json('/api/events')).data;
  check(ev.events?.length === 2 && ev.attendees?.length === 2, '/api/events feed + attendee list');

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
    check((await haunt(dee, cy, { back: true })).status === 200, 'no rate limit: a second haunt back right away -> 200');
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
  { // instant profile (#30): a PATCH pushes the changed card to every socket, so /hunt patches it in place (no gallery refetch);
    // opting out pushes only the id; opting back in asks for a gallery refetch (the descriptors come back)
    const hunter = new WebSocket(`ws://localhost:${PORT}/ws`), inbox = [];
    hunter.addEventListener('message', (e) => inbox.push(JSON.parse(e.data)));
    await new Promise((res, rej) => { hunter.addEventListener('open', res); hunter.addEventListener('error', rej); });
    const next = async (pred, ms = 1500) => { for (const t = Date.now(); Date.now() - t < ms; await new Promise((r) => setTimeout(r, 5))) { const i = inbox.findIndex(pred); if (i >= 0) return inbox.splice(i, 1)[0]; } return null; };
    const pia = (await json('/api/attendee', { method: 'POST', body: { name: 'Pia', handle: 'pia', consent: true, descriptors: [vec()], costume: 'vampire', avatar: 'data:image/jpeg;base64,AAAA' } })).data;
    await next((m) => m.type === 'gallery_changed'); inbox.length = 0; // the join itself still refetches: hunters need the new face
    const edit = async (body) => { inbox.length = 0; const t = Date.now(); const r = await json(`/api/attendee/${pia.id}`, { method: 'PATCH', body: { token: pia.token, ...body } }); return { r, t }; };
    const changed = (m) => m.type === 'attendee_changed' && m.attendee?.id === pia.id;
    let { r, t } = await edit({ costume: 'witch' });
    const c1 = await next(changed);
    check(r.status === 200 && c1?.attendee.costume === 'witch' && c1.attendee.name === 'Pia' && Date.now() - t < 1500, 'instant: a costume PATCH pushes attendee_changed with the new costume');
    check(c1 && !('descriptors' in c1.attendee) && !('token' in c1.attendee) && !('avatar' in c1.attendee), 'instant: the pushed card has no descriptors, token or avatar');
    await new Promise((res) => setTimeout(res, 100));
    check(!inbox.some((m) => m.type === 'gallery_changed'), 'instant: a profile edit no longer makes every /hunt refetch the gallery');
    ({ r } = await edit({ blurb: 'ghosts', linkedin: 'https://www.linkedin.com/in/pia', costume: 'plain' }));
    const c2 = await next(changed);
    check(c2?.attendee.blurb === 'ghosts' && c2.attendee.linkedin === 'https://www.linkedin.com/in/pia' && c2.attendee.costume === null && c2.attendee.profileLoading === false, 'instant: blurb, LinkedIn and costume off arrive in one push (profileLoading always a boolean)');
    ({ r } = await edit({ consent: false }));
    const gone = await next((m) => m.type === 'attendee_gone' && m.id === pia.id);
    check(gone && Object.keys(gone).sort().join() === 'id,type' && !inbox.some(changed), 'instant: opting out pushes attendee_gone with the id only, never the card');
    ({ r } = await edit({ costume: 'ghost' }));
    check(await next((m) => m.type === 'attendee_gone' && m.id === pia.id) && !inbox.some(changed), 'instant: an opted-out edit still never pushes the card');
    ({ r } = await edit({ consent: true }));
    check(await next((m) => m.type === 'gallery_changed') && (await json('/api/gallery')).data.some((x) => x.id === pia.id && x.costume === 'ghost'), 'instant: opting back in asks phones to refetch the gallery (face descriptors back)');
    hunter.close();
  }
  { // the Scout (#10, docs/scout/README.md): a complementary pair gets a clue that names nobody, the haunt between them confirms
    // the match on both phones, both answer one question, and the block on /api/events counts it against the organic baseline
    const reg = async (name, blurb) => (await json('/api/attendee', { method: 'POST', body: { name, handle: name.toLowerCase(), consent: true, descriptors: [vec()], blurb } })).data;
    const priya = await reg('Priya', 'Rust CLI that diffs Terraform plans, looking for a cofounder');
    const marco = await reg('Marco', 'React dashboards for devtools, looking for a cofounder');
    const listen = (id) => new Promise((res, rej) => { const ws = new WebSocket(`ws://localhost:${PORT}/ws?attendee=${id}`), inbox = []; ws.addEventListener('message', (e) => inbox.push(JSON.parse(e.data))); ws.addEventListener('open', () => res({ ws, inbox })); ws.addEventListener('error', rej); });
    const P = await listen(priya.id), M = await listen(marco.id);
    const waitFor = async (inbox, pred, ms = 4000) => { for (const t = Date.now(); Date.now() - t < ms; await new Promise((r) => setTimeout(r, 20))) { const m = inbox.find(pred); if (m) return m; } return null; };
    const clue = (m) => m.type === 'state' && m.scout?.phase === 'clue';
    const cP = await waitFor(P.inbox, clue), cM = await waitFor(M.inbox, clue);
    check(cP && cM && cP.scout.matchId === cM.scout.matchId && cP.scout.deadline > Date.now(), 'scout: both sides of a complementary pair get a clue for the same match');
    check(cP && !/priya|marco/i.test(cP.scout.clue + cM.scout.clue) && /frontend|React/i.test(cP.scout.clue) && /backend|Rust/i.test(cM.scout.clue), `scout: clues describe the other person without naming them: "${cP?.scout.clue}"`);
    const evs1 = (await json('/api/events?limit=50')).data; const match = evs1.events.find((e) => e.type === 'match');
    check(match?.meta?.status === 'open' && match.meta.features.includes('complement') && match.meta.features.includes('intent_match') && match.meta.weights.stack === 0.4, 'scout: match event is open with named features and the weights it used');
    check(evs1.scout?.clues.sent >= 1 && evs1.scout.clues.pending >= 1 && evs1.scout.version === 1 && evs1.scout.predicted.n === 0, '/api/events carries the scout block for the screen');
    const h = await json('/api/haunt', { method: 'POST', body: { actorId: priya.id, token: priya.token, targetId: marco.id, similarity: 0.7 } });
    check(h.status === 200 && h.data.hauntId > 0, 'haunt response carries hauntId (the rating names it)');
    check((await waitFor(M.inbox, (m) => m.type === 'haunted'))?.hauntId === h.data.hauntId, 'haunted push carries the same hauntId');
    const found = (m) => m.type === 'state' && m.scout?.phase === 'found';
    const fP = await waitFor(P.inbox, found), fM = await waitFor(M.inbox, found);
    check(fP && fM && fP.scout.hauntId === h.data.hauntId && /Paired on/.test(fP.scout.reason), 'scout: the haunt between the pair confirms the match on both phones, with the reason');
    const rate = (who, verdict, hauntId = h.data.hauntId) => json('/api/rating', { method: 'POST', body: { raterId: who.id, token: who.token, hauntId, verdict, source: 'phone' } });
    check((await rate({ id: priya.id, token: 'bad' }, 'yes')).status === 403, 'rating: bad token -> 403');
    check((await rate(priya, 'maybe')).status === 400, 'rating: verdict must be yes, no or knew');
    const eve = await reg('Eve', ''); check((await rate(eve, 'yes')).status === 404, 'rating: a haunt you were not part of -> 404');
    const r1 = await rate(priya, 'yes'), r2 = await rate(marco, 'no');
    check(r1.status === 200 && r1.data.scout === true && /Paired on/.test(r1.data.reason) && r2.status === 200, 'rating: both sides answer; the answer reveals why the Scout paired them');
    check((await rate(marco, 'yes')).status === 200, 'rating: a second answer overwrites (a mis-tap is fixable)');
    const st = (await json('/api/events')).data.scout;
    check(st.predicted.yes === 2 && st.predicted.n === 2 && st.clues.found === 1 && st.ratedPairs === 1, `scout state counts ratings on scout pairs and found clues: ${JSON.stringify(st.predicted)} found ${st.clues.found}`);
    const plain = await json('/api/haunt', { method: 'POST', body: { actorId: eve.id, token: eve.token, targetId: priya.id } });
    check((await rate(eve, 'yes', plain.data.hauntId)).data.scout === false && (await json('/api/events')).data.scout.baseline.n === 1, 'rating: an organic haunt counts toward the baseline, not the Scout');
    check((await rate(priya, 'knew', plain.data.hauntId)).status === 200 && (await json('/api/events')).data.scout.baseline.n === 1, 'rating: "already knew them" is kept but not counted');
    P.ws.close(); M.ws.close();
  }
  ws.close();

  // admin: auth, block/allow, direct + group message push, events
  const adm = (path, method = 'GET', body) => fetch(BASE + '/api/admin' + path, { method, headers: { 'x-admin-token': 'test-admin', ...(body ? { 'content-type': 'application/json' } : {}) }, body: body ? JSON.stringify(body) : undefined }).then(async (r) => ({ status: r.status, data: await r.json().catch(() => ({})) }));
  check((await fetch(BASE + '/api/admin/users')).status === 401, 'admin without token -> 401');
  check((await fetch(BASE + '/api/admin/users', { headers: { 'x-admin-token': 'wrong' } })).status === 401, 'admin wrong token -> 401');
  check((await fetch(BASE + '/admin')).ok, 'GET /admin page');
  const au = (await adm('/users')).data;
  check(au.length >= 2 && au.some((x) => x.id === a.id) && au.every((x) => !('token' in x) && !('descriptors' in x)), 'admin users list hides tokens/descriptors');
  const ws2 = new WebSocket(`ws://localhost:${PORT}/ws?attendee=${a.id}`);
  const gotMsg = new Promise((res) => ws2.addEventListener('message', (e) => { const m = JSON.parse(e.data); if (m.type === 'admin_message') res(m); }));
  await new Promise((res, rej) => { ws2.addEventListener('open', res); ws2.addEventListener('error', rej); });
  const dm = await adm('/messages', 'POST', { to: a.id, text: 'hello Ada' });
  check(dm.data.delivered === 1, 'direct message delivered to online attendee');
  check((await Promise.race([gotMsg, new Promise((r) => setTimeout(() => r(null), 3000))]))?.text === 'hello Ada', 'attendee socket receives admin_message');
  check((await adm('/messages', 'POST', { group: 'all', text: 'hi all' })).data.recipients === au.length, 'group message counts recipients');
  check((await adm('/messages', 'POST', { group: 'nope', text: 'x' })).status === 400, 'bad group -> 400');
  check((await adm(`/users/${a.id}`, 'PATCH', { blocked: true })).data.blocked === true, 'admin can disallow');
  check(!(await json('/api/gallery')).data.some((x) => x.id === a.id), 'blocked attendee leaves the gallery');
  check((await json('/api/haunt', { method: 'POST', body: { actorId: a.id, token: a.token, targetId: b.id } })).status === 403, 'blocked attendee cannot haunt');
  await adm(`/users/${a.id}`, 'PATCH', { blocked: false });
  const m1 = (await adm('/events', 'POST', { name: 'Night 1' })).data; const m2 = (await adm('/events', 'POST', { name: 'Night 2' })).data;
  await adm(`/events/${m1.id}/start`, 'POST'); await adm(`/events/${m2.id}/start`, 'POST');
  const evs = (await adm('/events')).data;
  check(evs.filter((x) => x.active).length === 1 && evs.find((x) => x.active).id === m2.id, 'only one active event');
  check((await adm(`/users/${b.id}`, 'DELETE')).status === 200 && !(await adm('/users')).data.some((x) => x.id === b.id), 'admin can delete an attendee');
  ws2.close();
} catch (e) { fails.push('exception: ' + (e.stack || e)); }
finally { server.kill(); }

if (fails.length) { console.error('SMOKE FAIL\n - ' + fails.join('\n - ')); process.exit(1); }
console.log('SMOKE PASS (api, gallery privacy, haunt push, repeat haunts, kill switch, costumes, instant profile pushes, scout clues + ratings, static routes)');
