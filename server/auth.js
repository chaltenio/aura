// OAuth sign-in (GitHub, LinkedIn OIDC, Google OIDC, Sign in with Apple). Pure Node, no deps. Enabled per provider when its env vars exist.
// Flow: GET /auth/:provider -> provider -> GET|POST /auth/:provider/callback -> profile cached server-side -> cookie -> /register
// Signing in with a second provider while a session exists links it to the same profile (see `linked`).
// Mirror flow (the Base44 copy of web/, another origin): GET /auth/:provider?return=<page on an allowed origin> -> ... ->
// callback redirects to that page with #haunt_session=<sid>.<sig>; the page keeps it and sends it as the x-haunt-session
// header, because a cookie on this domain would be a third-party cookie there (Safari drops those).
import { randomBytes, createHmac, createPrivateKey, sign as signRaw } from 'node:crypto';
import { isFrontendOrigin } from './cors.js';

const b64u = (v) => Buffer.from(typeof v === 'string' ? v : JSON.stringify(v)).toString('base64url');
// Apple wants a client secret that is a short-lived ES256 JWT signed with the team's .p8 key (env holds it with literal \n).
function appleClientSecret() {
  const now = Math.floor(Date.now() / 1000);
  const head = b64u({ alg: 'ES256', kid: process.env.APPLE_KEY_ID });
  const body = b64u({ iss: process.env.APPLE_TEAM_ID, iat: now, exp: now + 300, aud: 'https://appleid.apple.com', sub: process.env.APPLE_CLIENT_ID });
  const key = createPrivateKey(process.env.APPLE_PRIVATE_KEY.replace(/\\n/g, '\n'));
  return `${head}.${body}.${signRaw('sha256', Buffer.from(`${head}.${body}`), { key, dsaEncoding: 'ieee-p1363' }).toString('base64url')}`;
}

const PROVIDERS = {
  github: {
    enabled: () => !!(process.env.GITHUB_CLIENT_ID && process.env.GITHUB_CLIENT_SECRET),
    authorize: (redirect, state) => `https://github.com/login/oauth/authorize?${new URLSearchParams({ client_id: process.env.GITHUB_CLIENT_ID, redirect_uri: redirect, state, scope: 'read:user' })}`,
    async profile(code, redirect) {
      const tok = await (await fetch('https://github.com/login/oauth/access_token', { method: 'POST', headers: { accept: 'application/json', 'content-type': 'application/json' }, body: JSON.stringify({ client_id: process.env.GITHUB_CLIENT_ID, client_secret: process.env.GITHUB_CLIENT_SECRET, code, redirect_uri: redirect }) })).json();
      if (!tok.access_token) throw new Error('github token: ' + JSON.stringify(tok));
      const u = await (await fetch('https://api.github.com/user', { headers: { authorization: `Bearer ${tok.access_token}`, 'user-agent': 'haunt', accept: 'application/vnd.github+json' } })).json();
      return { provider: 'github', providerId: String(u.id), name: u.name || u.login, handle: u.login, avatarUrl: u.avatar_url ? `${u.avatar_url}&s=256` : null, linkedin: '' };
    },
  },
  linkedin: {
    enabled: () => !!(process.env.LINKEDIN_CLIENT_ID && process.env.LINKEDIN_CLIENT_SECRET),
    authorize: (redirect, state) => `https://www.linkedin.com/oauth/v2/authorization?${new URLSearchParams({ response_type: 'code', client_id: process.env.LINKEDIN_CLIENT_ID, redirect_uri: redirect, state, scope: 'openid profile email' })}`,
    async profile(code, redirect) {
      const tok = await (await fetch('https://www.linkedin.com/oauth/v2/accessToken', { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ grant_type: 'authorization_code', code, redirect_uri: redirect, client_id: process.env.LINKEDIN_CLIENT_ID, client_secret: process.env.LINKEDIN_CLIENT_SECRET }) })).json();
      if (!tok.access_token) throw new Error('linkedin token: ' + JSON.stringify(tok));
      const u = await (await fetch('https://api.linkedin.com/v2/userinfo', { headers: { authorization: `Bearer ${tok.access_token}` } })).json();
      return { provider: 'linkedin', providerId: String(u.sub), name: u.name || `${u.given_name || ''} ${u.family_name || ''}`.trim(), handle: '', avatarUrl: u.picture || null, linkedin: '' };
    },
  },
  google: {
    enabled: () => !!(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET),
    authorize: (redirect, state) => `https://accounts.google.com/o/oauth2/v2/auth?${new URLSearchParams({ response_type: 'code', client_id: process.env.GOOGLE_CLIENT_ID, redirect_uri: redirect, state, scope: 'openid profile email' })}`,
    async profile(code, redirect) {
      const tok = await (await fetch('https://oauth2.googleapis.com/token', { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ grant_type: 'authorization_code', code, redirect_uri: redirect, client_id: process.env.GOOGLE_CLIENT_ID, client_secret: process.env.GOOGLE_CLIENT_SECRET }) })).json();
      if (!tok.access_token) throw new Error('google token: ' + JSON.stringify(tok));
      const u = await (await fetch('https://openidconnect.googleapis.com/v1/userinfo', { headers: { authorization: `Bearer ${tok.access_token}` } })).json();
      return { provider: 'google', providerId: String(u.sub), name: u.name || `${u.given_name || ''} ${u.family_name || ''}`.trim(), handle: '', avatarUrl: u.picture ? u.picture.replace(/=s\d+(-c)?$/, '=s256-c') : null, linkedin: '' };
    },
  },
  apple: {
    enabled: () => !!(process.env.APPLE_CLIENT_ID && process.env.APPLE_TEAM_ID && process.env.APPLE_KEY_ID && process.env.APPLE_PRIVATE_KEY),
    // Apple POSTs the callback (form_post) and sends the user's name only on the very first authorization; no avatar at all.
    authorize: (redirect, state) => `https://appleid.apple.com/auth/authorize?${new URLSearchParams({ response_type: 'code', response_mode: 'form_post', client_id: process.env.APPLE_CLIENT_ID, redirect_uri: redirect, state, scope: 'name' })}`,
    async profile(code, redirect, extra = {}) {
      const tok = await (await fetch('https://appleid.apple.com/auth/token', { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ grant_type: 'authorization_code', code, redirect_uri: redirect, client_id: process.env.APPLE_CLIENT_ID, client_secret: appleClientSecret() }) })).json();
      if (!tok.id_token) throw new Error('apple token: ' + JSON.stringify(tok));
      const claims = JSON.parse(Buffer.from(tok.id_token.split('.')[1], 'base64url').toString()); // straight from Apple over TLS, so no signature check needed (OIDC core 3.1.3.7)
      let n = {}; try { n = JSON.parse(extra.user || '{}').name || {}; } catch {}
      return { provider: 'apple', providerId: String(claims.sub), name: `${n.firstName || ''} ${n.lastName || ''}`.trim(), handle: '', avatarUrl: null, linkedin: '' };
    },
  },
  // Test only (npm test sets OAUTH_FAKE=1, Fly never does): signs in as a fixed person without leaving this server,
  // so the smoke test walks the real redirect, cookie and #haunt_session handoff path.
  fake: {
    enabled: () => process.env.OAUTH_FAKE === '1',
    authorize: (redirect, state) => `${redirect}?${new URLSearchParams({ code: 'fake', state })}`,
    profile: async () => ({ provider: 'fake', providerId: '1', name: 'Fake Person', handle: 'fake', avatarUrl: null, linkedin: '' }),
  },
};

