// Spoiler shield: decides which trophies stay masked and what to show instead.
// A trophy is masked while it is unearned and either (a) a story trophy with the
// "Hide story spoilers" setting on, or (b) hidden by PlayStation itself.

/** True when this trophy's real name/description must not be shown yet. */
export function isSpoilerHidden(trophy, progress) {
  if (!trophy) return false;
  if (progress?.earned?.[trophy.id]) return false;
  if (spoilerSetting(progress) === 'show') return false;
  return isStoryTrophy(trophy) || trophy.hidden === true;
}

/** Replacement title, e.g. "Hidden story trophy · Chapter 3". */
export function maskedName(trophy) {
  const label = isStoryTrophy(trophy) ? 'Hidden story trophy' : 'Hidden trophy';
  const chapter = chapterLabel(trophy);
  return chapter ? `${label} · ${chapter}` : label;
}

/** Replacement description that says when, never what. */
export function maskedDescription(trophy) {
  const chapter = chapterLabel(trophy);
  const when = chapter ? `Unlocks during ${chapter} of the story.` :
    isStoryTrophy(trophy) ? 'Unlocks as the story progresses.' : 'Details stay hidden until you earn it.';
  return `${when} Earn it, or untick “Hide story spoilers”, to reveal it.`;
}

/** Display-safe name + description for any trophy (real text, or the masked pair). */
export function spoilerSafeText(trophy, progress) {
  return isSpoilerHidden(trophy, progress)
    ? { name: maskedName(trophy), description: maskedDescription(trophy), masked: true }
    : { name: trophy.name, description: trophy.description, masked: false };
}

/** Current spoiler setting; defaults to 'hide' so a fresh visitor sees no spoilers. */
export function spoilerSetting(progress) {
  return progress?.settings?.spoilers === 'show' ? 'show' : 'hide';
}

/** Story-mission trophy (by filter tag or kind). */
export function isStoryTrophy(trophy) {
  return trophy?.kind === 'story' || (Array.isArray(trophy?.filters) && trophy.filters.includes('story'));
}

/** Only the spoiler-free "Chapter N" part of a chapter field like "Chapter 2 · Breakfast Run". */
export function chapterLabel(trophy) {
  const m = /chapter\s*(\d+)/i.exec(trophy?.chapter || '');
  return m ? `Chapter ${m[1]}` : '';
}
