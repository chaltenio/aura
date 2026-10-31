// The Scout (Fetch.ai track): pairs people who could build together and would otherwise never meet, sends each a clue
// (never a name, handle or photo), the camera finds them, the haunt confirms it, and one tap afterwards scores the Scout.
// Plan and reasoning: docs/scout/README.md and the three docs beside it.
//
// Reads only what the public API exposes (publicCard + db.events). Faces, descriptors and avatars never enter this file.
// Adds one route (POST /api/rating), one event type (match), one phone payload (state { scout }) and one screen message (scout).
// Scoring is a named weight table so a change from feedback can be printed before and after (rule 1, below).
import { appendFileSync } from 'node:fs';
import { join } from 'node:path';

// ---------- knobs (env) ----------
const SWEEP_MS = Number(process.env.SCOUT_SWEEP_MS || 60_000);       // how often pairs are scored and clues fired
const FIT_MIN = Number(process.env.SCOUT_FIT_MIN || 0.5);           // mutual gate: both directions at least this
const MIN_N = Number(process.env.SCOUT_MIN_N || 8);                 // rated Scout pairs before a weight may change (demo: 4)
const CLUE_MINUTES = Number(process.env.SCOUT_CLUE_MINUTES || 25);  // a clue expires after this (or at the event end)
function eventEnd() { // SCOUT_END_AT = ISO time, or "18:00" today local; default 18:00 today
  const v = process.env.SCOUT_END_AT || '18:00';
  if (/^\d{1,2}:\d{2}$/.test(v)) { const [h, m] = v.split(':').map(Number); const d = new Date(); d.setHours(h, m, 0, 0); return d.getTime(); }
  const t = Date.parse(v); return Number.isFinite(t) ? t : Date.now() + 2 * 3600_000;
}

