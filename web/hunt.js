import { loadEngine, buildIndex, matchOne, imageFromFile, THRESHOLD, ABSTAIN, ENGINE } from '/face.js';
import { api, getMe, connectWs, unlockAudio, hauntedAlert, wakeLock, esc } from '/common.js';

const $ = (id) => document.getElementById(id);
const status = (t) => { $('status').textContent = t; };
const VOTES_NEEDED = 3;
let engine = null, index = buildIndex([]), stream = null, running = false;
const votes = new Map(); // attendeeId -> consecutive frames
let shown = null, shownSim = 0, lastShownAt = 0;
const me = getMe();

async function refreshGallery() { try { index = buildIndex(await api('/api/gallery')); } catch {} }
await refreshGallery();
connectWs(me ? { attendee: me.id } : {}, (msg) => { if (msg.type === 'gallery_changed') refreshGallery(); if (msg.type === 'haunted') hauntedAlert(msg); });

loadEngine({ video: true, onProgress: status }).then((h) => { engine = h; status(`Ready (${ENGINE}). ${index.owners.length ? new Set(index.owners.map(o => o.id)).size : 0} findable people. Tap Start.`); }).catch((e) => status('Model failed: ' + e.message));

function showCard(att, sim) {
  shown = att; shownSim = sim; lastShownAt = Date.now();
  $('c-name').textContent = att.name; $('c-handle').textContent = att.handle ? '@' + att.handle : ''; $('c-blurb').textContent = att.blurb || '';
  $('c-sim').textContent = `match ${(sim * 100).toFixed(0)}%`;
  if (att.avatar) { $('c-avatar').src = att.avatar; $('c-avatar').hidden = false; $('c-noavatar').hidden = true; } else { $('c-avatar').hidden = true; $('c-noavatar').hidden = false; }
  $('haunt').disabled = !me || me.id === att.id; $('haunt').textContent = !me ? 'Register to haunt' : me.id === att.id ? "That's you" : '👻 Haunt them';
  $('sheet').classList.add('show');
  // fetch full card (avatar/blurb) lazily; gallery only has name + descriptors
  api(`/api/attendee/${att.id}`).then((card) => { if (shown?.id === card.id) showCard(Object.assign(att, card), sim); }).catch(() => {});
}
$('dismiss').onclick = () => { $('sheet').classList.remove('show'); shown = null; votes.clear(); };
$('haunt').onclick = async () => {
  if (!shown || !me) return; $('haunt').disabled = true;
  try { await api('/api/haunt', { method: 'POST', body: { actorId: me.id, token: me.token, targetId: shown.id, similarity: shownSim } }); $('haunt').textContent = `You haunted ${shown.name} 👻`; }
  catch (e) { $('haunt').textContent = e.status === 429 ? 'Already haunted recently' : 'Failed: ' + e.message; }
};

/** Shared by the live loop and the photo test. Returns per-face results. */
export async function processFrame(source) {
  const faces = await engine.detect(source);
  const results = faces.map((f) => ({ ...f, ...matchOne(engine, f.embedding, index) }));
  const seen = new Set();
  for (const r of results) {
    if (r.attendee && r.similarity >= THRESHOLD) { seen.add(r.attendee.id); votes.set(r.attendee.id, (votes.get(r.attendee.id) || 0) + 1); }
  }
  for (const id of [...votes.keys()]) if (!seen.has(id)) votes.delete(id);
  let bestId = null, bestVotes = 0;
  for (const [id, v] of votes) if (v > bestVotes) { bestVotes = v; bestId = id; }
  if (bestId && bestVotes >= VOTES_NEEDED && (!shown || shown.id !== bestId)) {
    const r = results.find((x) => x.attendee?.id === bestId); showCard(r.attendee, r.similarity);
  }
  if (shown && Date.now() - lastShownAt > 8000 && !votes.has(shown.id)) { $('sheet').classList.remove('show'); shown = null; }
  draw(source, results);
  return results;
}

