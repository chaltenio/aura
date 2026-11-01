// HAUNT server: static files + JSON API + WebSocket push.
// Storage is a single JSON file (data/db.json); fine for one event.
import express from 'express';
import { WebSocketServer } from 'ws';
import { createServer } from 'node:http';
import { randomUUID, randomBytes } from 'node:crypto';
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { mountAuth, sessionProfile } from './auth.js';
import { ensureProfile, profileLoading } from './profile.js';
import { mountAdmin } from './admin.js';
import { deployInfo } from './version.js';
import { mountPresence } from './presence.js';
import { mountScout } from './scout.js';
import { cors } from './cors.js';
import { bandwidthCap } from './bandwidth.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');
const DATA_DIR = process.env.DATA_DIR || join(ROOT, 'data');
const DB_PATH = join(DATA_DIR, 'db.json');
const PORT = Number(process.env.PORT || 3000);
const STARTED_AT = Date.now();

// ---------- FaceX weights (gitignored binaries; fetched from the FaceX GitHub release on first start) ----------
const FACEX_DIR = join(ROOT, 'web', 'vendor', 'facex');
const FACEX_WEIGHTS = {
  'edgeface_xs_fp32.bin': 'https://github.com/facex-engine/facex/releases/download/v1.0.0/edgeface_xs_fp32.bin',
  'det_500m_int8.bin': 'https://github.com/facex-engine/facex/releases/download/v1.0.0/det_500m_int8.bin',
};
async function ensureWeights() {
  for (const [name, url] of Object.entries(FACEX_WEIGHTS)) {
    const path = join(FACEX_DIR, name);
    if (existsSync(path)) continue;
    try {
      console.log(`downloading ${name} …`);
      const res = await fetch(url, { redirect: 'follow' });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      writeFileSync(path, Buffer.from(await res.arrayBuffer()));
      console.log(`saved ${name}`);
    } catch (e) { console.warn(`could not fetch ${name}: ${e.message} (FaceX engine will not load; Human engine still works)`); }
  }
}

// ---------- storage ----------
mkdirSync(DATA_DIR, { recursive: true });
const VERSION = deployInfo(DATA_DIR); // { version: git sha, deploy: v-number (+1 per deploy), deployedAt }
console.log(VERSION.deploy ? `deploy v${VERSION.deploy} (${VERSION.version})` : `${VERSION.version} build (no deploy number)`);
const bandwidth = bandwidthCap(DATA_DIR); // #36: bytes sent this month (data/bandwidth.json); past BANDWIDTH_CAP_GB everything but /api/version is 503
const db = existsSync(DB_PATH)
  ? JSON.parse(readFileSync(DB_PATH, 'utf8'))
  : { attendees: [], events: [] };
let saveTimer = null, presence = null; // presence (#33) is set once the socket server exists
function save() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => writeFileSync(DB_PATH, JSON.stringify(db)), 50);
  presence?.update(); // a join, an opt-out or an admin block changes who is findable
}
const byId = (id) => db.attendees.find((a) => a.id === id);
// costume: optional look picked at /register or /me (the list lives in web/costume.js); the server only keeps a short id. 'plain' or junk = none.
const cleanCostume = (c) => (typeof c === 'string' && /^[a-z]{1,20}$/.test(c) && c !== 'plain' ? c : null);
const publicCard = (a) => ({
  id: a.id, name: a.name, handle: a.handle || '', blurb: a.blurb || '', linkedin: a.linkedin || '', profile: a.profile && !a.profile.error ? a.profile : null,
  profileLoading: profileLoading(a), // a GitHub lookup is running; the card is pushed again when it lands. Always a boolean: phones merge pushes
  avatar: a.avatar || null, consent: !!a.consent, costume: a.costume || null,
  hauntedCount: db.events.filter((e) => e.type === 'haunt' && e.targetId === a.id).length,
  huntCount: db.events.filter((e) => e.type === 'haunt' && e.actorId === a.id).length,
});
// A profile edit reaches every open page at once (#30): the changed card itself is pushed, so /hunt patches the person it
// already holds (their costume changes on the next frame, an open card re-renders) instead of refetching every face in the
// gallery. Someone not findable (opted out, blocked) goes out as their id only, never their card. No avatar: /me cannot change it.
function pushCard(a) {
  if (!a.consent || a.blocked) return broadcast({ type: 'attendee_gone', id: a.id });
  const card = publicCard(a); delete card.avatar;
  broadcast({ type: 'attendee_changed', attendee: card });
}
const cardChanged = (a) => { save(); pushCard(a); }; // a GitHub lookup landed on this card

