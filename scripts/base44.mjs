#!/usr/bin/env node
// Base44 mirror of the HAUNT frontend (Base44 "Real users" challenge): the same web/ pages, hosted on Base44 at
// https://aura-haunt.base44.app. The API and the /ws socket stay on Fly, so phones on either URL share one room; Fly
// lets the mirror's origin in (FRONTEND_ORIGINS in fly.toml, server/cors.js). Every push to main deploys Fly first,
// then this (.github/workflows/deploy.yml, job base44). Docs: docs/DEPLOY.md "Base44 mirror".
//
//   node scripts/base44.mjs build    web/ -> dist/base44/ (below), checked; nothing leaves the laptop
//   node scripts/base44.mjs deploy   build, tar.gz, upload to Base44 (deploy-dist API), wait until the site serves it, check
//   node scripts/base44.mjs check    live checks only: the mirror serves this build's pages, Fly answers the mirror's CORS
//
// What the build changes, and why:
//   - every page gets window.HAUNT_API = the Fly URL in <head>; web/common.js sends api() and the socket there
//   - index.html gets a router: Base44 serves index.html for any path that is not a file, so /register -> /register.html
//   - every local script, module import and stylesheet gets ?v=<sha>: Base44 caches them for an hour, pages it does not
//   - FaceX weights are bundled (gitignored in web/; fetched here like the Dockerfile does), so models load from Base44
//
// Env: BASE44_TOKEN    personal access token (Full access, scoped to the HAUNT app) or workspace API key; without it,
//                      deploy uploads through your own Base44 CLI login (`npx base44 login`, once)
//      BASE44_APP_ID   default below; BASE44_URL (the live mirror) default below; HAUNT_API default https://aura-haunt.fly.dev
//      GIT_SHA         default `git rev-parse HEAD`; BASE44_OUT default dist/base44; BASE44_WEIGHTS=0 skips weights (tests)
import { cpSync, existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { execFileSync, spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const APP_ID = process.env.BASE44_APP_ID || '6ae6701d773bec7f249e1409'; // Base44 app "HAUNT", created 2026-10-31
const MIRROR = (process.env.BASE44_URL || 'https://aura-haunt.base44.app').replace(/\/+$/, '');
const API = (process.env.HAUNT_API || 'https://aura-haunt.fly.dev').replace(/\/+$/, '');
const OUT = process.env.BASE44_OUT || join(ROOT, 'dist', 'base44');
const SHA = (process.env.GIT_SHA || git('rev-parse', 'HEAD') || 'dev').slice(0, 7);
// Same release files as server/index.js and the Dockerfile.
const FACEX_WEIGHTS = {
  'edgeface_xs_fp32.bin': 'https://github.com/facex-engine/facex/releases/download/v1.0.0/edgeface_xs_fp32.bin',
  'det_500m_int8.bin': 'https://github.com/facex-engine/facex/releases/download/v1.0.0/det_500m_int8.bin',
};
const LIMITS = { bytes: 50e6, files: 1000 }; // Base44 deploy-dist: 50 MB extracted, 1,000 files

function git(...args) { try { return execFileSync('git', args, { cwd: ROOT, encoding: 'utf8' }).trim(); } catch { return ''; } }
const die = (msg) => { console.error(`base44: ${msg}`); process.exit(1); };
const walk = (dir) => readdirSync(dir, { withFileTypes: true }).flatMap((d) => (d.isDirectory() ? walk(join(dir, d.name)) : [join(dir, d.name)]));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ---------- build ----------
const bust = (s) => s
  .replace(/(\s(?:src|href)\s*=\s*)(["'])(\/(?!\/)[^"'?#\s]+\.(?:m?js|css|svg|png|ico|webmanifest|json))\2/gi, `$1$2$3?v=${SHA}$2`)
  .replace(/(\bfrom\s*|\bimport\s*\(\s*|\bimport\s+)(["'])(\/(?!\/)[^"'?#\s]+\.m?js)\2/g, `$1$2$3?v=${SHA}$2`);

async function build() {
  rmSync(OUT, { recursive: true, force: true });
  cpSync(join(ROOT, 'web'), OUT, { recursive: true, filter: (src) => !src.endsWith('.DS_Store') });
  if (process.env.BASE44_WEIGHTS !== '0') {
    for (const [name, url] of Object.entries(FACEX_WEIGHTS)) {
      const dest = join(OUT, 'vendor', 'facex', name);
      if (existsSync(dest) && statSync(dest).size > 0) continue;
      const res = await fetch(url, { redirect: 'follow' });
      if (!res.ok) die(`weights: ${url} -> HTTP ${res.status}`);
      writeFileSync(dest, Buffer.from(await res.arrayBuffer()));
    }
  }
  const pages = readdirSync(OUT).filter((f) => f.endsWith('.html'));
  const routes = pages.filter((f) => f !== 'index.html').map((f) => '/' + f.replace(/\.html$/, ''));
  const config = `<script>window.HAUNT_API=${JSON.stringify(API)};window.HAUNT_MIRROR=${JSON.stringify(`Base44 mirror ${SHA}`)};</script>`;
  const router = `<script>(function(){var p=location.pathname.replace(/\\/+$/,'');if(${JSON.stringify(routes)}.indexOf(p)>=0)location.replace(p+'.html'+location.search+location.hash);})();</script>`;
  for (const f of pages) {
    const path = join(OUT, f); const html = readFileSync(path, 'utf8');
    if (!/<head>\s*<meta charset="?utf-8"?>/i.test(html)) die(`${f} must start <head> with <meta charset="utf-8"> (the API config goes right after it)`);
    writeFileSync(path, bust(html.replace(/(<head>\s*<meta charset="?utf-8"?>)/i, `$1${f === 'index.html' ? router : ''}${config}`)));
  }
  for (const f of walk(OUT).filter((f) => f.endsWith('.js') && !relative(OUT, f).startsWith('vendor'))) writeFileSync(f, bust(readFileSync(f, 'utf8')));
  writeFileSync(join(OUT, 'build.json'), JSON.stringify({ sha: SHA, api: API, builtAt: new Date().toISOString() }) + '\n');

  // A page that skips api()/API would call Base44 for the API, and Base44 answers every unknown path with index.html.
  const files = walk(OUT); const problems = [];
  for (const f of files.filter((f) => /\.(m?js|html)$/.test(f) && !relative(OUT, f).startsWith('vendor'))) {
    const s = readFileSync(f, 'utf8'); const rel = relative(OUT, f);
    if (/fetch\(\s*["'`]\/(api|auth)\b/.test(s)) problems.push(`${rel}: fetch('/api...') must go through api() or API + path (web/common.js)`);
    if (/location\.host\b[^\n]*\/ws\b/.test(s)) problems.push(`${rel}: the socket URL must come from connectWs() (web/common.js)`);
    if (/(\bfrom\s*|\bimport\s*\(\s*)["']\.{1,2}\//.test(s)) problems.push(`${rel}: relative module import; use '/x.js' so the ?v= cache key is the same everywhere`);
  }
  const bytes = files.reduce((n, f) => n + statSync(f).size, 0);
  if (bytes > LIMITS.bytes || files.length > LIMITS.files) problems.push(`${files.length} files, ${(bytes / 1e6).toFixed(1)} MB: over Base44's ${LIMITS.files} files / 50 MB`);
  if (problems.length) die('build is not mirror-safe:\n  - ' + problems.join('\n  - '));
  console.log(`base44: built ${relative(ROOT, OUT) || OUT} (${files.length} files, ${(bytes / 1e6).toFixed(1)} MB, ${SHA}, API ${API})`);
}

// ---------- deploy ----------
async function upload() {
  const dir = mkdtempSync(join(tmpdir(), 'base44-')); const tar = join(dir, 'site.tar.gz');
  // the build folder's contents at the archive root (index.html must be there); no macOS ._ resource files
  execFileSync('tar', ['-czf', tar, '-C', OUT, ...readdirSync(OUT)], { env: { ...process.env, COPYFILE_DISABLE: '1' } });
  const endpoint = `https://app.base44.com/api/apps/${APP_ID}/deploy-dist`;
  try {
    if (process.env.BASE44_TOKEN) {
      for (let attempt = 1; ; attempt++) {
        const form = new FormData(); form.append('file', new Blob([readFileSync(tar)], { type: 'application/gzip' }), 'site.tar.gz');
        const res = await fetch(endpoint, { method: 'POST', headers: { authorization: `Bearer ${process.env.BASE44_TOKEN.trim()}` }, body: form });
        const body = await res.text();
        if (res.status === 429 && attempt < 4) { console.log('base44: rate limited (5 deploys a minute per workspace), retrying in 20 s'); await sleep(20000); continue; }
        if (!res.ok) die(`deploy-dist -> HTTP ${res.status}: ${body.slice(0, 300)}${res.status === 401 || res.status === 403 ? ' (BASE44_TOKEN must be Full access and reach this app)' : ''}`);
        return JSON.parse(body);
      }
    }
    console.log('base44: no BASE44_TOKEN, uploading with your Base44 CLI login');
    const r = spawnSync('npx', ['-y', 'base44@0.2.6', 'api', 'fetch', 'POST', '/api/apps/{app_id}/deploy-dist', '--app-id', APP_ID, '--form', `file=@${tar}`], { encoding: 'utf8', env: { ...process.env, BASE44_DISABLE_TELEMETRY: '1' } });
    if (r.status !== 0) die(`base44 CLI upload failed (run \`npx base44 login\` once, or set BASE44_TOKEN):\n${(r.stderr || '').trim().slice(-600)}`);
    return JSON.parse(r.stdout);
  } finally { rmSync(dir, { recursive: true, force: true }); }
}

// ---------- live checks ----------
async function check(base = MIRROR) {
  const fails = []; const ok = (cond, msg) => { if (!cond) fails.push(msg); };
  const get = async (path, init) => { try { return await fetch(base + path, { redirect: 'manual', ...init }); } catch (e) { return { ok: false, status: e.message, headers: new Headers(), text: async () => '' }; } };
  const hunt = await (await get(`/hunt.html?t=${Date.now()}`)).text();
  ok(hunt.includes(`window.HAUNT_API=${JSON.stringify(API)}`), `${base}/hunt.html does not point at ${API}`);
  ok(hunt.includes(`Base44 mirror ${SHA}`), `${base}/hunt.html is not build ${SHA} yet`);
  ok(hunt.includes(`/hunt.js?v=${SHA}`), `${base}/hunt.html does not load /hunt.js?v=${SHA}`);
  ok((await (await get('/register')).text()).includes("location.replace(p+'.html'"), `${base}/register does not serve the router (index.html)`);
  const js = await get(`/common.js?v=${SHA}`); ok(js.ok && /javascript/.test(js.headers.get('content-type') || ''), `${base}/common.js?v=${SHA} -> ${js.status} ${js.headers.get('content-type')}`);
  const w = await get('/vendor/facex/edgeface_xs_fp32.bin', { method: 'HEAD' }); ok(w.ok && Number(w.headers.get('content-length')) > 1e6, `${base}: FaceX weights missing (${w.status})`);
  const pre = await fetch(`${API}/api/attendee`, { method: 'OPTIONS', headers: { origin: base, 'access-control-request-method': 'POST', 'access-control-request-headers': 'content-type,x-haunt-session' } }).catch((e) => ({ status: e.message, headers: new Headers() }));
  ok(pre.status === 204 && pre.headers.get('access-control-allow-origin') === base, `${API} refuses ${base} (preflight ${pre.status}): add it to FRONTEND_ORIGINS in fly.toml and deploy Fly`);
  if (fails.length) die('live check failed:\n  - ' + fails.join('\n  - '));
  console.log(`base44: live ${base} serves ${SHA}, API ${API} lets it in`);
}

async function deploy() {
  await build();
  const res = await upload();
  const url = (res.app_url || MIRROR).replace(/\/+$/, '');
  console.log(`base44: uploaded at ${res.deployed_at}Z -> ${url}`);
  for (let i = 0; i < 30; i++) { // the upload is live at once; give the edge a moment
    if ((await fetch(`${url}/hunt.html?t=${Date.now()}`).then((r) => r.text()).catch(() => '')).includes(`Base44 mirror ${SHA}`)) break;
    await sleep(2000);
  }
  await check(url);
}

const cmd = process.argv[2];
if (cmd === 'build') await build();
else if (cmd === 'deploy') await deploy();
else if (cmd === 'check') await check();
else die('usage: node scripts/base44.mjs build | deploy | check');
