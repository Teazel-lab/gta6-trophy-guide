// Roadmap builder: the 5-stage path to the platinum, the missable list in story
// order, and missable signals read straight from the official descriptions.
import { isSpoilerHidden, maskedName } from './spoiler-shield.js';

/** The five roadmap stages, in play order (titles + our own summaries). */
export const ROADMAP_STAGES = [
  { stage: 1, title: 'Story run — grab these on the way',
    summary: 'Play the main story start to finish and pick up every mission and chapter trophy as it comes. Watch the missable warnings so nothing tied to a one-off moment slips past.' },
  { stage: 2, title: 'Collectibles sweep',
    summary: 'With the whole map open, clear the count-based sets in one tidy loop. Work region by region so cards, WAiNK spots, meditation points and vehicles all tick up together.' },
  { stage: 3, title: 'Activities, ranges & races',
    summary: 'Turn to the side content: shooting ranges, drone and street races, fishing and the arcade. These reward practice rather than story progress, so take them at your own pace.' },
  { stage: 4, title: 'Strangers & loose ends',
    summary: 'Finish the stranger strands and mop up the one-off feats, heists and spending goals. Check the list for anything still unearned before the final push.' },
  { stage: 5, title: '100% and the platinum',
    summary: 'Use the in-game completion checklist to close the last gaps to 100%. The platinum pops once every other trophy is in the bag.' },
];

/**
 * Stages with their trophies and progress.
 * -> [{stage, title, summary, trophyIds, done, total}]
 * stageTexts (optional) overrides titles/summaries by stage number.
 */
export function buildPlatinumRoadmap(trophies, progress, stageTexts = null) {
  const stages = ROADMAP_STAGES.map((s) => ({ ...s, ...(stageTexts?.[s.stage] || {}), trophyIds: [], done: 0, total: 0 }));
  const ordered = trophies.slice().sort((a, b) => storyOrderKey(a) - storyOrderKey(b));
  for (const t of ordered) {
    const stage = stages[clampStage(stageOf(t)) - 1];
    stage.trophyIds.push(t.id);
    stage.total++;
    if (progress?.earned?.[t.id]) stage.done++;
  }
  return stages;
}

/**
 * Missable trophies (missable true or 'risk') in story order.
 * -> [{id, name, chapter, note, risk:'missable'|'risk'}]
 * Pass progress to get spoiler-masked names for hidden story trophies.
 */
export function listMissables(trophies, progress = null) {
  return trophies
    .filter((t) => t.missable === true || t.missable === 'risk')
    .sort((a, b) => storyOrderKey(a) - storyOrderKey(b))
    .map((t) => ({
      id: t.id,
      name: progress && isSpoilerHidden(t, progress) ? maskedName(t) : t.name,
      chapter: t.chapter || null,
      note: t.missableNote || null,
      risk: t.missable === true ? 'missable' : 'risk',
    }));
}

/** Sortable story position: chapter number (final mission last, no chapter after that), then id. */
export function storyOrderKey(trophy) {
  return chapterNumber(trophy) * 1000 + (Number(trophy.id) || 0);
}

/**
 * Secondary missable signal derived only from the official descriptions.
 * -> [{id, signal, risk:'missable'|'risk'|null, chapter, reason}] in story order.
 * signal: 'chapter' | 'mission' | 'story-finale' | 'strand-finale' | 'mission-location' | 'one-time'.
 * risk null = tied to the story but cannot be missed (still useful as a timeline marker).
 */
export function missableWarningsFromDescriptions(trophies) {
  const missionNames = trophies.map((t) => namedMission(t.description)).filter(Boolean);
  const flags = [];
  for (const t of trophies) {
    const d = t.description || '';
    const chapter = /\bChapter (\d+)\b/.exec(d);
    const finale = /\bfinal mission\b(?: for ([A-Z][\w'-]*))?/.exec(d);
    const mission = namedMission(d);
    const place = missionNames.find((m) => m !== mission && mentionsMissionPlace(d, m));
    let flag = null;
    if (finale && finale[1]) {
      flag = { signal: 'strand-finale', risk: 'risk', reason: `Ends ${finale[1]}'s strand; finish it before the credits in case the strand closes.` };
    } else if (finale) {
      flag = { signal: 'story-finale', risk: null, reason: 'Point of no return: clear story-tied risks before starting it.' };
    } else if (chapter) {
      flag = { signal: 'chapter', risk: null, reason: `Story progress: awarded for finishing Chapter ${chapter[1]}.` };
    } else if (mission) {
      flag = { signal: 'mission', risk: null, reason: `Story mission "${mission}" — unlocks on completion.` };
    } else if (place) {
      flag = { signal: 'mission-location', risk: 'risk', reason: `Mentions a place from the mission "${place}"; may only be possible during it.` };
    } else if (ONE_TIME_PATTERN.test(d)) {
      flag = { signal: 'one-time', risk: 'risk', reason: 'Wording points to a one-off moment or choice; read the guide before that scene.' };
    }
    if (flag) flags.push({ id: t.id, name: t.name, chapter: t.chapter || (chapter ? `Chapter ${chapter[1]}` : null), ...flag });
  }
  return flags.sort((a, b) => storyOrderKey(a) - storyOrderKey(b));
}

const ONE_TIME_PATTERN = /\b(choices? made|for better or worse|second time|unscheduled|what the hell just happened)\b/i;

function namedMission(description) {
  const m = /^Complete (?!the final|Chapter|\d)([A-Z][^.]*)\.$/.exec(description || '');
  return m ? m[1] : null;
}

function mentionsMissionPlace(description, mission) {
  // Upper-case tokens (e.g. "VCIA") shared between a description and a mission name.
  const tokens = mission.match(/\b[A-Z]{3,}\b/g) || [];
  return tokens.some((tok) => new RegExp(`\\b${tok}\\b`).test(description));
}

function chapterNumber(trophy) {
  const text = `${trophy.chapter || ''}`;
  const m = /chapter\s*(\d+)/i.exec(text) || /\bChapter (\d+)\b/.exec(trophy.description || '');
  if (m) return Number(m[1]);
  if (/final/i.test(text) || /^Complete the final mission\.$/.test(trophy.description || '')) return 90;
  return 99;
}

function stageOf(trophy) {
  if (Number.isFinite(trophy.stage)) return trophy.stage;
  if (trophy.grade === 'platinum') return 5;
  return { story: 1, missable: 1, collectible: 2, activity: 3 }[trophy.kind] || 4;
}

function clampStage(n) {
  return Math.min(5, Math.max(1, Math.round(n)));
}
