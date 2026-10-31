// Shared helpers: identity in localStorage, API, WebSocket, audio unlock, flash, toast.
export const ME_KEY = 'haunt.me';
export const getMe = () => { try { return JSON.parse(localStorage.getItem(ME_KEY) || 'null'); } catch { return null; } };
export const setMe = (me) => { try { localStorage.setItem(ME_KEY, JSON.stringify(me)); } catch {} };
export const clearMe = () => { try { localStorage.removeItem(ME_KEY); } catch {} };

export async function api(path, { method = 'GET', body } = {}) {
  const res = await fetch(path, { method, headers: body ? { 'content-type': 'application/json' } : {}, body: body ? JSON.stringify(body) : undefined });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) { const err = new Error(data.error || res.statusText); err.status = res.status; err.data = data; throw err; }
  return data;
}

export function connectWs(params, onMessage) {
  const proto = location.protocol === 'https:' ? 'wss' : 'ws';
  const url = `${proto}://${location.host}/ws?${new URLSearchParams(params)}`;
  let ws, closed = false, delay = 500;
  const open = () => {
    ws = new WebSocket(url);
    ws.onmessage = (e) => { try { onMessage(JSON.parse(e.data)); } catch {} };
    ws.onopen = () => { delay = 500; };
    ws.onclose = () => { if (!closed) setTimeout(open, delay = Math.min(delay * 2, 8000)); };
  };
  open();
  document.addEventListener('visibilitychange', () => { if (!document.hidden && ws && ws.readyState > 1) open(); });
  return () => { closed = true; ws?.close(); };
}

// ---- audio: must be unlocked inside a user gesture on iOS ----
let ctx = null;
export function unlockAudio() {
  try {
    ctx = ctx || new (window.AudioContext || window.webkitAudioContext)();
    const buf = ctx.createBuffer(1, 1, 22050); const src = ctx.createBufferSource(); src.buffer = buf; src.connect(ctx.destination); src.start(0);
    if (ctx.state !== 'running') ctx.resume();
  } catch {}
  return ctx;
}
export function shriek() {
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
  if (navigator.vibrate) { try { navigator.vibrate([200, 80, 300]); } catch {} }
}
export function flash() {
  let el = document.getElementById('flash');
  if (!el) { el = document.createElement('div'); el.id = 'flash'; document.body.appendChild(el); }
  el.classList.remove('on'); void el.offsetWidth; el.classList.add('on');
}
export function toast(html, ms = 5000) {
  let el = document.querySelector('.toast');
  if (!el) { el = document.createElement('div'); el.className = 'toast'; document.body.appendChild(el); }
  el.innerHTML = html; el.classList.add('show');
  clearTimeout(el._t); el._t = setTimeout(() => el.classList.remove('show'), ms);
}
export function hauntedAlert(msg) {
  shriek(); flash();
  const by = msg.by || {}; const name = esc(by.name || 'someone');
  const canBack = !msg.back && by.id && getMe(); // a haunt back gets no button, so it can't ping-pong
  toast(`<b>${msg.back ? `👻 ${name} haunted you back!` : `👻 You've been haunted by ${name}`}</b>${by.handle ? ` <span class="mute">@${esc(by.handle)}</span>` : ''}${by.blurb ? `<div class="mute">${esc(by.blurb)}</div>` : ''}${canBack ? '<button class="haunt-back">Haunt back</button>' : ''}`, 12000);
  const btn = canBack && document.querySelector('.toast .haunt-back');
  if (btn) btn.addEventListener('click', async () => { btn.disabled = true; btn.textContent = await hauntBack(by); });
}
/** Haunt back whoever haunted this phone (`by` = card from the haunted push). Call from a tap. Returns a short status for the UI. */
export async function hauntBack(by) {
  const me = getMe(); if (!me) return 'Register on this phone first';
  unlockAudio(); // inside the tap: also arms sound on this phone so the next haunt is heard
  try { await api('/api/haunt', { method: 'POST', body: { actorId: me.id, token: me.token, targetId: by?.id, similarity: null, back: true } }); return 'Haunted back 👻'; }
  catch (e) { return e.status === 404 ? "They've vanished" : e.status === 429 ? 'Already haunted them' : 'Failed: ' + e.message; }
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