// ---------- app ----------
const app = express();
app.use(bandwidth.gate); // first in line: past the monthly cap nothing else runs (server/bandwidth.js)
app.use('/api', cors); // the Base44 mirror of web/ calls the API cross-origin (server/cors.js, FRONTEND_ORIGINS)
app.use(express.json({ limit: '5mb' }));
app.use(express.static(join(ROOT, 'web'), { extensions: ['html'] }));
if (process.env.DEBUG_FIXTURES) app.use('/__fixtures', express.static(DATA_DIR)); // local debugging only

mountAuth(app);
const isOnline = (id) => [...(sockets.get(id) || [])].some((ws) => ws.readyState === 1);
const admin = mountAdmin(app, { db, byId, save, sendTo, broadcast, broadcastScreen, isOnline });
const scout = mountScout(app, { db, byId, save, sendTo, broadcastScreen, publicCard, dataDir: DATA_DIR, isOnline }); // the Scout (docs/scout/README.md): POST /api/rating, match events, state { scout } clues

// register. A signed-in session (GitHub/LinkedIn/Google/Apple) supplies provider, id, avatar and defaults; otherwise 'manual' or 'csv'.
app.post('/api/attendee', (req, res) => {
  const body = req.body || {};
  const sess = sessionProfile(req);
  if (sess) { body.provider = sess.provider; body.providerId = sess.providerId; body.name = body.name || sess.name; body.handle = body.handle || sess.handle; body.avatar = body.avatar || sess.avatar; }
  const { name, handle, blurb, consent, descriptors, avatar, linkedin, provider, providerId } = body;
  if (!name || typeof name !== 'string' || name.trim().length < 1) return res.status(400).json({ error: 'name required' });
  if (consent !== true) return res.status(400).json({ error: 'consent required' });
  if (!Array.isArray(descriptors) || descriptors.length < 1) return res.status(400).json({ error: 'at least one face descriptor required' });
  for (const d of descriptors) {
    if (!Array.isArray(d) || d.length < 128 || d.some((x) => typeof x !== 'number' || !Number.isFinite(x))) {
      return res.status(400).json({ error: 'bad descriptor' });
    }
  }
  const a = {
    id: randomUUID(), token: randomBytes(16).toString('hex'),
    provider: ['manual', 'csv', 'linkedin', 'github', 'google', 'apple'].includes(provider) ? provider : 'manual', providerId: providerId ? String(providerId).slice(0, 80) : null,
    name: name.trim().slice(0, 60), handle: String(handle || '').trim().slice(0, 60),
    linkedin: /^https?:\/\/(www\.)?linkedin\.com\//.test(String(linkedin || '')) ? String(linkedin).slice(0, 200) : '',
    blurb: String(blurb || '').trim().slice(0, 200), consent: true, costume: cleanCostume(body.costume),
    descriptors, avatar: typeof avatar === 'string' && avatar.startsWith('data:image/') && avatar.length < 200_000 ? avatar : null,
    createdAt: Date.now(),
  };
  db.attendees.push(a); save();
  ensureProfile(a, cardChanged, 0).catch(() => {}); // warm the GitHub profile cache in the background; the card is pushed when it lands
  broadcast({ type: 'gallery_changed' });
  broadcastScreen({ type: 'joined', attendee: publicCard(a) });
  res.json({ id: a.id, token: a.token });
});

