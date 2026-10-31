import { api, connectWs, esc, fmtTime } from '/common.js';
import { presence } from '/presence.js';
import { renderScout } from '/scout.js';
const $ = (id) => document.getElementById(id);
const joinUrl = location.origin + '/register';
const q = qrcode(0, 'M'); q.addData(joinUrl); q.make(); $('qr').innerHTML = q.createSvgTag({ cellSize: 8, margin: 2 });
$('url').textContent = joinUrl.replace(/^https?:\/\//, '');
let events = [], attendees = [], freshId = null;
const av = (card) => card?.avatar ? `<img class="av" src="${esc(card.avatar)}" alt="">` : '<span class="av">👤</span>';
function render() {
  const haunts = events.filter((e) => e.type === 'haunt' && e.actor && e.target);
  $('n-people').textContent = attendees.length; $('n-haunts').textContent = haunts.length;
  $('feed').innerHTML = haunts.slice(0, 25).map((e) => `<li class="ev${e.id === freshId ? ' fresh' : ''}">${av(e.actor)}<b>${esc(e.actor.name)}</b> haunted ${av(e.target)}<b>${esc(e.target.name)}</b>${e.back ? ' <span class="back">back</span>' : ''}<time>${fmtTime(e.createdAt)}</time></li>`).join('')
    || '<li class="mute">Nobody haunted yet. Scan the code, register, then point your phone at someone.</li>';
  // count per person (by id: two people can share a name), newest card wins for the picture
  const top = (key) => [...haunts.reduce((m, e) => { const c = e[key]; const r = m.get(c.id) || { card: c, n: 0 }; r.n++; m.set(c.id, r); return m; }, new Map()).values()].sort((a, b) => b.n - a.n).slice(0, 5);
  const board = (rows) => rows.map((r, i) => `<li class="rank"><span class="n">${i + 1}</span>${av(r.card)}<b>${esc(r.card.name)}</b><span class="c">${r.n}×</span></li>`).join('') || '<li class="mute">—</li>';
  $('top-haunted').innerHTML = board(top('target'));
  $('top-hunters').innerHTML = board(top('actor'));
  renderOnline();
}
// who has HAUNT open right now (#33): a haunt on them shrieks on their phone. Their faces, so the room can find them
function renderOnline() {
  const { online } = presence(), on = attendees.filter((a) => online.has(a.id));
  $('n-online').textContent = online.size;
  $('online-now').innerHTML = on.map((a) => `<span class="on-face">${av(a)}<span>${esc(String(a.name).trim().split(/\s+/)[0])}</span></span>`).join('');
}
addEventListener('presencechange', renderOnline);
async function load() { const d = await api('/api/events?limit=200'); events = d.events; attendees = d.attendees; render(); renderScout(d.scout); }
await load();
// attendee_gone: someone turned findable off, so the headcount drops now (attendee_changed alters nothing shown here)
connectWs({ screen: '1' }, (msg) => {
  if (msg.type === 'event') { events.unshift(msg.event); freshId = msg.event.id; render(); }
  if (msg.type === 'scout') renderScout(msg.scout);
  if (msg.type === 'joined' || msg.type === 'gallery_changed' || msg.type === 'attendee_gone') load();
});
