// Costumes (#22): an optional look each attendee picks at /register or /me. A hunter's phone draws it over a face only
// after that face matched a consenting attendee (the same 3-frame vote that shows the card), from the 468-point FaceMesh
// the engine already computes. Canvas drawing and WebAudio on the phone only: no image is uploaded, fetched or stored.
import { esc, unlockAudio } from '/common.js';

const first = (name) => String(name || '').trim().split(/\s+/)[0] || 'Stranger';

export const COSTUMES = {
  vampire:  { label: 'Vampire',  emoji: '🧛', title: (n) => `Count ${n}`,          draw: drawVampire,  sting: stingVampire },
  witch:    { label: 'Witch',    emoji: '🧙', title: (n) => `${n} the Witch`,      draw: drawWitch,    sting: stingWitch },
  demon:    { label: 'Demon',    emoji: '😈', title: (n) => `${n}, Demon of Prod`, draw: drawDemon,    sting: stingDemon },
  ghost:    { label: 'Ghost',    emoji: '👻', title: (n) => `The Ghost of ${n}`,   draw: drawGhost,    sting: stingGhost },
  skeleton: { label: 'Skeleton', emoji: '💀', title: (n) => `${n} Bones`,          draw: drawSkeleton, sting: stingSkeleton },
  pumpkin:  { label: 'Pumpkin',  emoji: '🎃', title: (n) => `${n} O'Lantern`,      draw: drawPumpkin,  sting: stingPumpkin },
};

/** "🧛 Count Ada" for an attendee wearing a costume, '' for plain. */
export function costumeTitle(att) {
  const c = COSTUMES[att?.costume];
  return c ? `${c.emoji} ${c.title(first(att.name))}` : '';
}

// ---------- face rig: the few mesh points the costumes hang from ----------
// FaceMesh indices. OVAL runs clockwise from the top of the forehead (index 0) round the chin (index 18).
const OVAL = [10, 338, 297, 332, 284, 251, 389, 356, 454, 323, 361, 288, 397, 365, 379, 378, 400, 377, 152, 148, 176, 149, 150, 136, 172, 58, 132, 93, 234, 127, 162, 21, 54, 103, 67, 109];
const TOP = [0, 1, 2, 3, 4, 5, 6, 7, 29, 30, 31, 32, 33, 34, 35]; // the upper half of OVAL: embers and sparks rise from here
const EYE_A = [33, 133, 159, 145], EYE_B = [362, 263, 386, 374];
// Rig = flat x,y pairs: 0 eye (image left), 1 eye (image right), 2 top of forehead, 3 chin, 4 nose tip,
// 5 upper lip, 6 lower lip, 7 mouth corner (left), 8 mouth corner (right), 9.. the OVAL.
const R_OVAL = 9;
function rigFrom(mesh) {
  const avg = (idx) => { let x = 0, y = 0; for (const i of idx) { x += mesh[i][0]; y += mesh[i][1]; } return [x / idx.length, y / idx.length]; };
  let ea = avg(EYE_A), eb = avg(EYE_B); if (ea[0] > eb[0]) [ea, eb] = [eb, ea];
  let ma = mesh[61], mb = mesh[291]; if (ma[0] > mb[0]) [ma, mb] = [mb, ma];
  const pts = [ea, eb, mesh[10], mesh[152], mesh[1], mesh[13], mesh[14], ma, mb, ...OVAL.map((i) => mesh[i])];
  const out = new Float32Array(pts.length * 2);
  pts.forEach((p, i) => { out[2 * i] = p[0]; out[2 * i + 1] = p[1]; });
  return out;
}
function frame(r, alpha) {
  const P = (i) => [r[2 * i], r[2 * i + 1]];
  const eL = P(0), eR = P(1), top = P(2), chin = P(3);
  const eye = Math.hypot(eR[0] - eL[0], eR[1] - eL[1]), height = Math.hypot(chin[0] - top[0], chin[1] - top[1]);
  const roll = Math.atan2(eR[1] - eL[1], eR[0] - eL[0]), ux = Math.sin(roll), uy = -Math.cos(roll); // (ux, uy) = "up" for this face
  let cx = 0, cy = 0; for (let k = 0; k < OVAL.length; k++) { cx += r[2 * (R_OVAL + k)]; cy += r[2 * (R_OVAL + k) + 1]; }
  cx /= OVAL.length; cy /= OVAL.length;
  const lift = (top[0] - cx) * ux + (top[1] - cy) * uy;
  // crown: straight above the middle of the outline at forehead height, so hats and horns stay on the head when it turns.
  // u = one eye distance, the unit every prop is sized in; the face height keeps it steady when the head turns sideways.
  return { P, eL, eR, top, chin, alpha, roll, crown: [cx + ux * lift, cy + uy * lift], u: Math.max(eye, height / 2.4) };
}

