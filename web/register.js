import { loadEngine, imageFromFile, cropFace } from '/face.js';
import { api, setMe, unlockAudio, getMe, esc, normLinkedin, normGithub } from '/common.js';

const $ = (id) => document.getElementById(id);
const status = (t) => { $('status').textContent = t; };
const WANT = 3;
const samples = []; // { embedding, thumb } per accepted selfie or photo; thumb of the first one becomes the card avatar
let stream = null; let engine = null;
const prev = getMe();

const engineReady = loadEngine({ video: false, onProgress: (t) => { if (t !== 'ready') status('Loading face model… (first time only)'); } })
  .then((h) => { engine = h; if (!samples.length) status('Face model ready. Take 3 selfies, or add photos.'); return h; })
  .catch(() => status("The face model didn't load. Check your connection and reload the page."));

function refresh() {
  const n = samples.length;
  $('thumbs').innerHTML = Array.from({ length: Math.max(WANT, n) }, (_, i) => samples[i]
    ? `<button class="slot filled" data-i="${i}" aria-label="Remove selfie ${i + 1}"><img src="${samples[i].thumb}" alt=""></button>`
    : `<div class="slot">${i + 1}</div>`).join('');
  $('capture').textContent = n < WANT ? `Take selfie ${n + 1} of ${WANT}` : 'Take another (optional)';
  $('start').textContent = n ? '📷 Take more selfies' : '📷 Open selfie camera';
  $('start').className = n >= WANT ? 'secondary' : ''; // done with selfies: the next step is the box and Register, not more photos
  const missing = !$('name').value.trim() ? 'Add your name to continue' : !n ? 'Take a selfie to continue' : !$('consent').checked ? 'Tick the box to agree' : '';
  $('submit').disabled = !!missing; $('submit').textContent = missing || 'Register 👻';
}
$('consent').onchange = refresh; $('name').oninput = refresh;
$('name').addEventListener('keydown', (e) => { if (e.key === 'Enter') $('handle').focus(); });
$('handle').addEventListener('keydown', (e) => { if (e.key === 'Enter') $('handle').blur(); });
$('thumbs').onclick = (e) => {
  const b = e.target.closest('.slot.filled'); if (!b) return;
  samples.splice(Number(b.dataset.i), 1); refresh(); status(`Removed. ${samples.length} of ${WANT} left.`);
};

async function addSample(source, label) {
  await engineReady; if (!engine) return false;
  status(`Checking ${label}…`);
  const faces = await engine.detect(source);
  if (faces.length === 0) { status(`No face found in ${label}. Face the camera in good light.`); return false; }
  const f = faces[0];
  if (f.box[2] < 60 || f.box[3] < 60) { status(`Your face is too small in ${label}. Come closer.`); return false; }
  samples.push({ embedding: f.embedding, thumb: cropFace(source, f.box) });
  const n = samples.length, many = faces.length > 1 ? ' More than one face there: kept the biggest.' : '';
  status(n < WANT ? `Got ${n} of ${WANT}.${many} Turn your head a little for the next one.` : `Got ${n}. Looking good.${many}`);
  refresh(); return true;
}

