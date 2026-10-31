import { api, getMe, clearMe, connectWs, unlockAudio, hauntedAlert, esc, fmtTime, renderProfile } from '/common.js';
const $ = (id) => document.getElementById(id);
const me = getMe();
if (!me) { $('nocard').hidden = false; } else {
  $('has').hidden = false;
  const render = async () => {
    try {
      const { me: card, received, given } = await api(`/api/me/${me.id}?token=${encodeURIComponent(me.token)}`);
      $('name').textContent = card.name; $('handle').textContent = card.handle ? '@' + card.handle : ''; $('blurb').textContent = card.blurb || '';
      $('stats').textContent = `haunted ${card.hauntedCount}× · hunted ${card.huntCount}×`;
      if (card.avatar) { $('avatar').src = card.avatar; $('avatar').hidden = false; $('noavatar').hidden = true; }
      $('consent').checked = card.consent;
      $('profile').innerHTML = renderProfile(card) || '<span class="mute">Add your GitHub handle below to show your profile on your card.</span>';
      if (document.activeElement !== $('handle')) $('handle').value = card.handle || '';
      if (document.activeElement !== $('linkedin')) $('linkedin').value = card.linkedin || '';
      $('received').innerHTML = received.map((e) => `<li>👻 <b>${esc(e.by.name)}</b>${e.by.handle ? ` <span class="mute">@${esc(e.by.handle)}</span>` : ''}<time>${fmtTime(e.createdAt)}</time></li>`).join('') || '<li class="mute">Nobody yet. Walk around.</li>';
      $('given').innerHTML = given.map((e) => `<li><b>${esc(e.target.name)}</b>${e.target.handle ? ` <span class="mute">@${esc(e.target.handle)}</span>` : ''}<time>${fmtTime(e.createdAt)}</time></li>`).join('') || '<li class="mute">Go find someone.</li>';
    } catch (e) { if (e.status === 403) { clearMe(); location.reload(); } }
  };
  render();
  connectWs({ attendee: me.id }, (msg) => { if (msg.type === 'haunted') { hauntedAlert(msg); render(); } });
  $('arm').onclick = () => { unlockAudio(); $('arm').textContent = '🔊 Sound armed. Keep this page open.'; };
  $('save').onclick = async () => { $('save').disabled = true; try { await api(`/api/attendee/${me.id}`, { method: 'PATCH', body: { token: me.token, handle: $('handle').value, linkedin: $('linkedin').value } }); await new Promise((r) => setTimeout(r, 1500)); await render(); } finally { $('save').disabled = false; } };
  $('consent').onchange = async (e) => { await api(`/api/attendee/${me.id}`, { method: 'PATCH', body: { token: me.token, consent: e.target.checked } }); };
  $('forget').onclick = async () => { try { await api(`/api/attendee/${me.id}`, { method: 'PATCH', body: { token: me.token, consent: false } }); } catch {} clearMe(); location.href = '/'; };
}
