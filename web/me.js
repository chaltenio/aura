import { api, getMe, clearMe, connectWs, unlockAudio, hauntedAlert, esc, fmtTime, renderProfile } from '/common.js';
const $ = (id) => document.getElementById(id);
const me = getMe();

// ---- tonight's connections: one row per person you haunted or who haunted you ----
const dirOf = (c) => (c.youHaunted && c.hauntedYou ? 'both' : c.youHaunted ? 'out' : 'in');
const DIR = { both: 'both ways', out: 'you found them', in: 'found you' };
const DIR_TEXT = { both: 'both ways', out: 'I found them', in: 'found me' }; // the copied text is first person ("I met")
const githubUrl = (k) => (/^https:\/\//.test(k.profile?.url || '') ? k.profile.url : k.handle ? `https://github.com/${encodeURIComponent(k.handle)}` : '');
const bare = (u) => u.replace(/^https?:\/\/(www\.)?/, '').replace(/\/+$/, '');
const link = (href, label) => `<a href="${esc(href)}" target="_blank" rel="noopener">${esc(label)}</a>`;
const connRow = (c) => {
  const k = c.card, d = dirOf(c), gh = githubUrl(k);
  const meta = [`<span class="dir ${d}">${esc(DIR[d])}</span>`, esc(fmtTime(c.lastAt)), gh && link(gh, 'GitHub'), k.linkedin && link(k.linkedin, 'LinkedIn')].filter(Boolean).join(' · ');
  return `<li class="conn">${k.avatar ? `<img class="conn-av" src="${esc(k.avatar)}" alt="">` : '<div class="conn-av">👤</div>'}<div class="conn-main"><div><b>${esc(k.name)}</b>${k.handle ? ` <span class="mute">@${esc(k.handle)}</span>` : ''}</div><div class="conn-meta">${meta}</div></div></li>`;
};
const connsText = (list) => 'Tonight at HAUNT I met:\n' + list.map((c) => {
  const k = c.card, gh = githubUrl(k);
  return `- ${[k.name + (k.handle ? ` (@${k.handle})` : ''), gh && bare(gh), k.linkedin && bare(k.linkedin)].filter(Boolean).join(', ')} (${DIR_TEXT[dirOf(c)]})`;
}).join('\n');
// Clipboard API (HTTPS); fallback: hidden textarea + execCommand (older iOS, plain-http LAN testing). Must run inside the tap.
function legacyCopy(text) {
  const ta = document.createElement('textarea');
  ta.value = text; ta.readOnly = true; ta.style.cssText = 'position:fixed;top:0;left:0;width:1px;height:1px;opacity:0;font-size:16px';
  document.body.appendChild(ta); ta.focus({ preventScroll: true }); ta.select(); ta.setSelectionRange(0, text.length);
  let ok = false; try { ok = document.execCommand('copy'); } catch {}
  ta.remove(); return ok;
}
const copyText = (text) => (navigator.clipboard?.writeText ? navigator.clipboard.writeText(text).then(() => true, () => legacyCopy(text)) : Promise.resolve(legacyCopy(text)));
const say = (btn, label) => { if (!btn.dataset.label) btn.dataset.label = btn.textContent; btn.textContent = label; clearTimeout(btn._t); btn._t = setTimeout(() => { btn.textContent = btn.dataset.label; }, 1600); };

if (!me) { $('nocard').hidden = false; } else {
  $('has').hidden = false;
  let conns = [];
  const render = async () => {
    try {
      const { me: card, connections = [] } = await api(`/api/me/${me.id}?token=${encodeURIComponent(me.token)}`);
      $('name').textContent = card.name; $('handle').textContent = card.handle ? '@' + card.handle : ''; $('blurb').textContent = card.blurb || '';
      $('stats').textContent = `haunted ${card.hauntedCount}× · hunted ${card.huntCount}×`;
      if (card.avatar) { $('avatar').src = card.avatar; $('avatar').hidden = false; $('noavatar').hidden = true; }
      $('consent').checked = card.consent;
      $('profile').innerHTML = renderProfile(card) || '<span class="mute">Add your GitHub handle below to show your profile on your card.</span>';
      if (document.activeElement !== $('ghhandle')) $('ghhandle').value = card.handle || '';
      if (document.activeElement !== $('linkedin')) $('linkedin').value = card.linkedin || '';
      conns = connections;
      $('nconn').textContent = `(${connections.length})`;
      $('connact').hidden = !connections.length;
      $('conns').innerHTML = connections.map(connRow).join('') || '<li class="mute">Nobody yet. <a href="/hunt">Go hunt</a></li>';
    } catch (e) { if (e.status === 403) { clearMe(); location.reload(); } }
  };
  render();
  connectWs({ attendee: me.id }, (msg) => { if (msg.type === 'haunted') { hauntedAlert(msg); render(); } });
  // back from /hunt (bfcache or tab switch): refresh so the people you just haunted show up
  addEventListener('pageshow', (e) => { if (e.persisted) render(); });
  document.addEventListener('visibilitychange', () => { if (!document.hidden) render(); });
  $('copy').onclick = async () => say($('copy'), (await copyText(connsText(conns))) ? 'Copied ✓' : 'Copy failed');
  if (navigator.share) { $('share').hidden = false; $('share').onclick = () => navigator.share({ title: 'Tonight at HAUNT', text: connsText(conns) }).catch(() => {}); }
  $('arm').onclick = () => { unlockAudio(); $('arm').textContent = '🔊 Sound armed. Keep this page open.'; };
  $('save').onclick = async () => { $('save').disabled = true; try { await api(`/api/attendee/${me.id}`, { method: 'PATCH', body: { token: me.token, handle: $('ghhandle').value, linkedin: $('linkedin').value } }); await new Promise((r) => setTimeout(r, 1500)); await render(); } finally { $('save').disabled = false; } };
  $('consent').onchange = async (e) => { await api(`/api/attendee/${me.id}`, { method: 'PATCH', body: { token: me.token, consent: e.target.checked } }); };
  $('forget').onclick = async () => { try { await api(`/api/attendee/${me.id}`, { method: 'PATCH', body: { token: me.token, consent: false } }); } catch {} clearMe(); location.href = '/'; };
}
