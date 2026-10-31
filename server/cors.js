// Cross-origin access for the frontend mirrors (the Base44 copy of web/, scripts/base44.mjs): the same pages served
// from another HTTPS origin call this API and the /ws socket on Fly, so both URLs share one database and one room.
// Allowed origins come from FRONTEND_ORIGINS (comma or space separated, set in fly.toml). Credentials never cross
// origins: the sign-in session rides in the x-haunt-session header instead of a cookie (server/auth.js), so this
// never sends Access-Control-Allow-Credentials and a third-party cookie is never needed (Safari blocks them).

/** Exact origins (scheme://host[:port], no trailing slash) allowed to call the API and to receive sign-in handoffs. */
export const frontendOrigins = () => (process.env.FRONTEND_ORIGINS || '').split(/[\s,]+/).map((o) => o.replace(/\/+$/, '')).filter(Boolean);
export const isFrontendOrigin = (origin) => !!origin && frontendOrigins().includes(origin);

/** Express middleware for /api: echo an allowed Origin, answer preflights. Unknown origins get no CORS headers. */
export function cors(req, res, next) {
  res.vary('Origin');
  const origin = req.headers.origin;
  if (!isFrontendOrigin(origin)) return next();
  res.setHeader('Access-Control-Allow-Origin', origin);
  if (req.method !== 'OPTIONS') return next();
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PATCH, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'content-type, x-haunt-session, x-admin-token');
  res.setHeader('Access-Control-Max-Age', '600');
  res.status(204).end();
}
