// Trophy filters: chip kinds (OR within the group), AND-combined with grade,
// status and search; plus sorting and the counts shown on the filter chips.
import { isSpoilerHidden, maskedName, chapterLabel } from './spoiler-shield.js';
import { storyOrderKey } from './roadmap-builder.js';

const FILTER_KIND_LIST = ['story', 'missable', 'collectibles', 'activities', 'online'];
const GRADE_RANK = { platinum: 0, gold: 1, silver: 2, bronze: 3 };

/**
 * Filter + sort trophies for the list.
 * state = {kinds:Set, grade:'all'|grade, status:'all'|'earned'|'unearned', query:'', sort:'roadmap'|'list'|'grade'}
 */
export function applyTrophyFilters(trophies, progress, state = {}) {
  const kinds = state.kinds instanceof Set ? state.kinds : new Set(state.kinds || []);
  const grade = state.grade || 'all';
  const status = state.status || 'all';
  const query = state.query || '';
  const result = trophies.filter((t) =>
    matchesKinds(t, kinds) &&
    (grade === 'all' || t.grade === grade) &&
    matchesStatus(t, progress, status) &&
    matchesSearch(t, query, progress));
  return sortTrophies(result, state.sort || 'roadmap');
}

/** Badge counts per chip (plus all/earned/unearned totals). */
export function countByFilter(trophies, progress) {
  const counts = { all: trophies.length, earned: 0, unearned: 0 };
  for (const kind of FILTER_KIND_LIST) counts[kind] = 0;
  for (const t of trophies) {
    for (const kind of trophyFilterKinds(t)) if (kind in counts) counts[kind]++;
    if (isEarned(t, progress)) counts.earned++; else counts.unearned++;
  }
  return counts;
}

/**
 * Case-insensitive search over name, description, chapter and guide text.
 * Spoiler-hidden trophies match only on their masked name, "Chapter N" and grade.
 */
export function matchesSearch(trophy, query, progress) {
  const words = normalise(query).split(' ').filter(Boolean);
  if (!words.length) return true;
  const fields = isSpoilerHidden(trophy, progress)
    ? [maskedName(trophy), chapterLabel(trophy), trophy.grade]
    : [trophy.name, trophy.description, trophy.chapter, trophy.guide, trophy.grade,
       ...(trophy.steps || []), ...(trophy.tips || [])];
  const haystack = normalise(fields.filter(Boolean).join(' '));
  return words.every((w) => haystack.includes(w));
}

/** Sort a copy: 'roadmap' = stage, story order, id; 'grade' = platinum→bronze, id; 'list' = id. */
export function sortTrophies(trophies, sort) {
  const list = trophies.slice();
  if (sort === 'list') return list.sort((a, b) => a.id - b.id);
  if (sort === 'grade') {
    return list.sort((a, b) => (GRADE_RANK[a.grade] ?? 9) - (GRADE_RANK[b.grade] ?? 9) || a.id - b.id);
  }
  return list.sort((a, b) => (a.stage ?? 9) - (b.stage ?? 9) || storyOrderKey(a) - storyOrderKey(b) || a.id - b.id);
}

/** Filter chip kinds a trophy belongs to (from data, with a fallback from kind/missable). */
export function trophyFilterKinds(trophy) {
  if (Array.isArray(trophy.filters)) return trophy.filters;
  const kinds = [];
  if (trophy.kind === 'story') kinds.push('story');
  if (trophy.missable === true || trophy.missable === 'risk') kinds.push('missable');
  if (trophy.kind === 'collectible') kinds.push('collectibles');
  if (trophy.kind === 'activity') kinds.push('activities');
  return kinds;
}

function matchesKinds(trophy, kinds) {
  if (!kinds.size) return true;
  return trophyFilterKinds(trophy).some((k) => kinds.has(k));
}

function matchesStatus(trophy, progress, status) {
  if (status === 'earned') return isEarned(trophy, progress);
  if (status === 'unearned') return !isEarned(trophy, progress);
  return true;
}

function isEarned(trophy, progress) {
  return Boolean(progress?.earned?.[trophy.id]);
}

function normalise(text) {
  return String(text || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/[’‘]/g, "'").replace(/[^a-z0-9'$%]+/g, ' ').trim();
}
