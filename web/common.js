// Shared helpers: identity in localStorage, API, WebSocket, audio unlock, flash, toast.
export const ME_KEY = 'haunt.me';
export const getMe = () => { try { return JSON.parse(localStorage.getItem(ME_KEY) || 'null'); } catch { return null; } };
export const setMe = (me) => { try { localStorage.setItem(ME_KEY, JSON.stringify(me)); } catch {} };
export const clearMe = () => { try { localStorage.removeItem(ME_KEY); } catch {} };

// Where the API and /ws live. '' = this origin (Fly serves pages and API together). The Base44 mirror
// (scripts/base44.mjs) puts window.HAUNT_API = the Fly URL in every page's <head>, so the same pages call the Fly
// API and socket cross-origin and both URLs share one room. Call the API only through api() / API + path.
export const API = String(globalThis.HAUNT_API || '').replace(/\/+$/, '');
// Cross-origin sign-in: a cookie on the API's domain would be a third-party cookie here, so the OAuth callback hands
// the session back in the URL fragment (#haunt_session=...; server/auth.js) and api() sends it as a header.
const SESSION_KEY = 'haunt.session';
const getSession = () => { try { return localStorage.getItem(SESSION_KEY) || ''; } catch { return ''; } };
{ const m = location.hash.match(/^#haunt_session=([\w-]+\.[\w-]+)$/); if (m) { try { localStorage.setItem(SESSION_KEY, m[1]); } catch {} history.replaceState(null, '', location.pathname + location.search); } }
/** Href that starts OAuth sign-in with `provider` and comes back to this page signed in, on either origin. */
export const signInHref = (provider) => `${API}/auth/${encodeURIComponent(provider)}${API ? `?return=${encodeURIComponent(location.origin + location.pathname)}` : ''}`;

export async function api(path, { method = 'GET', body } = {}) {
  const headers = body ? { 'content-type': 'application/json' } : {};
  // only where the server reads the session (writes, /api/session*), so plain GETs stay simple requests with no preflight
  const sess = getSession(); if (sess && (method !== 'GET' || path.startsWith('/api/session'))) headers['x-haunt-session'] = sess;
  const res = await fetch(API + path, { method, headers, body: body ? JSON.stringify(body) : undefined });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) { const err = new Error(data.error || res.statusText); err.status = res.status; err.data = data; throw err; }
  return data;
}

export function connectWs(params, onMessage) {
  const base = new URL(API || location.origin);
  const url = `${base.protocol === 'https:' ? 'wss' : 'ws'}://${base.host}/ws?${new URLSearchParams(params)}`;
  let ws, closed = false, delay = 500;
  const open = () => {
    ws = new WebSocket(url);
    ws.onmessage = (e) => { try { const m = JSON.parse(e.data); if (m.type === 'admin_message') toast(`<b>Organizer:</b> ${esc(m.text)}`, 12000); else if (m.type === 'admin_status' && m.blocked) toast('An organizer has paused your access.', 12000); onMessage(m); } catch {} };
    ws.onopen = () => { delay = 500; };
    ws.onclose = () => { if (!closed) setTimeout(open, delay = Math.min(delay * 2, 8000)); };
  };
  open();
  document.addEventListener('visibilitychange', () => { if (!document.hidden && ws && ws.readyState > 1) open(); });
  return () => { closed = true; ws?.close(); };
}

// ---- sound + vibrate: on by default ----
// A page may only start audio inside a user gesture (iOS always, Chrome until the page is tapped), so every page
// arms it on its first tap anywhere; nobody has to find an "arm sound" button. Vibrate (Android; iOS Safari has
// none) does not wait for audio, only for one earlier tap on the page.
let ctx = null;
export function unlockAudio() {
  try {
    if (!ctx) { ctx = new (window.AudioContext || window.webkitAudioContext)(); ctx.onstatechange = () => dispatchEvent(new Event('soundchange')); }
    const buf = ctx.createBuffer(1, 1, 22050); const src = ctx.createBufferSource(); src.buffer = buf; src.connect(ctx.destination); src.start(0);
    if (ctx.state !== 'running') ctx.resume();
  } catch {}
  return ctx;
}
/** True once this page can play the shriek; `soundchange` fires on window when it flips. */
export const soundOn = () => ctx?.state === 'running';
// skip a touchend that ends a scroll (not a gesture): it would leave a suspended context that shrieks late, on the next tap
for (const type of ['touchend', 'click', 'keydown']) addEventListener(type, () => { if (!soundOn() && navigator.userActivation?.isActive !== false) unlockAudio(); }, { capture: true, passive: true });
export function shriek() {
  if (navigator.vibrate) { try { navigator.vibrate([200, 80, 300]); } catch {} }
  if (!ctx) return;
  try {
    if (ctx.state !== 'running') ctx.resume();
    const t = ctx.currentTime;
    const o = ctx.createOscillator(); const g = ctx.createGain();
    o.type = 'sawtooth'; o.frequency.setValueAtTime(220, t); o.frequency.exponentialRampToValueAtTime(1400, t + 0.25); o.frequency.exponentialRampToValueAtTime(180, t + 1.1);
    g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(0.6, t + 0.05); g.gain.exponentialRampToValueAtTime(0.0001, t + 1.2);
    o.connect(g).connect(ctx.destination); o.start(t); o.stop(t + 1.25);
    const n = ctx.createBufferSource(); const nb = ctx.createBuffer(1, ctx.sampleRate * 0.6, ctx.sampleRate); const d = nb.getChannelData(0); for (let i = 0; i < d.length; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / d.length);
    n.buffer = nb; const ng = ctx.createGain(); ng.gain.value = 0.25; n.connect(ng).connect(ctx.destination); n.start(t + 0.1);
  } catch {}
}
export function flash() {
  let el = document.getElementById('flash');
  if (!el) { el = document.createElement('div'); el.id = 'flash'; document.body.appendChild(el); }
  el.classList.remove('on'); void el.offsetWidth; el.classList.add('on');
}
export function toast(html, ms = 5000) {
  let el = document.querySelector('.toast');
  if (!el) {
    el = document.createElement('div'); el.className = 'toast'; el.setAttribute('role', 'alert'); document.body.appendChild(el);
    el.addEventListener('click', (e) => { if (!e.target.closest('button, a')) el.classList.remove('show'); }); // tap the alert to dismiss it
  }
  el.innerHTML = html; el.classList.add('show');
  clearTimeout(el._t); el._t = setTimeout(() => el.classList.remove('show'), ms);
}
export function hauntedAlert(msg) {
  shriek(); flash();
  const by = msg.by || {}; const name = esc(by.name || 'someone');
  const canBack = !msg.back && by.id && getMe(); // a haunt back gets no button, so it can't ping-pong
  const av = by.avatar ? `<img class="t-av" src="${esc(by.avatar)}" alt="">` : ''; // their face: so you can spot who it was in the room
  toast(`<div class="t-row">${av}<div><b>${msg.back ? `👻 ${name} haunted you back!` : `👻 You've been haunted by ${name}`}</b>${by.handle ? ` <span class="mute">@${esc(by.handle)}</span>` : ''}${by.blurb ? `<div class="mute">${esc(by.blurb)}</div>` : ''}</div></div>${canBack ? '<button class="haunt-back">Haunt back</button>' : ''}`, 12000);
  const btn = canBack && document.querySelector('.toast .haunt-back');
  if (btn) btn.addEventListener('click', async () => {
    btn.disabled = true; btn.textContent = 'Haunting…'; btn.textContent = await hauntBack(by);
    const el = document.querySelector('.toast'); clearTimeout(el._t); el._t = setTimeout(() => el.classList.remove('show'), 2500);
  });
}
/** Haunt back whoever haunted this phone (`by` = card from the haunted push). Call from a tap. Returns a short status for the UI. */
export async function hauntBack(by) {
  const me = getMe(); if (!me) return 'Register on this phone first';
  unlockAudio(); // inside the tap: also arms sound on this phone so the next haunt is heard
  try { await api('/api/haunt', { method: 'POST', body: { actorId: me.id, token: me.token, targetId: by?.id, similarity: null, back: true } }); return 'Haunted back 👻'; }
  catch (e) { return e.status === 404 ? "They've vanished" : 'Failed: ' + e.message; }
}
export async function wakeLock() { try { if (navigator.wakeLock) await navigator.wakeLock.request('screen'); } catch {} }
export const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
export const fmtTime = (ts) => new Date(ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

/** HTML for the public profile block of a card (GitHub enrichment + LinkedIn link). Safe to inject. */
export function renderProfile(card) {
  if (!card) return '';
  const p = card.profile; const bits = [];
  if (p) {
    if (p.bio) bits.push(`<div class="p-bio">${esc(p.bio)}</div>`);
    const meta = [p.company, p.location].filter(Boolean).map(esc).join(' · ');
    if (meta) bits.push(`<div class="p-meta">${meta}</div>`);
    const stats = [];
    if (p.pushesThisWeek != null) stats.push(`<b>${p.pushesThisWeek}</b> push${p.pushesThisWeek === 1 ? '' : 'es'} this week`);
    if (p.followers != null) stats.push(`<b>${p.followers}</b> followers`);
    if (p.publicRepos != null) stats.push(`<b>${p.publicRepos}</b> repos`);
    if (stats.length) bits.push(`<div class="p-stats">${stats.join(' · ')}</div>`);
    if (p.activeRepos?.length) bits.push(`<div class="p-meta">Working on: ${p.activeRepos.map((r) => `<a href="https://github.com/${esc(r)}" target="_blank" rel="noopener">${esc(r.split('/').pop())}</a>`).join(', ')}</div>`);
    if (p.recentRepos?.length) bits.push(`<ul class="p-repos">${p.recentRepos.slice(0, 3).map((r) => `<li><a href="${esc(r.url)}" target="_blank" rel="noopener">${esc(r.name)}</a>${r.language ? ` <span class="mute">${esc(r.language)}</span>` : ''}${r.description ? `<div class="mute">${esc(r.description).slice(0, 90)}</div>` : ''}</li>`).join('')}</ul>`);
  }
  const links = [];
  if (p?.url) links.push(`<a href="${esc(p.url)}" target="_blank" rel="noopener">GitHub</a>`);
  else if (card.handle) links.push(`<a href="https://github.com/${esc(card.handle)}" target="_blank" rel="noopener">GitHub</a>`);
  if (card.linkedin) links.push(`<a href="${esc(card.linkedin)}" target="_blank" rel="noopener">LinkedIn</a>`);
  if (p?.blog) links.push(`<a href="${esc(/^https?:/.test(p.blog) ? p.blog : 'https://' + p.blog)}" target="_blank" rel="noopener">Site</a>`);
  if (links.length) bits.push(`<div class="p-links">${links.join(' · ')}</div>`);
  return bits.length ? `<div class="profile">${bits.join('')}</div>` : '';
}

/** What people type into the LinkedIn box -> the https://www.linkedin.com/... URL the server keeps ('' if it is not LinkedIn). */
export function normLinkedin(v) {
  let s = String(v || '').trim(); if (!s) return '';
  if (/^[\w-]{3,100}$/.test(s)) return `https://www.linkedin.com/in/${s}`; // bare profile slug
  s = s.replace(/^(https?:\/\/)?([a-z]{2,3}\.)?(www\.)?linkedin\.com/i, 'https://www.linkedin.com');
  return /^https:\/\/www\.linkedin\.com\//.test(s) ? s : '';
}
/** "@octocat", "github.com/octocat" or a pasted profile URL -> "octocat". */
export const normGithub = (v) => String(v || '').trim().replace(/^@/, '').replace(/^(https?:\/\/)?(www\.)?github\.com\//i, '').replace(/[/?#].*$/, '');
