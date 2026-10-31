// Presence (#33): who is on HAUNT right now, from any page.
// Online = /hunt or /me is open on their phone, so a haunt makes it shriek. Registered = findable (opted in, not blocked):
// /hunt still knows their face while they are offline, but a haunt on them only waits on their card. Only findable people
// are counted or listed (server/presence.js). mountPresence(button) turns a header button into a chip
// ("● 3 online / 12 registered") that opens the list. The chip hears the page's own socket (common.js re-fires every
// message as `haunt:ws`); a page without a socket passes { listen: true }.
import { api, connectWs, esc, getMe } from '/common.js';

let online = new Set(), findable = null, people = null; // people: GET /api/presence, loaded when the list opens
const chips = new Set();
let sheet = null, backdrop = null, opener = null, loading = null;

/** True while that person has /hunt or /me open, so a haunt makes their phone shriek. */
export const isOnline = (id) => online.has(id);
/** { online: Set of ids, findable: count or null before the first push }. `presencechange` fires on window on every update. */
export const presence = () => ({ online, findable });

function apply(msg) {
  online = new Set(msg.online || []);
  if (typeof msg.findable === 'number') findable = msg.findable;
  if (msg.people) people = msg.people;
  else if (people && (people.length !== findable || [...online].some((id) => !people.some((p) => p.id === id)))) people = null; // someone joined or left
  for (const el of chips) renderChip(el);
  if (sheet?.classList.contains('show')) { if (people) renderList(); else load(); }
  dispatchEvent(new Event('presencechange'));
}
addEventListener('haunt:ws', (e) => { if (e.detail?.type === 'presence') apply(e.detail); });
const load = () => (loading ||= api('/api/presence').then(apply, () => {}).finally(() => { loading = null; }));

function renderChip(el) {
  const n = online.size, known = findable != null; // "–" until the first push (the socket answers within a second)
  el.innerHTML = `<span class="dot${n ? '' : ' off'}"></span><span class="pc"><b>${known ? n : '–'} online</b><small>${known ? findable : '–'} registered</small></span>`;
  el.setAttribute('aria-label', known ? `${n} online now, ${findable} registered. Show who` : 'Who is online');
  el.hidden = false;
}

/** Turn `el` (a <button>) into the presence chip. listen: open a socket of our own (the page has none). */
export function mountPresence(el, { listen = false } = {}) {
  if (!el) return;
  chips.add(el);
  el.setAttribute('aria-haspopup', 'dialog');
  el.addEventListener('click', (e) => { e.stopPropagation(); openList(el); });
  renderChip(el);
  if (listen) connectWs({}, () => {});
  setTimeout(() => { if (findable == null) load(); }, 3000); // the socket normally answers within a second; this covers one that can't connect
}

function openList(from) {
  opener = from;
  if (!sheet) {
    backdrop = document.createElement('div'); backdrop.className = 'who-backdrop'; backdrop.addEventListener('click', closeList);
    sheet = document.createElement('div'); sheet.className = 'sheet who';
    sheet.setAttribute('role', 'dialog'); sheet.setAttribute('aria-modal', 'true'); sheet.setAttribute('aria-labelledby', 'who-title');
    sheet.addEventListener('click', (e) => { if (e.target.closest('.grab, .who-close')) closeList(); });
    document.body.append(backdrop, sheet);
    addEventListener('keydown', (e) => { if (e.key === 'Escape' && sheet.classList.contains('show')) closeList(); });
  }
  renderList();
  void sheet.offsetWidth; // start from the closed position so it slides in
  sheet.classList.add('show'); backdrop.classList.add('show');
  sheet.querySelector('.who-close').focus({ preventScroll: true });
  load(); // fresh names and faces every time it opens
}
function closeList() {
  sheet?.classList.remove('show'); backdrop?.classList.remove('show');
  opener?.focus({ preventScroll: true });
}

function renderList() {
  const meId = getMe()?.id, refocus = sheet.contains(document.activeElement);
  const all = [...(people || [])].sort((a, b) => a.name.localeCompare(b.name));
  const on = all.filter((p) => online.has(p.id)), off = all.filter((p) => !online.has(p.id));
  const row = (p) => `<li class="who-row">${p.avatar ? `<img class="who-av" src="${esc(p.avatar)}" alt="">` : '<span class="who-av">👤</span>'}<span class="who-name"><b>${esc(p.name)}${p.id === meId ? ' <span class="you">you</span>' : ''}</b>${p.handle ? `<small>@${esc(p.handle)}</small>` : ''}</span></li>`;
  const rows = (list, empty) => (people ? list.map(row).join('') || `<li class="mute">${empty}</li>` : '<li class="mute">Loading…</li>');
  const nOn = people ? on.length : online.size, nOff = people ? off.length : Math.max(0, (findable ?? 0) - online.size);
  sheet.innerHTML = `<button class="grab" aria-label="Close"></button>
    <h2 id="who-title"><span class="dot"></span>Online now<span class="n">${nOn}</span></h2>
    <p class="hint">HAUNT is open on their phone: haunt them and it shrieks.</p>
    <ul class="who-list">${rows(on, 'Nobody right now.')}</ul>
    <h2><span class="dot off"></span>Registered, not online<span class="n">${nOff}</span></h2>
    <p class="hint">/hunt still knows their face, but a haunt only waits on their card. No shriek.</p>
    <ul class="who-list">${rows(off, 'Everyone registered is online.')}</ul>
    <button class="secondary who-close">Close</button>`;
  if (refocus) sheet.querySelector('.who-close').focus({ preventScroll: true });
}