const SECRET = process.env.SESSION_SECRET || randomBytes(32).toString('hex');
const sign = (v) => createHmac('sha256', SECRET).update(v).digest('base64url');
const sessions = new Map(); // sid -> profile (in memory; lost on restart, which is fine: it only pre-fills /register)
const cookies = (req) => Object.fromEntries((req.headers.cookie || '').split(';').map((c) => c.trim().split('=')).filter((p) => p[0]).map(([k, ...v]) => [k, decodeURIComponent(v.join('='))]));
const isHttps = () => !!process.env.PUBLIC_BASE_URL?.startsWith('https');
// SameSite=None (needs Secure) only for the state cookie: Apple's form_post callback is a cross-site POST, which Lax cookies never ride on.
const setCookie = (res, name, value, maxAge, sameSite = 'Lax') => res.append('Set-Cookie', `${name}=${encodeURIComponent(value)}; Path=/; HttpOnly; SameSite=${sameSite === 'None' && !isHttps() ? 'Lax' : sameSite}; Max-Age=${maxAge}${isHttps() ? '; Secure' : ''}`);
const readForm = (req) => new Promise((resolve) => { let b = ''; req.on('data', (c) => { b += c; if (b.length > 20_000) req.destroy(); }); req.on('end', () => resolve(Object.fromEntries(new URLSearchParams(b)))); req.on('error', () => resolve({})); });
const baseUrl = (req) => (process.env.PUBLIC_BASE_URL || `${req.headers['x-forwarded-proto'] || req.protocol}://${req.headers['x-forwarded-host'] || req.headers.host}`).replace(/\/$/, '');

