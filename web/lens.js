// Costume lens (#31): Snapchat-style costumes on /hunt. A face that recognition has already confirmed, and whose owner
// picked a costume, is tracked at camera rate by MediaPipe Face Landmarker (GPU) inside a zoomed crop around it, and drawn
// with WebGL: face paint mapped onto the 468-point mesh and shaded by the person's real skin and light, irises tracked and
// clipped to the eyelids (they blink), a mouth that glows or goes black and fangs that show only when it opens, and 3D
// props (horns, hat, stem, bats) posed with the head and hidden behind it. Effects only: the tracker never decides who
// anyone is (recognition does), and no frame leaves the phone. If any part fails to load, costume.js keeps the 2D costumes.
import { CANON, UV, TRIS } from '/vendor/facegeom.js';

const THREE_URL = 'https://cdn.jsdelivr.net/npm/three@0.184.0/build/three.module.js';
const MP_URL = 'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@1.2.0';
const MODEL_URL = 'https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task';
const MAX_TRACKED = 2; // faces tracked at camera rate at once; any more fall back to the 2D costumes
const CROP = 256;      // tracker input: a square crop around each face, so a face across the room is still big enough
const FOV = 63;        // vertical field of view MediaPipe assumes when it solves the head pose
const PROP_ROOM = 3.2; // props are drawn in a viewport this many crops wide, so a tall hat is not cut off at the crop edge
const TEX = 512;       // face paint texture size

// FaceMesh landmark sets (MediaPipe indices; 468-477 are the irises)
const OVAL = [10, 338, 297, 332, 284, 251, 389, 356, 454, 323, 361, 288, 397, 365, 379, 378, 400, 377, 152, 148, 176, 149, 150, 136, 172, 58, 132, 93, 234, 127, 162, 21, 54, 103, 67, 109];
const EYES = [[33, 246, 161, 160, 159, 158, 157, 173, 133, 155, 154, 153, 145, 144, 163, 7], [263, 466, 388, 387, 386, 385, 384, 398, 362, 382, 381, 380, 374, 373, 390, 249]];
const LIDS = [[159, 145, 33, 133], [386, 374, 263, 362]]; // upper lid, lower lid, corner, corner: how open each eye is
const IRIS = [[468, 469, 470, 471, 472], [473, 474, 475, 476, 477]];
const BROWS = [[70, 63, 105, 66, 107], [300, 293, 334, 296, 336]];
const LIPS_OUT = [61, 146, 91, 181, 84, 17, 314, 405, 321, 375, 291, 409, 270, 269, 267, 0, 37, 39, 40, 185];
const LIPS_IN = [78, 95, 88, 178, 87, 14, 317, 402, 318, 324, 308, 415, 310, 311, 312, 13, 82, 81, 80, 191];

// ---------- looks: how each costume recolours the skin, paints the face, and treats eyes, mouth and props ----------
// skin: [desaturate, brighten, contrast, tint rgb, strength]
const LOOKS = {
  vampire:  { skin: [0.55, 0.05, 1.08, [0.97, 0.95, 1.05], 0.9], iris: { color: [1, 0.07, 0.1], glow: 0.9 }, halo: [1, 0.1, 0.12], fangs: true, props: 'bats' },
  witch:    { skin: [0.3, -0.02, 1.08, [0.7, 1.02, 0.6], 0.85], iris: { color: [0.45, 1, 0.3], glow: 0.7 }, halo: [0.4, 1, 0.3], props: 'hat' },
  demon:    { skin: [0.25, -0.05, 1.2, [1.2, 0.48, 0.38], 0.92], iris: { color: [1, 0.72, 0.08], glow: 1, slit: true }, halo: [1, 0.5, 0.1], glow: [1, 0.42, 0.08], mouth: { color: [1, 0.45, 0.05], fire: 1 }, props: 'horns' },
  ghost:    { skin: [1, 0.2, 0.85, [0.9, 0.97, 1.1], 0.95], iris: { color: [0.94, 0.96, 1], glow: 0.2, white: true }, mouth: { color: [0, 0, 0], fire: 0 } },
  skeleton: { skin: [0.9, 0.08, 1, [1, 0.98, 0.92], 0.5], mouth: { color: [0.02, 0.02, 0.02], fire: 0 } },
  pumpkin:  { skin: [0.55, 0, 1.18, [1.35, 0.62, 0.16], 0.95], iris: { color: [1, 0.78, 0.2], glow: 1 }, halo: [1, 0.6, 0.1], glow: [1, 0.62, 0.12], mouth: { color: [1, 0.62, 0.1], fire: 1 }, props: 'stem' },
};

