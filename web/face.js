// Face engine abstraction. All on-device; nothing here talks to the network except to fetch models.
// Engines:
//   facex (default): FaceX SDK (Apache-2.0) = 5-point aligned EdgeFace-XS 512-d embeddings, cosine similarity. Vendored in /vendor/facex.
//   human:           @vladmandic/human FaceRes 1024-d embeddings (weaker separation; kept as a fallback). ?engine=human
const PARAMS = new URLSearchParams(location.search);
// Default engine is 'human' until FaceX is validated on phones; switch with ?engine=facex (or flip DEFAULT_ENGINE).
const DEFAULT_ENGINE = 'human';
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

async function loadFaceX({ onProgress }) {
  onProgress?.('loading FaceX engine');
  for (const f of ['detect.js', 'facex.js', 'align.js']) await loadScript(FACEX_DIR + f);
  if (!window.FaceDetModule && window.DetectModule) window.FaceDetModule = window.DetectModule; // sdk expects FaceDetModule; detect.js defines DetectModule
  await loadScript(FACEX_DIR + 'facex-sdk.js');
  // `class FaceXSDK` in a classic script is a global lexical binding, not a window property
  const FaceXSDK = window.FaceXSDK || Function('return typeof FaceXSDK !== "undefined" ? FaceXSDK : null')();
  if (!FaceXSDK) throw new Error('FaceXSDK not found after loading scripts');
  const sdk = new FaceXSDK({ detSize: Number(PARAMS.get('det')) || 320, detWeightsUrl: FACEX_DIR + 'det_500m_int8.bin', embWeightsUrl: FACEX_DIR + 'edgeface_xs_fp32.bin', onProgress: (m) => onProgress?.(String(m)) });
  onProgress?.('loading FaceX weights (7 MB, cached after first time)');
  await sdk.load();
  onProgress?.('ready');
  return {
    name: 'facex',
    async detect(source) {
      const r = sdk.process(source);
      return r.faces.map((f, i) => ({ box: [f.x1, f.y1, f.x2 - f.x1, f.y2 - f.y1], score: f.score, embedding: Array.from(r.embeddings[i]) }))
        .filter((f) => f.embedding.length === 512)
        .sort((a, b) => b.box[2] * b.box[3] - a.box[2] * a.box[3]);
    },
    similarity: cosine,
    find: findByCosine,
  };
}

async function loadHumanEngine({ video, onProgress }) {
  onProgress?.('loading Human library');
  const mod = await import(`${HUMAN_CDN}/dist/human.esm.js`);
  const Human = mod.Human || mod.default;
  const human = new Human({
    backend: 'wasm', wasmPath: `https://cdn.jsdelivr.net/npm/@tensorflow/tfjs-backend-wasm@${TFJS_WASM_VERSION}/dist/`, modelBasePath: `${HUMAN_CDN}/models/`,
    async: true, warmup: 'none', cacheSensitivity: 0, debug: false, filter: { enabled: true, equalization: false },
    face: { enabled: true, detector: { rotation: true, maxDetected: video ? 6 : 4, minConfidence: 0.3, iouThreshold: 0.1, return: false, skipFrames: 0, skipTime: 0 }, mesh: { enabled: true }, attention: { enabled: false }, iris: { enabled: false }, emotion: { enabled: false }, description: { enabled: true, skipFrames: 0, skipTime: 0 }, antispoof: { enabled: false }, liveness: { enabled: false } },
    body: { enabled: false }, hand: { enabled: false }, gesture: { enabled: false }, object: { enabled: false }, segmentation: { enabled: false },
  });
  onProgress?.('loading Human models (~9 MB, cached after first time)');
  await human.load(); await human.warmup();
  onProgress?.('ready');
  return {
    name: 'human',
    async detect(source) {
      const res = await human.detect(source);
      return (res.face || []).filter((f) => Array.isArray(f.embedding) && f.embedding.length).map((f) => ({ box: f.box, score: f.faceScore ?? f.score ?? 0, embedding: f.embedding })).sort((a, b) => b.box[2] * b.box[3] - a.box[2] * a.box[3]);
    },
    similarity: (a, b) => human.match.similarity(a, b),
    find: (emb, list) => { const r = human.match.find(emb, list); return { index: r.index, similarity: r.similarity }; },
  };
}

let enginePromise = null;
/** Load the face engine once per page. Returns { name, detect(source), similarity(a,b), find(emb, list) }. */
export function loadEngine({ video = false, onProgress } = {}) {
  if (!enginePromise) {
    enginePromise = (ENGINE === 'human' ? loadHumanEngine({ video, onProgress }) : loadFaceX({ onProgress }));
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
  const [x, y, w, h] = box; const s = Math.max(w, h) * 1.4; const cx = x + w / 2, cy = y + h / 2;
  const c = document.createElement('canvas'); c.width = size; c.height = size;
  c.getContext('2d').drawImage(source, cx - s / 2, cy - s / 2, s, s, 0, 0, size, size);
  return c.toDataURL('image/jpeg', 0.8);
}