// ---------- drawing helpers (g = 2D context, F = frame, t = ms) ----------
const TAU = Math.PI * 2;
const at = (g, F, [x, y]) => { g.save(); g.translate(x, y); g.rotate(F.roll); }; // local frame: +x toward the image-right eye, +y toward the chin
const alpha = (g, F, a = 1) => { g.globalAlpha = Math.max(0, Math.min(1, a * F.alpha)); };
const mid = ([ax, ay], [bx, by]) => [(ax + bx) / 2, (ay + by) / 2];
const dist = ([ax, ay], [bx, by]) => Math.hypot(bx - ax, by - ay);
function ovalPath(g, F, grow = 1, begin = true) { // smooth closed curve through the outline, optionally scaled about the face center
  const n = OVAL.length, [cx, cy] = mid(F.top, F.chin);
  const Q = (k) => { const [x, y] = F.P(R_OVAL + (k % n)); return [cx + (x - cx) * grow, cy + (y - cy) * grow]; };
  if (begin) g.beginPath();
  g.moveTo(...mid(Q(0), Q(1)));
  for (let k = 1; k <= n; k++) { const q = Q(k); g.quadraticCurveTo(q[0], q[1], ...mid(q, Q(k + 1))); }
  g.closePath();
}
function aura(g, F, color, t) { // the costume's color pulsing round the head, outside the face only
  const pulse = 0.8 + 0.2 * Math.sin(t / 260);
  g.save(); g.beginPath(); g.rect(-1e5, -1e5, 2e5, 2e5); ovalPath(g, F, 1, false); g.clip('evenodd');
  g.lineJoin = 'round'; g.strokeStyle = color;
  for (const [w, a] of [[1.7, 0.1], [1.05, 0.16], [0.6, 0.26], [0.24, 0.6]]) { alpha(g, F, a * pulse); g.lineWidth = F.u * w; ovalPath(g, F); g.stroke(); }
  g.restore();
}
function tint(g, F, color, a) { alpha(g, F, a); g.fillStyle = color; ovalPath(g, F); g.fill(); }
function glowEyes(g, F, color, r = 0.4) {
  alpha(g, F);
  for (const [x, y] of [F.eL, F.eR]) {
    const R = F.u * r, gr = g.createRadialGradient(x, y, 0, x, y, R);
    gr.addColorStop(0, '#ffffff'); gr.addColorStop(0.15, color); gr.addColorStop(0.45, color + '99'); gr.addColorStop(1, color + '00');
    g.fillStyle = gr; g.beginPath(); g.arc(x, y, R, 0, TAU); g.fill();
  }
}
function hollowEyes(g, F, rx, ry, color = '#000') {
  alpha(g, F, 0.92); g.fillStyle = color;
  for (const p of [F.eL, F.eR]) { at(g, F, p); g.beginPath(); g.ellipse(0, 0, rx * F.u, ry * F.u, 0, 0, TAU); g.fill(); g.restore(); }
}
function rising(g, F, t, color, { n = 14, period = 1600, size = 0.07, height = 1.6 } = {}) { // embers or sparks drifting up off the head
  g.fillStyle = color;
  for (let i = 0; i < n; i++) {
    const ph = (t / period + i / n) % 1, [ox, oy] = F.P(R_OVAL + TOP[(i * 5) % TOP.length]);
    alpha(g, F, (1 - ph) * 0.9); g.beginPath();
    g.arc(ox + Math.sin(t / 380 + i * 1.7) * 0.18 * F.u, oy - ph * height * F.u, (0.4 + (1 - ph)) * size * F.u, 0, TAU); g.fill();
  }
}