// version: git sha, deploy number (one more per deploy, server/version.js) and when it went live, boot time, counts,
// and this month's outbound data against the cap (server/bandwidth.js); still answers past the cap
app.get('/api/version', (_req, res) => res.json({ ...VERSION, startedAt: STARTED_AT, attendees: db.attendees.length, events: db.events.length, bandwidth: bandwidth.state() }));

// gallery: only consenting attendees, only what matching needs
app.get('/api/gallery', (_req, res) => {
  res.json(db.attendees.filter((a) => a.consent && !a.blocked).map((a) => ({ id: a.id, name: a.name, costume: a.costume || null, descriptors: a.descriptors })));
});

app.get('/api/attendee/:id', async (req, res) => {
  const a = byId(req.params.id);
  if (!a) return res.status(404).json({ error: 'not found' });
  await ensureProfile(a, cardChanged).catch(() => {});
  res.json(publicCard(a));
});

// me: card + haunts + tonight's connections (one row per person), needs token.
// Consent is a server-side filter: a counterpart who is gone or opted out is left out of all three lists.
app.get('/api/me/:id', async (req, res) => {
  const a = byId(req.params.id);
  if (!a || a.token !== req.query.token) return res.status(403).json({ error: 'forbidden' });
  await ensureProfile(a, cardChanged).catch(() => {});
  const received = [], given = [], conns = new Map(); // otherId -> { card, youHaunted, hauntedYou, lastAt }
  for (const e of db.events) {
    const mine = e.actorId === a.id;
    if (e.type !== 'haunt' || mine === (e.targetId === a.id)) continue; // not about me (or a self-haunt)
    const other = byId(mine ? e.targetId : e.actorId);
    if (!other || other.consent !== true) continue;
    let c = conns.get(other.id);
    if (!c) conns.set(other.id, c = { card: publicCard(other), youHaunted: 0, hauntedYou: 0, lastAt: 0 });
    if (mine) { c.youHaunted++; given.push({ ...e, target: c.card }); } else { c.hauntedYou++; received.push({ ...e, by: c.card }); }
    c.lastAt = Math.max(c.lastAt, e.createdAt || 0);
  }
  const connections = [...conns.values()].sort((x, y) => y.lastAt - x.lastAt);
  res.json({ me: publicCard(a), received: received.reverse(), given: given.reverse(), connections });
});

// profile edits and the kill switch. Every change reaches every open page at once (pushCard).
app.patch('/api/attendee/:id', (req, res) => {
  const a = byId(req.params.id);
  if (!a || a.token !== req.body?.token) return res.status(403).json({ error: 'forbidden' });
  const wasFindable = a.consent && !a.blocked;
  if (typeof req.body.consent === 'boolean') a.consent = req.body.consent;
  if (typeof req.body.blurb === 'string') a.blurb = req.body.blurb.trim().slice(0, 200);
  if (typeof req.body.handle === 'string') {
    const handle = req.body.handle.trim().replace(/^@/, '').slice(0, 60);
    if (handle !== a.handle) { a.handle = handle; a.profile = null; ensureProfile(a, cardChanged, 0).catch(() => {}); } // an unchanged handle keeps its profile
  }
  if (typeof req.body.linkedin === 'string') a.linkedin = /^https?:\/\/(www\.)?linkedin\.com\//.test(req.body.linkedin) ? req.body.linkedin.slice(0, 200) : '';
  if ('costume' in req.body) a.costume = cleanCostume(req.body.costume);
  save();
  // findable again: phones need this face's descriptors back, so they refetch the gallery; every other edit is pushed as the card
  if (!wasFindable && a.consent && !a.blocked) broadcast({ type: 'gallery_changed' }); else pushCard(a);
  res.json(publicCard(a));
});

