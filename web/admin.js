import { esc, fmtTime, API } from '/common.js';
const $ = (id) => document.getElementById(id);
let token = ''; try { token = sessionStorage.getItem('haunt.admin') || ''; } catch {}
let users = [];
async function call(path, method = 'GET', body) {
  const r = await fetch(API + '/api/admin' + path, { method, headers: { 'x-admin-token': token, ...(body ? { 'content-type': 'application/json' } : {}) }, body: body ? JSON.stringify(body) : undefined });
  const d = await r.json().catch(() => ({}));
  if (!r.ok) throw Object.assign(new Error(d.error || r.statusText), { status: r.status });
  return d;
}
async function refresh() {
  const [o, u, ev, log] = await Promise.all([call('/overview'), call('/users'), call('/events'), call('/messages')]);
  users = u;
  $('stats').innerHTML = [['attendees', o.attendees], ['findable', o.consenting], ['blocked', o.blocked], ['online', o.online], ['hauntings', o.haunts]].map(([k, v]) => `<div><div class="big">${v}</div><div class="mute">${k}</div></div>`).join('');
  $('events').innerHTML = ev.map((m) => `<div class="u"><div class="grow"><b>${esc(m.name)}</b>${m.active ? '<span class="tag ok">ACTIVE</span>' : ''}<div class="mute">${m.haunts} hauntings${m.startedAt ? ' · started ' + fmtTime(m.startedAt) : ''}</div></div><button data-ev="${m.id}" data-act="${m.active ? 'end' : 'start'}" class="${m.active ? 'danger' : ''}">${m.active ? 'End' : 'Start'}</button></div>`).join('') || '<div class="mute">No events yet.</div>';
  const cur = $('to').value;
  $('to').innerHTML = o.groups.map((g) => `<option value="g:${g}">Group: ${g}</option>`).join('') + users.map((a) => `<option value="u:${esc(a.id)}">${esc(a.name)}</option>`).join('');
  if (cur) $('to').value = cur;
  $('log').innerHTML = log.map((m) => `<div class="u"><div class="grow">${esc(m.text)}<div class="mute">${fmtTime(m.createdAt)} → ${m.to ? 'one person' : esc(m.group)} · ${m.delivered}/${m.recipients} online</div></div></div>`).join('') || '<div class="mute">None yet.</div>';
  renderUsers();
}
function renderUsers() {
  const q = $('q').value.toLowerCase();
  $('users').innerHTML = users.filter((a) => !q || `${a.name} ${a.handle} ${a.provider}`.toLowerCase().includes(q)).map((a) => `<div class="u">${a.avatar ? `<img src="${esc(a.avatar)}" alt="">` : '<div class="ph"></div>'}<div class="grow"><b>${esc(a.name)}</b> <span class="mute">${esc(a.handle ? '@' + a.handle : '')}</span><div class="mute">${esc(a.provider)} · ${a.huntCount} hunts · ${a.hauntedCount} haunted${a.online ? ' · online' : ''}</div><span class="tag ${a.consent ? 'ok' : ''}">${a.consent ? 'findable' : 'opted out'}</span>${a.blocked ? '<span class="tag bad">blocked</span>' : ''}</div><button class="secondary" data-msg="${esc(a.id)}">Message</button><button class="${a.blocked ? '' : 'danger'}" data-block="${esc(a.id)}">${a.blocked ? 'Allow' : 'Disallow'}</button><button class="secondary" data-del="${esc(a.id)}">Delete</button></div>`).join('') || '<div class="mute">No attendees.</div>';
}
const guard = (fn) => async (...a) => { try { await fn(...a); } catch (e) { if (e.status === 401) signOut('Bad token'); else alert(e.message); } };
function signOut(msg) { token = ''; try { sessionStorage.removeItem('haunt.admin'); } catch {} $('app').hidden = true; $('login').hidden = false; $('err').textContent = msg || ''; }
async function enter() { await refresh(); $('login').hidden = true; $('app').hidden = false; }
$('go').onclick = async () => { token = $('tok').value.trim(); try { await enter(); try { sessionStorage.setItem('haunt.admin', token); } catch {} } catch (e) { signOut(e.status === 503 ? 'Admin is disabled: set ADMIN_TOKEN on the server' : 'Bad token'); } };
$('q').oninput = renderUsers;
$('ev-add').onclick = guard(async () => { const name = $('ev-name').value.trim(); if (!name) return; await call('/events', 'POST', { name }); $('ev-name').value = ''; await refresh(); });
$('send').onclick = guard(async () => {
  const text = $('msg').value.trim(); if (!text) return; const [k, v] = $('to').value.split(/:(.*)/s);
  if (k === 'g' && v === 'all' && !confirm('Send to everyone?')) return;
  const m = await call('/messages', 'POST', k === 'u' ? { to: v, text } : { group: v, text });
  $('sent').textContent = `delivered ${m.delivered}/${m.recipients}`; $('msg').value = ''; await refresh();
});
document.addEventListener('click', guard(async (e) => {
  const t = e.target.closest('button'); if (!t) return;
  if (t.dataset.ev) { await call(`/events/${t.dataset.ev}/${t.dataset.act}`, 'POST'); await refresh(); }
  else if (t.dataset.block) { const a = users.find((x) => x.id === t.dataset.block); await call(`/users/${a.id}`, 'PATCH', { blocked: !a.blocked }); await refresh(); }
  else if (t.dataset.del) { const a = users.find((x) => x.id === t.dataset.del); if (confirm(`Delete ${a.name} and their data?`)) { await call(`/users/${a.id}`, 'DELETE'); await refresh(); } }
  else if (t.dataset.msg) { $('to').value = 'u:' + t.dataset.msg; $('msg').focus(); }
}));
setInterval(() => { if (!$('app').hidden) refresh().catch(() => {}); }, 15000);
if (token) enter().catch(() => signOut(''));
