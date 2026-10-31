// Public profile enrichment from GitHub (by handle). Cached on the attendee record, refreshed hourly.
// Uses GITHUB_TOKEN when present (5000 req/h instead of 60). Never blocks registration; the card route awaits it briefly.
const TTL_MS = 60 * 60 * 1000;
const inflight = new Map();

const gh = async (path) => {
  const headers = { accept: 'application/vnd.github+json', 'user-agent': 'haunt' };
  if (process.env.GITHUB_TOKEN) headers.authorization = `Bearer ${process.env.GITHUB_TOKEN}`;
  const r = await fetch(`https://api.github.com${path}`, { headers });
  if (!r.ok) throw new Error(`github ${path} -> ${r.status}`);
  return r.json();
};

export async function fetchGithubProfile(handle) {
  const login = String(handle || '').trim().replace(/^@/, '');
  if (!/^[a-z\d](?:[a-z\d]|-(?=[a-z\d])){0,38}$/i.test(login)) return null;
  const [user, repos, events] = await Promise.all([
    gh(`/users/${login}`),
    gh(`/users/${login}/repos?sort=pushed&per_page=5&type=owner`).catch(() => []),
    gh(`/users/${login}/events/public?per_page=100`).catch(() => []),
  ]);
  const weekAgo = Date.now() - 7 * 86400 * 1000;
  const pushes = events.filter((e) => e.type === 'PushEvent' && new Date(e.created_at).getTime() > weekAgo);
  const activeRepos = [...new Set(pushes.map((e) => e.repo?.name).filter(Boolean))].slice(0, 3);
  return {
    source: 'github', url: user.html_url, name: user.name || null, bio: user.bio || null, company: user.company || null, location: user.location || null,
    blog: user.blog || null, followers: user.followers ?? null, publicRepos: user.public_repos ?? null, avatar: user.avatar_url ? `${user.avatar_url}&s=256` : null,
    pushesThisWeek: pushes.length, activeRepos,
    lastPush: pushes[0]?.created_at || null,
    recentRepos: repos.map((r) => ({ name: r.name, url: r.html_url, description: r.description || null, language: r.language || null, stars: r.stargazers_count, pushedAt: r.pushed_at })),
    fetchedAt: Date.now(),
  };
}

/** Ensure a.profile is fresh. Resolves quickly if cached; otherwise fetches (deduplicated) within `waitMs`. */
export async function ensureProfile(a, save, waitMs = 4000) {
  if (!a?.handle || process.env.NO_PROFILE) return a?.profile || null;
  if (a.profile && Date.now() - (a.profile.fetchedAt || 0) < TTL_MS) return a.profile;
  if (!inflight.has(a.id)) {
    inflight.set(a.id, fetchGithubProfile(a.handle).then((p) => { if (p) { a.profile = p; save(); } return p; }).catch((e) => { a.profile = a.profile || { source: 'github', error: e.message, fetchedAt: Date.now() }; save(); return a.profile; }).finally(() => inflight.delete(a.id)));
  }
  return Promise.race([inflight.get(a.id), new Promise((r) => setTimeout(() => r(a.profile || null), waitMs))]);
}
