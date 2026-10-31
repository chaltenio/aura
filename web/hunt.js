import { loadEngine, buildIndex, matchOne, imageFromFile, THRESHOLD, ABSTAIN, ENGINE } from '/face.js';
import { api, getMe, connectWs, unlockAudio, hauntedAlert, wakeLock, renderProfile } from '/common.js';
import { costumeLayer, costumeTitle, COSTUMES } from '/costume.js';

const $ = (id) => document.getElementById(id);
const status = (t) => { $('status').textContent = t; };                          // small numbers line under the camera
const hint = (t) => { if ($('hint').textContent !== t) $('hint').textContent = t; }; // plain-words line inside the camera
const firstName = (n) => String(n || '').trim().split(/\s+/)[0];
const VOTES_NEEDED = 3;
const GONE_MS = 2500;      // a closed card re-arms once that person has been out of frame this long
const AUTO_CLOSE_MS = 15000; // an untouched card closes after its person has been out of frame this long
let engine = null, index = buildIndex([]), stream = null, running = false, wantRunning = false;
const votes = new Map();   // attendeeId -> consecutive frames
const snoozed = new Map(); // attendeeId -> last seen while their card is closed (Close, or after a haunt)
let shown = null, shownSim = 0, lastSeenShown = 0, sheetTouched = false, closeTimer = 0;
const me = getMe();
const costumes = costumeLayer($('wrap'), { threshold: THRESHOLD }); // draws a recognised person's costume over the camera
if (!me) { $('melink').textContent = 'Register'; $('melink').href = '/register'; }

const others = () => new Set(index.owners.filter((o) => o.id !== me?.id).map((o) => o.id)).size;
function renderCounts() {
  if (!engine) return;
  const n = others();
  $('hud-count').textContent = `${n} findable`;
  $('idle-sub').textContent = n ? `${n} ${n === 1 ? 'person' : 'people'} here can be found.` : 'Nobody else is findable yet. Ask people to scan the QR and register.';
}
async function refreshGallery() { try { index = buildIndex(await api('/api/gallery')); } catch {} renderCounts(); }
await refreshGallery();
// Profile edits arrive as the changed card, applied in place: a new costume is drawn on the next frame and an open card
// re-renders, with no gallery refetch. Someone who turns findable off is forgotten at once.
function patchPerson(card) {
  for (const o of index.owners) if (o.id === card.id) Object.assign(o, card); // matchOne hands these objects to the costume layer
  if (shown?.id === card.id) renderCard(Object.assign(shown, card), shownSim);
}
function dropPerson(id) {
  const keep = index.owners.map((o) => o.id !== id);
  index = { embeddings: index.embeddings.filter((_, i) => keep[i]), owners: index.owners.filter((_, i) => keep[i]) };
  if (shown?.id === id) closeCard(false);
  votes.delete(id); snoozed.delete(id); renderCounts();
}
let hellos = 0;
connectWs(me ? { attendee: me.id } : {}, (msg) => {
  if (msg.type === 'attendee_changed') patchPerson(msg.attendee);
  if (msg.type === 'attendee_gone') dropPerson(msg.id);
  if (msg.type === 'gallery_changed' || (msg.type === 'hello' && hellos++)) refreshGallery(); // a later hello is a reconnect: catch up on what it missed
  if (msg.type === 'haunted') hauntedAlert(msg);
});

loadEngine({ video: true, onProgress: (t) => { status(t); $('idle-sub').textContent = 'Loading face model… (first time only)'; } })
  .then((h) => { engine = h; status(`Ready (${ENGINE}). ${others()} findable people. Tap Start.`); renderCounts(); $('start').disabled = false; autoStart(); })
  .catch((e) => {
    status('Model failed: ' + e.message);
    $('idle-sub').textContent = "The face model didn't load. Check your connection and reload.";
    $('start').textContent = 'Reload'; $('start').disabled = false; $('start').onclick = () => location.reload();
  });

