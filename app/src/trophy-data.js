// trophy-data.js — loads ./data/trophies.json once per page, revalidates it with
// ETag / If-None-Match, keeps a localStorage copy for instant (and offline) repeat
// loads, and normalises it into {trophies, sources, meta, fromCache}.

export const GRADE_ORDER = ['platinum', 'gold', 'silver', 'bronze'];
export const GRADE_POINTS = { platinum: 300, gold: 90, silver: 30, bronze: 15 };
export const FILTER_KINDS = ['story', 'missable', 'collectibles', 'activities', 'online'];

const DATA_URL = './data/trophies.json';
const CACHE_KEY = 'platinum-run:data';
const KINDS = ['story', 'missable', 'collectible', 'activity', 'combat', 'exploration', 'economy', 'misc'];

let inFlight = null;

/** Fetch (or reuse) the trophy data. Concurrent callers share one request. */
export function loadTrophyData() {
  if (!inFlight) {
    inFlight = fetchTrophyData().catch((err) => {
      inFlight = null; // allow a later retry after a failure
      throw err;
    });
  }
  return inFlight;
}

/** Human label for a grade: 'gold' -> 'Gold'. */
export function gradeLabel(grade) {
  const g = String(grade || '');
  return g ? g[0].toUpperCase() + g.slice(1) : '';
}

/**
 * First-load stats for the footer: the files the page needed before the trophy data
 * (HTML, CSS, modules), re-read from the HTTP cache and gzipped in the browser with
 * CompressionStream, so the figure is honest whatever the server sent. Falls back to
 * raw bytes (labelled 'raw') where CompressionStream is missing.
 * Resolves {files, kb, unit:'gzip'|'raw'}.
 */
export async function measureFirstLoad(perf = globalThis.performance) {
  let urls = [];
  try {
    const entries = [...perf.getEntriesByType('navigation'), ...perf.getEntriesByType('resource')];
    // Page, stylesheet and module files only: skip fetch() calls (data, this measuring),
    // failed requests (e.g. a missing favicon) and the screenshot-only module.
    urls = entries
      .filter((e) => e.initiatorType !== 'fetch' && !(e.responseStatus >= 400))
      .map((e) => e.name.split('#')[0])
      .filter((u) => u.startsWith(location.origin) && !/\.json(\?|$)|favicon|screenshot-scenes/.test(u));
  } catch {
    return { files: 0, kb: 0, unit: 'raw' };
  }
  urls = [...new Set(urls)];
  const canGzip = typeof CompressionStream === 'function';
  const sizes = await Promise.all(urls.map(async (url) => {
    try {
      const body = await (await fetch(url, { cache: 'force-cache' })).arrayBuffer();
      if (!canGzip) return body.byteLength;
      const gz = new Blob([body]).stream().pipeThrough(new CompressionStream('gzip'));
      return (await new Response(gz).arrayBuffer()).byteLength;
    } catch {
      return 0;
    }
  }));
  const bytes = sizes.reduce((a, n) => a + n, 0);
  return { files: urls.length, kb: Math.round(bytes / 102.4) / 10, unit: canGzip ? 'gzip' : 'raw' };
}

// ---------------------------------------------------------------------------

async function fetchTrophyData() {
  const cached = readCache();
  const headers = {};
  if (cached && cached.etag) headers['If-None-Match'] = cached.etag;

  let res;
  try {
    res = await fetch(DATA_URL, { cache: 'no-cache', headers });
  } catch (err) {
    if (cached) return normaliseTrophyData(cached.json, true); // offline: use the stored copy
    throw err;
  }

  if (res.status === 304 && cached) return normaliseTrophyData(cached.json, true);
  if (!res.ok) {
    if (cached) return normaliseTrophyData(cached.json, true);
    throw new Error(`Trophy data failed to load (HTTP ${res.status})`);
  }

  const json = await res.json();
  writeCache({ etag: res.headers.get('ETag') || null, version: json.list || null, json });
  return normaliseTrophyData(json, false);
}

/** Turn raw JSON into the shape every view expects, filling safe defaults. */
export function normaliseTrophyData(json, fromCache = false) {
  const raw = Array.isArray(json && json.trophies) ? json.trophies : [];
  const trophies = raw
    .filter((t) => t && Number.isInteger(t.id))
    .map(normaliseTrophy)
    .sort((a, b) => a.id - b.id);
  const sources = json && typeof json.sources === 'object' && json.sources ? json.sources : {};
  const meta = {
    game: (json && json.game) || '',
    platform: (json && json.platform) || '',
    list: (json && json.list) || '',
  };
  return { trophies, sources, meta, fromCache };
}

function normaliseTrophy(t) {
  const grade = GRADE_ORDER.includes(t.grade) ? t.grade : 'bronze';
  const missable = t.missable === true || t.missable === 'risk' ? t.missable : false;
  return {
    id: t.id,
    name: String(t.name || ''),
    description: String(t.description || ''),
    grade,
    hidden: t.hidden === true,
    kind: KINDS.includes(t.kind) ? t.kind : 'misc',
    filters: Array.isArray(t.filters) ? t.filters.filter((f) => FILTER_KINDS.includes(f)) : [],
    chapter: t.chapter || null,
    missable,
    missableNote: t.missableNote || null,
    count: Number.isInteger(t.count) && t.count > 0 ? t.count : null,
    stage: Number.isInteger(t.stage) ? Math.min(5, Math.max(1, t.stage)) : 5,
    guide: String(t.guide || ''),
    steps: Array.isArray(t.steps) ? t.steps.map(String) : [],
    tips: Array.isArray(t.tips) ? t.tips.map(String) : [],
    cite: Array.isArray(t.cite) ? t.cite.map(String) : [],
  };
}

function readCache() {
  try {
    const parsed = JSON.parse(globalThis.localStorage.getItem(CACHE_KEY));
    return parsed && parsed.json && Array.isArray(parsed.json.trophies) ? parsed : null;
  } catch {
    return null;
  }
}

function writeCache(entry) {
  try {
    globalThis.localStorage.setItem(CACHE_KEY, JSON.stringify(entry));
  } catch {
    /* storage full or blocked: the app still works without the copy */
  }
}
