import { api, getMe, clearMe, connectWs, soundOn, hauntedAlert, esc, fmtTime, renderProfile, normGithub, normLinkedin } from '/common.js';
import { costumePicker } from '/costume.js';
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
  if (new URLSearchParams(location.search).has('welcome')) { $('welcome').hidden = false; history.replaceState(null, '', '/me'); } // just registered
  let conns = [];
  const costume = costumePicker($('costume'), { name: () => $('name').textContent || me.name, onPick: (c) => api(`/api/attendee/${me.id}`, { method: 'PATCH', body: { token: me.token, costume: c } }).catch(() => {}) });
  const render = async () => {
    try {
      const { me: card, connections = [] } = await api(`/api/me/${me.id}?token=${encodeURIComponent(me.token)}`);
      $('name').textContent = card.name; $('handle').textContent = card.handle ? '@' + card.handle : ''; $('blurb').textContent = card.blurb || '';
      $('n-out').textContent = card.huntCount ?? 0; $('n-in').textContent = card.hauntedCount ?? 0;
      if (card.avatar) { $('avatar').src = card.avatar; $('avatar').hidden = false; $('noavatar').hidden = true; }
      $('consent').checked = card.consent; consentNote();
      costume.set(card.costume);
      $('profile').innerHTML = renderProfile(card) || '<div class="hint" style="margin-top:10px">Add your GitHub username under <b>Edit GitHub and LinkedIn</b> below: hunters then see your bio and repos.</div>';
      if (document.activeElement !== $('ghhandle')) $('ghhandle').value = card.handle || '';
      if (document.activeElement !== $('linkedin')) $('linkedin').value = card.linkedin || '';
      conns = connections;
      $('nconn').textContent = `(${connections.length})`;
      $('connact').hidden = !connections.length;
      $('conns').innerHTML = connections.map(connRow).join('') || '<li class="mute">Nobody yet. Haunt someone, or get haunted, and they show up here with their links.</li>';
    } catch (e) { if (e.status === 403) { clearMe(); location.reload(); } }
  };
  render();
  connectWs({ attendee: me.id }, (msg) => { if (msg.type === 'haunted') { hauntedAlert(msg); render(); } });
  // back from /hunt (bfcache or tab switch): refresh so the people you just haunted show up
  addEventListener('pageshow', (e) => { if (e.persisted) render(); });
  document.addEventListener('visibilitychange', () => { if (!document.hidden) render(); });
  $('copy').onclick = async () => say($('copy'), (await copyText(connsText(conns))) ? 'Copied ✓' : 'Copy failed');
  if (navigator.share) { $('share').hidden = false; $('share').onclick = () => navigator.share({ title: 'Tonight at HAUNT', text: connsText(conns) }).catch(() => {}); }
  // sound is on by default: common.js arms it on the first tap anywhere, so this button only gives that tap a home
  const soundLabel = () => { $('arm').textContent = soundOn() ? '🔊 Sound on. Keep this page open.' : '🔊 Sound on (tap anywhere once to wake it)'; $('arm').classList.toggle('sound-on', soundOn()); };
  addEventListener('soundchange', soundLabel); soundLabel();
  const note = (t) => { $('save-note').textContent = t; };
  $('save').onclick = async () => {
    const handle = normGithub($('ghhandle').value), linkedin = normLinkedin($('linkedin').value);
    if ($('linkedin').value.trim() && !linkedin) return note("That doesn't look like a LinkedIn profile link.");
    $('save').disabled = true; $('save').textContent = 'Saving…'; note('');
    try {
      await api(`/api/attendee/${me.id}`, { method: 'PATCH', body: { token: me.token, handle, linkedin } });
      $('ghhandle').value = handle; $('linkedin').value = linkedin;
      note(handle ? 'Saved. Fetching your GitHub profile…' : 'Saved.');
      await new Promise((r) => setTimeout(r, 1500)); await render(); note('Saved ✓');
    } catch (e) { note('Could not save: ' + e.message); }
    finally { $('save').disabled = false; $('save').textContent = 'Save'; }
  };
  function consentNote() { $('consent-note').textContent = $('consent').checked ? 'Phones in the room can recognize you' : 'Hidden: no phone can recognize you'; }
  $('consent').onchange = async (e) => {
    const on = e.target.checked; consentNote();
    try { await api(`/api/attendee/${me.id}`, { method: 'PATCH', body: { token: me.token, consent: on } }); }
    catch { e.target.checked = !on; consentNote(); $('consent-note').textContent += " (couldn't change it, try again)"; }
  };
  // two taps: the first arms it for 4 s, the second forgets (the card stops being findable and this phone lets go of it)
  $('forget').onclick = async () => {
    const b = $('forget');
    if (!b.dataset.armed) { b.dataset.armed = '1'; b.textContent = 'Tap again to forget me (you vanish from every phone)'; clearTimeout(b._t); b._t = setTimeout(() => { delete b.dataset.armed; b.textContent = 'Forget me on this phone'; }, 4000); return; }
    b.disabled = true;
    try { await api(`/api/attendee/${me.id}`, { method: 'PATCH', body: { token: me.token, consent: false } }); } catch {}
    clearMe(); location.href = '/';
  };
}
