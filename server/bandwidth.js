// Bandwidth cap (#36). Fly has no spending limit, and outbound data is the one Fly cost with no ceiling of its own:
// $0.02/GB to North America and Europe, up to $0.12/GB to Africa and India, and a phone's first visit pulls about 8 MB
// of face weights. The server counts every byte it writes (HTTP and WebSocket, per socket, every BANDWIDTH_TALLY_MS and
// when the socket closes) into DATA_DIR/bandwidth.json for the calendar month (UTC). Past BANDWIDTH_CAP_GB (fly.toml,
// default 10) every request except GET /api/version gets 503 and new sockets are refused until the 1st, so data costs
// at most the cap times $0.12 a month (10 GB: $1.20). The machine is capped in fly.toml: one machine, stopped when idle.
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const GB = 1e9;
const monthOf = (t) => new Date(t).toISOString().slice(0, 7); // '2026-11', UTC
const nextMonth = (t) => { const d = new Date(t); return Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 1); };

// The meter: bytes sent this month, kept on the volume so restarts and idle stops do not reset it. `now` is for the test.
export function bandwidthMeter(dataDir, { capGb = 10, now = Date.now } = {}) {
  const file = join(dataDir, 'bandwidth.json');
  let m = { month: monthOf(now()), bytes: 0 }, dirty = false;
  try { const saved = JSON.parse(readFileSync(file, 'utf8')); if (saved.month === m.month && Number.isFinite(saved.bytes)) m = saved; } catch {}
  const current = () => { const month = monthOf(now()); if (month !== m.month) { m = { month, bytes: 0 }; dirty = true; } return m; };
  return {
    capGb,
    add(n) { if (n > 0) { current().bytes += n; dirty = true; } },
    over: () => current().bytes >= capGb * GB,
    state: () => { const c = current(); return { month: c.month, usedGb: Math.round(c.bytes / 1e3) / 1e6, capGb, over: c.bytes >= capGb * GB }; },
    resumesAt: () => nextMonth(now()),
    save() { if (!dirty) return; dirty = false; try { writeFileSync(file, JSON.stringify(m)); } catch (e) { console.warn(`could not write ${file}: ${e.message}`); } },
  };
}

// The server side: `gate` is the first middleware, `watch(server)` counts the bytes, `allowSocket` refuses new sockets.
export function bandwidthCap(dataDir, env = process.env) {
  const meter = bandwidthMeter(dataDir, { capGb: Number(env.BANDWIDTH_CAP_GB) > 0 ? Number(env.BANDWIDTH_CAP_GB) : 10 });
  const counted = new Map(); // socket -> its bytesWritten already on the meter
  const tally = (s) => { const w = s.bytesWritten; meter.add(w - (counted.get(s) ?? 0)); counted.set(s, w); };
  setInterval(() => { for (const s of counted.keys()) tally(s); meter.save(); }, Number(env.BANDWIDTH_TALLY_MS) || 10_000).unref();
  const resumes = () => new Date(meter.resumesAt()).toISOString().slice(0, 10);
  return {
    state: meter.state,
    watch(server) { server.on('connection', (s) => { counted.set(s, 0); s.once('close', () => { tally(s); counted.delete(s); }); }); },
    allowSocket: (_info, cb) => cb(!meter.over(), 503, 'Bandwidth cap reached'), // ws verifyClient
    gate(req, res, next) {
      if (req.path === '/api/version' || !meter.over()) return next();
      res.status(503).set('retry-after', String(Math.ceil((meter.resumesAt() - Date.now()) / 1000)));
      if (req.path.startsWith('/api/')) return res.json({ error: 'bandwidth cap reached', resumes: resumes() });
      res.type('text/plain').send(`HAUNT is paused: this month's bandwidth cap (${meter.capGb} GB) is used up. Back on ${resumes()} (UTC).\n`);
    },
  };
}