function closeCamera() { stream?.getTracks().forEach((t) => t.stop()); stream = null; $('wrap').hidden = true; $('capture').hidden = true; $('start').hidden = false; }
$('start').onclick = async () => {
  unlockAudio();
  if (!navigator.mediaDevices?.getUserMedia) { status('The camera needs the https:// link. Use photos instead.'); return; }
  try {
    stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'user', width: { ideal: 640 }, height: { ideal: 480 } }, audio: false });
    $('video').srcObject = stream; $('wrap').hidden = false; $('start').hidden = true; $('capture').hidden = false;
    $('selfies').scrollIntoView({ behavior: 'smooth', block: 'start' });
  } catch (e) { status(e.name === 'NotAllowedError' ? 'The camera is blocked. Allow it in your browser settings, or use photos instead.' : `Camera error: ${e.message}. Use photos instead.`); }
};
$('capture').onclick = async () => {
  const v = $('video'); if (!v.videoWidth) return;
  const c = document.createElement('canvas'); c.width = v.videoWidth; c.height = v.videoHeight; c.getContext('2d').drawImage(v, 0, 0);
  $('wrap').classList.remove('snap'); void $('wrap').offsetWidth; $('wrap').classList.add('snap');
  $('capture').disabled = true;
  const ok = await addSample(c, `selfie ${samples.length + 1}`);
  $('capture').disabled = false;
  if (ok && samples.length === WANT) { closeCamera(); $('consent').scrollIntoView({ behavior: 'smooth', block: 'center' }); }
};
$('files').onchange = async (e) => {
  for (const file of e.target.files) { try { await addSample(await imageFromFile(file), file.name); } catch { status('Could not read ' + file.name); } }
  e.target.value = '';
};
$('submit').onclick = async () => {
  $('submit').disabled = true; $('submit').textContent = 'Registering…';
  try {
    const body = { name: $('name').value.trim(), handle: normGithub($('handle').value), blurb: $('blurb').value.trim(), linkedin: normLinkedin($('linkedin').value), consent: $('consent').checked, descriptors: samples.slice(0, 5).map((s) => s.embedding), avatar: samples[0]?.thumb || null };
    const { id, token } = await api('/api/attendee', { method: 'POST', body });
    // this phone had a card: it is replaced, so the old one stops being findable (said in the notice at the top)
    if (prev?.id && prev.id !== id) await Promise.race([api(`/api/attendee/${prev.id}`, { method: 'PATCH', body: { token: prev.token, consent: false } }).catch(() => {}), new Promise((r) => setTimeout(r, 1500))]);
    setMe({ id, token, name: body.name });
    closeCamera();
    location.href = '/me?welcome=1';
  } catch (e) { status('Registration failed: ' + e.message); refresh(); }
};
if (prev) { $('already').hidden = false; $('already').innerHTML = `This phone is registered as <b>${esc(prev.name || 'you')}</b>. <a href="/me">Open my card</a>. Registering again replaces that card.`; }
refresh();

// Optional sign-in (buttons appear only when the server has provider credentials); a session pre-fills the form
// and offers the profile photo as one face sample.
(async () => {
  try {
    const providers = await api('/api/auth/providers');
    const session = await api('/api/session');
    if (!providers.length && !session) return;
    $('auth').hidden = false;
    const labels = { linkedin: 'LinkedIn', github: 'GitHub', google: 'Google', apple: 'Apple' };
    const btn = (p, verb) => `<a class="btn secondary" href="/auth/${esc(p)}">${verb} ${esc(labels[p] || p)}</a>`;
    if (!session) {
      $('auth-buttons').innerHTML = providers.map((p) => btn(p, 'Sign in with')).join('') + '<div class="hint" style="text-align:center">Fills in your name and photo. Optional.</div>';
    } else {
      const more = providers.filter((p) => !session.linked.includes(p));
      $('auth-buttons').innerHTML = more.map((p) => btn(p, 'Also link')).join('');
      $('auth-session').innerHTML = `${session.avatar ? `<img src="${esc(session.avatar)}" alt="" style="width:40px;height:40px;border-radius:50%;vertical-align:middle;margin-right:8px">` : ''}Signed in as <b>${esc(session.name || 'you')}</b> via ${session.linked.map((p) => esc(labels[p] || p)).join(' + ')}`;
      if (!$('name').value) $('name').value = session.name || '';
      if (!$('handle').value) $('handle').value = session.handle || '';
      refresh();
      if (session.avatar) {
        const b = document.createElement('button'); b.className = 'secondary'; b.textContent = 'Use my profile photo as a face sample';
        b.onclick = async () => { b.disabled = true; const img = new Image(); img.src = session.avatar; await img.decode(); await addSample(img, 'profile photo'); };
        $('auth-buttons').appendChild(b);
      }
    }
  } catch {}
})();
