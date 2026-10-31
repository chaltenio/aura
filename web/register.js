import { loadEngine, imageFromFile, cropFace, ENGINE } from '/face.js';
import { api, setMe, unlockAudio, getMe } from '/common.js';

const $ = (id) => document.getElementById(id);
const status = (t) => { $('status').textContent = t; };
const descriptors = []; let avatar = null; let stream = null; let engine = null;

const engineReady = loadEngine({ video: false, onProgress: status }).then((h) => { engine = h; status(`Face model ready (${ENGINE}). Take 3 selfies or add photos.`); return h; }).catch((e) => status('Model failed to load: ' + e.message));

function refresh() {
  $('n').textContent = String(Math.min(descriptors.length, 3));
  $('submit').disabled = !(descriptors.length >= 1 && $('consent').checked && $('name').value.trim());
}
$('consent').onchange = refresh; $('name').oninput = refresh;

async function addSample(source, label) {
  await engineReady; if (!engine) return;
  status(`Analyzing ${label}…`);
  const faces = await engine.detect(source);
  if (faces.length === 0) { status(`No face found in ${label}. Try better light, face the camera.`); return; }
  if (faces.length > 1) { status(`${faces.length} faces in ${label}; using the largest.`); }
  const f = faces[0];
  if (f.box[2] < 60 || f.box[3] < 60) { status(`Face too small in ${label}; get closer.`); return; }
  descriptors.push(f.embedding);
  const thumb = cropFace(source, f.box);
  if (!avatar) avatar = thumb;
  const img = document.createElement('img'); img.src = thumb; $('thumbs').appendChild(img);
  status(`Got ${descriptors.length} sample${descriptors.length > 1 ? 's' : ''} (face score ${f.score.toFixed(2)}).${descriptors.length < 3 ? ' Take another from a slightly different angle.' : ' Good to go.'}`);
  refresh();
}

$('start').onclick = async () => {
  unlockAudio();
  try {
    stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'user', width: { ideal: 640 }, height: { ideal: 480 } }, audio: false });
    $('video').srcObject = stream; $('wrap').hidden = false; $('start').hidden = true; $('capture').hidden = false;
  } catch (e) { status('Camera blocked: ' + e.message + '. Use photos instead.'); }
};
$('capture').onclick = async () => {
  const v = $('video'); if (!v.videoWidth) return;
  const c = document.createElement('canvas'); c.width = v.videoWidth; c.height = v.videoHeight; c.getContext('2d').drawImage(v, 0, 0);
  $('capture').disabled = true; await addSample(c, `selfie ${descriptors.length + 1}`); $('capture').disabled = false;
};
$('files').onchange = async (e) => {
  for (const file of e.target.files) { try { await addSample(await imageFromFile(file), file.name); } catch (err) { status('Could not read ' + file.name); } }
  e.target.value = '';
};
$('submit').onclick = async () => {
  $('submit').disabled = true; status('Registering…');
  try {
    const body = { name: $('name').value.trim(), handle: $('handle').value.trim().replace(/^@/, ''), blurb: $('blurb').value.trim(), consent: $('consent').checked, descriptors: descriptors.slice(0, 5), avatar };
    const { id, token } = await api('/api/attendee', { method: 'POST', body });
    setMe({ id, token, name: body.name });
    stream?.getTracks().forEach((t) => t.stop());
    location.href = '/me';
  } catch (e) { status('Failed: ' + e.message); $('submit').disabled = false; }
};
if (getMe()) status('You are already registered on this phone. Registering again creates a new card.');

// Optional sign-in (buttons appear only when the server has provider credentials); a session pre-fills the form
// and offers the profile photo as one face sample.
(async () => {
  try {
    const providers = await api('/api/auth/providers');
    const session = await api('/api/session');
    if (!providers.length && !session) return;
    $('auth').hidden = false;
    const labels = { linkedin: 'Sign in with LinkedIn', github: 'Sign in with GitHub' };
    if (!session) {
      $('auth-buttons').innerHTML = providers.map((p) => `<a href="/auth/${p}"><button class="secondary">${labels[p] || p}</button></a>`).join('');
    } else {
      $('auth-session').innerHTML = `Signed in as <b>${session.name}</b> via ${session.provider}${session.avatar ? ` <img src="${session.avatar}" style="width:40px;height:40px;border-radius:50%;vertical-align:middle;margin-left:8px">` : ''}`;
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
