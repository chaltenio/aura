import { api, connectWs, esc, fmtTime } from '/common.js';
const $ = (id) => document.getElementById(id);
const q = qrcode(0, 'M'); q.addData(location.origin + '/register'); q.make(); $('qr').innerHTML = q.createSvgTag({ cellSize: 8, margin: 2 });
let events = [], attendees = [];
function render() {
  $('n-people').textContent = attendees.length; $('n-haunts').textContent = events.filter((e) => e.type === 'haunt').length;
  $('feed').innerHTML = events.slice(0, 25).map((e) => `<li>👻 <b>${esc(e.actor.name)}</b> haunted <b>${esc(e.target.name)}</b><time>${fmtTime(e.createdAt)}</time></li>`).join('') || '<li class="mute">Nothing yet…</li>';
  const top = (key) => Object.entries(events.reduce((m, e) => (m[e[key].name] = (m[e[key].name] || 0) + 1, m), {})).sort((a, b) => b[1] - a[1]).slice(0, 5);
  $('top-haunted').innerHTML = top('target').map(([n, c]) => `<li><b>${esc(n)}</b> <span class="mute">${c}×</span></li>`).join('') || '<li class="mute">—</li>';
  $('top-hunters').innerHTML = top('actor').map(([n, c]) => `<li><b>${esc(n)}</b> <span class="mute">${c}×</span></li>`).join('') || '<li class="mute">—</li>';
}
async function load() { const d = await api('/api/events?limit=200'); events = d.events; attendees = d.attendees; render(); }
await load();
// attendee_gone: someone turned findable off, so the headcount drops now (attendee_changed alters nothing shown here)
connectWs({ screen: '1' }, (msg) => { if (msg.type === 'event') { events.unshift(msg.event); render(); } if (msg.type === 'joined' || msg.type === 'gallery_changed' || msg.type === 'attendee_gone') load(); });