/** Profile for this request's session cookie, or null. */
export function sessionProfile(req) {
  const sid = sessionId(req);
  return (sid && sessions.get(sid)) || null;
}
/** Signed session id from the x-haunt-session header (`<sid>.<sig>`, cross-origin pages) or the cookies (same origin). */
function sessionId(req) {
  const [hsid, hsig] = String(req.headers['x-haunt-session'] || '').split('.');
  if (hsid && hsig === sign(hsid)) return hsid;
  const c = cookies(req);
  return c.haunt_sid && c.haunt_sig === sign(c.haunt_sid) ? c.haunt_sid : null;
}
/** `return` URL for the sign-in handoff if its origin is an allowed frontend (server/cors.js), else null. Never an open redirect. */
function handoffUrl(ret) {
  try { const u = new URL(String(ret || '')); if (!isFrontendOrigin(u.origin)) return null; u.hash = ''; return u.href; } catch { return null; }
}

async function fetchAvatar(url) {
  if (!url) return null;
  try {
    const r = await fetch(url, { redirect: 'follow' }); if (!r.ok) return null;
    const type = r.headers.get('content-type') || 'image/jpeg'; const buf = Buffer.from(await r.arrayBuffer());
    if (!type.startsWith('image/') || buf.length > 400_000) return null;
    return `data:${type};base64,${buf.toString('base64')}`;
  } catch { return null; }
}

export function mountAuth(app) {
  app.get('/api/auth/providers', (_req, res) => res.json(Object.entries(PROVIDERS).filter(([, p]) => p.enabled()).map(([k]) => k)));
  app.get('/api/session', (req, res) => { const p = sessionProfile(req); res.json(p ? { provider: p.provider, linked: Object.keys(p.linked || {}), name: p.name, handle: p.handle, avatar: p.avatar, linkedin: p.linkedin } : null); });
  app.post('/api/session/logout', (req, res) => { const sid = sessionId(req); if (sid) sessions.delete(sid); setCookie(res, 'haunt_sid', '', 0); setCookie(res, 'haunt_sig', '', 0); res.json({ ok: true }); });

  app.get('/auth/:provider', (req, res) => {
    const p = PROVIDERS[req.params.provider];
    if (!p || !p.enabled()) return res.status(404).send('provider not configured');
    const ret = req.query.return ? handoffUrl(req.query.return) : null;
    if (req.query.return && !ret) return res.status(400).send('return must be a page on an allowed frontend origin (FRONTEND_ORIGINS)');
    const state = randomBytes(16).toString('hex');
    setCookie(res, 'oauth_state', `${req.params.provider}:${state}:${sign(state)}`, 600, 'None');
    setCookie(res, 'oauth_return', ret || '', ret ? 600 : 0, 'None'); // None like oauth_state: Apple's form_post callback is a cross-site POST
    res.redirect(p.authorize(`${baseUrl(req)}/auth/${req.params.provider}/callback`, state));
  });

  const callback = async (req, res) => {
    const p = PROVIDERS[req.params.provider];
    const q = req.method === 'POST' ? await readForm(req) : req.query;
    const [prov, state, sig] = (cookies(req).oauth_state || '').split(':');
    try {
      if (!p || !p.enabled()) throw new Error('provider not configured');
      if (prov !== req.params.provider || !state || sig !== sign(state) || q.state !== state) throw new Error('bad state');
      if (!q.code) throw new Error(String(q.error_description || q.error || 'no code'));
      const profile = await p.profile(String(q.code), `${baseUrl(req)}/auth/${req.params.provider}/callback`, q);
      profile.avatar = await fetchAvatar(profile.avatarUrl); delete profile.avatarUrl; // LinkedIn picture URLs expire: keep bytes, not the URL
      const c = cookies(req); const existing = sessionProfile(req);
      let sid = c.haunt_sid;
      if (existing) { // second provider: keep the first as primary, fill whatever it lacked
        for (const k of ['name', 'handle', 'avatar', 'linkedin']) existing[k] = existing[k] || profile[k];
        existing.linked[profile.provider] = profile.providerId;
      } else {
        sid = randomBytes(16).toString('hex'); profile.linked = { [profile.provider]: profile.providerId }; sessions.set(sid, profile);
      }
      setCookie(res, 'haunt_sid', sid, 86400); setCookie(res, 'haunt_sig', sign(sid), 86400); setCookie(res, 'oauth_state', '', 0, 'None');
      const ret = handoffUrl(cookies(req).oauth_return); setCookie(res, 'oauth_return', '', 0, 'None');
      res.redirect(303, ret ? `${ret}#haunt_session=${sid}.${sign(sid)}` : '/register');
    } catch (e) {
      const back = handoffUrl(cookies(req).oauth_return) || '/register';
      res.status(400).send(`<p>Sign-in failed: ${String(e.message).replace(/[<>&]/g, '')}</p><p><a href="${back.replace(/[<>&"]/g, '')}">Back</a></p>`);
    }
  };
  app.get('/auth/:provider/callback', callback);
  app.post('/auth/:provider/callback', callback);
}
