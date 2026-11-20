// Guide pane: everything about one trophy — official name/description/grade, when
// to get it, missable warning, our own guide, steps, tips, a counter stepper, the
// mark-earned button and the named, linked sources the guide is based on.
import { isSpoilerHidden, maskedName, maskedDescription, chapterLabel } from './spoiler-shield.js';
import { ROADMAP_STAGES } from './roadmap-builder.js';
import { GRADE_POINTS, gradeLabel } from './trophy-data.js';

/** Trophy ids the visitor chose to reveal in the guide this session. */
const revealedIds = new Set();
/** Per-panel context for the delegated click handler. */
const panels = new WeakMap();

/**
 * Render the guide for `trophy` into `el` (#guide-panel). `sources` is the
 * key -> {name, url} dictionary. Optional `actions`: {onToggleEarned(id),
 * onCounter(id, n)}; without them the panel dispatches bubbling CustomEvents
 * 'guide:toggle-earned' {id} and 'guide:counter' {id, value}.
 */
export function renderGuidePanel(el, trophy, sources = {}, progress = {}, actions = {}) {
  bindGuidePanel(el);
  panels.get(el).ctx = { trophy, sources, progress, actions };
  if (!trophy) {
    el.replaceChildren(guideEmptyState());
    return;
  }
  const masked = isSpoilerHidden(trophy, progress) && !revealedIds.has(trophy.id);
  const earned = Boolean(progress?.earned?.[trophy.id]);
  el.dataset.trophyId = trophy.id;
  el.replaceChildren(...[
    guideHeader(trophy, masked),
    guideWhen(trophy, masked),
    missableWarning(trophy),
    masked ? revealCard(trophy) : guideBody(trophy),
    sourcesCard(trophy, sources),
    masked ? null : guideSteps(trophy),
    trophy.count ? counterCard(trophy, progress, earned) : null,
    earnButton(trophy, earned),
  ].filter(Boolean));
  el.scrollTop = 0;
}

/** Header: grade cup, official (or masked) name + description, grade, points, PS hidden badge. */
function guideHeader(trophy, masked) {
  const meta = h('div', { class: 'guide-meta' },
    h('span', { class: 'grade-label', 'data-grade': trophy.grade }, gradeLabel(trophy.grade)),
    h('span', { class: 'guide-points' }, `${GRADE_POINTS[trophy.grade] ?? 0} pts`));
  if (trophy.hidden) meta.append(h('span', { class: 'hidden-badge', title: 'PlayStation lists this trophy as hidden' }, 'PS hidden'));
  return h('header', { class: 'guide-head' },
    h('i', { class: 'grade-icon', 'data-grade': trophy.grade, 'aria-hidden': 'true' }),
    h('div', {},
      h('h2', { class: 'guide-title' + (masked ? ' spoiler-lock' : '') }, masked ? maskedName(trophy) : trophy.name),
      h('p', { class: 'guide-desc' }, masked ? maskedDescription(trophy) : trophy.description),
      meta));
}

/** "When" line: chapter (mission name only when not masked) + roadmap stage. */
function guideWhen(trophy, masked) {
  const chapter = masked ? chapterLabel(trophy) : trophy.chapter;
  const stage = ROADMAP_STAGES.find((s) => s.stage === trophy.stage);
  const line = h('div', { class: 'guide-when' }, h('strong', {}, 'When'));
  line.append(h('span', { class: 'when-chip' }, chapter || 'Any time — not tied to a mission'));
  if (stage) line.append(h('span', { class: 'when-chip' }, `Roadmap stage ${stage.stage} · ${stage.title}`));
  return line;
}

/** Red box for missables, amber-styled (is-risk) for "easy to miss" ones. */
function missableWarning(trophy) {
  if (!trophy.missable) return null;
  const risk = trophy.missable === 'risk';
  return h('div', { class: 'guide-warning' + (risk ? ' is-risk' : ''), role: 'note' },
    h('strong', {}, risk ? 'Missable risk' : 'Missable'),
    trophy.missableNote || (risk ? 'Easy to miss — read the steps before you start.' : 'Can be permanently missed.'));
}

/** Our guide paragraph (the cited Sources card follows it directly). */
function guideBody(trophy) {
  const card = h('section', { class: 'guide-card guide-body' }, h('h3', {}, 'Our guide'));
  card.append(h('p', { class: 'guide-text' }, trophy.guide || 'Guide text coming soon.'));
  return card;
}

/** Numbered steps and tips, after the sources. */
function guideSteps(trophy) {
  if (!trophy.steps?.length && !trophy.tips?.length) return null;
  const card = h('section', { class: 'guide-card guide-route' });
  if (trophy.steps?.length) {
    card.append(h('h3', {}, 'Steps'),
      h('ol', { class: 'guide-steps' }, ...trophy.steps.map((s) => h('li', {}, s))));
  }
  if (trophy.tips?.length) {
    card.append(h('h3', { class: 'guide-subhead' }, 'Tips'),
      h('ul', { class: 'guide-tips' }, ...trophy.tips.map((s) => h('li', {}, s))));
  }
  return card;
}

