// Trophy checklist view: builds one row per trophy once, then patches rows in place
// by id (only changed text/classes are touched). One delegated listener per list
// handles row selection and the earned checkbox.
import { isSpoilerHidden, maskedName, maskedDescription, chapterLabel } from './spoiler-shield.js';
import { ROADMAP_STAGES } from './roadmap-builder.js';
import { gradeLabel } from './trophy-data.js';

const KIND_LABELS = {
  story: 'Story', missable: 'Missable', collectible: 'Collectible', activity: 'Activity',
  combat: 'Combat', exploration: 'Exploration', economy: 'Economy', misc: 'Misc',
};

/** Per-container view state: keyed row elements, group headers, callback. */
const views = new WeakMap();

/**
 * Render (or re-render) the checklist into `container` (the #trophy-list <ol>).
 * `trophies` is the already filtered + sorted list; `state` is the filter state
 * ({sort, kinds, selectedId, ...}). `onSelect(id, action)` is called with
 * action 'select' (row clicked / Enter) or 'toggle-earned' (checkbox clicked).
 * `onSelect` may also be an object {onSelect(id), onToggleEarned(id)}.
 */
export function renderTrophyList(container, trophies, progress, state = {}, onSelect = null) {
  const view = viewFor(container);
  view.callback = onSelect;
  const wanted = [];
  const grouped = state.sort === 'roadmap';
  let lastStage = null;

  for (const trophy of trophies) {
    if (grouped && trophy.stage !== lastStage) {
      lastStage = trophy.stage;
      wanted.push(patchGroupHeader(view, trophy.stage, trophies, progress));
    }
    let row = view.rows.get(trophy.id);
    if (!row) {
      row = buildTrophyRow(trophy);
      view.rows.set(trophy.id, row);
    }
    patchTrophyRow(row, trophy, progress, state);
    wanted.push(row);
  }
  if (!trophies.length) wanted.push(patchEmptyState(view, state));
  placeChildren(container, wanted);
}

/** Update one row's text, classes and checkbox to match trophy + progress. */
export function patchTrophyRow(row, trophy, progress, state = {}) {
  const masked = isSpoilerHidden(trophy, progress);
  const earned = Boolean(progress?.earned?.[trophy.id]);
  const selected = String(state.selectedId ?? '') === String(trophy.id);
  const counter = trophy.count ? Math.min(progress?.counters?.[trophy.id] || 0, trophy.count) : 0;
  const parts = row._parts;

  setText(parts.name, masked ? maskedName(trophy) : trophy.name);
  setText(parts.desc, masked ? maskedDescription(trophy) : trophy.description);
  setText(parts.counter, trophy.count ? `${earned ? trophy.count : counter} / ${trophy.count}` : '');
  parts.counter.hidden = !trophy.count;
  row.classList.toggle('is-masked', masked);
  row.classList.toggle('is-earned', earned);
  row.classList.toggle('is-selected', selected);
  if (row.getAttribute('aria-selected') !== String(selected)) row.setAttribute('aria-selected', String(selected));
  if (parts.check.checked !== earned) parts.check.checked = earned;
  const label = `${earned ? 'Unmark' : 'Mark'} ${masked ? 'this trophy' : trophy.name} as earned`;
  if (parts.check.getAttribute('aria-label') !== label) parts.check.setAttribute('aria-label', label);
  return row;
}

/** Build the static skeleton of a row; patchTrophyRow fills the changing parts. */
function buildTrophyRow(trophy) {
  const row = el('li', { class: 'trophy-row', 'data-id': trophy.id, tabindex: '0', role: 'option' });
  const icon = el('i', { class: 'grade-icon', 'data-grade': trophy.grade, 'aria-hidden': 'true' });
  const name = el('div', { class: 'row-name' });
  const desc = el('div', { class: 'row-desc' });
  const text = el('div', { class: 'row-text' }, name, desc);

  const meta = el('div', { class: 'row-meta' });
  meta.append(el('span', { class: 'grade-label', 'data-grade': trophy.grade }, gradeLabel(trophy.grade)));
  if (trophy.kind) meta.append(el('span', { class: 'kind-chip' }, KIND_LABELS[trophy.kind] || trophy.kind));
  const chapter = chapterLabel(trophy);
  if (chapter) meta.append(el('span', { class: 'kind-chip chapter-chip', title: chapter }, chapter.replace('Chapter', 'Ch.')));
  if (trophy.missable === true) meta.append(el('span', { class: 'missable-flag', title: trophy.missableNote || 'Can be missed' }, 'MISSABLE'));
  else if (trophy.missable === 'risk') meta.append(el('span', { class: 'missable-flag is-risk', title: trophy.missableNote || 'Easy to miss' }, 'MISSABLE RISK'));
  const counter = el('span', { class: 'row-counter' });
  meta.append(counter);

  const check = el('input', { type: 'checkbox', class: 'earned-check', 'data-action': 'toggle-earned' });
  row.append(icon, text, meta, check);
  row._parts = { name, desc, counter, check };
  return row;
}

