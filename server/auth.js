// OAuth sign-in (GitHub, LinkedIn OpenID Connect). Pure Node, no deps. Enabled per provider when its env vars exist.
// Flow: GET /auth/:provider -> provider -> GET /auth/:provider/callback -> profile cached server-side -> cookie -> /register
import { randomBytes, createHmac } from 'node:crypto';

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
};

const SECRET = process.env.SESSION_SECRET || randomBytes(32).toString('hex');
const sign = (v) => createHmac('sha256', SECRET).update(v).digest('base64url');
const sessions = new Map(); // sid -> profile (in memory; lost on restart, which is fine: it only pre-fills /register)
const cookies = (req) => Object.fromEntries((req.headers.cookie || '').split(';').map((c) => c.trim().split('=')).filter((p) => p[0]).map(([k, ...v]) => [k, decodeURIComponent(v.join('='))]));
const setCookie = (res, name, value, maxAge) => res.append('Set-Cookie', `${name}=${encodeURIComponent(value)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAge}${process.env.PUBLIC_BASE_URL?.startsWith('https') ? '; Secure' : ''}`);
const baseUrl = (req) => (process.env.PUBLIC_BASE_URL || `${req.headers['x-forwarded-proto'] || req.protocol}://${req.headers['x-forwarded-host'] || req.headers.host}`).replace(/\/$/, '');

/** Profile for this request's session cookie, or null. */
export function sessionProfile(req) {
  const c = cookies(req); const sid = c.haunt_sid;
  if (!sid || c.haunt_sig !== sign(sid)) return null;
  return sessions.get(sid) || null;
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
  app.get('/api/session', (req, res) => { const p = sessionProfile(req); res.json(p ? { provider: p.provider, name: p.name, handle: p.handle, avatar: p.avatar, linkedin: p.linkedin } : null); });
  app.post('/api/session/logout', (req, res) => { const c = cookies(req); if (c.haunt_sid) sessions.delete(c.haunt_sid); setCookie(res, 'haunt_sid', '', 0); setCookie(res, 'haunt_sig', '', 0); res.json({ ok: true }); });

  app.get('/auth/:provider', (req, res) => {
    const p = PROVIDERS[req.params.provider];
    if (!p || !p.enabled()) return res.status(404).send('provider not configured');
    const state = randomBytes(16).toString('hex');
    setCookie(res, 'oauth_state', `${req.params.provider}:${state}:${sign(state)}`, 600);
    res.redirect(p.authorize(`${baseUrl(req)}/auth/${req.params.provider}/callback`, state));
  });

  app.get('/auth/:provider/callback', async (req, res) => {
    const p = PROVIDERS[req.params.provider];
    const [prov, state, sig] = (cookies(req).oauth_state || '').split(':');
    try {
      if (!p || !p.enabled()) throw new Error('provider not configured');
      if (prov !== req.params.provider || !state || sig !== sign(state) || req.query.state !== state) throw new Error('bad state');
      if (!req.query.code) throw new Error(String(req.query.error_description || req.query.error || 'no code'));
      const profile = await p.profile(String(req.query.code), `${baseUrl(req)}/auth/${req.params.provider}/callback`);
      profile.avatar = await fetchAvatar(profile.avatarUrl); delete profile.avatarUrl; // LinkedIn picture URLs expire: keep bytes, not the URL
      const sid = randomBytes(16).toString('hex'); sessions.set(sid, profile);
      setCookie(res, 'haunt_sid', sid, 86400); setCookie(res, 'haunt_sig', sign(sid), 86400); setCookie(res, 'oauth_state', '', 0);
      res.redirect('/register');
    } catch (e) { res.status(400).send(`<p>Sign-in failed: ${String(e.message).replace(/[<>&]/g, '')}</p><p><a href="/register">Back</a></p>`); }
  });
}