// ---------- face paint: drawn once per costume in UV space, then wrapped onto the face mesh ----------
const P = (i) => [UV[2 * i] * TEX, (1 - UV[2 * i + 1]) * TEX];
const avgP = (idx) => { let x = 0, y = 0; for (const i of idx) { const [a, b] = P(i); x += a; y += b; } return [x / idx.length, y / idx.length]; };
const span = (a, b) => { const [x0, y0] = P(a), [x1, y1] = P(b); return Math.hypot(x1 - x0, y1 - y0); };
const half = ([a, b], [c, d]) => [(a + c) / 2, (b + d) / 2];
const eyeC = (k) => avgP(EYES[k]), eyeW = (k) => (k ? span(263, 362) : span(33, 133));
function outline(c, idx, scale = 1, at = avgP(idx)) {
  c.beginPath();
  idx.forEach((i, k) => { const [x, y] = P(i), X = at[0] + (x - at[0]) * scale, Y = at[1] + (y - at[1]) * scale; if (k) c.lineTo(X, Y); else c.moveTo(X, Y); });
  c.closePath();
}
// Blurred fill or stroke: draw an off-canvas copy and let its shadow land in place (ctx.filter is not in every Safari).
function soft(c, blur, color, path, stroke = 0) {
  c.save(); c.shadowColor = color; c.shadowBlur = blur; c.shadowOffsetX = 4 * TEX; c.translate(-4 * TEX, 0); path(c);
  if (stroke) { c.lineWidth = stroke; c.lineCap = c.lineJoin = 'round'; c.strokeStyle = '#000'; c.stroke(); } else { c.fillStyle = '#000'; c.fill(); }
  c.restore();
}
function blob(c, [x, y], r, rgb, a) { const g = c.createRadialGradient(x, y, 0, x, y, r); g.addColorStop(0, `rgba(${rgb},${a})`); g.addColorStop(1, `rgba(${rgb},0)`); c.fillStyle = g; c.fillRect(x - r, y - r, 2 * r, 2 * r); }
function rng(seed) { return () => (seed = (seed * 16807) % 2147483647) / 2147483647; }
function cracks(c, color, width, starts, branches, seed, reach = 14) {
  const r = rng(seed); c.strokeStyle = color; c.lineWidth = width; c.lineCap = c.lineJoin = 'round';
  for (const s of starts) for (let b = 0; b < branches; b++) {
    let [x, y] = P(s), ang = -Math.PI / 2 + (r() - 0.5) * 2.4; c.beginPath(); c.moveTo(x, y);
    for (let k = 0; k < 7; k++) { ang += (r() - 0.5) * 0.9; const len = reach * (0.4 + r() * 0.8); x += Math.cos(ang) * len; y += Math.sin(ang) * len; c.lineTo(x, y); }
    c.stroke();
  }
}
function teeth(c) {
  const L = P(61), R = P(291), top = P(0)[1] - 5, bot = P(17)[1] + 5, seam = (P(13)[1] + P(14)[1]) / 2, n = 10, x0 = L[0] - 3, w = (R[0] + 3 - x0) / n;
  soft(c, 4, 'rgba(14,10,10,0.96)', (k) => outline(k, LIPS_OUT, 1.2));
  c.fillStyle = 'rgba(232,226,208,1)'; c.strokeStyle = 'rgba(60,50,40,0.9)'; c.lineWidth = 1;
  for (let i = 0; i < n; i++) {
    const shrink = 1 - (Math.abs(i - (n - 1) / 2) / (n / 2)) * 0.4, x = x0 + i * w + w * 0.08, tw = w * 0.84;
    const up = (seam - top) * shrink, dn = (bot - seam) * shrink;
    c.beginPath(); c.roundRect(x, seam - up, tw, up - 1, 2); c.fill(); c.stroke();
    c.beginPath(); c.roundRect(x, seam + 1, tw, dn - 1, 2); c.fill(); c.stroke();
  }
  c.strokeStyle = 'rgba(20,14,12,0.9)'; c.lineWidth = 2;
  for (const [a, dir] of [[L, -1], [R, 1]]) { c.beginPath(); c.moveTo(a[0], a[1]); c.quadraticCurveTo(a[0] + dir * 14, a[1] - 2, a[0] + dir * 26, a[1] - 9); c.stroke(); }
}
function drip(c, [x, y], len, w) {
  c.beginPath(); c.moveTo(x - w, y); c.quadraticCurveTo(x - w * 0.6, y + len * 0.6, x - w * 0.9, y + len); c.arc(x, y + len, w * 0.9, Math.PI, 0, true);
  c.quadraticCurveTo(x + w * 0.6, y + len * 0.6, x + w, y); c.closePath();
}
const PAINTERS = {
  skeleton(g) {
    soft(g, 22, 'rgba(236,231,216,0.95)', (c) => outline(c, OVAL, 0.94));
    for (const [a, b] of [[50, 172], [280, 397]]) blob(g, half(P(a), P(b)), 0.1 * TEX, '96,86,72', 0.5); // cheek hollows
    for (const i of [127, 356]) blob(g, P(i), 0.07 * TEX, '96,86,72', 0.4); // temples
    for (const k of [0, 1]) { soft(g, 10, 'rgba(8,6,6,0.98)', (c) => outline(c, EYES[k], 2.05)); blob(g, eyeC(k), eyeW(k) * 1.5, '30,24,20', 0.5); }
    soft(g, 5, 'rgba(10,8,8,0.96)', (c) => { const t = P(195), l = P(98), r = P(327), b = P(2); c.beginPath(); c.moveTo(t[0], t[1]); c.quadraticCurveTo(l[0] - 5, l[1] - 6, l[0], l[1] + 2); c.quadraticCurveTo(b[0], b[1] - 3, r[0], r[1] + 2); c.quadraticCurveTo(r[0] + 5, r[1] - 6, t[0], t[1]); c.closePath(); });
    teeth(g);
    cracks(g, 'rgba(40,32,26,0.8)', 1.6, [151, 108, 337], 2, 11);
  },
  ghost(g) {
    for (const k of [0, 1]) { blob(g, eyeC(k), eyeW(k) * 1.5, '22,26,40', 0.88); soft(g, 8, 'rgba(6,8,16,0.8)', (c) => outline(c, EYES[k], 1.65)); }
    soft(g, 6, 'rgba(66,74,96,0.72)', (c) => outline(c, LIPS_OUT, 1.05));
    for (const [a, b] of [[50, 172], [280, 397]]) blob(g, half(P(a), P(b)), 0.1 * TEX, '80,90,116', 0.4);
  },
  vampire(g) {
    for (const k of [0, 1]) { const [x, y] = eyeC(k), w = eyeW(k); blob(g, [x, y + 0.42 * w], 0.95 * w, '72,36,84', 0.5); soft(g, 9, 'rgba(70,8,24,0.4)', (c) => outline(c, EYES[k], 1.55)); }
    for (const [a, b] of [[50, 172], [280, 397]]) blob(g, half(P(a), P(b)), 0.1 * TEX, '90,64,104', 0.3);
    soft(g, 3, 'rgba(92,0,18,0.88)', (c) => outline(c, LIPS_OUT, 1.02));
    g.fillStyle = 'rgba(136,0,16,0.95)';
    for (const [i, len, w] of [[84, 0.07, 3.2], [314, 0.1, 3.8], [17, 0.045, 2.6]]) { drip(g, P(i), len * TEX, w); g.fill(); }
    g.strokeStyle = 'rgba(255,255,255,0.35)'; g.lineWidth = 1;
    for (const i of [84, 314]) { const [x, y] = P(i); g.beginPath(); g.moveTo(x - 1, y + 3); g.lineTo(x - 1, y + 14); g.stroke(); }
  },
  demon(g, f) {
    for (const k of [0, 1]) { soft(g, 12, 'rgba(14,0,0,0.88)', (c) => outline(c, EYES[k], 2.1)); blob(g, eyeC(k), eyeW(k) * 1.6, '40,0,0', 0.5); }
    soft(g, 3, 'rgba(36,0,0,0.8)', (c) => outline(c, LIPS_OUT, 1.02));
    for (const k of [0, 1]) soft(g, 3, 'rgba(18,0,0,0.85)', (c) => { c.beginPath(); BROWS[k].forEach((i, n) => { const [x, y] = P(i); const yy = y - (k ? n : 4 - n) * 2.2; if (n) c.lineTo(x, yy); else c.moveTo(x, yy); }); }, 5); // arched evil brows
    for (const [c, color, w] of [[g, 'rgba(255,196,96,1)', 1.3], [f, 'rgba(0,255,0,0.55)', 5], [f, 'rgb(0,255,0)', 1.6]]) cracks(c, color, w, [151, 108, 337, 205, 425], 2, 7, 9); // lava cracks: hot core, soft glow
  },
  witch(g) {
    for (const k of [0, 1]) soft(g, 9, 'rgba(46,10,62,0.72)', (c) => outline(c, EYES[k], 1.75));
    soft(g, 3, 'rgba(40,8,48,0.85)', (c) => outline(c, LIPS_OUT, 1.02));
    for (const k of [0, 1]) soft(g, 2, 'rgba(20,26,10,0.85)', (c) => { c.beginPath(); BROWS[k].forEach((i, n) => { const [x, y] = P(i); if (n) c.lineTo(x, y - 2); else c.moveTo(x, y - 2); }); }, 5);
    for (const [a, b] of [[50, 172], [280, 397]]) blob(g, half(P(a), P(b)), 0.11 * TEX, '24,60,16', 0.32);
    const [wx, wy] = half(P(129), P(203)); blob(g, [wx, wy], 7, '70,60,30', 0.95); blob(g, [wx - 2, wy - 2], 3, '200,200,160', 0.5); // wart
  },
  pumpkin(g, f) {
    for (const u of [0.17, 0.29, 0.41, 0.59, 0.71, 0.83]) soft(g, 10, 'rgba(110,40,0,0.45)', (c) => { c.beginPath(); c.moveTo(u * TEX, 0.04 * TEX); c.quadraticCurveTo((u + (u - 0.5) * 0.35) * TEX, 0.5 * TEX, u * TEX, 0.97 * TEX); }, 0.03 * TEX); // ribs
    const carve = (path) => { soft(g, 3, 'rgba(255,214,110,1)', path); g.save(); path(g); g.lineWidth = 2.5; g.strokeStyle = 'rgba(60,18,0,0.9)'; g.stroke(); g.restore(); soft(f, 6, 'rgb(0,255,0)', path); };
    for (const k of [0, 1]) { const [x, y] = eyeC(k), w = eyeW(k); carve((c) => { c.beginPath(); c.moveTo(x, y - 0.85 * w); c.lineTo(x + 0.95 * w, y + 0.55 * w); c.lineTo(x - 0.95 * w, y + 0.55 * w); c.closePath(); }); }
    carve((c) => { const t = P(195), l = P(98), r = P(327); c.beginPath(); c.moveTo(t[0], t[1]); c.lineTo(r[0] + 3, r[1] + 4); c.lineTo(l[0] - 3, l[1] + 4); c.closePath(); });
    carve((c) => { // jagged grin
      const L = P(61), R = P(291), top = P(0)[1] - 2, bot = P(17)[1] + 0.05 * TEX, x0 = L[0] - 0.03 * TEX, x1 = R[0] + 0.03 * TEX, n = 7;
      c.beginPath(); c.moveTo(x0, L[1] - 4);
      for (let i = 1; i < n; i++) c.lineTo(x0 + ((x1 - x0) * i) / n, i % 2 ? top + 9 : top);
      c.lineTo(x1, R[1] - 4); c.quadraticCurveTo((x0 + x1) / 2, bot + 18, x0, L[1] - 4); c.closePath();
    });
  },
};
function fadeTop(c, from, to) { // the mesh ends mid-forehead: fade toward that edge instead of stopping in a line
  const g = c.createLinearGradient(0, from * TEX, 0, to * TEX); g.addColorStop(0, 'rgba(0,0,0,0)'); g.addColorStop(1, 'rgba(0,0,0,1)');
  c.save(); c.globalCompositeOperation = 'destination-in'; c.fillStyle = g; c.fillRect(0, 0, TEX, TEX); c.restore();
}
function textures(kind) {
  const mk = () => { const c = document.createElement('canvas'); c.width = c.height = TEX; return c; };
  const paint = mk(), fx = mk(), skin = mk(), g = paint.getContext('2d'), f = fx.getContext('2d'), k = skin.getContext('2d');
  soft(k, 40, 'rgb(255,0,0)', (c) => outline(c, OVAL, 0.88)); fadeTop(k, 0.07, 0.26); // R: where the skin is recoloured, feathered all round
  f.fillStyle = '#000'; f.fillRect(0, 0, TEX, TEX); f.globalCompositeOperation = 'lighter'; f.drawImage(skin, 0, 0);
  PAINTERS[kind](g, f);
  fadeTop(g, 0.07, 0.17);
  return { paint, fx };
}

