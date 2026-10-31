// Public profile enrichment from GitHub (by handle). Cached on the attendee record, refreshed hourly.
// Uses GITHUB_TOKEN when present (5000 req/h instead of 60). Never blocks registration; the card route awaits it briefly.
const TTL_MS = 60 * 60 * 1000;
const inflight = new Map(); // attendeeId -> { handle, done }

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

/** Ensure a.profile is fresh. A cached profile, even a stale one, comes back at once (a stale one is refreshed in the
 *  background); with nothing cached it waits up to `waitMs` for the lookup. One lookup per person at a time, for their
 *  current handle: a lookup for a handle they have since changed never lands on the card. `onUpdate(a)` runs when a
 *  lookup changes the card (or ends one that was loading), so the caller can save and push it. */
export async function ensureProfile(a, onUpdate, waitMs = 4000) {
  if (!a?.handle || process.env.NO_PROFILE) return a?.profile || null;
  if (a.profile && Date.now() - (a.profile.fetchedAt || 0) < TTL_MS) return a.profile;
  let job = inflight.get(a.id);
  if (!job || job.handle !== a.handle) {
    const handle = a.handle, before = a.profile;
    job = { handle };
    job.done = fetchGithubProfile(handle)
      .catch((e) => ({ source: 'github', error: e.message, fetchedAt: Date.now() }))
      .then((p) => { if (p && a.handle === handle && !(p.error && a.profile && !a.profile.error)) a.profile = p; return a.profile; }) // an error never replaces a good profile
      .finally(() => {
        if (inflight.get(a.id) === job) inflight.delete(a.id);
        if (a.profile !== before || !before) { try { onUpdate?.(a); } catch (e) { console.warn('profile update:', e.message); } } // nobody may await this: never reject
      });
    inflight.set(a.id, job);
  }
  if (a.profile) return a.profile;
  return Promise.race([job.done, new Promise((r) => setTimeout(() => r(a.profile || null), waitMs))]);
}

/** True while a GitHub lookup runs for this person's current handle and no profile is cached yet. */
export const profileLoading = (a) => !!a?.handle && !a.profile && inflight.get(a.id)?.handle === a.handle;