let shownId = null, hauntSent = false;
function renderCard(att, sim) {
  const title = costumeTitle(att); // "🧛 Count Ada" when they picked a costume; their real name moves to the handle line
  $('c-name').textContent = title || att.name; $('c-handle').textContent = [title && att.name, att.handle && '@' + att.handle].filter(Boolean).join(' · '); $('c-blurb').textContent = att.blurb || '';
  $('c-sim').textContent = `${(sim * 100).toFixed(0)}% match`;
  if (att.avatar) { $('c-avatar').src = att.avatar; $('c-avatar').hidden = false; $('c-noavatar').hidden = true; } else { $('c-avatar').hidden = true; $('c-noavatar').hidden = false; }
  $('c-profile').innerHTML = renderProfile(att);
}
function showCard(att, sim) {
  const changed = shownId !== att.id;
  shown = att; shownSim = sim; lastSeenShown = Date.now(); shownId = att.id;
  renderCard(att, sim);
  if (changed) { // reset the haunt button only when a different person appears, never on a lazy card refresh
    hauntSent = false; sheetTouched = false; clearTimeout(closeTimer);
    const b = $('haunt'); b.className = '';
    b.disabled = !!me && me.id === att.id;
    b.textContent = !me ? 'Register to haunt them' : me.id === att.id ? "That's you 👋" : `👻 Haunt ${firstName(att.name)}`;
    api(`/api/attendee/${att.id}`).then((card) => { if (shownId === card.id) renderCard(Object.assign(att, card), shownSim); }).catch(() => {});
    try { navigator.vibrate?.(30); } catch {}
  }
  $('sheet').classList.add('show'); hint('');
}
/** Close the card. snooze: that person's card stays closed until they leave the frame (or the camera is tapped). */
function closeCard(snooze = true) {
  if (shown && snooze) snoozed.set(shown.id, Date.now());
  $('sheet').classList.remove('show'); shown = null; shownId = null; votes.clear(); clearTimeout(closeTimer);
}
$('dismiss').onclick = () => closeCard(true);
$('grab').onclick = () => closeCard(true);
$('sheet').addEventListener('pointerdown', () => { sheetTouched = true; });
// tap the camera to reopen a card you closed while that person is still in view
$('wrap').addEventListener('click', () => {
  if (!running || shown) return;
  const id = [...votes.keys()].find((k) => snoozed.has(k));
  if (id) { snoozed.delete(id); votes.set(id, VOTES_NEEDED); }
});
function boo(el) {
  const r = el.getBoundingClientRect(); const s = document.createElement('span');
  s.className = 'boo'; s.textContent = '👻'; s.style.left = `${r.left + r.width / 2}px`; s.style.top = `${r.top - 30}px`;
  document.body.appendChild(s); setTimeout(() => s.remove(), 1200);
}
$('haunt').onclick = async () => {
  if (!shown) return;
  if (!me) { location.href = '/register'; return; }
  if (hauntSent) return;
  const b = $('haunt'), target = shown; b.disabled = true; hauntSent = true; b.textContent = 'Haunting…';
  try {
    await api('/api/haunt', { method: 'POST', body: { actorId: me.id, token: me.token, targetId: target.id, similarity: shownSim } });
    if (shownId !== target.id) return;
    b.className = 'ok'; b.textContent = `✓ ${firstName(target.name)} is haunted 👻`; boo(b);
    closeTimer = setTimeout(() => { if (shownId === target.id) closeCard(true); }, 3500);
  } catch (e) {
    if (shownId !== target.id) return;
    if (e.status === 404) { b.textContent = `${firstName(target.name)} just vanished (not findable)`; return; }
    if (e.status === 403) { b.textContent = 'Your card is gone. Register again to haunt'; return; }
    hauntSent = false; b.disabled = false; b.textContent = `Didn't send (${e.message}). Tap to retry`;
  }
};

