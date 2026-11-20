// App shell: the one module index.html loads. Loads data + saved progress, keeps the
// UI state, routes by hash (#/list, #/roadmap, #/trophy/<id>) and wires every control
// to the view modules. Rendering itself lives in the view files.
import { loadTrophyData, measureFirstLoad, GRADE_ORDER, FILTER_KINDS } from './trophy-data.js';
import {
  loadProgress, saveProgress, toggleEarned, setCounter,
  exportProgressFile, importProgressFile, progressSummary,
} from './progress-storage.js';
import { applyTrophyFilters, countByFilter } from './trophy-filters.js';
import { isSpoilerHidden, maskedName, chapterLabel } from './spoiler-shield.js';
import { buildPlatinumRoadmap, listMissables } from './roadmap-builder.js';
import { renderTrophyList } from './trophy-list-view.js';
import { renderGuidePanel } from './guide-panel.js';
import { renderRoadmapView } from './roadmap-view.js';

const $ = (id) => document.getElementById(id);

/** UI state (filters, view, selection); progress is the saved part. */
const state = {
  kinds: new Set(), grade: 'all', status: 'all', query: '', sort: 'roadmap',
  view: 'list', selectedId: null,
};
let progress = loadProgress();
let data = { trophies: [], sources: {}, meta: {} };
let byId = new Map();

startApp();

/** Bind controls first (so the page is usable at once), then fetch data and render. */
async function startApp() {
  bindControls();
  syncControlsFromState();
  try {
    data = await loadTrophyData();
  } catch (err) {
    $('trophy-list').innerHTML = '';
    $('trophy-list').append(Object.assign(document.createElement('li'), {
      className: 'trophy-empty', textContent: `Could not load the trophy list: ${err.message}`,
    }));
    return;
  }
  byId = new Map(data.trophies.map((t) => [t.id, t]));
  applyRoute();
  showLoadStats();
  runScreenshotHook();
}

// --- rendering --------------------------------------------------------------

/** Re-render everything that depends on state or progress (views patch in place). */
function renderApp() {
  renderHeaderSummary();
  renderFilterCounts();
  const listView = state.view === 'list';
  document.body.dataset.view = state.view;
  $('trophy-list').hidden = !listView;
  $('missables-strip').hidden = !listView;
  $('roadmap').hidden = listView;
  $('nav-list').setAttribute('aria-selected', String(listView));
  $('nav-roadmap').setAttribute('aria-selected', String(!listView));
  if (listView) {
    renderTrophyList($('trophy-list'), applyTrophyFilters(data.trophies, progress, state), progress, state, onListAction);
    renderMissablesStrip();
  } else {
    renderRoadmapView($('roadmap'), buildPlatinumRoadmap(data.trophies, progress), listMissables(data.trophies, progress),
      { trophiesById: byId, progress, onSelect: openFromRoadmap });
  }
  renderGuide();
}

function renderGuide() {
  renderGuidePanel($('guide-panel'), byId.get(state.selectedId) || null, data.sources, progress,
    { onToggleEarned: flipEarned, onCounter: changeCounter });
}

/** Progress ring, "x / 55 · pts" text and the per-grade tally. */
function renderHeaderSummary() {
  const s = progressSummary(data.trophies, progress);
  const ring = $('progress-ring');
  ring.querySelector('.ring-fill').setAttribute('stroke-dashoffset', String(100 - s.percent));
  ring.setAttribute('aria-label', `${s.percent}% of trophies earned`);
  const text = $('progress-text');
  text.querySelector('strong').textContent = `${s.percent}%`;
  text.querySelector('span').textContent = `${s.earned} / ${s.total} trophies · ${s.points} pts`;
  for (const grade of GRADE_ORDER) {
    const li = $('grade-tally').querySelector(`li[data-grade="${grade}"]`);
    if (!li) continue;
    const g = s.byGrade[grade];
    li.replaceChildren(li.querySelector('.grade-icon'), Object.assign(document.createElement('b'), { textContent: g.earned }), `/${g.total}`);
    li.title = `${g.earned} of ${g.total} ${grade} earned`;
  }
}

