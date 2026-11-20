// progress-storage.js — saved trophy progress in localStorage, plus export to and
// import from a JSON file (validated, merged: union of earned, max of counters).

const STORAGE_KEY = 'platinum-run:v1';
export const PROGRESS_SCHEMA = 'platinum-run-progress/1';
const GRADES = ['platinum', 'gold', 'silver', 'bronze'];
const POINTS = { platinum: 300, gold: 90, silver: 30, bronze: 15 };

/** Read saved progress; corrupt or missing storage yields a fresh progress object. */
export function loadProgress() {
  try {
    return sanitiseProgress(JSON.parse(globalThis.localStorage.getItem(STORAGE_KEY)));
  } catch {
    return emptyProgress();
  }
}

/** Persist progress. Returns false when storage is unavailable. */
export function saveProgress(progress) {
  try {
    globalThis.localStorage.setItem(STORAGE_KEY, JSON.stringify(sanitiseProgress(progress)));
    return true;
  } catch {
    return false;
  }
}

/** Flip a trophy between earned (stamped with today's ISO date) and unearned. */
export function toggleEarned(progress, id, when = new Date()) {
  const earned = { ...progress.earned };
  if (earned[id]) delete earned[id];
  else earned[id] = when.toISOString();
  return { ...progress, earned };
}

/** Set a counter (e.g. collectibles found), clamped to 0..max when max is given. */
export function setCounter(progress, id, n, max = Infinity) {
  const value = clampCount(n, max);
  const counters = { ...progress.counters };
  if (value > 0) counters[id] = value;
  else delete counters[id];
  return { ...progress, counters };
}

/** True when every non-platinum trophy is earned (the platinum should pop now). */
export function platinumReady(trophies, progress) {
  const others = trophies.filter((t) => t.grade !== 'platinum');
  return others.length > 0 && others.every((t) => Boolean(progress.earned[t.id]));
}

/** Totals for the header ring and grade tally. */
export function progressSummary(trophies, progress) {
  const byGrade = {};
  for (const g of GRADES) byGrade[g] = { earned: 0, total: 0 };
  let earned = 0;
  let points = 0;
  let maxPoints = 0;
  for (const t of trophies) {
    const g = byGrade[t.grade] ? t.grade : 'bronze';
    byGrade[g].total += 1;
    maxPoints += POINTS[g];
    if (progress.earned[t.id]) {
      byGrade[g].earned += 1;
      earned += 1;
      points += POINTS[g];
    }
  }
  const total = trophies.length;
  const percent = total ? Math.round((earned / total) * 100) : 0;
  return { earned, total, byGrade, points, maxPoints, percent };
}

/** Download progress as platinum-run-progress-YYYY-MM-DD.json. Returns the file name. */
export function exportProgressFile(progress, when = new Date()) {
  const payload = {
    schema: PROGRESS_SCHEMA,
    exportedAt: when.toISOString(),
    game: 'Grand Theft Auto VI',
    ...sanitiseProgress(progress),
  };
  const fileName = `platinum-run-progress-${when.toISOString().slice(0, 10)}.json`;
  const blob = new Blob([JSON.stringify(payload, null, 1)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = fileName;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  return fileName;
}

/**
 * Read a progress file, validate it against the trophy list and merge it into the
 * current progress. Resolves {progress, imported, ignored, message}; rejects with a
 * readable Error when the file is not a Platinum Run progress file.
 */
export async function importProgressFile(file, { trophies = [], current = loadProgress() } = {}) {
  const text = typeof file.text === 'function' ? await file.text() : await readAsText(file);
  const parsed = parseProgressFile(text, trophies);
  const progress = mergeProgress(current, parsed.progress);
  const message =
    `Imported ${parsed.imported} trophies` +
    (parsed.ignored ? ` · ${parsed.ignored} unknown ids ignored` : '');
  return { progress, imported: parsed.imported, ignored: parsed.ignored, message };
}

/** Validate exported JSON text. Unknown ids are dropped and counted. */
export function parseProgressFile(text, trophies) {
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    throw new Error('That file is not valid JSON.');
  }
  if (!data || data.schema !== PROGRESS_SCHEMA) {
    throw new Error('That file is not a Platinum Run progress export.');
  }
  const byId = new Map(trophies.map((t) => [String(t.id), t]));
  const known = (id) => (byId.size ? byId.has(String(id)) : /^\d+$/.test(String(id)));
  const ignoredIds = new Set();
  const touched = new Set();
  const earned = {};
  const counters = {};

  for (const [id, date] of Object.entries(isObject(data.earned) ? data.earned : {})) {
    if (!known(id)) { ignoredIds.add(id); continue; }
    if (!date) continue;
    earned[id] = validDate(date);
    touched.add(id);
  }
  for (const [id, n] of Object.entries(isObject(data.counters) ? data.counters : {})) {
    if (!known(id)) { ignoredIds.add(id); continue; }
    const t = byId.get(String(id));
    const value = clampCount(n, t && t.count ? t.count : Infinity);
    if (value > 0) { counters[id] = value; touched.add(id); }
  }
  const settings = isObject(data.settings) ? cleanSettings(data.settings) : {};
  return {
    progress: { earned, counters, settings },
    imported: touched.size,
    ignored: ignoredIds.size,
  };
}

/** Merge two progress objects: union of earned (earliest date wins), max of counters. */
export function mergeProgress(base, incoming) {
  const a = sanitiseProgress(base);
  const b = sanitiseProgress(incoming);
  const earned = { ...a.earned };
  for (const [id, date] of Object.entries(b.earned)) {
    if (!earned[id] || date < earned[id]) earned[id] = date;
  }
  const counters = { ...a.counters };
  for (const [id, n] of Object.entries(b.counters)) counters[id] = Math.max(counters[id] || 0, n);
  return { earned, counters, settings: { ...a.settings } }; // keep this device's settings
}

// ---------------------------------------------------------------------------

function emptyProgress() {
  return { earned: {}, counters: {}, settings: { spoilers: 'hide' } };
}

function sanitiseProgress(p) {
  const out = emptyProgress();
  if (!isObject(p)) return out;
  if (isObject(p.earned)) {
    for (const [id, date] of Object.entries(p.earned)) if (date) out.earned[id] = validDate(date);
  }
  if (isObject(p.counters)) {
    for (const [id, n] of Object.entries(p.counters)) {
      const v = clampCount(n, Infinity);
      if (v > 0) out.counters[id] = v;
    }
  }
  if (isObject(p.settings)) out.settings = { ...out.settings, ...cleanSettings(p.settings) };
  return out;
}

function cleanSettings(s) {
  const out = { ...s };
  if (out.spoilers !== 'hide' && out.spoilers !== 'show') delete out.spoilers;
  return out;
}

function clampCount(n, max) {
  const v = Math.floor(Number(n));
  if (!Number.isFinite(v) || v < 0) return 0;
  return Math.min(v, max);
}

function validDate(d) {
  const t = Date.parse(d);
  return Number.isNaN(t) ? new Date().toISOString() : new Date(t).toISOString();
}

function isObject(v) {
  return v !== null && typeof v === 'object' && !Array.isArray(v);
}

function readAsText(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(new Error('Could not read that file.'));
    reader.readAsText(file);
  });
}
