// HAUNT server: static files + JSON API + WebSocket push.
// Storage is a single JSON file (data/db.json); fine for one event.
import express from 'express';
import { WebSocketServer } from 'ws';
import { createServer } from 'node:http';
import { randomUUID, randomBytes } from 'node:crypto';
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');
const DATA_DIR = join(ROOT, 'data');
const DB_PATH = join(DATA_DIR, 'db.json');
const PORT = Number(process.env.PORT || 3000);
const HAUNT_COOLDOWN_MS = 60_000;

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
const db = existsSync(DB_PATH)
  ? JSON.parse(readFileSync(DB_PATH, 'utf8'))
  : { attendees: [], events: [] };
let saveTimer = null;
function save() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => writeFileSync(DB_PATH, JSON.stringify(db)), 50);
}
const byId = (id) => db.attendees.find((a) => a.id === id);
const publicCard = (a) => ({
  id: a.id, name: a.name, handle: a.handle || '', blurb: a.blurb || '', linkedin: a.linkedin || '',
  avatar: a.avatar || null, consent: !!a.consent,
  hauntedCount: db.events.filter((e) => e.type === 'haunt' && e.targetId === a.id).length,
  huntCount: db.events.filter((e) => e.type === 'haunt' && e.actorId === a.id).length,
});

// ---------- app ----------
const app = express();
app.use(express.json({ limit: '5mb' }));
app.use(express.static(join(ROOT, 'web'), { extensions: ['html'] }));

// register (manual provider; OAuth comes later)
app.post('/api/attendee', (req, res) => {
  const { name, handle, blurb, consent, descriptors, avatar, linkedin, provider } = req.body || {};
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
    provider: ['manual', 'csv', 'linkedin', 'github'].includes(provider) ? provider : 'manual',
    name: name.trim().slice(0, 60), handle: String(handle || '').trim().slice(0, 60),
    linkedin: /^https?:\/\/(www\.)?linkedin\.com\//.test(String(linkedin || '')) ? String(linkedin).slice(0, 200) : '',
    blurb: String(blurb || '').trim().slice(0, 200), consent: true,
    descriptors, avatar: typeof avatar === 'string' && avatar.startsWith('data:image/') && avatar.length < 200_000 ? avatar : null,
    createdAt: Date.now(),
  };
  db.attendees.push(a); save();
  broadcast({ type: 'gallery_changed' });
  broadcastScreen({ type: 'joined', attendee: publicCard(a) });
  res.json({ id: a.id, token: a.token });
});

// gallery: only consenting attendees, only what matching needs
app.get('/api/gallery', (_req, res) => {
  res.json(db.attendees.filter((a) => a.consent).map((a) => ({ id: a.id, name: a.name, descriptors: a.descriptors })));
});

app.get('/api/attendee/:id', (req, res) => {
  const a = byId(req.params.id);
  if (!a) return res.status(404).json({ error: 'not found' });
  res.json(publicCard(a));
});

// me: card + haunts, needs token
app.get('/api/me/:id', (req, res) => {
  const a = byId(req.params.id);
  if (!a || a.token !== req.query.token) return res.status(403).json({ error: 'forbidden' });
  const received = db.events.filter((e) => e.type === 'haunt' && e.targetId === a.id).map((e) => ({ ...e, by: publicCard(byId(e.actorId) || { id: '?', name: 'unknown' }) }));
  const given = db.events.filter((e) => e.type === 'haunt' && e.actorId === a.id).map((e) => ({ ...e, target: publicCard(byId(e.targetId) || { id: '?', name: 'unknown' }) }));
  res.json({ me: publicCard(a), received: received.reverse(), given: given.reverse() });
});

// kill switch
app.patch('/api/attendee/:id', (req, res) => {
  const a = byId(req.params.id);
  if (!a || a.token !== req.body?.token) return res.status(403).json({ error: 'forbidden' });
  if (typeof req.body.consent === 'boolean') a.consent = req.body.consent;
  if (typeof req.body.blurb === 'string') a.blurb = req.body.blurb.trim().slice(0, 200);
  save();
  broadcast({ type: 'gallery_changed' });
  res.json(publicCard(a));
});

// haunt: actor found target
const lastHaunt = new Map(); // `${actor}:${target}` -> ts
app.post('/api/haunt', (req, res) => {
  const { actorId, token, targetId, similarity } = req.body || {};
  const actor = byId(actorId); const target = byId(targetId);
  if (!actor || actor.token !== token) return res.status(403).json({ error: 'forbidden' });
  if (!target || !target.consent) return res.status(404).json({ error: 'target not findable' });
  if (actor.id === target.id) return res.status(400).json({ error: 'cannot haunt yourself' });
  const key = `${actor.id}:${target.id}`;
  const now = Date.now();
  if (now - (lastHaunt.get(key) || 0) < HAUNT_COOLDOWN_MS) return res.status(429).json({ error: 'cooldown', card: publicCard(target) });
  lastHaunt.set(key, now);
  const ev = { id: db.events.length + 1, type: 'haunt', actorId: actor.id, targetId: target.id, similarity: Number(similarity) || null, createdAt: now };
  db.events.push(ev); save();
  sendTo(target.id, { type: 'haunted', by: publicCard(actor), at: now });
  broadcastScreen({ type: 'event', event: { ...ev, actor: publicCard(actor), target: publicCard(target) } });
  res.json({ ok: true, card: publicCard(target) });
});

app.get('/api/events', (req, res) => {
  const limit = Math.min(Number(req.query.limit) || 50, 500);
  const events = db.events.slice(-limit).reverse().map((e) => ({ ...e, actor: publicCard(byId(e.actorId) || { id: '?', name: 'unknown' }), target: publicCard(byId(e.targetId) || { id: '?', name: 'unknown' }) }));
  res.json({ events, attendees: db.attendees.filter((a) => a.consent).map(publicCard) });
});

// ---------- websockets ----------
const server = createServer(app);
const wss = new WebSocketServer({ server, path: '/ws' });
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

ensureWeights().finally(() => server.listen(PORT, () => console.log(`HAUNT listening on http://localhost:${PORT}`)));