function renderFilterCounts() {
  const counts = countByFilter(data.trophies, progress);
  for (const chip of $('filter-chips').querySelectorAll('.chip')) {
    const kind = chip.dataset.kind;
    chip.querySelector('.chip-count').textContent = String(counts[kind] ?? 0);
    chip.setAttribute('aria-pressed', String(state.kinds.has(kind)));
    if (kind === 'online' && !counts.online) chip.title = 'No online trophies in GTA VI';
  }
}

/** Compact strip of unearned missables above the list; click opens the guide. */
function renderMissablesStrip() {
  const pills = data.trophies
    .filter((t) => t.missable && !progress.earned[t.id])
    .slice(0, 12)
    .map((t) => {
      const name = isSpoilerHidden(t, progress) ? maskedName(t) : t.name;
      const pill = document.createElement('button');
      pill.type = 'button';
      pill.className = 'missable-pill' + (t.missable === 'risk' ? ' is-risk' : '');
      pill.dataset.id = t.id;
      pill.title = t.missableNote || 'Missable';
      pill.textContent = `⚠ ${name}${chapterLabel(t) && !name.includes('Chapter') ? ' · ' + chapterLabel(t).replace('Chapter', 'Ch.') : ''}`;
      return pill;
    });
  $('missables-strip').replaceChildren(...pills);
}

/** Footer figure, computed only once the UI has rendered and the browser is idle. */
function showLoadStats() {
  const write = async () => {
    const m = await measureFirstLoad();
    const dataNote = data.fromCache ? 'trophy data cached (ETag)' : 'trophy data fetched after first paint · cached (ETag)';
    $('load-stats').textContent = `First load: ${m.files} files · ${m.kb} KB ${m.unit} · ${dataNote}`;
  };
  const later = () => (globalThis.requestIdleCallback ? requestIdleCallback(write, { timeout: 1500 }) : setTimeout(write, 300));
  if (document.readyState === 'complete') later();
  else addEventListener('load', later, { once: true });
}

// --- actions ----------------------------------------------------------------

function onListAction(id, action) {
  if (action === 'toggle-earned') flipEarned(id);
  else selectTrophy(id);
}

/** Roadmap chips open the trophy's guide beside the checklist. */
function openFromRoadmap(id) {
  state.view = 'list';
  selectTrophy(id);
}

function selectTrophy(id) {
  setRoute(`#/trophy/${id}`);
}

function flipEarned(id) {
  updateProgress(toggleEarned(progress, id));
}

function changeCounter(id, n) {
  const t = byId.get(id);
  let next = setCounter(progress, id, n, t?.count ?? Infinity);
  // Reaching the full count marks the trophy earned; stepping back down unmarks it.
  if (t?.count && (n >= t.count) !== Boolean(next.earned[id])) next = toggleEarned(next, id);
  updateProgress(next);
}

function updateProgress(next) {
  progress = next;
  if (!saveProgress(progress)) showToast('Could not save — browser storage is blocked', true);
  renderApp();
}

function setSettings(partial) {
  updateProgress({ ...progress, settings: { ...progress.settings, ...partial } });
  syncControlsFromState();
}

function showToast(message, isError = false) {
  const toast = $('toast');
  toast.textContent = message;
  toast.classList.toggle('is-error', isError);
  toast.classList.add('is-visible');
  clearTimeout(showToast.timer);
  showToast.timer = setTimeout(() => toast.classList.remove('is-visible'), 3200);
}

// --- routing ----------------------------------------------------------------

/** Go to a hash route without adding a history entry per row click. */
function setRoute(hash) {
  if (location.hash !== hash) history.replaceState(null, '', hash);
  applyRoute();
}