// ---------- features (collaboration.md section 2) ----------
const LANG_BUCKET = { TypeScript: 'front', JavaScript: 'front', CSS: 'front', Svelte: 'front', Vue: 'front', Go: 'back', Rust: 'back', Java: 'back', Ruby: 'back', PHP: 'back', Elixir: 'back', Kotlin: 'back', 'C#': 'back', Scala: 'back', 'Jupyter Notebook': 'ml', C: 'systems', 'C++': 'systems', Zig: 'systems', Swift: 'systems', 'Objective-C': 'systems', Assembly: 'systems' };
const WORDS = {
  front: /\b(react|frontend|front-end|next\.?js|svelte|vue|dashboards?|css|tailwind)\b/i,
  back: /\b(backend|back-end|api|server|rust|golang|infra|devops|terraform|kubernetes|k8s|database|postgres|cli)\b/i,
  ml: /\b(ml|llm|llms|model|models|agent|agents|eval|evals|fine-?tun\w*|rag|embedding|embeddings|ai|dataset)\b/i,
  systems: /\b(embedded|kernel|firmware|ios|swift|metal|gpu|wasm|compiler)\b/i,
};
const INTENT_WORDS = [['cofounder', /\bco-?founder\b/i], ['hiring', /\b(hiring|we're hiring|recruit\w*)\b/i], ['job', /\b(open to work|looking for (a )?(job|role|work)|job hunting)\b/i], ['mentor', /\b(mentor\w*|happy to (teach|pair|help))\b/i], ['learn', /\b(learning|new to|beginner|want to learn|teach me)\b/i], ['collaborator', /\b(collaborat\w*|team up|build with)\b/i]];
const ADJ = { 'front:back': 1.0, 'back:ml': 0.8, 'systems:back': 0.7, 'front:ml': 0.6, 'systems:ml': 0.6, 'front:systems': 0.5 };
const INTENT = { 'cofounder:cofounder': 1.0, 'collaborator:collaborator': 0.9, 'hiring:job': 1.0, 'learn:mentor': 1.0, 'collaborator:cofounder': 0.7, 'learn:learn': 0.4, 'hiring:hiring': 0.1, 'job:job': 0.1, 'mentor:mentor': 0.2 };
const BUCKET_WORD = { front: 'frontend', back: 'backend', ml: 'ML', systems: 'systems' };
const pairKey = (x, y) => [x, y].sort().join(':');

export function features(card) { // everything the Scout knows about one person; from the public card only
  const p = card.profile || {}; const langs = (p.recentRepos || []).map((r) => r.language).filter(Boolean);
  const langBuckets = new Set(langs.map((l) => LANG_BUCKET[l]).filter(Boolean));
  const buckets = new Set(langBuckets);
  const text = `${card.blurb || ''} ${p.bio || ''}`;
  for (const [b, re] of Object.entries(WORDS)) if (re.test(text)) buckets.add(b);
  if (langs.includes('Python') && !buckets.has('ml')) buckets.add(WORDS.ml.test(text) ? 'ml' : 'back');
  const intent = (INTENT_WORDS.find(([, re]) => re.test(text)) || ['curious'])[0];
  const maxStars = Math.max(0, ...(p.recentRepos || []).map((r) => r.stars || 0));
  const level = Math.min(4, Math.log10((p.followers || 0) + 1) + Math.log10(maxStars + 1) / 2 + Math.min(p.pushesThisWeek || 0, 10) / 10);
  const primary = langs.sort((a, b) => langs.filter((x) => x === b).length - langs.filter((x) => x === a).length)[0] || null;
  return { buckets, langBuckets, langs: new Set(langs), intent, level, pushes: p.pushesThisWeek || 0, primary };
}

/** Directional score: how much b is worth to a, in [0, 1]. Returns the number and which named features fired. */
export function score(fa, fb, W) {
  let stack = fa.buckets.size && fb.buckets.size ? 0.35 : 0.5; // same bucket 0.35, nothing known 0.5
  for (const x of fa.buckets) for (const y of fb.buckets) stack = Math.max(stack, x === y ? 0.35 : ADJ[`${x}:${y}`] ?? ADJ[`${y}:${x}`] ?? 0.4);
  const brings = [...fb.buckets].some((b) => !fa.buckets.has(b)) ? 1 : 0.3;
  const common = [...fa.langs].some((l) => fb.langs.has(l)) ? 1 : 0;
  const fit = fa.intent === 'curious' || fb.intent === 'curious' ? 0.5 : INTENT[`${fa.intent}:${fb.intent}`] ?? INTENT[`${fb.intent}:${fa.intent}`] ?? 0.3;
  const fresh = Math.min(1, (fa.pushes + fb.pushes) / 10);
  const gap = Math.abs(fa.level - fb.level);
  const teaching = ['learn', 'mentor'].includes(fa.intent) || ['learn', 'mentor'].includes(fb.intent);
  const gapTerm = gap <= 2 ? 1 : teaching ? 1.1 : 0.7;
  const s = Math.min(1, (W.stack * stack * brings + W.common * common + W.intent * fit + W.fresh * fresh) * gapTerm);
  const fired = [];
  if (brings === 1 && stack >= 0.6) fired.push('complement');
  if (stack === 0.35) fired.push('same_bucket');
  if (common) fired.push('shared_language');
  if (fit >= 0.9) fired.push('intent_match');
  if (fresh >= 0.5) fired.push('active_this_week');
  if (gap > 2 && teaching) fired.push('teach_learn');
  return { s, fired };
}

// ---------- clue: describes the OTHER person without identifying them (missed-connections.md section 4) ----------
const idTokens = (card) => [card.name, card.handle].join(' ').toLowerCase().split(/[^a-z0-9]+/).filter((t) => t.length >= 3);
const leaks = (text, card) => { const t = String(text || '').toLowerCase(); return idTokens(card).some((k) => t.includes(k)); };
export function clueFor(me, other, fo, fm, deadline) {
  const bits = [];
  if (fo.primary) bits.push(`writes ${fo.primary}`); else if (fo.buckets.size) bits.push(`does ${[...fo.buckets].map((b) => BUCKET_WORD[b]).join(' and ')} work`);
  if (fo.pushes > 0) bits.push(`pushed ${fo.pushes} time${fo.pushes === 1 ? '' : 's'} this week`);
  const repo = [...(other.profile?.activeRepos || []).map((r) => r.split('/').pop()), ...(other.profile?.recentRepos || []).map((r) => r.name)].find((n) => n && !leaks(n, other));
  if (repo) bits.push(`is working on something called "${repo}"`);
  const blurb = other.blurb && !leaks(other.blurb, other) ? other.blurb.trim().replace(/\s+/g, ' ').slice(0, 80) : '';
  if (blurb) bits.push(`says: "${blurb}${other.blurb.length > 80 ? '…' : ''}"`);
  const missing = [...fo.langBuckets, ...fo.buckets].find((b) => !fm.buckets.has(b)); // a language they ship in beats a word in their blurb
  const why = missing ? `They have the ${BUCKET_WORD[missing]} you are missing.`
    : fo.intent === 'mentor' && fm.intent === 'learn' ? 'They offered to teach tonight.'
    : fo.intent === 'learn' && fm.intent === 'mentor' ? 'They asked to learn what you know.'
    : fo.intent === fm.intent && fo.intent !== 'curious' ? `They want a ${fo.intent} too.` : 'The Scout thinks you two should talk.';
  const when = new Date(deadline).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  return `A ghost in this room ${bits.length ? bits.join(', ') : 'is hiding'}. ${why} Find them with your camera before ${when}.`;
}

// ---------- mount ----------
export function mountScout(app, { db, byId, save, sendTo, broadcastScreen, publicCard, dataDir, isOnline }) {
  const LOG = dataDir ? join(dataDir, 'scout-log.jsonl') : null;
  db.scout ||= { version: 1, changedAt: null, weights: { stack: 0.40, common: 0.10, intent: 0.35, fresh: 0.15 }, changelog: [], round: 0 };
  const S = db.scout;
  const log = (o) => { try { if (LOG) appendFileSync(LOG, JSON.stringify({ at: Date.now(), ...o }) + '\n'); } catch {} };
  const matches = () => db.events.filter((e) => e.type === 'match');
  const haunts = () => db.events.filter((e) => e.type === 'haunt');
  const findable = () => db.attendees.filter((a) => a.consent && !a.blocked);
  const inPair = (e, x, y) => (e.actorId === x && e.targetId === y) || (e.actorId === y && e.targetId === x);

  // pOrganic: how likely these two meet without us (missed-connections.md section 3)
  function organic(x, y, hs, now) {
    const nb = (id) => new Set(hs.flatMap((e) => (e.actorId === id ? [e.targetId] : e.targetId === id ? [e.actorId] : [])));
    const nx = nb(x), ny = nb(y);
    const shared = [...nx].some((n) => ny.has(n)) ? 1 : 0;
    const active = Math.min(1, (nx.size + ny.size) / 6);
    // co-haunt: both touched the same third person in the last 10 minutes, so they are probably in the same corner
    const recent = hs.filter((e) => now - e.createdAt < 10 * 60_000);
    const partners = (id) => new Set(recent.flatMap((e) => (e.actorId === id ? [e.targetId] : e.targetId === id ? [e.actorId] : [])));
    const px = partners(x), py = partners(y);
    const near = [...px].some((n) => n !== y && n !== x && py.has(n)) ? 1 : 0;
    return Math.min(0.95, 0.10 + 0.40 * shared + 0.30 * active + 0.20 * near);
  }

  /** One round: score every unmet, unclaimed pair; fire clues within budget; write match events. Returns fired matches. */
  function sweep(now = Date.now()) {
    const end = eventEnd(); const minsLeft = (end - now) / 60_000;
    if (minsLeft <= 0) return [];
    const open = new Set(matches().filter((m) => m.meta.status === 'open').flatMap((m) => [m.actorId, m.targetId]));
    const firedPairs = new Set(matches().map((m) => pairKey(m.actorId, m.targetId)));
    const hs = haunts(); const met = new Set(hs.map((e) => pairKey(e.actorId, e.targetId)));
    const people = findable().filter((a) => !open.has(a.id)).map((a) => { const c = publicCard(a); return { a, c, f: features(c) }; });
    const dir = new Map(); // "x>y" -> score
    for (const p of people) for (const q of people) if (p !== q) dir.set(`${p.a.id}>${q.a.id}`, score(p.f, q.f, S.weights));
    const top3 = (id) => people.filter((q) => q.a.id !== id).map((q) => [q.a.id, dir.get(`${id}>${q.a.id}`).s]).sort((u, v) => v[1] - u[1]).slice(0, 3).map((u) => u[0]);
    const cands = [];
    for (let i = 0; i < people.length; i++) for (let j = i + 1; j < people.length; j++) {
      const p = people[i], q = people[j], k = pairKey(p.a.id, q.a.id);
      if (met.has(k) || firedPairs.has(k)) continue;
      const ab = dir.get(`${p.a.id}>${q.a.id}`), ba = dir.get(`${q.a.id}>${p.a.id}`);
      const fit = Math.min(ab.s, ba.s);
      if (fit < FIT_MIN || !top3(p.a.id).includes(q.a.id) || !top3(q.a.id).includes(p.a.id)) continue;
      const pOrganic = organic(p.a.id, q.a.id, hs, now);
      const urgency = 1 + (minsLeft < 30 ? 1 : 0);
      const reach = isOnline && !(isOnline(p.a.id) || isOnline(q.a.id)) ? 0.1 : 1;
      cands.push({ p, q, fit, pOrganic, priority: reach * fit * fit * (1 - pOrganic) * urgency, fired: [...new Set([...ab.fired, ...ba.fired])] });
    }
    cands.sort((u, v) => v.priority - u.priority);
    const budget = minsLeft > 60 ? 2 : minsLeft > 30 ? 4 : 8; const used = new Set(); const out = []; const round = S.round + 1;
    for (const c of cands) {
      if (out.length >= budget || used.has(c.p.a.id) || used.has(c.q.a.id)) continue;
      used.add(c.p.a.id); used.add(c.q.a.id);
      const deadline = Math.min(now + CLUE_MINUTES * 60_000, end);
      const clueA = clueFor(c.p.c, c.q.c, c.q.f, c.p.f, deadline), clueB = clueFor(c.q.c, c.p.c, c.p.f, c.q.f, deadline);
      const ev = { id: db.events.length + 1, type: 'match', actorId: c.p.a.id, targetId: c.q.a.id, createdAt: now,
        meta: { round, scoutVersion: S.version, fit: +c.fit.toFixed(3), pOrganic: +c.pOrganic.toFixed(3), priority: +c.priority.toFixed(3), features: c.fired, weights: { ...S.weights }, clueA, clueB, deadline, status: 'open' } };
      db.events.push(ev); out.push(ev);
      sendTo(c.p.a.id, { type: 'state', scout: { phase: 'clue', matchId: ev.id, clue: clueA, deadline, round } });
      sendTo(c.q.a.id, { type: 'state', scout: { phase: 'clue', matchId: ev.id, clue: clueB, deadline, round } });
      log({ kind: 'clue', matchId: ev.id, fit: ev.meta.fit, pOrganic: ev.meta.pOrganic, features: c.fired });
    }
    // expire
    for (const m of matches()) if (m.meta.status === 'open' && m.meta.deadline < now) m.meta.status = 'expired';
    if (out.length) { S.round = round; save(); broadcastScreen({ type: 'scout', scout: state() }); }
    return out;
  }

  /** A haunt between an open pair confirms the match: both phones hear it, the screen updates. Returns the match or null. */
  function confirm(h) {
    const m = matches().find((x) => x.meta.status === 'open' && inPair(x, h.actorId, h.targetId) && h.createdAt >= x.createdAt);
    if (!m) return null;
    m.meta.status = 'found'; m.meta.foundAt = h.createdAt; m.meta.hauntId = h.id; m.meta.minutesToFind = +((h.createdAt - m.createdAt) / 60_000).toFixed(1);
    const reason = reasonOf(m);
    for (const id of [m.actorId, m.targetId]) sendTo(id, { type: 'state', scout: { phase: 'found', matchId: m.id, hauntId: h.id, reason } });
    broadcastScreen({ type: 'scout', scout: state() });
    log({ kind: 'found', matchId: m.id, minutes: m.meta.minutesToFind }); save();
    return m;
  }
  const seenHaunts = new Set();
  function watch() { for (const h of haunts()) if (!seenHaunts.has(h.id)) { seenHaunts.add(h.id); confirm(h); } }
  const reasonOf = (m) => 'Paired on: ' + (m.meta.features.length ? m.meta.features.map((f) => f.replace(/_/g, ' ')).join(', ') : 'profile fit') + ` (fit ${m.meta.fit}).`;
  const matchOfHaunt = (hauntId) => matches().find((m) => m.meta.hauntId === hauntId);

  // ---------- rating: one tap on both phones after any haunt (calibration.md section 2) ----------
  app.post('/api/rating', (req, res) => {
    const { raterId, token, hauntId, verdict, source } = req.body || {};
    const rater = byId(raterId);
    if (!rater || rater.token !== token) return res.status(403).json({ error: 'forbidden' });
    if (!['yes', 'no', 'knew'].includes(verdict)) return res.status(400).json({ error: 'verdict must be yes, no or knew' });
    const h = db.events.find((e) => e.type === 'haunt' && e.id === Number(hauntId));
    if (!h || (h.actorId !== rater.id && h.targetId !== rater.id)) return res.status(404).json({ error: 'no such haunt of yours' });
    h.meta ||= {}; h.meta.ratings ||= {};
    h.meta.ratings[rater.id] = { verdict, at: Date.now(), source: source === 'asi1' ? 'asi1' : 'phone' };
    save();
    const m = matchOfHaunt(h.id);
    log({ kind: 'rating', hauntId: h.id, matchId: m?.id || null, verdict, source: h.meta.ratings[rater.id].source });
    const changed = review();
    broadcastScreen({ type: 'scout', scout: state() });
    res.json({ ok: true, scout: !!m, reason: m ? reasonOf(m) : 'This one was not the Scout\'s call.', changed });
  });

  // ---------- rule 1: one weight per version, with evidence (calibration.md section 4) ----------
  const FEATURE_WEIGHT = { complement: 'stack', same_bucket: 'stack', shared_language: 'common', intent_match: 'intent', active_this_week: 'fresh' };
  function ratedPairs() { // Scout pairs with at least one phone rating that is yes or no (knew drops the pair)
    return matches().filter((m) => m.meta.status === 'found').map((m) => {
      const h = db.events.find((e) => e.id === m.meta.hauntId); const rs = Object.values(h?.meta?.ratings || {}).filter((r) => r.source === 'phone' && r.verdict !== 'knew');
      if (!rs.length) return null;
      return { m, yes: rs.every((r) => r.verdict === 'yes') ? 1 : 0 }; // a no from either side is a full negative
    }).filter(Boolean);
  }
  function review() {
    const rated = ratedPairs(); if (rated.length < MIN_N) return null;
    if (S.changelog.some((c) => c.atN === rated.length)) return null; // one change per review point
    const byF = {};
    for (const r of rated) for (const f of r.m.meta.features) { byF[f] ||= { yes: 0, n: 0 }; byF[f].n++; byF[f].yes += r.yes; }
    const worst = Object.entries(byF).filter(([f, v]) => FEATURE_WEIGHT[f] && v.n >= 3 && v.yes / v.n <= 0.4).sort((a, b) => a[1].yes / a[1].n - b[1].yes / b[1].n)[0];
    if (!worst) return null;
    const [feature, ev] = worst; const w = FEATURE_WEIGHT[feature]; const before = { ...S.weights };
    S.weights[w] = +Math.max(0.05, S.weights[w] / 2).toFixed(3);
    const entry = { from: `v${S.version}`, to: `v${S.version + 1}`, at: Date.now(), atN: rated.length, rule: 'weight_halve', feature, weight: w, evidence: ev, before, after: { ...S.weights },
      text: `v${S.version} -> v${S.version + 1}: pairs with ${feature.replace(/_/g, ' ')} were worth it ${ev.yes} of ${ev.n} times, so ${w} weight ${before[w]} -> ${S.weights[w]}.` };
    S.version++; S.changedAt = entry.at; S.changelog.push(entry); log({ kind: 'version', ...entry }); save();
    return entry;
  }

  /** The one block the screen, the log and the ASI:One agent all quote (calibration.md section 3). */
  function state() {
    const ms = matches(); const found = ms.filter((m) => m.meta.status === 'found'); const scoutHauntIds = new Set(found.map((m) => m.meta.hauntId));
    const tally = (hs) => { const t = { yes: 0, no: 0, n: 0 }; for (const h of hs) for (const r of Object.values(h.meta?.ratings || {})) if (r.verdict !== 'knew') { t[r.verdict]++; t.n++; } return t; };
    const hs = haunts();
    return { version: S.version, changedAt: S.changedAt, weights: S.weights, round: S.round, minN: MIN_N, ratedPairs: ratedPairs().length,
      predicted: tally(hs.filter((h) => scoutHauntIds.has(h.id))), baseline: tally(hs.filter((h) => !scoutHauntIds.has(h.id))),
      clues: { sent: ms.length, found: found.length, pending: ms.filter((m) => m.meta.status === 'open').length, expired: ms.filter((m) => m.meta.status === 'expired').length },
      changelog: S.changelog.slice(-3).map((c) => c.text), nextReviewAt: Math.max(MIN_N, ratedPairs().length + 1), endsAt: eventEnd() };
  }

  if (process.env.NO_SCOUT !== '1') {
    setTimeout(() => { try { sweep(); } catch (e) { console.warn('scout sweep:', e.message); } }, Math.min(3000, SWEEP_MS)).unref();
    setInterval(() => { try { sweep(); } catch (e) { console.warn('scout sweep:', e.message); } }, SWEEP_MS).unref();
    setInterval(() => { try { watch(); } catch {} }, 1000).unref();
  }
  for (const h of haunts()) seenHaunts.add(h.id); // haunts from before this boot are not confirmations
  return { sweep, confirm, state, review, watch };
}