/** Shared by the live loop and the photo test. Returns per-face results. */
export async function processFrame(source) {
  const faces = await engine.detect(source);
  const results = faces.map((f) => ({ ...f, ...matchOne(engine, f.embedding, index) }));
  const now = Date.now(), seen = new Set();
  for (const r of results) {
    if (r.attendee && r.similarity >= THRESHOLD) { seen.add(r.attendee.id); votes.set(r.attendee.id, (votes.get(r.attendee.id) || 0) + 1); }
  }
  for (const id of [...votes.keys()]) if (!seen.has(id)) votes.delete(id);
  for (const id of seen) if (snoozed.has(id)) snoozed.set(id, now);
  for (const [id, at] of snoozed) if (now - at > GONE_MS) snoozed.delete(id);
  if (shown && seen.has(shown.id)) lastSeenShown = now;
  let bestId = null, bestVotes = 0;
  for (const [id, v] of votes) if (!snoozed.has(id) && v > bestVotes) { bestVotes = v; bestId = id; }
  // the card stays on the person you are pointing at; it moves to someone else only once they leave the frame
  if (bestId && bestVotes >= VOTES_NEEDED && (!shown || (shown.id !== bestId && !seen.has(shown.id)))) {
    const r = results.find((x) => x.attendee?.id === bestId); showCard(r.attendee, r.similarity);
  }
  if (shown && !sheetTouched && !hauntSent && now - lastSeenShown > AUTO_CLOSE_MS) closeCard(false);
  draw(source, results);
  costumes.update(source, results, (id) => (votes.get(id) || 0) >= VOTES_NEEDED);
  if (source === $('video')) guide(results);
  return results;
}

function guide(results) {
  if (shown) return hint('');
  if (!results.length) return hint('Point at a face');
  const known = results.filter((r) => r.attendee && r.similarity >= THRESHOLD);
  if (known.some((r) => !snoozed.has(r.attendee.id))) return hint('Hold steady…');
  if (known.length) return hint(`Tap to reopen ${firstName(known[0].attendee.name)}`);
  if (results.some((r) => r.attendee && r.similarity >= ABSTAIN)) return hint('Not sure. Get a little closer');
  return hint(results.length > 1 ? 'Unknown faces' : 'Unknown face');
}