// ---------- shaders (2D pass: vertices arrive in source pixels) ----------
const VS = `uniform vec2 size; attribute vec2 local; varying vec2 vLocal; varying vec2 vUv;
void main() { vLocal = local; vUv = uv; gl_Position = vec4(position.x / size.x * 2.0 - 1.0, 1.0 - position.y / size.y * 2.0, position.z, 1.0); }`;
const LUMA = 'float luma(vec3 c) { return dot(c, vec3(0.299, 0.587, 0.114)); }';
const FS_PAINT = `uniform sampler2D cam, paint, fx; uniform vec2 res; uniform vec3 tint, glow; uniform float desat, bright, contrast, amount, alpha, time;
varying vec2 vUv; ${LUMA}
void main() {
  vec3 c = texture2D(cam, gl_FragCoord.xy / res).rgb; float l = luma(c);
  vec4 p = texture2D(paint, vUv), f = texture2D(fx, vUv);
  vec3 skin = clamp(((mix(c, vec3(l), desat) - 0.5) * contrast + 0.5 + bright) * tint, 0.0, 1.0);
  float sk = f.r * amount;
  vec3 col = mix(c, skin, sk);
  col = mix(col, p.rgb * (0.28 + 1.25 * l), p.a);               // paint keeps the real light and shadow of the face
  col += glow * f.g * (0.85 + 0.15 * sin(time * 3.1));          // carved or cracked parts glow
  float a = clamp(max(sk, p.a) + f.g * 0.8, 0.0, 1.0) * alpha;
  gl_FragColor = vec4(col * a, a);
}`;
const FS_IRIS = `uniform sampler2D cam; uniform vec2 res; uniform vec3 color; uniform float glow, alpha, slit, white;
varying vec2 vLocal; ${LUMA}
void main() {
  float d = length(vLocal); if (d > 1.0) discard;
  float l = luma(texture2D(cam, gl_FragCoord.xy / res).rgb);
  vec3 iris = color * (0.45 + 1.3 * l) + color * glow * (1.0 - d) * 0.9;
  float pupil = slit > 0.5 ? smoothstep(0.17, 0.08, abs(vLocal.x)) * smoothstep(0.98, 0.75, abs(vLocal.y)) : smoothstep(0.42, 0.3, d);
  iris = mix(iris, vec3(0.02), pupil * (1.0 - white));
  float a = smoothstep(1.0, 0.82, d) * alpha;
  gl_FragColor = vec4(iris * a, a);
}`;
const FS_HALO = `uniform vec3 color; uniform float alpha; varying vec2 vLocal;
void main() { float d = length(vLocal); if (d > 1.0) discard; float a = pow(1.0 - d, 2.2) * alpha; gl_FragColor = vec4(color * a, a); }`;
const FS_MOUTH = `uniform vec3 color; uniform float alpha, fire, time; varying vec2 vLocal;
void main() {
  float d = clamp(length(vLocal), 0.0, 1.0);
  vec3 c = fire > 0.5 ? mix(vec3(1.0, 0.92, 0.5), color, d) * (0.9 + 0.1 * sin(time * 9.0 + vLocal.x * 6.0)) : color;
  float a = alpha * (fire > 0.5 ? 0.95 : 0.93);
  gl_FragColor = vec4(c * a, a);
}`;
const FS_FANG = `uniform float alpha; varying vec2 vLocal;
void main() { vec3 c = mix(vec3(0.72, 0.68, 0.6), vec3(0.98, 0.96, 0.9), smoothstep(0.0, 0.5, vLocal.y)) * (1.0 - 0.18 * abs(vLocal.x)); gl_FragColor = vec4(c * alpha, alpha); }`;
const FS_MASK = 'void main() { gl_FragColor = vec4(0.0); }';