/** Stage heading shown above each roadmap group, with earned/visible counts. */
function patchGroupHeader(view, stage, trophies, progress) {
  let head = view.heads.get(stage);
  if (!head) {
    const info = ROADMAP_STAGES.find((s) => s.stage === stage);
    head = el('li', { class: 'list-group-head', role: 'presentation', 'data-stage': stage },
      el('span', { class: 'group-stage' }, `Stage ${stage ?? '–'}`),
      el('span', { class: 'group-title' }, info ? info.title : 'Other trophies'),
      el('span', { class: 'group-count' }));
    view.heads.set(stage, head);
  }
  const inStage = trophies.filter((t) => t.stage === stage);
  const done = inStage.filter((t) => progress?.earned?.[t.id]).length;
  setText(head.lastChild, `${done} / ${inStage.length}`);
  return head;
}

/** "Nothing matches" row; explains the empty Online filter specifically. */
function patchEmptyState(view, state) {
  if (!view.empty) {
    view.empty = el('li', { class: 'trophy-empty', role: 'presentation' },
      el('strong', {}), el('span', {}));
  }
  const onlineOnly = state.kinds instanceof Set && state.kinds.size === 1 && state.kinds.has('online');
  setText(view.empty.firstChild, onlineOnly ? 'No online trophies' : 'No trophies match');
  setText(view.empty.lastChild, onlineOnly
    ? 'All 55 GTA VI trophies are earned in single-player; none need GTA Online.'
    : 'Clear the search or switch a filter off to see more of the list.');
  return view.empty;
}

/** Lazily create view state and the delegated listeners for a list container. */
function viewFor(container) {
  let view = views.get(container);
  if (view) return view;
  view = { rows: new Map(), heads: new Map(), empty: null, callback: null };
  views.set(container, view);
  container.setAttribute('role', 'listbox');

  container.addEventListener('click', (event) => {
    const row = event.target.closest('.trophy-row');
    if (!row || !container.contains(row)) return;
    const id = idOf(row);
    if (event.target.closest('[data-action="toggle-earned"]')) notify(view, id, 'toggle-earned');
    else notify(view, id, 'select');
  });
  container.addEventListener('keydown', (event) => {
    const row = event.target.closest?.('.trophy-row');
    if (!row || event.target !== row) return;
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      notify(view, idOf(row), 'select');
    } else if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      let next = event.key === 'ArrowDown' ? row.nextElementSibling : row.previousElementSibling;
      while (next && !next.classList.contains('trophy-row')) {
        next = event.key === 'ArrowDown' ? next.nextElementSibling : next.previousElementSibling;
      }
      next?.focus();
    }
  });
  return view;
}

function notify(view, id, action) {
  const cb = view.callback;
  if (typeof cb === 'function') cb(id, action);
  else if (cb && action === 'select') cb.onSelect?.(id);
  else if (cb && action === 'toggle-earned') cb.onToggleEarned?.(id);
}

/** Make container's children exactly `wanted`, moving only nodes out of place. */
function placeChildren(container, wanted) {
  const keep = new Set(wanted);
  for (const child of [...container.children]) if (!keep.has(child)) child.remove();
  let cursor = container.firstElementChild;
  for (const node of wanted) {
    if (node === cursor) cursor = cursor.nextElementSibling;
    else container.insertBefore(node, cursor);
  }
}

function idOf(row) {
  const raw = row.dataset.id;
  return /^\d+$/.test(raw) ? Number(raw) : raw;
}

function setText(node, text) {
  if (node.textContent !== text) node.textContent = text;
}

function el(tag, attrs = {}, ...children) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, v);
  node.append(...children);
  return node;
}
