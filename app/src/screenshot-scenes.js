// Screenshot scenes, loaded only with ?shot=<name> (tools/take-screenshots.mjs).
// Each scene puts the real app into a realistic state through the shell's api,
// then sets document.title = 'shot-ready' once everything has rendered.

/** Run scene `shot` against the app-shell api. */
export default async function runScreenshotScene(api, shot) {
  const scene = SCENES[shot] || SCENES.tracker;
  await scene(api);
  await waitForLoadStats();
  await nextFrames(3);
  document.title = 'shot-ready';
}

const SCENES = {
  /** Checklist + filters + header progress + open guide (Positive Mental Attitude) with sources. */
  async tracker(api) {
    api.setProgress(midRunProgress('show'));
    api.setState({ kinds: [], grade: 'all', status: 'all', query: '', sort: 'roadmap' });
    api.setRoute('#/list');
    api.selectTrophy(28);
    alignRowToTop(12); // a few story rows above Stage 2, no half-cut row at the top
  },

  /** Roadmap tab: five stage cards + the missable panel. */
  async roadmap(api) {
    api.setProgress(midRunProgress('show'));
    api.setState({ kinds: [], sort: 'roadmap' });
    api.setRoute('#/roadmap');
    document.getElementById('roadmap')?.scrollTo?.(0, 0);
  },

  /** Spoilers hidden, Story + Missable chips on, guide on a masked story trophy. */
  async spoilers(api) {
    api.setProgress(midRunProgress('hide', [2, 3, 8, 20, 21, 30, 24]));
    api.setState({ kinds: ['story'], grade: 'all', status: 'unearned', sort: 'roadmap' });
    api.setRoute('#/list');
    api.setState({ kinds: ['story', 'missable'] });
    api.selectTrophy(10);
    scrollListTo(10);
  },

  /** A real import through the file input → toast; Collectibles chip; counter guide. */
  async import(api) {
    api.setProgress({ earned: {}, counters: {}, settings: { spoilers: 'show' } });
    api.setState({ kinds: ['collectibles'], grade: 'all', status: 'all', sort: 'roadmap' });
    api.setRoute('#/list');
    api.selectTrophy(31);
    const exported = { schema: 'platinum-run-progress/1', exportedAt: '2026-11-20T21:04:00.000Z', game: 'Grand Theft Auto VI', ...midRunProgress('show') };
    const file = new File([JSON.stringify(exported)], 'platinum-run-progress-2026-11-20.json', { type: 'application/json' });
    const input = document.getElementById('import-file');
    const transfer = new DataTransfer();
    transfer.items.add(file);
    input.files = transfer.files;
    input.dispatchEvent(new Event('change'));
    await waitFor(() => /Imported \d+ trophies/.test(document.getElementById('toast')?.textContent || ''));
    scrollListTo(31);
  },
};

/** ~22 earned: story chapters 1–3, early side content, some collectibles part-way. */
function midRunProgress(spoilers, onlyEarned = null) {
  const earnedIds = onlyEarned || [2, 3, 4, 5, 8, 9, 20, 21, 22, 24, 27, 29, 30, 33, 36, 37, 39, 44, 46, 49, 54, 18];
  const earned = {};
  earnedIds.forEach((id, i) => {
    earned[id] = new Date(Date.UTC(2026, 10, 19, 20) + i * 3.1e6).toISOString();
  });
  const counters = { 31: 37, 15: 112, 35: 64, 42: 30, 17: 18, 28: 9, 25: 3, 23: 4, 26: 7, 32: 21, 34: 2 };
  for (const [id, n] of Object.entries({ 30: 3, 46: 3, 54: 8, 36: 5, 18: 14 })) if (earned[id]) counters[id] = n;
  return { earned, counters, settings: { spoilers } };
}

function scrollListTo(id) {
  const row = document.querySelector(`#trophy-list .trophy-row[data-id="${id}"]`);
  row?.scrollIntoView({ block: 'center' });
}

/** Scroll the list so row `id` sits just under the sticky view tabs. */
function alignRowToTop(id) {
  const row = document.querySelector(`#trophy-list .trophy-row[data-id="${id}"]`);
  const main = document.querySelector('.trophy-main');
  const tabs = document.querySelector('.view-tabs');
  if (!row || !main || !tabs) return;
  main.scrollTop += row.getBoundingClientRect().top - tabs.getBoundingClientRect().bottom - 8;
}

function waitForLoadStats() {
  return waitFor(() => /First load:/.test(document.getElementById('load-stats')?.textContent || ''), 4000);
}

async function waitFor(test, timeout = 3000) {
  const start = performance.now();
  while (!test() && performance.now() - start < timeout) await nextFrames(1);
}

function nextFrames(n) {
  return new Promise((resolve) => {
    const step = () => (n-- <= 0 ? resolve() : requestAnimationFrame(step));
    step();
  });
}
