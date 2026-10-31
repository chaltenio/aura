import { loadEngine, imageFromFile, cropFace, ENGINE } from '/face.js';
import { api, esc } from '/common.js';
const $ = (id) => document.getElementById(id);
const status = (t) => { $('status').textContent = t; };
let engine = null, rows = [], photos = new Map();
loadEngine({ video: false, onProgress: status }).then((e) => { engine = e; status(`Face model ready (${ENGINE}).`); refresh(); }).catch((e) => status('Model failed: ' + e.message));

function parseCsv(text) {
  const out = []; let row = [], field = '', q = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) { if (c === '"') { if (text[i + 1] === '"') { field += '"'; i++; } else q = false; } else field += c; }
    else if (c === '"') q = true;
    else if (c === ',') { row.push(field); field = ''; }
    else if (c === '\n' || c === '\r') { if (c === '\r' && text[i + 1] === '\n') i++; row.push(field); if (row.some((f) => f.trim())) out.push(row); row = []; field = ''; }
    else field += c;
  }
  row.push(field); if (row.some((f) => f.trim())) out.push(row);
  const header = out.shift().map((h) => h.trim().toLowerCase());
  return out.map((r) => Object.fromEntries(header.map((h, i) => [h, (r[i] || '').trim()])));
}
function setRows(text) { rows = parseCsv(text).filter((r) => r.name); rows.forEach((r) => { r.result = ''; }); render(); refresh(); }
$('csv').onchange = async (e) => { const f = e.target.files[0]; if (f) setRows(await f.text()); };
$('csvtext').oninput = (e) => { try { setRows(e.target.value); } catch {} };
$('photos').onchange = (e) => { for (const f of e.target.files) photos.set(f.name.toLowerCase(), f); render(); refresh(); };
$('consent').onchange = refresh;
function photoFor(r) { const k = (r.photo || '').toLowerCase(); return photos.get(k) || photos.get(k.split('/').pop()) || null; }
function refresh() { $('run').disabled = !(engine && rows.length && $('consent').checked); }
function render() {
  $('rows').querySelector('tbody').innerHTML = rows.map((r, i) => `<tr><td>${r.avatar ? `<img src="${r.avatar}">` : ''}</td><td>${esc(r.name)}</td><td>${esc(r.handle || '')}</td><td>${photoFor(r) ? '📎 ' + esc(photoFor(r).name) : /^https?:/.test(r.photo || '') ? '🔗 url' : `<span class="bad">missing: ${esc(r.photo || '(none)')}</span>`}</td><td id="res-${i}">${r.result || ''}</td></tr>`).join('');
}
async function loadPhoto(r) {
  const f = photoFor(r); if (f) return imageFromFile(f);
  if (/^https?:/.test(r.photo || '')) { const img = new Image(); img.crossOrigin = 'anonymous'; img.src = r.photo; await img.decode(); return img; }
  throw new Error('no photo');
}
$('run').onclick = async () => {
  $('run').disabled = true;
  let ok = 0;
  for (let i = 0; i < rows.length; i++) {
    const r = rows[i]; const cell = () => document.getElementById(`res-${i}`);
    try {
      const img = await loadPhoto(r);
      const faces = await engine.detect(img);
      if (!faces.length) throw new Error('no face found');
      const f = faces[0]; r.avatar = cropFace(img, f.box);
      const { id } = await api('/api/attendee', { method: 'POST', body: { name: r.name, handle: (r.handle || '').replace(/^@/, ''), blurb: r.blurb || '', linkedin: r.linkedin || '', provider: 'csv', consent: true, descriptors: [f.embedding], avatar: r.avatar } });
      r.result = `<span class="ok">enrolled</span> ${faces.length > 1 ? `(largest of ${faces.length} faces)` : ''} <span class="mute">${id.slice(0, 8)}</span>`; ok++;
    } catch (e) { r.result = `<span class="bad">${esc(e.message)}</span>`; }
    render(); status(`${i + 1}/${rows.length} processed, ${ok} enrolled`);
  }
  $('run').disabled = false;
};
