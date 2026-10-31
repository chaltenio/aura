// Admin API: list/block attendees, direct + group messages, open/close meetup events.
// Auth: ADMIN_TOKEN env var, sent as `x-admin-token` or `Authorization: Bearer`. Unset = admin disabled (503).
// Admins never see descriptors or attendee tokens, and cannot force consent on.
import { createHash, timingSafeEqual } from 'node:crypto';

const h = (s) => createHash('sha256').update(String(s)).digest();
const GROUPS = ['all', 'consenting', 'blocked', 'wallflowers', 'github', 'linkedin', 'google', 'apple', 'manual', 'csv'];

export function mountAdmin(app, { db, byId, save, sendTo, broadcast, broadcastScreen, isOnline }) {
  db.messages ||= []; db.meetups ||= [];
  const adminCard = (a) => ({
    id: a.id, name: a.name, handle: a.handle || '', provider: a.provider, consent: !!a.consent, blocked: !!a.blocked,
    avatar: a.avatar || null, createdAt: a.createdAt, online: isOnline(a.id),
    hauntedCount: db.events.filter((e) => e.type === 'haunt' && e.targetId === a.id).length,
    huntCount: db.events.filter((e) => e.type === 'haunt' && e.actorId === a.id).length,
  });
  const activeMeetup = () => db.meetups.find((m) => m.active) || null;

  const gate = (req, res, next) => {
    const want = process.env.ADMIN_TOKEN;
    if (!want) return res.status(503).json({ error: 'admin disabled: set ADMIN_TOKEN' });
    const got = req.get('x-admin-token') || (req.get('authorization') || '').replace(/^Bearer\s+/i, '');
    if (!got || !timingSafeEqual(h(got), h(want))) return res.status(401).json({ error: 'bad admin token' });
    next();
  };
  app.use('/api/admin', gate);

  app.get('/api/admin/overview', (_req, res) => res.json({
    attendees: db.attendees.length, consenting: db.attendees.filter((a) => a.consent && !a.blocked).length, blocked: db.attendees.filter((a) => a.blocked).length,
    online: db.attendees.filter((a) => isOnline(a.id)).length, haunts: db.events.length, messages: db.messages.length, activeEvent: activeMeetup(), groups: GROUPS,
  }));

  app.get('/api/admin/users', (_req, res) => res.json(db.attendees.map(adminCard).sort((a, b) => b.createdAt - a.createdAt)));

  // allow / disallow. A blocked user leaves the gallery, cannot haunt or be haunted, and is told on their socket.
  app.patch('/api/admin/users/:id', (req, res) => {
    const a = byId(req.params.id); if (!a) return res.status(404).json({ error: 'not found' });
    if (typeof req.body?.blocked !== 'boolean') return res.status(400).json({ error: 'blocked (boolean) required' });
    a.blocked = req.body.blocked; save();
    sendTo(a.id, { type: 'admin_status', blocked: a.blocked });
    broadcast({ type: 'gallery_changed' });
    res.json(adminCard(a));
  });

  // remove an attendee and their data (descriptors, avatar, events they are in)
  app.delete('/api/admin/users/:id', (req, res) => {
    const i = db.attendees.findIndex((a) => a.id === req.params.id); if (i < 0) return res.status(404).json({ error: 'not found' });
    const [a] = db.attendees.splice(i, 1);
    db.events = db.events.filter((e) => e.actorId !== a.id && e.targetId !== a.id); save();
    broadcast({ type: 'gallery_changed' });
    res.json({ ok: true });
  });

  // message one attendee ({to: id}) or a group ({group: 'all'|'consenting'|...}); delivered live over /ws as {type:'admin_message'}
  app.post('/api/admin/messages', (req, res) => {
    const { to, group } = req.body || {}; const text = String(req.body?.text || '').trim().slice(0, 500);
    if (!text) return res.status(400).json({ error: 'text required' });
    let targets;
    if (to) { const a = byId(to); if (!a) return res.status(404).json({ error: 'recipient not found' }); targets = [a]; }
    else if (GROUPS.includes(group)) {
      const hunts = (a) => db.events.some((e) => e.type === 'haunt' && (e.actorId === a.id || e.targetId === a.id));
      targets = db.attendees.filter((a) => group === 'all' ? true : group === 'consenting' ? a.consent && !a.blocked : group === 'blocked' ? a.blocked : group === 'wallflowers' ? a.consent && !hunts(a) : a.provider === group);
    } else return res.status(400).json({ error: 'to or a valid group required' });
    const msg = { id: db.messages.length + 1, to: to || null, group: to ? null : group, text, createdAt: Date.now(), recipients: targets.length, delivered: 0 };
    for (const a of targets) if (isOnline(a.id)) { sendTo(a.id, { type: 'admin_message', text, at: msg.createdAt }); msg.delivered++; }
    db.messages.push(msg); save();
    res.json(msg);
  });
  app.get('/api/admin/messages', (_req, res) => res.json(db.messages.slice(-100).reverse()));

  // meetup events: one active at a time; haunts are tagged with the active event id
  app.get('/api/admin/events', (_req, res) => res.json(db.meetups.map((m) => ({ ...m, haunts: db.events.filter((e) => e.meetupId === m.id).length })).reverse()));
  app.post('/api/admin/events', (req, res) => {
    const name = String(req.body?.name || '').trim().slice(0, 80); if (!name) return res.status(400).json({ error: 'name required' });
    const m = { id: db.meetups.length + 1, name, active: false, createdAt: Date.now(), startedAt: null, endedAt: null };
    db.meetups.push(m); save(); res.json(m);
  });
  const setActive = (m, on) => {
    if (on) for (const o of db.meetups) if (o.active) { o.active = false; o.endedAt = Date.now(); }
    m.active = on; if (on) { m.startedAt = Date.now(); m.endedAt = null; } else m.endedAt = Date.now();
    save(); broadcast({ type: 'event_changed', event: activeMeetup() && { id: m.id, name: m.name } }); broadcastScreen({ type: 'event_changed', event: on ? { id: m.id, name: m.name } : null });
  };
  app.post('/api/admin/events/:id/:action(start|end)', (req, res) => {
    const m = db.meetups.find((x) => x.id === Number(req.params.id)); if (!m) return res.status(404).json({ error: 'not found' });
    setActive(m, req.params.action === 'start'); res.json(m);
  });
  return { activeMeetup };
}