// ---------- 3D props (canonical face space, cm: y up, +z toward the camera) ----------
function taperedTube(T, curve, r0, r1, colors, ridges = 0.05) {
  const N = 40, M = 16, frames = curve.computeFrenetFrames(N, false), pos = [], col = [], idx = [];
  const ca = new T.Color(colors[0]), cb = new T.Color(colors[1]), cc = new T.Color(colors[2]), c = new T.Color();
  for (let i = 0; i <= N; i++) {
    const t = i / N, p = curve.getPointAt(t), n = frames.normals[i], b = frames.binormals[i];
    const r = (r0 + (r1 - r0) * Math.pow(t, 0.85)) * (1 + ridges * Math.sin(t * 46));
    if (t < 0.6) c.copy(ca).lerp(cb, t / 0.6); else c.copy(cb).lerp(cc, (t - 0.6) / 0.4);
    for (let j = 0; j <= M; j++) {
      const a = (j / M) * Math.PI * 2, cs = Math.cos(a), sn = Math.sin(a);
      pos.push(p.x + r * (cs * n.x + sn * b.x), p.y + r * (cs * n.y + sn * b.y), p.z + r * (cs * n.z + sn * b.z)); col.push(c.r, c.g, c.b);
    }
  }
  for (let i = 0; i < N; i++) for (let j = 0; j < M; j++) { const a = i * (M + 1) + j, d = a + M + 1; idx.push(a, d, a + 1, d, d + 1, a + 1); }
  const geo = new T.BufferGeometry(); geo.setAttribute('position', new T.Float32BufferAttribute(pos, 3)); geo.setAttribute('color', new T.Float32BufferAttribute(col, 3)); geo.setIndex(idx); geo.computeVertexNormals();
  return geo;
}
const PROPS = {
  horns(T) {
    const g = new T.Group(), mat = new T.MeshStandardMaterial({ vertexColors: true, roughness: 0.42, metalness: 0.08 });
    for (const s of [-1, 1]) g.add(new T.Mesh(taperedTube(T, new T.CubicBezierCurve3(new T.Vector3(4.1 * s, 8.4, 1.4), new T.Vector3(6.4 * s, 12.6, 2.6), new T.Vector3(9.8 * s, 14.2, -0.4), new T.Vector3(10.8 * s, 18.6, -2.6)), 1.55, 0.06, [0x2b0606, 0x7a1010, 0xf0c070]), mat));
    return g;
  },
  hat(T) {
    const g = new T.Group(), felt = new T.MeshStandardMaterial({ color: 0x2a1838, roughness: 0.95, side: T.DoubleSide });
    const prof = [[13.2, 0], [13.3, 0.3], [12.6, 0.55], [9.0, 0.8], [8.4, 1.05], [7.9, 3], [6.6, 8], [4.9, 13], [3.1, 17.5], [1.6, 21], [0.4, 23.5], [0.01, 24.2]].map(([r, y]) => new T.Vector2(r, y));
    const cone = new T.LatheGeometry(prof, 64), p = cone.attributes.position;
    for (let i = 0; i < p.count; i++) { const y = p.getY(i); if (y > 10) { const k = (y - 10) / 14; p.setX(i, p.getX(i) + 3.4 * k * k); p.setZ(i, p.getZ(i) - 5.8 * k * k); } } // bent tip
    cone.computeVertexNormals(); g.add(new T.Mesh(cone, felt));
    const band = new T.Mesh(new T.CylinderGeometry(7.72, 8.22, 2.6, 64, 1, true), new T.MeshStandardMaterial({ color: 0x6a2bb0, roughness: 0.55, side: T.DoubleSide })); band.position.y = 2.25; g.add(band);
    const buckle = new T.Mesh(new T.BoxGeometry(2.6, 2.3, 0.5), new T.MeshStandardMaterial({ color: 0xffcc44, roughness: 0.3, metalness: 0.35, emissive: 0x332200 })); buckle.position.set(0, 2.25, 8.15); g.add(buckle);
    g.position.set(0, 9.4, -2.9); g.rotation.set(0.1, 0, 0.12);
    return g;
  },
  stem(T) {
    const g = new T.Group(), mat = new T.MeshStandardMaterial({ vertexColors: true, roughness: 0.85 });
    const curve = new T.QuadraticBezierCurve3(new T.Vector3(0, 12.2, -3.6), new T.Vector3(0.6, 16.8, -3.3), new T.Vector3(2.8, 18.6, -4.6));
    g.add(new T.Mesh(taperedTube(T, curve, 1.7, 1.0, [0x3a4f1c, 0x5a6b2e, 0x7d7a44], 0.12), mat));
    const cap = new T.Mesh(new T.SphereGeometry(1.0, 12, 8), new T.MeshStandardMaterial({ color: 0x7d7a44, roughness: 0.9 })); cap.position.copy(curve.getPoint(1)); g.add(cap);
    return g;
  },
  bats(T) {
    const g = new T.Group(), list = [];
    const wc = document.createElement('canvas'); wc.width = 128; wc.height = 80; const c = wc.getContext('2d');
    c.fillStyle = '#fff'; c.beginPath(); c.moveTo(0, 14); c.quadraticCurveTo(54, -4, 126, 4); c.lineTo(120, 30); // one wing: bony top edge, scalloped trailing edge
    for (const [x, y] of [[98, 48], [74, 40], [52, 64], [30, 52], [10, 72]]) c.quadraticCurveTo(x + 9, y - 20, x, y);
    c.lineTo(0, 44); c.closePath(); c.fill();
    const wingMat = new T.MeshStandardMaterial({ color: 0x160609, emissive: 0x2a0006, roughness: 0.7, map: new T.CanvasTexture(wc), alphaTest: 0.5, side: T.DoubleSide });
    const bodyMat = new T.MeshStandardMaterial({ color: 0x120607, emissive: 0x1e0004, roughness: 0.55 });
    for (let i = 0; i < 3; i++) {
      const bat = new T.Group(), body = new T.Mesh(new T.SphereGeometry(1, 14, 10), bodyMat); body.scale.set(0.95, 1.5, 0.8); bat.add(body);
      for (const s of [-1, 1]) {
        const ear = new T.Mesh(new T.ConeGeometry(0.38, 1.1, 8), bodyMat); ear.position.set(0.42 * s, 1.55, 0); ear.rotation.z = -0.25 * s; bat.add(ear);
        const pivot = new T.Group(), wing = new T.Mesh(new T.PlaneGeometry(7, 4.4), wingMat);
        wing.position.set(3.5 * s, 0.4, 0); if (s < 0) wing.scale.x = -1;
        pivot.position.x = 0.6 * s; pivot.add(wing); bat.add(pivot); bat.userData[s < 0 ? 'l' : 'r'] = pivot;
      }
      g.add(bat); list.push(bat);
    }
    const q = new T.Quaternion();
    g.userData.tick = (t) => { // circle the head facing the camera, wings beating
      g.parent?.matrix.decompose(new T.Vector3(), q, new T.Vector3()); q.invert(); // the pose matrix is set before tick()
      list.forEach((bat, i) => {
        const a = t * 1.1 + i * 2.094, R = 16.5;
        bat.position.set(Math.cos(a) * R, 8 + Math.sin(t * 1.8 + i) * 3, -4.6 + Math.sin(a) * R);
        bat.quaternion.copy(q); // undo the head's rotation: the silhouette always faces the viewer
        const flap = Math.sin(t * 13 + i * 1.7); bat.userData.l.rotation.set(0, 0.5 * flap, -0.75 * flap); bat.userData.r.rotation.set(0, -0.5 * flap, 0.75 * flap);
      });
    };
    return g;
  },
};

