// Face engine abstraction. All on-device; nothing here talks to the network except to fetch models.
// Engines:
//   facex (default): FaceX SDK (Apache-2.0) = 5-point aligned EdgeFace-XS 512-d embeddings, cosine similarity. Vendored in /vendor/facex.
//   human:           @vladmandic/human FaceRes 1024-d embeddings (weaker separation; kept as a fallback). ?engine=human
const PARAMS = new URLSearchParams(location.search);
// Default engine is FaceX (hybrid); ?engine=human falls back to Human's FaceRes embeddings.
const DEFAULT_ENGINE = 'facex';
export const ENGINE = PARAMS.get('engine') || DEFAULT_ENGINE;
const DEFAULT_T = { facex: 0.4, human: 0.5 };
export const THRESHOLD = Number(PARAMS.get('t')) || DEFAULT_T[ENGINE]; // name shown at/above this
export const ABSTAIN = THRESHOLD - 0.1;                                 // box only between ABSTAIN and THRESHOLD

const HUMAN_VERSION = '3.3.6';
const TFJS_WASM_VERSION = '4.22.0';
const HUMAN_CDN = `https://cdn.jsdelivr.net/npm/@vladmandic/human@${HUMAN_VERSION}`;
const FACEX_DIR = '/vendor/facex/';

function loadScript(src) {
  return new Promise((resolve, reject) => {
    if (document.querySelector(`script[src="${src}"]`)) return resolve();
    const s = document.createElement('script'); s.src = src; s.onload = resolve; s.onerror = () => reject(new Error('failed to load ' + src)); document.head.appendChild(s);
  });
}

const cosine = (a, b) => { let d = 0, na = 0, nb = 0; for (let i = 0; i < a.length; i++) { d += a[i] * b[i]; na += a[i] * a[i]; nb += b[i] * b[i]; } return na && nb ? d / Math.sqrt(na * nb) : 0; };
const findByCosine = (emb, list) => { let best = -1, sim = -1; for (let i = 0; i < list.length; i++) { const s = cosine(emb, list[i]); if (s > sim) { sim = s; best = i; } } return { index: best, similarity: Math.max(0, sim) }; };

// FaceX hybrid: Human's BlazeFace detector + FaceMesh landmarks give the 5 ArcFace keypoints; alignToArcFace warps
// the face to 112x112 and FaceX's EdgeFace-XS wasm embedder produces a 512-d vector. (FaceX's own detector needs a
// weight file that is not published, and its align.js produced shifted crops, so neither is used.)

// ArcFace 112x112 reference points (image-left eye, image-right eye, nose, left mouth, right mouth).
const ARCFACE_REF = [[38.2946, 51.6963], [73.5318, 51.5014], [56.0252, 71.7366], [41.5493, 92.3655], [70.7299, 92.2041]];
/** Least-squares 2D similarity (rotation+scale+translation) from kps -> ARCFACE_REF, applied with the canvas transform. Returns 112x112 ImageData. */
export function alignToArcFace(source, kps, dstCtx) {
  const n = kps.length; let sx = 0, sy = 0, dx = 0, dy = 0;
  for (let i = 0; i < n; i++) { sx += kps[i][0]; sy += kps[i][1]; dx += ARCFACE_REF[i][0]; dy += ARCFACE_REF[i][1]; }
  sx /= n; sy /= n; dx /= n; dy /= n;
  let num1 = 0, num2 = 0, den = 0;
  for (let i = 0; i < n; i++) {
    const xs = kps[i][0] - sx, ys = kps[i][1] - sy, xd = ARCFACE_REF[i][0] - dx, yd = ARCFACE_REF[i][1] - dy;
    num1 += xs * xd + ys * yd; num2 += xs * yd - ys * xd; den += xs * xs + ys * ys;
  }
  const a = num1 / den, b = num2 / den;            // x' = a*x - b*y + tx ; y' = b*x + a*y + ty
  const tx = dx - a * sx + b * sy, ty = dy - b * sx - a * sy;
  dstCtx.setTransform(1, 0, 0, 1, 0, 0); dstCtx.fillStyle = '#000'; dstCtx.fillRect(0, 0, 112, 112);
  dstCtx.setTransform(a, b, -b, a, tx, ty); dstCtx.drawImage(source, 0, 0);
  dstCtx.setTransform(1, 0, 0, 1, 0, 0);
  return dstCtx.getImageData(0, 0, 112, 112);
}

