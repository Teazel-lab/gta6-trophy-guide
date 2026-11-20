// Roadmap view: the five stage cards to the platinum (progress bar + the stage's
// trophies as grade chips) and the "Missable & one-time" panel in story order.
import { isSpoilerHidden, maskedName, chapterLabel } from './spoiler-shield.js';

/** Per-element click callback, so re-renders never stack listeners. */
const callbacks = new WeakMap();

/**
 * Render the roadmap into `el` (#roadmap).
 * stages    = buildPlatinumRoadmap(...) -> [{stage, title, summary, trophyIds, done, total}]
 * missables = listMissables(trophies, progress) -> [{id, name, chapter, note, risk}]
 * options   = {trophiesById: Map, progress, onSelect(id)}; chips call onSelect when clicked.
 */
export function renderRoadmapView(el, stages, missables, options = {}) {
  const { trophiesById = new Map(), progress = {}, onSelect = null } = options;
  bindRoadmapClicks(el);
  callbacks.set(el, onSelect);
  const done = stages.reduce((n, s) => n + s.done, 0);
  const total = stages.reduce((n, s) => n + s.total, 0);

  el.replaceChildren(
    h('header', { class: 'roadmap-intro' },
      h('h2', {}, 'Platinum roadmap'),
      h('p', {}, `${stages.length} stages · ${done} / ${total} trophies done · ${missables.length} missable or one-time trophies to watch`)),
    h('div', { class: 'roadmap-stages' }, ...stages.map((s) => stageCard(s, trophiesById, progress))),
    h('aside', { class: 'roadmap-side' },
      stageOverview(stages),
      missablesPanel(missables, trophiesById, progress)),
  );
}

/** At-a-glance list of the five stages with their progress bars. */
function stageOverview(stages) {
  return h('section', { class: 'stage-overview', 'aria-label': 'Stages at a glance' },
    h('h3', {}, 'Route to the platinum'),
    h('ol', {}, ...stages.map((s) => {
      const pct = s.total ? Math.round((s.done / s.total) * 100) : 0;
      return h('li', { class: s.total && s.done === s.total ? 'is-done' : '' },
        h('span', { class: 'overview-num' }, String(s.stage)),
        h('span', { class: 'overview-title' }, s.title),
        h('span', { class: 'overview-count' }, `${s.done}/${s.total}`),
        h('div', { class: 'stage-bar' }, h('span', { style: `width:${pct}%` })));
    })));
}

/** One stage: number badge, title, summary, done/total bar and trophy chips. */
function stageCard(stage, trophiesById, progress) {
  const pct = stage.total ? Math.round((stage.done / stage.total) * 100) : 0;
  const complete = stage.total > 0 && stage.done === stage.total;
  const chips = stage.trophyIds.map((id) => trophiesById.get(id)).filter(Boolean)
    .map((t) => trophyChip(t, progress));
  return h('article', { class: 'stage-card' + (complete ? ' is-done' : ''), 'data-stage': stage.stage },
    h('span', { class: 'stage-num', 'aria-hidden': 'true' }, String(stage.stage)),
    h('h3', {}, stage.title),
    h('p', { class: 'stage-summary' }, stage.summary),
    h('div', { class: 'stage-progress' },
      h('div', { class: 'stage-bar', role: 'progressbar', 'aria-valuemin': '0', 'aria-valuemax': String(stage.total), 'aria-valuenow': String(stage.done) },
        h('span', { style: `width:${pct}%` })),
      h('span', {}, `${stage.done} / ${stage.total}`)),
    h('div', { class: 'stage-trophies' }, ...chips));
}

/** Compact clickable chip: grade cup + name (masked while spoiler-hidden). */
function trophyChip(trophy, progress) {
  const masked = isSpoilerHidden(trophy, progress);
  const earned = Boolean(progress?.earned?.[trophy.id]);
  const name = masked ? maskedName(trophy) : trophy.name;
  const cls = ['stage-chip', earned && 'is-earned', masked && 'is-masked', trophy.missable && 'is-missable'].filter(Boolean).join(' ');
  return h('button', { type: 'button', class: cls, 'data-id': trophy.id, title: `${name} — open guide` },
    h('i', { class: 'grade-icon', 'data-grade': trophy.grade, 'aria-hidden': 'true' }),
    h('span', {}, name));
}

/** Every missable / easy-to-miss trophy with its chapter and why it can slip. */
function missablesPanel(missables, trophiesById, progress) {
  const panel = h('section', { class: 'missables-panel', 'aria-label': 'Missable and one-time trophies' },
    h('h3', {}, `Missable & one-time (${missables.length})`),
    h('p', { class: 'stage-summary' }, 'In story order. Do these before the chapter moves on — some cannot be retried.'));
  if (!missables.length) {
    panel.append(h('p', { class: 'stage-summary' }, 'No missable trophies flagged.'));
    return panel;
  }
  panel.append(h('ol', { class: 'missable-list' }, ...missables.map((m) => {
    const t = trophiesById.get(m.id);
    const earned = Boolean(progress?.earned?.[m.id]);
    const masked = t ? isSpoilerHidden(t, progress) : false;
    const chapter = masked ? chapterLabel(t) : m.chapter;
    return h('li', { class: 'missable-item' + (m.risk === 'risk' ? ' is-risk' : '') + (earned ? ' is-earned' : '') },
      h('button', { type: 'button', class: 'missable-open', 'data-id': m.id },
        t ? h('i', { class: 'grade-icon', 'data-grade': t.grade, 'aria-hidden': 'true' }) : null,
        h('span', { class: 'missable-name' }, m.name),
        h('span', { class: 'missable-flag' + (m.risk === 'risk' ? ' is-risk' : '') }, m.risk === 'risk' ? 'RISK' : 'MISSABLE')),
      h('span', { class: 'when-chip' }, chapter || 'Any time'),
      m.note ? h('p', { class: 'missable-note' }, m.note) : null);
  })));
  return panel;
}

function bindRoadmapClicks(el) {
  if (callbacks.has(el)) return;
  el.addEventListener('click', (event) => {
    const btn = event.target.closest('[data-id]');
    const cb = callbacks.get(el);
    if (!btn || !el.contains(btn) || typeof cb !== 'function') return;
    const raw = btn.dataset.id;
    cb(/^\d+$/.test(raw) ? Number(raw) : raw);
  });
}

function h(tag, attrs = {}, ...children) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, v);
  node.append(...children.filter((c) => c != null));
  return node;
}