/** Stand-in for the guide while a story trophy is spoiler-shielded. */
function revealCard(trophy) {
  return h('section', { class: 'guide-card guide-reveal' },
    h('h3', {}, 'Our guide'),
    h('p', { class: 'spoiler-lock' }, 'This guide names story missions and events. It stays hidden until you earn the trophy.'),
    h('button', { class: 'btn reveal-btn', type: 'button', 'data-action': 'reveal', 'data-id': trophy.id }, 'Reveal this guide'));
}

/** − n/count + stepper with a progress bar, for count-based trophies. */
function counterCard(trophy, progress, earned) {
  const n = earned ? trophy.count : Math.min(progress?.counters?.[trophy.id] || 0, trophy.count);
  const pct = Math.round((n / trophy.count) * 100);
  return h('section', { class: 'guide-card guide-counter' },
    h('h3', {}, 'Your count'),
    h('div', { class: 'counter-row' },
      h('div', { class: 'counter-stepper' },
        h('button', { type: 'button', 'data-action': 'counter', 'data-step': '-1', 'aria-label': 'One fewer', ...(n <= 0 ? { disabled: '' } : {}) }, '−'),
        h('output', { 'aria-live': 'polite' }, `${n} / ${trophy.count}`),
        h('button', { type: 'button', 'data-action': 'counter', 'data-step': '1', 'aria-label': 'One more', ...(n >= trophy.count ? { disabled: '' } : {}) }, '+')),
      h('span', { class: 'counter-percent' }, `${pct}%`)),
    h('div', { class: 'counter-bar' }, h('span', { style: `width:${pct}%` })));
}

function earnButton(trophy, earned) {
  return h('button', {
    class: 'btn guide-earn-btn' + (earned ? ' is-earned' : ''), type: 'button',
    'data-action': 'toggle-earned', 'aria-pressed': String(earned),
  }, earned ? '✓ Earned — click to unmark' : 'Mark as earned');
}

/** Every cited source by name, with its domain; links open only when clicked. */
function sourcesCard(trophy, sources) {
  const keys = (trophy.cite || []).filter((k) => sources?.[k]);
  const card = h('section', { class: 'guide-card guide-sources' }, h('h3', {}, `Sources (${keys.length})`));
  if (!keys.length) {
    card.append(h('p', { class: 'guide-text' }, 'No sources cited for this trophy yet.'));
    return card;
  }
  card.append(h('ul', { class: 'source-list' }, ...keys.map((k) => {
    const src = sources[k];
    return h('li', {},
      h('a', { href: src.url, target: '_blank', rel: 'noopener noreferrer' }, src.name),
      h('small', {}, domainOf(src.url)));
  })));
  return card;
}

function guideEmptyState() {
  return h('div', { class: 'guide-empty' },
    h('i', { class: 'grade-icon', 'data-grade': 'platinum', 'aria-hidden': 'true' }),
    h('h2', {}, 'Pick a trophy'),
    h('p', {}, 'Select any row to open its guide: when to do it, step-by-step route, missable warnings and the sources we checked.'));
}

/** One delegated click listener per panel for reveal, counter and earned actions. */
function bindGuidePanel(el) {
  if (panels.has(el)) return;
  const state = { ctx: null };
  panels.set(el, state);
  el.addEventListener('click', (event) => {
    const btn = event.target.closest('button[data-action]');
    if (!btn || !state.ctx?.trophy) return;
    const { trophy, sources, progress, actions } = state.ctx;
    const action = btn.dataset.action;
    if (action === 'reveal') {
      revealedIds.add(trophy.id);
      renderGuidePanel(el, trophy, sources, progress, actions);
    } else if (action === 'toggle-earned') {
      if (actions?.onToggleEarned) actions.onToggleEarned(trophy.id);
      else el.dispatchEvent(new CustomEvent('guide:toggle-earned', { bubbles: true, detail: { id: trophy.id } }));
    } else if (action === 'counter') {
      const current = progress?.counters?.[trophy.id] || 0;
      const value = Math.max(0, Math.min(trophy.count, current + Number(btn.dataset.step)));
      if (actions?.onCounter) actions.onCounter(trophy.id, value);
      else el.dispatchEvent(new CustomEvent('guide:counter', { bubbles: true, detail: { id: trophy.id, value } }));
    }
  });
}

function domainOf(url) {
  try { return new URL(url).hostname.replace(/^www\./, ''); } catch { return ''; }
}

function h(tag, attrs = {}, ...children) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, v);
  node.append(...children.filter((c) => c != null));
  return node;
}