// ---------- the costumes ----------
function fangs(g, F) {
  const u = F.u, half = dist(F.P(7), F.P(8)) / 2;
  at(g, F, F.P(5)); alpha(g, F);
  for (const s of [-1, 1]) {
    const x = s * half * 0.45;
    g.beginPath(); g.moveTo(x - 0.075 * u, -0.03 * u); g.lineTo(x + 0.075 * u, -0.03 * u); g.lineTo(x + s * 0.015 * u, 0.32 * u); g.closePath();
    g.fillStyle = '#fffaf0'; g.fill(); g.lineWidth = Math.max(1, 0.02 * u); g.strokeStyle = '#8a8a8a'; g.stroke();
    g.fillStyle = '#c4001d'; g.beginPath(); g.arc(x + s * 0.015 * u, 0.36 * u, 0.03 * u, 0, TAU); g.fill();
  }
  g.restore();
}
function batPath(g, s, flap) { // one bat, wings spread, centred on 0,0, about 2s wide; flap in -1..1 moves the wing tips
  const tip = -0.15 - 0.35 * flap;
  g.beginPath();
  for (const k of [-1, 1]) { // each half closes on the centre line, so the pair fills as one bat
    g.moveTo(0, -0.1 * s); g.lineTo(0.06 * k * s, -0.26 * s); g.lineTo(0.12 * k * s, -0.1 * s); // ear
    g.quadraticCurveTo(0.45 * k * s, (tip - 0.15) * s, k * s, tip * s); // top edge out to the wing tip
    g.quadraticCurveTo(0.86 * k * s, (tip + 0.2) * s, 0.74 * k * s, 0.12 * s); // scalloped trailing edge back in
    g.quadraticCurveTo(0.62 * k * s, 0, 0.5 * k * s, 0.14 * s);
    g.quadraticCurveTo(0.38 * k * s, 0.02 * s, 0.26 * k * s, 0.16 * s);
    g.quadraticCurveTo(0.14 * k * s, 0.08 * s, 0.07 * k * s, 0.22 * s);
    g.lineTo(0, 0.3 * s); g.closePath();
  }
}
function bats(g, F, t) { // three bats circling the head, smaller and fainter on the far side
  const u = F.u, [cx, cy] = F.crown;
  for (let i = 0; i < 3; i++) {
    const a = t / 1100 + (i * TAU) / 3, depth = 0.6 + 0.4 * Math.sin(a), s = 0.6 * u * depth, flap = Math.sin(t / 70 + i * 2.1);
    g.save(); g.translate(cx + Math.cos(a) * 1.9 * u, cy - 0.55 * u + Math.sin(a) * 0.55 * u);
    alpha(g, F, 0.4 * depth); g.fillStyle = '#ff2a3d'; batPath(g, s * 1.15, flap); g.fill(); // red glow
    alpha(g, F, 0.5 + 0.5 * depth); g.fillStyle = '#120006'; batPath(g, s, flap); g.fill();
    g.restore();
  }
}
function drawVampire(g, F, t) { bats(g, F, t); aura(g, F, '#ff2a3d', t); tint(g, F, '#f2f0ff', 0.12); glowEyes(g, F, '#ff1a2e'); fangs(g, F); }

function hat(g, F) {
  const u = F.u; at(g, F, F.crown); alpha(g, F);
  g.lineWidth = Math.max(1, 0.035 * u); g.strokeStyle = '#7CFF6B'; g.fillStyle = '#1b1026';
  g.beginPath(); g.moveTo(-0.8 * u, -0.2 * u); // cone, tip bent to one side
  g.quadraticCurveTo(-0.45 * u, -1.2 * u, 0.5 * u, -1.8 * u);
  g.quadraticCurveTo(0.2 * u, -1.1 * u, 0.8 * u, -0.2 * u); g.closePath(); g.fill(); g.stroke();
  g.beginPath(); g.ellipse(0, -0.12 * u, 1.55 * u, 0.3 * u, 0, 0, TAU); g.fill(); g.stroke(); // brim
  g.fillStyle = '#6a2bb0'; g.beginPath(); g.moveTo(-0.8 * u, -0.22 * u); g.lineTo(0.8 * u, -0.22 * u); g.lineTo(0.72 * u, -0.5 * u); g.lineTo(-0.72 * u, -0.5 * u); g.closePath(); g.fill(); // band
  g.strokeStyle = '#ffd34d'; g.lineWidth = Math.max(1, 0.05 * u); g.strokeRect(-0.13 * u, -0.48 * u, 0.26 * u, 0.24 * u); // buckle
  g.restore();
}
function drawWitch(g, F, t) { aura(g, F, '#7CFF6B', t); rising(g, F, t, '#b6ff8a', { n: 12, period: 2200, size: 0.05 }); glowEyes(g, F, '#5dff3a', 0.36); hat(g, F); }