function draw(source, results) {
  const c = $('overlay'); const v = $('video');
  const sw = source.videoWidth || source.naturalWidth || source.width, sh = source.videoHeight || source.naturalHeight || source.height;
  if (c.width !== sw || c.height !== sh) { c.width = sw; c.height = sh; }
  const ctx = c.getContext('2d'); ctx.clearRect(0, 0, c.width, c.height);
  if (source !== v) ctx.drawImage(source, 0, 0, sw, sh);
  ctx.lineWidth = Math.max(2, sw / 200); ctx.font = `${Math.max(14, sw / 30)}px sans-serif`;
  for (const r of results) {
    const [x, y, w, h] = r.box;
    const matched = r.attendee && r.similarity >= THRESHOLD; const maybe = r.attendee && r.similarity >= ABSTAIN;
    ctx.strokeStyle = matched ? '#7CFF6B' : maybe ? '#ffb347' : '#9a93ad'; ctx.strokeRect(x, y, w, h);
    const label = matched ? `${r.attendee.name} ${(r.similarity * 100).toFixed(0)}%` : maybe ? `? ${(r.similarity * 100).toFixed(0)}%` : 'unknown';
    ctx.fillStyle = '#000a'; ctx.fillRect(x, y - 24, ctx.measureText(label).width + 10, 24); ctx.fillStyle = ctx.strokeStyle; ctx.fillText(label, x + 5, y - 6);
  }
}

async function pickRearCamera() {
  const base = { width: { ideal: 640 }, height: { ideal: 480 } };
  try {
    const devs = (await navigator.mediaDevices.enumerateDevices()).filter((d) => d.kind === 'videoinput');
    const back = devs.find((d) => /back camera/i.test(d.label)) || devs.find((d) => /back|rear|environment/i.test(d.label));
    if (back) return { video: { deviceId: { exact: back.deviceId }, ...base }, audio: false };
  } catch {}
  return { video: { facingMode: { ideal: 'environment' }, ...base }, audio: false };
}

let frames = 0, t0 = 0;
async function loop() {
  if (!running) return;
  const v = $('video');
  if (engine && v.videoWidth) {
    const t = performance.now();
    try { const r = await processFrame(v); frames++; if (frames % 5 === 0) { const fps = (1000 / Math.max(1, performance.now() - t)).toFixed(1); const best = r.reduce((m, x) => Math.max(m, x.similarity), 0); status(`${r.length} face(s) · best ${(best * 100).toFixed(0)}% · ${fps} fps · threshold ${(THRESHOLD * 100).toFixed(0)}%`); } }
    catch (e) { status('detect error: ' + e.message); }
  }
  setTimeout(loop, 120); // ~4 fps target; detection itself takes most of it
}
$('start').onclick = async () => {
  unlockAudio(); wakeLock();
  try {
    stream = await navigator.mediaDevices.getUserMedia(await pickRearCamera());
    $('video').srcObject = stream; await $('video').play().catch(() => {});
    $('start').hidden = true; running = true; loop();
  } catch (e) { status('Camera blocked: ' + e.message); }
};
document.addEventListener('visibilitychange', async () => {
  if (document.hidden) { running = false; stream?.getTracks().forEach((t) => t.stop()); stream = null; $('start').hidden = false; $('start').textContent = 'Resume hunting'; }
});
// test hook: run a photo through the same pipeline VOTES_NEEDED times so the card logic is exercised
$('testfile').onchange = async (e) => {
  const file = e.target.files[0]; if (!file || !engine) return;
  const img = await imageFromFile(file); let r = [];
  for (let i = 0; i < VOTES_NEEDED; i++) r = await processFrame(img);
  status(r.length ? r.map((x) => `${x.attendee ? x.attendee.name : 'nobody'} ${(x.similarity * 100).toFixed(0)}%`).join(' | ') : 'no faces in photo');
  window.__lastTest = r.map((x) => ({ name: x.attendee?.name || null, id: x.attendee?.id || null, similarity: x.similarity, box: x.box }));
};
window.__haunt = { get index() { return index; }, get shown() { return shown; }, THRESHOLD };
