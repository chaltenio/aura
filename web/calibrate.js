import { loadEngine, imageFromFile, cropFace, THRESHOLD, ABSTAIN, ENGINE } from '/face.js';
import { esc } from '/common.js';
const $ = (id) => document.getElementById(id);
const status = (t) => { $('status').textContent = t; };
$('t').textContent = `${Math.round(THRESHOLD * 100)}%`;
const engine = await loadEngine({ video: false, onProgress: (t) => status(t === 'ready' ? 'Face model ready. Add photos.' : 'Loading face model… (first time only)') });
status('Face model ready. Add photos.');
const samples = []; // {name, embedding, score, thumb}
window.__matrix = null;
$('files').onchange = async (e) => {
  for (const file of e.target.files) {
    try {
      status(`Reading ${file.name}…`);
      const img = await imageFromFile(file); const faces = await engine.detect(img);
      if (!faces.length) { status(`No face in ${file.name}`); continue; }
      faces.forEach((f, i) => samples.push({ name: faces.length > 1 ? `${file.name}#${i}` : file.name, embedding: f.embedding, score: f.score, thumb: cropFace(img, f.box, 48) }));
    } catch { status('Could not read ' + file.name); }
  }
  e.target.value = ''; render();
};
const short = (n) => n.replace(/\.(jpe?g|png|webp|heic)(#\d+)?$/i, '$2').slice(-16);
function render() {
  const n = samples.length; const m = samples.map((a) => samples.map((b) => engine.similarity(a.embedding, b.embedding)));
  window.__matrix = { names: samples.map((s) => s.name), sim: m };
  let html = '<tr><th></th>' + samples.map((s, j) => `<th title="${esc(s.name)}">${j + 1}</th>`).join('') + '</tr>';
  for (let i = 0; i < n; i++) html += `<tr><th class="rh" title="${esc(samples[i].name)}"><img src="${samples[i].thumb}" alt="">${i + 1}. ${esc(short(samples[i].name))}</th>` + m[i].map((v, j) => `<td class="${i === j ? 'self' : v >= THRESHOLD ? 'hi' : v >= ABSTAIN ? 'mid' : ''}">${(v * 100).toFixed(0)}</td>`).join('') + '</tr>';
  $('matrix').innerHTML = html; status(`${n} face${n === 1 ? '' : 's'} (${ENGINE}). Add more photos any time.`);
}