function horns(g, F) {
  const u = F.u; at(g, F, F.crown); alpha(g, F);
  for (const s of [-1, 1]) {
    g.beginPath(); g.moveTo(s * 0.25 * u, 0.15 * u);
    g.quadraticCurveTo(s * 0.35 * u, -0.6 * u, s * 0.95 * u, -1.05 * u); // inner edge out to the tip
    g.quadraticCurveTo(s * 0.72 * u, -0.4 * u, s * 0.75 * u, 0.12 * u); g.closePath(); // outer edge back down
    const gr = g.createLinearGradient(0, 0.15 * u, 0, -1.05 * u); gr.addColorStop(0, '#2a0000'); gr.addColorStop(0.55, '#a8001a'); gr.addColorStop(1, '#ff9a3a');
    g.fillStyle = gr; g.fill(); g.lineWidth = Math.max(1, 0.03 * u); g.strokeStyle = '#ff7a1a'; g.stroke();
  }
  g.restore();
}
function drawDemon(g, F, t) { rising(g, F, t, '#ff8a2a'); aura(g, F, '#ff4d1a', t); tint(g, F, '#ff2a00', 0.12); glowEyes(g, F, '#ffb21a'); horns(g, F); }

function drawGhost(g, F, t) {
  aura(g, F, '#dff1ff', t); tint(g, F, '#f4fbff', 0.45);
  hollowEyes(g, F, 0.26, 0.36);
  at(g, F, mid(F.P(5), F.P(6))); alpha(g, F, 0.9); g.fillStyle = '#000'; // the "oooo" mouth
  g.beginPath(); g.ellipse(0, 0.04 * F.u, 0.2 * F.u, 0.3 * F.u, 0, 0, TAU); g.fill(); g.restore();
}

function drawSkeleton(g, F, t) {
  const u = F.u;
  aura(g, F, '#f4f1e6', t); tint(g, F, '#f7f3e3', 0.4);
  hollowEyes(g, F, 0.3, 0.27, '#0a0a0a');
  alpha(g, F); g.fillStyle = '#ffffff'; for (const [x, y] of [F.eL, F.eR]) { g.beginPath(); g.arc(x, y, 0.05 * u, 0, TAU); g.fill(); } // glints
  at(g, F, F.P(4)); g.fillStyle = '#0a0a0a'; // nose hole, point up
  g.beginPath(); g.moveTo(0, -0.2 * u); g.lineTo(-0.13 * u, 0.06 * u); g.quadraticCurveTo(0, 0, 0.13 * u, 0.06 * u); g.closePath(); g.fill(); g.restore();
  const w = dist(F.P(7), F.P(8)) * 1.15, n = 6, tw = w / n; // teeth across the mouth
  at(g, F, mid(F.P(7), F.P(8))); g.fillStyle = '#0a0a0a'; g.fillRect(-w / 2, -0.11 * u, w, 0.22 * u);
  g.fillStyle = '#f7f3e3'; for (let i = 0; i < n; i++) g.fillRect(-w / 2 + i * tw + tw * 0.12, -0.09 * u, tw * 0.76, 0.18 * u);
  g.restore();
}