async function loadFaceX({ video, onProgress }) {
  onProgress?.('loading detector');
  const human = await makeHuman({ video, description: false });
  onProgress?.('loading FaceX embedder');
  await loadScript(FACEX_DIR + 'facex.js');
  const fx = await window.FaceXModule();
  onProgress?.('loading FaceX weights (7 MB, cached after first time)');
  const w = new Uint8Array(await (await fetch(FACEX_DIR + 'edgeface_xs_fp32.bin')).arrayBuffer());
  fx.FS.writeFile('/emb.bin', w);
  const handle = fx.cwrap('facex_init', 'number', ['string', 'string'])('/emb.bin', null);
  if (!handle) throw new Error('facex_init failed');
  const facexEmbed = fx.cwrap('facex_embed', 'number', ['number', 'number', 'number']);
  const crop = document.createElement('canvas'); crop.width = 112; crop.height = 112; const cropCtx = crop.getContext('2d', { willReadFrequently: true });
  const N = 112 * 112 * 3; const inPtr = fx._malloc(N * 4); const outPtr = fx._malloc(512 * 4);
  function embed(imageData) {
    const heap = fx.HEAPF32; const base = inPtr >> 2; const px = imageData.data;
    for (let i = 0; i < 112 * 112; i++) { heap[base + i * 3] = px[i * 4] / 127.5 - 1; heap[base + i * 3 + 1] = px[i * 4 + 1] / 127.5 - 1; heap[base + i * 3 + 2] = px[i * 4 + 2] / 127.5 - 1; }
    facexEmbed(handle, inPtr, outPtr);
    return Array.from(fx.HEAPF32.subarray(outPtr >> 2, (outPtr >> 2) + 512));
  }
  const center = (mesh, idx) => { let x = 0, y = 0; for (const i of idx) { x += mesh[i][0]; y += mesh[i][1]; } return [x / idx.length, y / idx.length]; };
  // MediaPipe FaceMesh indices: eye rings, nose tip, mouth corners. Sorted by x so "left" means image-left, as in align.js REF_POINTS.
  function keypoints(mesh) {
    const eyeA = center(mesh, [33, 133, 159, 145]), eyeB = center(mesh, [362, 263, 386, 374]);
    const [le, re] = eyeA[0] <= eyeB[0] ? [eyeA, eyeB] : [eyeB, eyeA];
    const mA = [mesh[61][0], mesh[61][1]], mB = [mesh[291][0], mesh[291][1]];
    const [lm, rm] = mA[0] <= mB[0] ? [mA, mB] : [mB, mA];
    return [le, re, [mesh[1][0], mesh[1][1]], lm, rm];
  }
  onProgress?.('ready');
  return {
    name: 'facex',
    async detect(source) {
      const res = await human.detect(source);
      const faces = (res.face || []).filter((f) => f.mesh && f.mesh.length >= 468);
      if (!faces.length) return [];
      return faces.map((f) => {
        const aligned = alignToArcFace(source, keypoints(f.mesh), cropCtx);
        return { box: f.box, score: f.faceScore ?? f.score ?? 0, embedding: embed(aligned), mesh: f.mesh };
      }).sort((a, b) => b.box[2] * b.box[3] - a.box[2] * a.box[3]);
    },
    similarity: cosine,
    find: findByCosine,
  };
}