/** #/list and #/roadmap pick the view; #/trophy/<id> opens a guide in the current view. */
function applyRoute() {
  const [, route, arg] = location.hash.match(/^#\/(\w+)(?:\/(\w+))?/) || [];
  if (route === 'roadmap') state.view = 'roadmap';
  else if (route === 'list') state.view = 'list';
  else if (route === 'trophy') {
    const id = Number(arg);
    if (byId.has(id)) state.selectedId = id;
  }
  if (!data.trophies.length) return;
  renderApp();
  if (route === 'trophy' && state.view === 'list') {
    $('trophy-list').querySelector(`.trophy-row[data-id="${state.selectedId}"]`)?.scrollIntoView({ block: 'nearest' });
  }
}

// --- control wiring -----------------------------------------------------------

function bindControls() {
  const search = $('search');
  search.addEventListener('input', () => { state.query = search.value; renderApp(); });
  search.addEventListener('keydown', (e) => { if (e.key === 'Escape') { search.value = ''; state.query = ''; renderApp(); search.blur(); } });
  addEventListener('keydown', (e) => {
    if (e.key !== '/' || e.ctrlKey || e.metaKey || e.altKey) return;
    if (e.target.closest?.('input, select, textarea, [contenteditable="true"]')) return;
    e.preventDefault();
    if (state.view !== 'list') setRoute('#/list');
    search.focus();
    search.select();
  });

  $('filter-chips').addEventListener('click', (e) => {
    const chip = e.target.closest('.chip[data-kind]');
    if (!chip || !FILTER_KINDS.includes(chip.dataset.kind)) return;
    const kind = chip.dataset.kind;
    if (state.kinds.has(kind)) state.kinds.delete(kind); else state.kinds.add(kind);
    if (state.view !== 'list') setRoute('#/list'); else renderApp();
  });
  for (const [id, key] of [['grade-filter', 'grade'], ['status-filter', 'status'], ['sort-select', 'sort']]) {
    $(id).addEventListener('change', (e) => { state[key] = e.target.value; renderApp(); });
  }

  $('spoiler-toggle').addEventListener('change', (e) => setSettings({ spoilers: e.target.checked ? 'hide' : 'show' }));

  $('export-progress').addEventListener('click', () => {
    try {
      const name = exportProgressFile(progress);
      showToast(`Exported ${Object.keys(progress.earned).length} earned trophies → ${name}`);
    } catch (err) {
      showToast(`Export failed: ${err.message}`, true);
    }
  });
  const fileInput = $('import-file');
  $('import-progress').addEventListener('click', () => fileInput.click());
  fileInput.addEventListener('change', async () => {
    const file = fileInput.files?.[0];
    fileInput.value = '';
    if (!file) return;
    try {
      const result = await importProgressFile(file, { trophies: data.trophies, current: progress });
      updateProgress(result.progress);
      showToast(result.message);
    } catch (err) {
      showToast(`Import failed: ${err.message}`, true);
    }
  });

  $('missables-strip').addEventListener('click', (e) => {
    const pill = e.target.closest('[data-id]');
    if (pill) selectTrophy(Number(pill.dataset.id));
  });
  addEventListener('hashchange', applyRoute);
}

/** Put select values, search text and the spoiler switch in line with state/progress. */
function syncControlsFromState() {
  $('search').value = state.query;
  $('grade-filter').value = state.grade;
  $('status-filter').value = state.status;
  $('sort-select').value = state.sort;
  $('spoiler-toggle').checked = progress.settings?.spoilers !== 'show';
}

// --- ?shot= hook for the screenshot script ------------------------------------

async function runScreenshotHook() {
  const shot = new URLSearchParams(location.search).get('shot');
  if (!shot) return;
  const api = {
    data,
    shot,
    setState(partial) {
      Object.assign(state, partial);
      if (partial.kinds && !(partial.kinds instanceof Set)) state.kinds = new Set(partial.kinds);
      syncControlsFromState();
      renderApp();
    },
    selectTrophy,
    setRoute: (route) => setRoute(route.startsWith('#') ? route : `#/${route}`),
    setProgress(next) { progress = next; saveProgress(progress); syncControlsFromState(); renderApp(); },
    setSettings,
  };
  try {
    const scenes = await import('./screenshot-scenes.js');
    await scenes.default(api, shot);
  } catch (err) {
    console.warn('screenshot scene failed:', err);
  }
  document.documentElement.dataset.shotReady = shot;
}