// haunt: actor found target. No rate limit: a repeat haunt on the same person is written and pushed like the first.
app.post('/api/haunt', (req, res) => {
  const { actorId, token, targetId, similarity } = req.body || {}; const back = req.body?.back === true;
  const actor = byId(actorId); const target = byId(targetId);
  if (!actor || actor.token !== token) return res.status(403).json({ error: 'forbidden' });
  if (actor.blocked) return res.status(403).json({ error: 'blocked' });
  if (!target || !target.consent || target.blocked) return res.status(404).json({ error: 'target not findable' });
  if (actor.id === target.id) return res.status(400).json({ error: 'cannot haunt yourself' });
  // haunt back: only toward someone who haunted you first
  if (back && !db.events.some((e) => e.type === 'haunt' && e.actorId === target.id && e.targetId === actor.id)) return res.status(400).json({ error: 'nothing to haunt back' });
  const now = Date.now();
  const ev = { id: db.events.length + 1, type: 'haunt', actorId: actor.id, targetId: target.id, similarity: Number(similarity) || null, createdAt: now, meetupId: admin.activeMeetup()?.id || null, ...(back && { back: true }) };
  db.events.push(ev); save();
  sendTo(target.id, { type: 'haunted', by: publicCard(actor), at: now, hauntId: ev.id, ...(back && { back: true }) }); // hauntId: the rating buttons name this haunt
  broadcastScreen({ type: 'event', event: { ...ev, actor: publicCard(actor), target: publicCard(target) } });
  res.json({ ok: true, card: publicCard(target), hauntId: ev.id });
});

app.get('/api/events', (req, res) => {
  const limit = Math.min(Number(req.query.limit) || 50, 500);
  const events = db.events.slice(-limit).reverse().map((e) => ({ ...e, actor: publicCard(byId(e.actorId) || { id: '?', name: 'unknown' }), target: publicCard(byId(e.targetId) || { id: '?', name: 'unknown' }) }));
  res.json({ events, attendees: db.attendees.filter((a) => a.consent && !a.blocked).map(publicCard), scout: scout.state() }); // scout: first paint of the /screen panel
});

// ---------- websockets ----------
const server = createServer(app);
bandwidth.watch(server); // counts every byte written on every socket, HTTP and WebSocket alike
const wss = new WebSocketServer({ server, path: '/ws', verifyClient: bandwidth.allowSocket }); // past the cap: 503, no socket
const sockets = new Map(); // attendeeId -> Set<ws>
const screens = new Set();
wss.on('connection', (ws, req) => {
  const url = new URL(req.url, 'http://x');
  const attendee = url.searchParams.get('attendee');
  const isScreen = url.searchParams.get('screen') === '1';
  if (isScreen) screens.add(ws);
  if (attendee) { if (!sockets.has(attendee)) sockets.set(attendee, new Set()); sockets.get(attendee).add(ws); }
  ws.on('close', () => { screens.delete(ws); if (attendee) sockets.get(attendee)?.delete(ws); });
  ws.on('message', () => {}); // clients only listen
  ws.send(JSON.stringify({ type: 'hello', attendees: db.attendees.filter((a) => a.consent).length }));
});
function sendTo(id, msg) { for (const ws of sockets.get(id) || []) if (ws.readyState === 1) ws.send(JSON.stringify(msg)); }
function broadcast(msg) { const s = JSON.stringify(msg); for (const ws of wss.clients) if (ws.readyState === 1) ws.send(s); }
function broadcastScreen(msg) { const s = JSON.stringify(msg); for (const ws of screens) if (ws.readyState === 1) ws.send(s); }
presence = mountPresence(app, { db, wss, sockets, broadcast }); // who is online (#33): heartbeat, `presence` push, GET /api/presence

ensureWeights().finally(() => server.listen(PORT, () => console.log(`HAUNT listening on http://localhost:${PORT}`)));