async function makeHuman({ video, description }) {
  const mod = await import(`${HUMAN_CDN}/dist/human.esm.js`);
  const Human = mod.Human || mod.default;
  const human = new Human({
    backend: 'wasm', wasmPath: `https://cdn.jsdelivr.net/npm/@tensorflow/tfjs-backend-wasm@${TFJS_WASM_VERSION}/dist/`, modelBasePath: `${HUMAN_CDN}/models/`,
    async: true, warmup: 'none', cacheSensitivity: 0, debug: false, filter: { enabled: true, equalization: false },
    face: { enabled: true, detector: { rotation: true, maxDetected: video ? 6 : 4, minConfidence: 0.3, iouThreshold: 0.1, return: false, skipFrames: 0, skipTime: 0 }, mesh: { enabled: true }, attention: { enabled: false }, iris: { enabled: false }, emotion: { enabled: false }, description: { enabled: description, skipFrames: 0, skipTime: 0 }, antispoof: { enabled: false }, liveness: { enabled: false } },
    body: { enabled: false }, hand: { enabled: false }, gesture: { enabled: false }, object: { enabled: false }, segmentation: { enabled: false },
  });
  await human.load(); await human.warmup();
  return human;
}

async function loadHumanEngine({ video, onProgress }) {
  onProgress?.('loading Human models (~9 MB, cached after first time)');
  const human = await makeHuman({ video, description: true });
  onProgress?.('ready');
  return {
    name: 'human',
    async detect(source) {
      const res = await human.detect(source);
      return (res.face || []).filter((f) => Array.isArray(f.embedding) && f.embedding.length).map((f) => ({ box: f.box, score: f.faceScore ?? f.score ?? 0, embedding: f.embedding, mesh: f.mesh })).sort((a, b) => b.box[2] * b.box[3] - a.box[2] * a.box[3]);
    },
    similarity: (a, b) => human.match.similarity(a, b),
    find: (emb, list) => { const r = human.match.find(emb, list); return { index: r.index, similarity: r.similarity }; },
  };
}

let enginePromise = null;
/** Load the face engine once per page. Returns { name, detect(source), similarity(a,b), find(emb, list) }.
 *  detect() -> [{ box, score, embedding, mesh }], largest face first; mesh = 468 FaceMesh [x, y, z] points in source pixels (costumes draw from it). */
export function loadEngine({ video = false, onProgress } = {}) {
  if (!enginePromise) {
    enginePromise = (ENGINE === 'human' ? loadHumanEngine({ video, onProgress }) : loadFaceX({ video, onProgress }));
    enginePromise.catch(() => { enginePromise = null; });
  }
  return enginePromise;
}

/** Flatten gallery [{id,name,descriptors:[[...]]}] into parallel arrays. */
export function buildIndex(gallery) {
  const embeddings = [], owners = [];
  for (const a of gallery) for (const d of a.descriptors || []) { embeddings.push(d); owners.push(a); }
  return { embeddings, owners };
}
/** Best match for one embedding: { attendee|null, similarity }. */
export function matchOne(engine, embedding, index) {
  if (!index.embeddings.length) return { attendee: null, similarity: 0 };
  const same = index.embeddings.filter((e) => e.length === embedding.length);
  if (same.length !== index.embeddings.length) { // mixed engines in the gallery: only compare like with like
    const owners = index.owners.filter((_, i) => index.embeddings[i].length === embedding.length);
    const r = engine.find(embedding, same); return { attendee: r.index >= 0 ? owners[r.index] : null, similarity: r.similarity };
  }
  const r = engine.find(embedding, index.embeddings);
  return { attendee: r.index >= 0 ? index.owners[r.index] : null, similarity: r.similarity };
}
export async function imageFromFile(file) {
  const url = URL.createObjectURL(file);
  try { const img = new Image(); img.decoding = 'async'; img.src = url; await img.decode(); return img; }
  finally { setTimeout(() => URL.revokeObjectURL(url), 10_000); }
}
/** Small square face crop as a JPEG data URL (avatar). */
export function cropFace(source, box, size = 128) {
  const [x, y, w, h] = box; const W = source.naturalWidth || source.videoWidth || source.width, H = source.naturalHeight || source.videoHeight || source.height;
  const s = Math.min(Math.max(w, h) * 1.4, W, H); // the square stays inside the image (no black bar on avatars of faces near an edge)
  const sx = Math.max(0, Math.min(x + w / 2 - s / 2, W - s)), sy = Math.max(0, Math.min(y + h / 2 - s / 2, H - s));
  const c = document.createElement('canvas'); c.width = size; c.height = size;
  c.getContext('2d').drawImage(source, sx, sy, s, s, 0, 0, size, size);
  return c.toDataURL('image/jpeg', 0.8);
}