function draw(source, results) {
  const c = $('overlay'); const v = $('video');
  const sw = source.videoWidth || source.naturalWidth || source.width, sh = source.videoHeight || source.naturalHeight || source.height;
  if (c.width !== sw || c.height !== sh) { c.width = sw; c.height = sh; }
  const ctx = c.getContext('2d'); ctx.clearRect(0, 0, c.width, c.height);
  if (source !== v) ctx.drawImage(source, 0, 0, sw, sh);
  const fs = Math.round(Math.max(16, sw / 24));
  ctx.lineWidth = Math.max(3, sw / 160); ctx.font = `600 ${fs}px -apple-system, system-ui, sans-serif`;
  // the canvas is object-fit: cover, so work out which part of it is on screen; labels stay inside that and below the HUD pills
  const W = c.clientWidth || sw, H = c.clientHeight || sh, k = Math.max(W / sw, H / sh), offX = (sw * k - W) / 2, offY = (sh * k - H) / 2;
  const minX = offX / k, maxX = (offX + W) / k, minY = (offY + 48) / k, maxY = (offY + H) / k;
  for (const r of results) {
    const [x, y, w, h] = r.box;
    const matched = r.attendee && r.similarity >= THRESHOLD; const maybe = r.attendee && r.similarity >= ABSTAIN;
    const color = matched ? '#7CFF6B' : maybe ? '#ffb347' : '#c9c3d6';
    const costumed = matched && COSTUMES[r.attendee.costume]; // a costume replaces the box, and the label moves under the chin, clear of hats and horns
    ctx.strokeStyle = color; if (!costumed) ctx.strokeRect(x, y, w, h);
    const label = matched ? `${r.attendee.name} ${(r.similarity * 100).toFixed(0)}%` : maybe ? `? ${(r.similarity * 100).toFixed(0)}%` : 'unknown';
    const tw = ctx.measureText(label).width + 14, th = fs + 12;
    const lx = Math.max(minX, Math.min(x, maxX - tw)), ly = costumed ? Math.max(minY, Math.min(y + h + 8, maxY - th)) : y - th >= minY ? y - th : Math.max(minY, y + 4);
    ctx.fillStyle = '#000c'; ctx.fillRect(lx, ly, tw, th); ctx.fillStyle = color; ctx.fillText(label, lx + 7, ly + th - 8);
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
const ios = /iPhone|iPad|iPod/.test(navigator.userAgent);
function cameraHelp(e) {
  if (!navigator.mediaDevices?.getUserMedia) return 'This page needs HTTPS to use the camera. Open the https:// link.';
  if (e?.name === 'NotAllowedError') return ios ? 'Camera is blocked. Tap aA in the address bar, then Website Settings, Camera, Allow. Then try again.' : 'Camera is blocked. Tap the icon left of the address, then Permissions, Camera, Allow. Then try again.';
  if (e?.name === 'NotReadableError') return 'Another app is using the camera. Close it and try again.';
  if (e?.name === 'NotFoundError' || e?.name === 'OverconstrainedError') return 'No camera found on this device.';
  return `Camera error: ${e?.message || e}`;
}

let frames = 0, loopId = 0; // a new start() bumps loopId, so a timer left over from before an app switch cannot run a second loop
async function loop(id) {
  if (!running || id !== loopId) return;
  const v = $('video');
  if (engine && v.videoWidth) {
    const t = performance.now();
    try { const r = await processFrame(v); frames++; if (frames % 5 === 0) { const fps = (1000 / Math.max(1, performance.now() - t)).toFixed(1); const best = r.reduce((m, x) => Math.max(m, x.similarity), 0); status(`${r.length} face(s) · best ${(best * 100).toFixed(0)}% · ${fps} fps · threshold ${(THRESHOLD * 100).toFixed(0)}%`); } }
    catch (e) { status('detect error: ' + e.message); }
  }
  setTimeout(() => loop(id), 120); // ~4 fps target; detection itself takes most of it
}
let starting = false;
async function start() {
  if (running || starting || !engine) return;
  starting = true; wantRunning = true; $('start').disabled = true; $('idle-sub').textContent = 'Opening the camera…';
  try {
    stream = await navigator.mediaDevices.getUserMedia(await pickRearCamera());
    $('video').srcObject = stream; await $('video').play().catch(() => {});
    $('idle').hidden = true; running = true; wakeLock();
    $('hud-state').innerHTML = '<span class="dot"></span>Scanning'; hint('Point at a face');
    loop(++loopId);
  } catch (e) {
    wantRunning = false; $('idle').hidden = false; $('start').disabled = false; $('start').textContent = 'Try again';
    $('idle-sub').textContent = cameraHelp(e); status('Camera blocked: ' + e.message);
  } finally { starting = false; }
}
// camera already allowed on this phone (a return visit): start without the extra tap
async function autoStart() { try { if ((await navigator.permissions?.query({ name: 'camera' }))?.state === 'granted') start(); } catch {} }
$('start').onclick = () => { unlockAudio(); start(); };
document.addEventListener('visibilitychange', () => {
  if (document.hidden) {
    if (running) { running = false; stream?.getTracks().forEach((t) => t.stop()); stream = null; $('hud-state').textContent = ''; hint(''); }
  } else if (wantRunning && !running) { $('start').textContent = 'Resume hunting'; start(); } // back from another app: pick up where you were
});
// test hook: run a photo through the same pipeline VOTES_NEEDED times so the card logic is exercised
$('testfile').onchange = async (e) => {
  const file = e.target.files[0]; if (!file || !engine) return;
  $('idle').hidden = true;
  const img = await imageFromFile(file); let r = [];
  for (let i = 0; i < VOTES_NEEDED; i++) r = await processFrame(img);
  status(r.length ? r.map((x) => `${x.attendee ? x.attendee.name : 'nobody'} ${(x.similarity * 100).toFixed(0)}%`).join(' | ') : 'no faces in photo');
  window.__lastTest = r.map((x) => ({ name: x.attendee?.name || null, id: x.attendee?.id || null, similarity: x.similarity, box: x.box }));
};
window.__haunt = { get index() { return index; }, get shown() { return shown; }, THRESHOLD };
