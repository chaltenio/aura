// Presence (#33): who has HAUNT open right now, so everyone can see who a haunt reaches live.
// /hunt and /me open /ws?attendee=<id> and both shriek on a `haunted` push, so while one of those sockets is alive the
// person is online. Everyone findable (registered, opted in, not blocked) is still recognised by /hunt when offline; a haunt
// on them is saved to their card, without the shriek. Only findable people are ever counted or listed.
// Every socket gets `presence {online: [ids], findable: n}` when it connects and again whenever either changes;
// GET /api/presence adds names and faces for the list. A locked phone or a dropped network never sends a close, so a
// heartbeat pings every socket and drops one that missed its pong; a short grace keeps a reload, or the hop from /hunt
// to /me, from flickering someone offline.
const HEARTBEAT_MS = Number(process.env.PRESENCE_HEARTBEAT_MS) || 15_000;
const GRACE_MS = Number(process.env.PRESENCE_GRACE_MS) || 4_000;

export function mountPresence(app, { db, wss, sockets, broadcast }) {
  const findable = () => db.attendees.filter((a) => a.consent && !a.blocked);
  const live = (id) => [...(sockets.get(id) || [])].some((ws) => ws.readyState === 1);
  const leftAt = new Map(); // attendeeId -> when their last socket closed; still online until the grace runs out
  const isOnline = (id) => live(id) || Date.now() - (leftAt.get(id) ?? -Infinity) < GRACE_MS;
  const snapshot = () => {
    const people = findable();
    return { online: people.filter((a) => isOnline(a.id)).map((a) => a.id), findable: people.length };
  };

  // at most one push per 250 ms, and only when the online set or the findable count changed
  let sent = '', pending = null;
  function update() {
    if (pending) return;
    pending = setTimeout(() => {
      pending = null;
      const s = snapshot(), key = `${s.findable}:${[...s.online].sort().join()}`;
      if (key !== sent) { sent = key; broadcast({ type: 'presence', ...s }); }
    }, 250);
  }

  // registered after index.js's own handler, so `sockets` already holds this socket (and has let go of it on close)
  wss.on('connection', (ws, req) => {
    const attendee = new URL(req.url, 'http://x').searchParams.get('attendee');
    ws.isAlive = true;
    ws.on('pong', () => { ws.isAlive = true; });
    ws.send(JSON.stringify({ type: 'presence', ...snapshot() }));
    if (attendee) { leftAt.delete(attendee); update(); }
    ws.on('close', () => {
      if (!attendee || live(attendee)) return; // another page of theirs is still open
      leftAt.set(attendee, Date.now());
      setTimeout(update, GRACE_MS + 50);
    });
  });

  const beat = setInterval(() => {
    for (const ws of wss.clients) {
      if (!ws.isAlive) { ws.terminate(); continue; } // missed the last pong: locked, asleep or out of signal
      ws.isAlive = false;
      try { ws.ping(); } catch {}
    }
    update();
  }, HEARTBEAT_MS);
  beat.unref?.();

  app.get('/api/presence', (_req, res) => {
    const s = snapshot(), on = new Set(s.online);
    const people = findable()
      .map((a) => ({ id: a.id, name: a.name, handle: a.handle || '', avatar: a.avatar || null, costume: a.costume || null, online: on.has(a.id) }))
      .sort((x, y) => y.online - x.online || x.name.localeCompare(y.name));
    res.json({ ...s, people });
  });

  return { update, isOnline };
}