function drawPumpkin(g, F, t) {
  const u = F.u, flicker = 0.85 + 0.15 * Math.sin(t / 90) * Math.sin(t / 37);
  aura(g, F, '#ff8c1a', t); tint(g, F, '#ff7a00', 0.5);
  const fire = (r) => { const gr = g.createRadialGradient(0, 0, 0, 0, 0, r); gr.addColorStop(0, '#fff6a8'); gr.addColorStop(0.5, '#ffc21a'); gr.addColorStop(1, '#ff6a00'); return gr; };
  const carve = () => { g.fillStyle = fire(0.5 * u); g.fill(); g.lineWidth = Math.max(1, 0.04 * u); g.strokeStyle = '#3a1500'; g.stroke(); };
  alpha(g, F, flicker);
  for (const [p, w, h] of [[F.eL, 0.5, 0.42], [F.eR, 0.5, 0.42], [F.P(4), 0.26, 0.22]]) { // triangle eyes and nose
    at(g, F, p); g.beginPath(); g.moveTo(0, -h / 2 * u); g.lineTo(w / 2 * u, h / 2 * u); g.lineTo(-w / 2 * u, h / 2 * u); g.closePath(); carve(); g.restore();
  }
  const w = dist(F.P(7), F.P(8)) * 1.5; // jagged grin
  at(g, F, mid(F.P(7), F.P(8))); g.beginPath(); g.moveTo(-w / 2, -0.08 * u);
  for (let i = 1; i <= 6; i++) g.lineTo(-w / 2 + (i * w) / 6, i % 2 ? 0.03 * u : -0.08 * u);
  g.quadraticCurveTo(0, 0.5 * u, -w / 2, -0.08 * u); g.closePath(); carve(); g.restore();
  at(g, F, F.crown); alpha(g, F); g.fillStyle = '#4a6b1a'; // stem
  g.beginPath(); g.moveTo(-0.1 * u, 0.05 * u); g.quadraticCurveTo(-0.14 * u, -0.35 * u, 0.06 * u, -0.48 * u); g.lineTo(0.16 * u, -0.4 * u); g.quadraticCurveTo(0.04 * u, -0.25 * u, 0.1 * u, 0.05 * u); g.closePath(); g.fill();
  g.restore();
}

// ---------- stings: a short synthesized sound per costume (no audio files) ----------
function voice(a, t, { type = 'sine', f0, f1 = f0, dur, vol = 0.25, attack = 0.01, filter }) {
  const o = a.createOscillator(), env = a.createGain();
  o.type = type; o.frequency.setValueAtTime(f0, t); if (f1 !== f0) o.frequency.exponentialRampToValueAtTime(f1, t + dur);
  env.gain.setValueAtTime(0.0001, t); env.gain.exponentialRampToValueAtTime(vol, t + attack); env.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  let node = o;
  if (filter) { const f = a.createBiquadFilter(); f.type = filter.type || 'lowpass'; f.frequency.value = filter.f; if (filter.q) f.Q.value = filter.q; o.connect(f); node = f; }
  node.connect(env); env.connect(a.destination); o.start(t); o.stop(t + dur + 0.05);
  return o;
}
function noise(a, t, { dur, vol = 0.2, f = 800 }) {
  const b = a.createBuffer(1, Math.ceil(a.sampleRate * dur), a.sampleRate), d = b.getChannelData(0);
  for (let i = 0; i < d.length; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / d.length);
  const s = a.createBufferSource(), lp = a.createBiquadFilter(), gain = a.createGain();
  s.buffer = b; lp.type = 'lowpass'; lp.frequency.value = f; gain.gain.value = vol;
  s.connect(lp); lp.connect(gain); gain.connect(a.destination); s.start(t);
}
function stingVampire(a, t) { // organ chord in D minor, three bat squeaks on top
  for (const f of [146.83, 174.61, 220, 293.66]) voice(a, t, { type: 'sawtooth', f0: f, dur: 1.4, vol: 0.07, attack: 0.04, filter: { f: 1400 } });
  for (let i = 0; i < 3; i++) voice(a, t + 0.08 + i * 0.13, { f0: 4200, f1: 2500, dur: 0.06, vol: 0.06 });
}
function stingWitch(a, t) { // cackle: six falling "ha"s
  for (let i = 0; i < 6; i++) voice(a, t + i * 0.12, { type: 'square', f0: 700 - i * 45, f1: 520 - i * 45, dur: 0.09, vol: 0.12, filter: { type: 'bandpass', f: 1300, q: 2 } });
}
function stingDemon(a, t) { // low growl
  for (const f of [55, 58.5]) voice(a, t, { type: 'sawtooth', f0: f, f1: f * 0.75, dur: 1.2, vol: 0.2, attack: 0.06, filter: { f: 300 } });
  noise(a, t, { dur: 0.9, vol: 0.25, f: 500 });
}
function stingGhost(a, t) { // wooOOooo with vibrato
  const o = voice(a, t, { f0: 300, dur: 1.7, vol: 0.2, attack: 0.35 });
  o.frequency.linearRampToValueAtTime(560, t + 0.7); o.frequency.linearRampToValueAtTime(280, t + 1.7);
  const lfo = a.createOscillator(), depth = a.createGain(); lfo.frequency.value = 6; depth.gain.value = 14;
  lfo.connect(depth); depth.connect(o.frequency); lfo.start(t); lfo.stop(t + 1.75);
}
function stingSkeleton(a, t) { [1568, 1319, 1175, 988, 880, 784, 659].forEach((f, i) => voice(a, t + i * 0.075, { type: 'triangle', f0: f, dur: 0.14, vol: 0.22 })); }
function stingPumpkin(a, t) { [1318.5, 1046.5, 1244.5, 987.8].forEach((f, i) => voice(a, t + i * 0.2, { type: 'triangle', f0: f, dur: 0.55, vol: 0.14 })); }

