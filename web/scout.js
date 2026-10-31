// The Scout on the phone and the big screen (docs/scout/README.md).
// Phone: a clue arrives on the socket as { type: 'state', scout: { phase: 'clue' | 'found', ... } }; after any haunt both
// sides get one question, "Would you build something with them?", whose answer scores the Scout (POST /api/rating).
// Screen: renderScout(state) draws the "predicted vs actual" panel. Styles are injected here so app.css stays untouched.
import { api, getMe, toast, esc, shriek } from '/common.js';

const CSS = `
.scout-rate { margin-top: 10px; padding-top: 10px; border-top: 1px solid #ffffff22; font-size: 15px; }
.scout-rate .q { margin-bottom: 6px; }
.scout-rate button { display: inline-block; width: auto; margin: 0 8px 0 0; padding: 8px 16px; font-size: 15px; border-radius: 10px; }
.scout-rate button.secondary { background: #3a3346; color: #e8e2f2; }
.scout-rate .knew { color: #b3abc4; font-size: 13px; text-decoration: underline; cursor: pointer; margin-left: 4px; }
.scout-rate .done { color: #b3abc4; font-size: 14px; }
.scout-clue { border-color: #9b6bff !important; }
.scout-clue .lead { color: #c9b3ff; font-size: 13px; letter-spacing: .08em; text-transform: uppercase; }
.scout-clue .deadline { color: #b3abc4; font-size: 13px; margin-top: 6px; }
#scout { white-space: pre-wrap; font-variant-numeric: tabular-nums; }
#scout .bar { font-family: ui-monospace, Menlo, monospace; letter-spacing: 1px; }
#scout .v { color: #c9b3ff; }
#scout .small { color: #b3abc4; font-size: 14px; }
`;
let styled = false;
function style() { if (styled) return; styled = true; const s = document.createElement('style'); s.textContent = CSS; document.head.appendChild(s); }

/** Handle a `state { scout }` payload on a phone page. */
export function scoutState(s) {
  style();
  if (s.phase === 'clue') {
    try { navigator.vibrate?.([80, 60, 80, 60, 240]); } catch {}
    const when = new Date(s.deadline).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    toast(`<div class="lead">The Scout has a match for you</div><b>${esc(s.clue)}</b><div class="deadline">No name, no photo. Point your camera at people. Expires ${esc(when)}.</div>`, 60_000);
    document.querySelector('.toast')?.classList.add('scout-clue');
  }
  if (s.phase === 'found') {
    shriek();
    toast(`<div class="lead">You found your match</div><b>👻 The Scout was right about you two.</b><div class="deadline">${esc(s.reason || '')}</div>`, 10_000);
    document.querySelector('.toast')?.classList.add('scout-clue');
  }
}

/** Append the one rating question for haunt `hauntId` into `container` (default: the open toast). Call after a haunt either way. */
export function scoutRate(hauntId, container) {
  style();
  const me = getMe(); if (!me || !hauntId) return;
  const host = container || document.querySelector('.toast'); if (!host || host.querySelector(`.scout-rate[data-h="${hauntId}"]`)) return;
  const el = document.createElement('div'); el.className = 'scout-rate'; el.dataset.h = hauntId;
  el.innerHTML = `<div class="q">Would you build something with them?</div><button data-v="yes">Yes</button><button data-v="no" class="secondary">No</button><span class="knew" data-v="knew">Already knew them</span>`;
  host.appendChild(el);
  if (host.classList.contains('toast')) { clearTimeout(host._t); host._t = setTimeout(() => host.classList.remove('show'), 40_000); } // give the tap time
  el.addEventListener('click', async (e) => {
    const v = e.target.closest('[data-v]')?.dataset.v; if (!v) return;
    e.stopPropagation();
    el.innerHTML = '<span class="done">Saving…</span>';
    try {
      const r = await api('/api/rating', { method: 'POST', body: { raterId: me.id, token: me.token, hauntId, verdict: v, source: 'phone' } });
      el.innerHTML = `<span class="done">${v === 'knew' ? 'Noted, not counted.' : 'Thanks.'} ${esc(r.reason || '')}${r.changed ? ' The Scout just changed its mind: ' + esc(r.changed.text) : ''}</span>`;
    } catch (err) { el.innerHTML = `<span class="done">Could not save (${esc(err.message)}).</span>`; }
  });
}

/** Big screen panel. `s` is the scout block from GET /api/events or a `scout` socket message. */
export function renderScout(s, el = document.getElementById('scout')) {
  if (!el || !s) return; style();
  const any = s.clues.sent + s.predicted.n + s.baseline.n;
  el.hidden = !any; if (!any) return;
  const bar = (t) => { const n = Math.max(t.n, 1), w = 10, y = Math.round((t.yes / n) * w); return `<span class="bar">${'#'.repeat(t.n ? y : 0)}${'-'.repeat(w - (t.n ? y : 0))}</span>`; };
  const of = (t) => (t.n ? `${t.yes} of ${t.n}` : 'no ratings yet');
  const changed = s.changedAt ? ` <span class="small">changed ${new Date(s.changedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>` : '';
  const lines = [
    `<b>THE SCOUT</b> <span class="v">v${s.version}</span>${changed}`,
    `Scout pairs "would build"   ${of(s.predicted).padEnd(16)} ${bar(s.predicted)}`,
    `Other haunts                ${of(s.baseline).padEnd(16)} ${bar(s.baseline)}`,
    `Clues sent ${s.clues.sent} · found ${s.clues.found} · still hunting ${s.clues.pending}`,
  ];
  if (s.changelog?.length) lines.push(`<span class="small">${esc(s.changelog[s.changelog.length - 1])}</span>`);
  else lines.push(`<span class="small">weights ${Object.entries(s.weights).map(([k, v]) => `${k} ${v}`).join(', ')} · reviews after ${s.nextReviewAt} rated pairs</span>`);
  if (s.predicted.n + s.baseline.n < 10) lines.push('<span class="small">small sample: a few more ratings will move these bars</span>');
  el.innerHTML = lines.join('\n');
}
