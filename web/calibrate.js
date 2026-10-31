import { loadEngine, imageFromFile, THRESHOLD, ABSTAIN, ENGINE } from '/face.js';
const $ = (id) => document.getElementById(id);
const status = (t) => { $('status').textContent = t; };
$('t').textContent = THRESHOLD;
const engine = await loadEngine({ video: false, onProgress: status });
const samples = []; // {name, embedding}
window.__matrix = null;
$('files').onchange = async (e) => {
  for (const file of e.target.files) {
    try {
      const img = await imageFromFile(file); const faces = await engine.detect(img);
      if (!faces.length) { status(`no face in ${file.name}`); continue; }
      faces.forEach((f, i) => samples.push({ name: faces.length > 1 ? `${file.name}#${i}` : file.name, embedding: f.embedding, score: f.score }));
    } catch { status('could not read ' + file.name); }
  }
  e.target.value = ''; render();
};
function render() {
  const n = samples.length; const m = samples.map((a) => samples.map((b) => engine.similarity(a.embedding, b.embedding)));
  window.__matrix = { names: samples.map((s) => s.name), sim: m };
  let html = '<tr><th></th>' + samples.map((s) => `<th>${s.name.replace(/\.(jpe?g|png)$/i, '').slice(0, 12)}</th>`).join('') + '</tr>';
  for (let i = 0; i < n; i++) html += `<tr><th class="row">${samples[i].name}</th>` + m[i].map((v, j) => `<td class="${i === j ? '' : v >= THRESHOLD ? 'hi' : v >= ABSTAIN ? 'mid' : ''}">${(v * 100).toFixed(0)}</td>`).join('') + '</tr>';
  $('matrix').innerHTML = html; status(`${n} faces (${ENGINE})`);
}