/** Play a costume's sting. Uses the page's shared AudioContext (unlocked by the Start / arm / chip tap on iOS). */
export function playSting(id) {
  const c = COSTUMES[id]; if (!c) return;
  try { const a = unlockAudio(); if (a) c.sting(a, a.currentTime + 0.02); } catch {}
}

// ---------- /hunt: the layer over the camera ----------
const STING_GAP_MS = 30_000; // one sting per person per 30 s, however often they walk in and out of frame
const LENS = new URLSearchParams(location.search).get('lens') !== '2d'; // ?lens=2d keeps the flat costumes (debugging, old phones)
/** Costumes over the camera. update(source, results, isConfirmed) takes processFrame's results; a face gets its costume once
 *  isConfirmed(id) says the card's vote passed, and keeps it while it still matches at or above `threshold`. The WebGL lens
 *  (web/lens.js: tracked face paint, eyes, mouth, 3D props) draws it when it loads and can track that face; otherwise, and
 *  for any face the lens is not tracking, the flat 2D costume below draws it. */
export function costumeLayer(wrap, { threshold = 0 } = {}) {
  const flat = flatLayer(wrap), active = new Map(), stung = new Map(); // id -> last seen; id -> last sting
  let lens = null, loading = false, last = null;
  const loadLens = () => {
    if (loading || !LENS) return; loading = true;
    import('/lens.js').then((m) => m.createLens(wrap, { onTracking: (id) => flat.release(id) }))
      .then((l) => { lens = l; window.__lens = l.debug; if (last) l.update(last.source, last.list); }) // replay the latest frame (a test photo sends only three)
      .catch((err) => { console.warn('costume lens unavailable, using flat costumes', err); window.__lens = { failed: String(err && err.message || err) }; });
  };
  return {
    update(source, results, isConfirmed = () => true) {
      try {
        loadLens(); // first frame: start fetching the lens in the background (cached after the first visit)
        const now = performance.now(), list = [];
        for (const r of results) {
          const a = r.attendee, costume = a && COSTUMES[a.costume];
          if (!costume || r.similarity < threshold) continue;
          if (!active.has(a.id) && !isConfirmed(a.id)) continue;
          if (!active.has(a.id) && now - (stung.get(a.id) ?? -Infinity) > STING_GAP_MS) { stung.set(a.id, now); playSting(a.costume); }
          active.set(a.id, now); list.push({ id: a.id, costume: a.costume, box: r.box, mesh: r.mesh });
        }
        last = { source, list };
        for (const [id, t] of active) if (now - t > 1500) active.delete(id);
        if (lens && !lens.dead) { lens.update(source, list); flat.update(source, list.filter((x) => !lens.tracking(x.id))); }
        else flat.update(source, list);
      } catch (err) { console.warn('costume update', err); } // a costume bug must never stop matching
    },
  };
}

