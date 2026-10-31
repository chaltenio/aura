import { api, getMe, clearMe, connectWs, unlockAudio, hauntedAlert, esc, fmtTime } from '/common.js';
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
      $('received').innerHTML = received.map((e) => `<li>👻 <b>${esc(e.by.name)}</b>${e.by.handle ? ` <span class="mute">@${esc(e.by.handle)}</span>` : ''}<time>${fmtTime(e.createdAt)}</time></li>`).join('') || '<li class="mute">Nobody yet. Walk around.</li>';
      $('given').innerHTML = given.map((e) => `<li><b>${esc(e.target.name)}</b>${e.target.handle ? ` <span class="mute">@${esc(e.target.handle)}</span>` : ''}<time>${fmtTime(e.createdAt)}</time></li>`).join('') || '<li class="mute">Go find someone.</li>';
    } catch (e) { if (e.status === 403) { clearMe(); location.reload(); } }
  };
  render();
  connectWs({ attendee: me.id }, (msg) => { if (msg.type === 'haunted') { hauntedAlert(msg); render(); } });
  $('arm').onclick = () => { unlockAudio(); $('arm').textContent = '🔊 Sound armed. Keep this page open.'; };
  $('consent').onchange = async (e) => { await api(`/api/attendee/${me.id}`, { method: 'PATCH', body: { token: me.token, consent: e.target.checked } }); };
  $('forget').onclick = async () => { try { await api(`/api/attendee/${me.id}`, { method: 'PATCH', body: { token: me.token, consent: false } }); } catch {} clearMe(); location.href = '/'; };
}