// ---------- the lens ----------
/** Load the tracker and renderer and add the lens canvas to `wrap`. Resolves to { update, tracking, debug } or throws. */
export async function createLens(wrap, { onTracking } = {}) {
  const [T, vision] = await Promise.all([import(THREE_URL), import(`${MP_URL}/vision_bundle.mjs`)]);
  const fileset = await vision.FilesetResolver.forVisionTasks(`${MP_URL}/wasm`);
  const debug = { delegate: 'GPU', fps: 0, tracks: [], reproj: null, errors: 0 };
  const makeTracker = async () => {
    const opts = (delegate) => ({ baseOptions: { modelAssetPath: MODEL_URL, delegate }, runningMode: 'VIDEO', numFaces: 1, outputFaceBlendshapes: false, outputFacialTransformationMatrixes: true, minFaceDetectionConfidence: 0.3, minFacePresenceConfidence: 0.3, minTrackingConfidence: 0.3 });
    try { return await vision.FaceLandmarker.createFromOptions(fileset, opts(debug.delegate)); }
    catch (err) { if (debug.delegate === 'CPU') throw err; debug.delegate = 'CPU'; return vision.FaceLandmarker.createFromOptions(fileset, opts('CPU')); }
  };
  const pool = [await makeTracker()];

  const canvas = document.createElement('canvas'); canvas.className = 'costume-lens'; canvas.setAttribute('aria-hidden', 'true');
  canvas.style.pointerEvents = 'none'; canvas.style.visibility = 'hidden'; wrap.appendChild(canvas);
  const renderer = new T.WebGLRenderer({ canvas, alpha: true, antialias: true, premultipliedAlpha: true, stencil: true });
  const pr = Math.min(2, window.devicePixelRatio || 1);
  renderer.setPixelRatio(pr); renderer.setClearColor(0x000000, 0); renderer.autoClear = false;
  const flatCam = new T.OrthographicCamera(-1, 1, 1, -1, 0, 1); // the 2D pass places vertices itself
  const camTex = new T.Texture(); camTex.minFilter = T.LinearFilter; camTex.generateMipmaps = false;
  const shared = { cam: { value: camTex }, res: { value: new T.Vector2(1, 1) }, size: { value: new T.Vector2(1, 1) }, time: { value: 0 } };
  const scene2d = new T.Scene();
  const texCache = {};
  const look = (kind) => (texCache[kind] ||= (() => { const t = textures(kind); return { paint: new T.CanvasTexture(t.paint), fx: new T.CanvasTexture(t.fx) }; })());

  const mat = (fs, uniforms, extra = {}) => new T.ShaderMaterial({ vertexShader: VS, fragmentShader: fs, uniforms: { ...shared, alpha: { value: 0 }, ...uniforms }, transparent: true, premultipliedAlpha: true, depthTest: false, depthWrite: false, side: T.DoubleSide, ...extra });
  const stencilMask = (ref) => ({ colorWrite: false, stencilWrite: true, stencilRef: ref, stencilFunc: T.AlwaysStencilFunc, stencilZPass: T.ReplaceStencilOp });
  const stencilIn = (ref) => ({ stencilWrite: true, stencilRef: ref, stencilFunc: T.EqualStencilFunc, stencilFail: T.KeepStencilOp, stencilZFail: T.KeepStencilOp, stencilZPass: T.KeepStencilOp });
  const dyn = (verts, tris, local) => { // geometry whose vertex positions are rewritten every frame
    const geo = new T.BufferGeometry();
    geo.setAttribute('position', new T.BufferAttribute(new Float32Array(verts * 3), 3).setUsage(T.DynamicDrawUsage));
    if (local) geo.setAttribute('local', new T.BufferAttribute(local, 2));
    geo.setIndex(tris); return geo;
  };
  const fan = (n) => { const idx = []; for (let i = 1; i <= n; i++) idx.push(0, i, (i % n) + 1); return idx; };
  const DISC = 24, discLocal = new Float32Array((DISC + 1) * 2); for (let i = 1; i <= DISC; i++) { const a = (i / DISC) * Math.PI * 2; discLocal[2 * i] = Math.cos(a); discLocal[2 * i + 1] = Math.sin(a); }
  const add = (geo, material, order) => { const m = new T.Mesh(geo, material); m.frustumCulled = false; m.renderOrder = order; m.visible = false; scene2d.add(m); return m; };

  function makeTrack(id) {
    const tr = { id, kind: null, lm: new Float32Array(478 * 3), matrix: new T.Matrix4(), have: false, seenAt: -1e9, alpha: 0, roi: null, tracker: null, lastTs: 0, crop: document.createElement('canvas') };
    tr.crop.width = tr.crop.height = CROP; tr.cropCtx = tr.crop.getContext('2d', { willReadFrequently: false });
    const faceGeo = new T.BufferGeometry();
    faceGeo.setAttribute('position', new T.BufferAttribute(new Float32Array(468 * 3), 3).setUsage(T.DynamicDrawUsage));
    faceGeo.setAttribute('uv', new T.BufferAttribute(UV, 2)); faceGeo.setIndex(new T.BufferAttribute(TRIS, 1));
    tr.face = add(faceGeo, mat(FS_PAINT, { paint: { value: null }, fx: { value: null }, tint: { value: new T.Vector3() }, glow: { value: new T.Vector3() }, desat: { value: 0 }, bright: { value: 0 }, contrast: { value: 1 }, amount: { value: 1 } }, { depthTest: true, depthWrite: true }), 1);
    tr.eyeMask = EYES.map(() => add(dyn(17, fan(16)), mat(FS_MASK, {}, stencilMask(1)), 2));
    tr.iris = [0, 1].map(() => add(dyn(DISC + 1, fan(DISC), discLocal), mat(FS_IRIS, { color: { value: new T.Vector3() }, glow: { value: 0 }, slit: { value: 0 }, white: { value: 0 } }, stencilIn(1)), 3));
    tr.halo = [0, 1].map(() => add(dyn(DISC + 1, fan(DISC), discLocal), mat(FS_HALO, { color: { value: new T.Vector3() } }), 4));
    const mouthLocal = new Float32Array(21 * 2);
    tr.mouthMask = add(dyn(21, fan(20)), mat(FS_MASK, {}, stencilMask(2)), 5);
    tr.mouth = add(dyn(21, fan(20), mouthLocal), mat(FS_MOUTH, { color: { value: new T.Vector3() }, fire: { value: 0 } }, stencilIn(2)), 6);
    tr.mouthLocal = mouthLocal;
    const fangLocal = new Float32Array([-1, 0, 1, 0, 0, 1, -1, 0, 1, 0, 0, 1]);
    tr.fangs = add(dyn(6, [0, 1, 2, 3, 4, 5], fangLocal), mat(FS_FANG, {}, stencilIn(2)), 7);
    tr.scene = new T.Scene(); tr.pose = new T.Group(); tr.pose.matrixAutoUpdate = false; tr.scene.add(tr.pose);
    tr.scene.add(new T.HemisphereLight(0xffffff, 0x303040, 1.5));
    const sun = new T.DirectionalLight(0xffffff, 2.4); sun.position.set(0.3, 0.8, 1); tr.scene.add(sun);
    const head = new T.Mesh(new T.SphereGeometry(1, 32, 24), new T.MeshBasicMaterial({ colorWrite: false })); // hides whatever is behind the head
    head.scale.set(7.9, 11.4, 10.2); head.position.set(0, 2, -4.6); head.renderOrder = -1; tr.pose.add(head);
    tr.cam3 = new T.PerspectiveCamera(FOV, 1, 1, 10000);
    return tr;
  }
  function dressTrack(tr, kind) {
    if (tr.kind === kind) return;
    tr.kind = kind; const L = LOOKS[kind], tx = look(kind), u = tr.face.material.uniforms;
    u.paint.value = tx.paint; u.fx.value = tx.fx;
    const [desat, bright, contrast, tint, amount] = L.skin; u.desat.value = desat; u.bright.value = bright; u.contrast.value = contrast; u.tint.value.set(...tint); u.amount.value = amount; u.glow.value.set(...(L.glow || [0, 0, 0]));
    for (const m of tr.iris) { const v = m.material.uniforms, I = L.iris || { color: [0, 0, 0], glow: 0 }; v.color.value.set(...I.color); v.glow.value = I.glow; v.slit.value = I.slit ? 1 : 0; v.white.value = I.white ? 1 : 0; }
    for (const m of tr.halo) m.material.uniforms.color.value.set(...(L.halo || [0, 0, 0]));
    if (L.mouth) { tr.mouth.material.uniforms.color.value.set(...L.mouth.color); tr.mouth.material.uniforms.fire.value = L.mouth.fire; }
    if (tr.prop) tr.pose.remove(tr.prop);
    tr.prop = L.props ? PROPS[L.props](T) : null; if (tr.prop) tr.pose.add(tr.prop);
  }
  function setVisible(tr, on) {
    const L = LOOKS[tr.kind] || {};
    tr.face.visible = on; for (const m of tr.eyeMask) m.visible = on && !!L.iris; for (const m of tr.iris) m.visible = on && !!L.iris;
    for (const m of tr.halo) m.visible = on && !!L.halo; tr.mouthMask.visible = on && !!(L.mouth || L.fangs); tr.mouth.visible = on && !!L.mouth; tr.fangs.visible = on && !!L.fangs;
  }
  const lmx = (tr, i) => tr.lm[3 * i], lmy = (tr, i) => tr.lm[3 * i + 1];
  function writePoly(mesh, tr, idx) { // fan: centroid then the ring
    const a = mesh.geometry.attributes.position, n = idx.length; let cx = 0, cy = 0;
    for (const i of idx) { cx += lmx(tr, i); cy += lmy(tr, i); } cx /= n; cy /= n;
    a.setXYZ(0, cx, cy, 0); idx.forEach((i, k) => a.setXYZ(k + 1, lmx(tr, i), lmy(tr, i), 0)); a.needsUpdate = true;
    return [cx, cy];
  }
  function writeDisc(mesh, x, y, r) { const a = mesh.geometry.attributes.position; a.setXYZ(0, x, y, 0); for (let i = 1; i <= DISC; i++) { const t = (i / DISC) * Math.PI * 2; a.setXYZ(i, x + Math.cos(t) * r, y + Math.sin(t) * r, 0); } a.needsUpdate = true; }
  function place(tr) { // landmarks -> every 2D-pass mesh of this face
    const L = LOOKS[tr.kind], fa = tr.face.geometry.attributes.position;
    for (let i = 0; i < 468; i++) fa.setXYZ(i, tr.lm[3 * i], tr.lm[3 * i + 1], tr.lm[3 * i + 2]);
    fa.needsUpdate = true;
    const ew = Math.hypot(lmx(tr, 263) - lmx(tr, 33), lmy(tr, 263) - lmy(tr, 33)); // outer eye corners
    for (const k of [0, 1]) {
      writePoly(tr.eyeMask[k], tr, EYES[k]);
      const [c, ...ring] = IRIS[k]; let r = 0; for (const i of ring) r += Math.hypot(lmx(tr, i) - lmx(tr, c), lmy(tr, i) - lmy(tr, c)); r = (r / 4) * 1.08;
      writeDisc(tr.iris[k], lmx(tr, c), lmy(tr, c), r);
      const [up, lo, a, b] = LIDS[k], open = Math.hypot(lmx(tr, up) - lmx(tr, lo), lmy(tr, up) - lmy(tr, lo)) / Math.max(1, Math.hypot(lmx(tr, a) - lmx(tr, b), lmy(tr, a) - lmy(tr, b)));
      writeDisc(tr.halo[k], lmx(tr, c), lmy(tr, c), Math.max(r * 3.4, ew * 0.16));
      tr.halo[k].material.uniforms.alpha.value = tr.alpha * 0.55 * ((L.iris && L.iris.glow) || 0) * Math.min(1, Math.max(0, (open - 0.08) / 0.12));
    }
    const [mx, my] = writePoly(tr.mouthMask, tr, LIPS_IN);
    writePoly(tr.mouth, tr, LIPS_IN);
    const mw = Math.hypot(lmx(tr, 308) - lmx(tr, 78), lmy(tr, 308) - lmy(tr, 78)) || 1;
    tr.mouthLocal[0] = tr.mouthLocal[1] = 0; LIPS_IN.forEach((i, k) => { tr.mouthLocal[2 * (k + 1)] = (lmx(tr, i) - mx) / (mw / 2); tr.mouthLocal[2 * (k + 1) + 1] = (lmy(tr, i) - my) / (mw / 2); });
    tr.mouth.geometry.attributes.local.needsUpdate = true;
    if (L.fangs) { // two fangs hanging from the upper lip, seen only inside the open mouth (stencil)
      let dx = lmx(tr, 14) - lmx(tr, 13), dy = lmy(tr, 14) - lmy(tr, 13), dl = Math.hypot(dx, dy);
      if (dl < 2) { dx = (lmx(tr, 13) + lmx(tr, 14)) / 2 - (lmx(tr, 33) + lmx(tr, 263)) / 2; dy = (lmy(tr, 13) + lmy(tr, 14)) / 2 - (lmy(tr, 33) + lmy(tr, 263)) / 2; dl = Math.hypot(dx, dy) || 1; }
      dx /= dl; dy /= dl; const sx = -dy, sy = dx, a = tr.fangs.geometry.attributes.position, len = 0.22 * mw, w = 0.08 * mw;
      [[80, 81], [310, 311]].forEach(([p, q], f) => {
        const rx = (lmx(tr, p) + lmx(tr, q)) / 2 - dx * 0.03 * mw, ry = (lmy(tr, p) + lmy(tr, q)) / 2 - dy * 0.03 * mw, inward = f ? -1 : 1;
        a.setXYZ(3 * f, rx - sx * w / 2, ry - sy * w / 2, 0); a.setXYZ(3 * f + 1, rx + sx * w / 2, ry + sy * w / 2, 0);
        a.setXYZ(3 * f + 2, rx + dx * len + sx * inward * w * 0.25, ry + dy * len + sy * inward * w * 0.25, 0);
      });
      a.needsUpdate = true;
    }
    for (const m of [tr.face, ...tr.iris, tr.mouth, tr.fangs]) m.material.uniforms.alpha.value = tr.alpha;
  }

  // ---------- tracking ----------
  let source = null, lastFrame = -1, lastImg = null, raf = 0, frames = 0, fpsAt = performance.now(), flipMatrix = null;
  const recog = new Map(); // id -> { kind, box, at } from recognition (3 to 5 a second)
  const tracks = new Map();
  const free = () => pool.find((t) => ![...tracks.values()].some((tr) => tr.tracker === t));
  async function takeTracker(tr) { // a dedicated landmarker per tracked face (VIDEO mode keeps per-stream state)
    tr.tracker = free() || null;
    if (!tr.tracker && pool.length < MAX_TRACKED) { const t = await makeTracker(); pool.push(t); if (tracks.get(tr.id) === tr && !tr.tracker) tr.tracker = t; }
  }
  function roiFrom(box, W, H) { const [x, y, w, h] = box, s = Math.max(w, h) * 2.1; return [x + w / 2 - s / 2, y + h / 2 - s * 0.47, s]; }
  function track(tr, src, W, H, now) {
    const rec = recog.get(tr.id);
    if (!tr.roi || now - tr.seenAt > 400) tr.roi = rec ? roiFrom(rec.box, W, H) : tr.roi;
    if (!tr.roi || !tr.tracker) return;
    const [sx, sy, s] = tr.roi, c = tr.cropCtx;
    c.fillStyle = '#000'; c.fillRect(0, 0, CROP, CROP); c.drawImage(src, sx, sy, s, s, 0, 0, CROP, CROP);
    const ts = Math.max(now, tr.lastTs + 1); tr.lastTs = ts;
    const res = tr.tracker.detectForVideo(tr.crop, ts), lm = res.faceLandmarks?.[0];
    if (!lm) return;
    let x0 = 1e9, y0 = 1e9, x1 = -1e9, y1 = -1e9;
    for (let i = 0; i < lm.length && i < 478; i++) {
      const X = sx + lm[i].x * s, Y = sy + lm[i].y * s; tr.lm[3 * i] = X; tr.lm[3 * i + 1] = Y; tr.lm[3 * i + 2] = (lm[i].z * s) / W;
      if (i < 468) { x0 = Math.min(x0, X); y0 = Math.min(y0, Y); x1 = Math.max(x1, X); y1 = Math.max(y1, Y); }
    }
    if (rec && now - rec.at < 600) { // identity guard: the face in the crop must be the one recognition named
      const [bx, by, bw, bh] = rec.box;
      if (Math.hypot((x0 + x1) / 2 - (bx + bw / 2), (y0 + y1) / 2 - (by + bh / 2)) > Math.max(bw, bh) * 0.9) { tr.roi = roiFrom(rec.box, W, H); return; }
    }
    const m = res.facialTransformationMatrixes?.[0];
    if (m) {
      tr.matrix.fromArray(m.data);
      if (flipMatrix === null) flipMatrix = pickOrder(tr, lm);
      if (flipMatrix) tr.matrix.transpose();
    }
    if (now - tr.seenAt > 600) onTracking?.(tr.id); // (re)acquired: the flat costume can step aside
    tr.cropRect = [sx, sy, s]; tr.have = true; tr.seenAt = now;
    const fw = x1 - x0, fh = y1 - y0, side = Math.max(fw, fh) * 2.1; tr.roi = [(x0 + x1) / 2 - side / 2, (y0 + y1) / 2 - side * 0.47, side]; // follow the face
  }
  function pickOrder(tr, lm) { // MediaPipe's matrix layout, checked once by projecting canonical points back onto the landmarks
    const cam = new T.PerspectiveCamera(FOV, 1, 1, 10000); cam.updateProjectionMatrix();
    const err = (M) => { let e = 0; for (const i of [1, 10, 152, 234, 454]) { const v = new T.Vector3(CANON[3 * i], CANON[3 * i + 1], CANON[3 * i + 2]).applyMatrix4(M).applyMatrix4(cam.projectionMatrix); e += Math.hypot(v.x - (lm[i].x * 2 - 1), v.y - (1 - lm[i].y * 2)); } return e / 5; };
    const a = err(tr.matrix), b = err(tr.matrix.clone().transpose());
    debug.reproj = { asIs: +a.toFixed(3), transposed: +b.toFixed(3) };
    return b < a;
  }

  // ---------- render ----------
  function render(now, W, H) {
    shared.time.value = now / 1000;
    renderer.setViewport(0, 0, W, H); renderer.clear(true, true, true);
    let any = false;
    for (const tr of tracks.values()) {
      const on = tr.have && tr.alpha > 0.001; setVisible(tr, on);
      if (on) { place(tr); any = true; }
    }
    canvas.style.visibility = any ? 'visible' : 'hidden';
    if (!any) return;
    renderer.render(scene2d, flatCam);
    for (const tr of tracks.values()) { // 3D props, each through a camera matching its crop
      if (!(tr.have && tr.alpha > 0.001 && tr.prop && tr.cropRect)) continue;
      const [sx, sy, s] = tr.cropRect, big = s * PROP_ROOM, cx = sx + s / 2, cy = sy + s / 2;
      tr.cam3.projectionMatrix.makePerspective(...frustum()).premultiply(new T.Matrix4().makeScale(1 / PROP_ROOM, 1 / PROP_ROOM, 1));
      tr.cam3.projectionMatrixInverse.copy(tr.cam3.projectionMatrix).invert();
      tr.pose.matrix.copy(tr.matrix); tr.pose.matrixWorldNeedsUpdate = true;
      tr.prop.userData.tick?.(now / 1000);
      tr.prop.traverse((o) => { if (o.material) { o.material.transparent = tr.alpha < 0.99; o.material.opacity = tr.alpha; } });
      renderer.clearDepth(); renderer.setViewport(cx - big / 2, H - cy - big / 2, big, big);
      renderer.render(tr.scene, tr.cam3);
    }
    renderer.setViewport(0, 0, W, H);
  }
  function frustum() { const top = Math.tan((FOV * Math.PI) / 360); return [-top, top, top, -top, 1, 10000]; } // near = 1

  function step(now) {
    raf = 0;
    try {
      const src = source, W = src?.videoWidth || src?.naturalWidth || src?.width, H = src?.videoHeight || src?.naturalHeight || src?.height;
      if (!src || !W || !H) return;
      const isVideo = !!src.videoWidth;
      if (canvas.width !== Math.round(W * pr) || canvas.height !== Math.round(H * pr)) renderer.setSize(W, H, false);
      renderer.getDrawingBufferSize(shared.res.value); shared.size.value.set(W, H);
      for (const [id, r] of recog) if (isVideo && now - r.at > 1500) recog.delete(id);
      for (const [id, r] of recog) if (!tracks.has(id) && tracks.size < MAX_TRACKED) { const tr = makeTrack(id); tracks.set(id, tr); takeTracker(tr); }
      const fresh = isVideo ? src.currentTime !== lastFrame : src !== lastImg;
      if (fresh) {
        lastFrame = isVideo ? src.currentTime : -1; lastImg = isVideo ? null : src;
        camTex.image = src; camTex.needsUpdate = true;
        for (const tr of tracks.values()) if (recog.has(tr.id)) track(tr, src, W, H, now);
        frames++;
      }
      for (const [id, tr] of tracks) {
        const rec = recog.get(id); if (rec) dressTrack(tr, rec.kind);
        const live = rec && tr.have && (isVideo ? now - tr.seenAt < 500 : true);
        tr.alpha = Math.max(0, Math.min(1, tr.alpha + (live ? 0.12 : -0.08)));
        if (!live && tr.alpha === 0 && !rec) { for (const m of [tr.face, ...tr.eyeMask, ...tr.iris, ...tr.halo, tr.mouthMask, tr.mouth, tr.fangs]) { scene2d.remove(m); m.geometry.dispose(); m.material.dispose(); } tracks.delete(id); }
      }
      render(now, W, H);
      if (now - fpsAt > 1000) { debug.fps = Math.round((frames * 1000) / (now - fpsAt)); frames = 0; fpsAt = now; }
      debug.tracks = [...tracks.values()].map((t) => ({ id: t.id, kind: t.kind, alpha: +t.alpha.toFixed(2), have: t.have, tracker: !!t.tracker }));
    } catch (err) { debug.errors++; debug.lastError = String(err && err.message || err); if (debug.errors > 20) { debug.dead = true; canvas.style.visibility = 'hidden'; return; } }
    if (recog.size || tracks.size) raf = requestAnimationFrame(step);
  }

  return {
    debug,
    /** From costume.js at recognition rate: confirmed, costumed faces [{ id, costume, box }] in this frame. */
    update(src, list) {
      if (debug.dead) return;
      source = src; const now = performance.now();
      for (const x of list) if (LOOKS[x.costume]) recog.set(x.id, { kind: x.costume, box: x.box, at: now });
      if (!src.videoWidth) for (const id of [...recog.keys()]) if (!list.some((x) => x.id === id)) recog.delete(id); // a new test photo without them
      if (!raf && (recog.size || tracks.size)) raf = requestAnimationFrame(step);
    },
    /** They took the costume off: fade their track out now. */
    drop(id) { recog.delete(id); if (!raf && tracks.size) raf = requestAnimationFrame(step); },
    /** True while the lens is drawing this attendee (so the 2D costume should not). */
    tracking(id) { const tr = tracks.get(id); return !debug.dead && !!tr && tr.have && performance.now() - tr.seenAt < 600; },
    get dead() { return !!debug.dead; },
  };
}