/** The flat 2D costumes: a canvas over the camera, drawn from the recognition mesh and eased between detections. */
function flatLayer(wrap) {
  const c = document.createElement('canvas'); c.className = 'costume-layer'; c.setAttribute('aria-hidden', 'true'); c.style.pointerEvents = 'none';
  wrap.appendChild(c);
  const g = c.getContext('2d'), faces = new Map(); // attendeeId -> { costume, cur, target, alpha, until }
  let raf = 0, last = 0;
  function tick(now) {
    raf = 0; const dt = last ? Math.min(100, now - last) : 16; last = now;
    g.clearRect(0, 0, c.width, c.height);
    const k = 1 - Math.exp(-dt / 70); // ease toward the latest detection (~70 ms time constant)
    for (const [id, e] of faces) {
      const live = now < e.until;
      e.alpha = Math.max(0, Math.min(1, e.alpha + (live ? dt / 160 : -dt / 320)));
      if (!live && !e.alpha) { faces.delete(id); continue; }
      for (let i = 0; i < e.cur.length; i++) e.cur[i] += (e.target[i] - e.cur[i]) * k;
      g.save(); try { e.costume.draw(g, frame(e.cur, e.alpha), now); } catch (err) { console.warn('costume draw', err); } g.restore();
    }
    if (faces.size) raf = requestAnimationFrame(tick); else last = 0;
  }
  return {
    update(source, list) {
      const sw = source.videoWidth || source.naturalWidth || source.width, sh = source.videoHeight || source.naturalHeight || source.height;
      if (sw && sh && (c.width !== sw || c.height !== sh)) { c.width = sw; c.height = sh; }
      const now = performance.now(), still = !source.videoWidth, seen = new Set(); // a test photo keeps its costume until the next frame
      for (const x of list) {
        if (!x.mesh || x.mesh.length < 468) continue;
        const rig = rigFrom(x.mesh);
        let e = faces.get(x.id);
        if (!e) faces.set(x.id, e = { cur: rig.slice(), alpha: 0 });
        e.costume = COSTUMES[x.costume]; e.target = rig; e.until = still ? Infinity : now + 600; seen.add(x.id);
      }
      for (const [id, e] of faces) if (!seen.has(id) && e.until > now + 600) e.until = now; // gone from this frame: a held photo face fades too
      if (faces.size && !raf) raf = requestAnimationFrame(tick);
    },
    /** The lens took this face over: fade the flat costume out. */
    release(id) { const e = faces.get(id); if (e) { e.until = Math.min(e.until, performance.now()); if (!raf) raf = requestAnimationFrame(tick); } },
  };
}

// ---------- the picker (/register and /me) ----------
const PICKER_CSS = `
.costumes { display:grid; grid-template-columns: repeat(auto-fill, minmax(92px, 1fr)); gap: 8px; }
.costumes button.costume { margin:0; padding: 10px 4px 8px; font-size: 14px; background:#2a2738; color: var(--ink); border: 2px solid transparent; display:flex; flex-direction:column; align-items:center; gap: 4px; }
.costumes button.costume.on { border-color: var(--accent); background:#3a2747; }
.costumes .c-emoji { font-size: 28px; line-height: 1; }
.costume-preview { margin-top: 10px; }`;
/** Costume chips, Plain first. name() feeds the title preview; onPick(id or null) fires on every change. Tapping one plays its sting. */
export function costumePicker(el, { value = null, name = () => '', onPick } = {}) {
  if (!document.getElementById('costume-css')) { const s = document.createElement('style'); s.id = 'costume-css'; s.textContent = PICKER_CSS; document.head.appendChild(s); }
  const ids = [null, ...Object.keys(COSTUMES)];
  const render = () => {
    const chips = ids.map((id) => {
      const c = COSTUMES[id];
      return `<button type="button" class="costume${id === value ? ' on' : ''}" role="radio" aria-checked="${id === value}" data-id="${id || ''}"><span class="c-emoji">${c ? c.emoji : '🙂'}</span>${c ? c.label : 'Plain'}</button>`;
    }).join('');
    const preview = value
      ? `Phones that find you show <b>${esc(costumeTitle({ name: name(), costume: value }))}</b>, with the ${esc(COSTUMES[value].label.toLowerCase())} drawn on your face.`
      : 'Plain: phones that find you show your normal card.';
    el.innerHTML = `<div class="costumes" role="radiogroup" aria-label="Costume">${chips}</div><div class="hint costume-preview">${preview}</div>`;
  };
  el.addEventListener('click', (e) => {
    const b = e.target.closest('button.costume'); if (!b) return;
    value = COSTUMES[b.dataset.id] ? b.dataset.id : null; render();
    playSting(value); onPick?.(value);
  });
  render();
  return { get value() { return value; }, set(v) { value = COSTUMES[v] ? v : null; render(); }, refresh: render };
}
