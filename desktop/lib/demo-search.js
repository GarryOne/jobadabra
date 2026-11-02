// Demo mode's Find jobs: the engine step of a search plays a short script of fictional log lines (about 25 s), so the Find jobs card, the task, the
// log and the list all run for real on made-up work. Nothing is read and nothing leaves the Mac. The product media (hero video) records this.
// Owns: the script, which engine steps it replaces, and the fresh demo's empty list. Guarded by: test/find-first-run.test.js.

// [wait before the line (ms), the engine's line]: first jobs, every employer, the job boards, more employers, in the engine's own words and counts.
export const SCRIPT = [
  [600, 'Finding your first jobs…'],
  [1800, 'First jobs: reading 15 of 212 employer sites first'],
  [2200, 'First jobs: 4 found'],
  [300, 'Run counts: looked=240 matches=4 scored=0'],
  [1800, 'Scored 1 of 3 job(s)'],
  [300, 'Run counts: looked=388 matches=9 scored=1 good=1'],
  [1500, 'Scored 3 of 3 job(s)'],
  [300, 'Run counts: looked=612 matches=9 scored=3 good=2'],
  [1200, 'First jobs: 3 scored in 12 s; the full search goes on'],
  [1500, '⏳ Reading employer job sites: 310 of 2251 · 22,480 jobs listed'],
  [300, 'Run counts: looked=22480 matches=12 scored=3 good=2'],
  [1800, '⏳ Reading employer job sites: 940 of 2251 · 61,300 jobs listed'],
  [300, 'Run counts: looked=61300 matches=17 scored=5 good=2'],
  [1800, '⏳ Reading employer job sites: 1620 of 2251 · 104,900 jobs listed'],
  [300, 'Run counts: looked=104900 matches=24 scored=8 good=3'],
  [1800, '⏳ Reading employer job sites: 2251 of 2251 · 135,769 jobs listed'],
  [300, 'Run counts: looked=135769 matches=31 scored=14 good=4'],
  [1500, 'Searching job boards…'],
  [1800, 'Run counts: looked=135769 matches=31 scored=24 good=6'],
  [1500, 'Growing your sources: finding more employers…'],
  [1500, 'Run counts: looked=135769 matches=31 scored=31 good=7'],
];

export const isSearchRun = args => args[0] === 'src' && args[1] === 'daily';
// The steps around the engine's daily run (the job boards, the finder) end at once and silently: the script already told their story.
export const isQuietStep = args => args[0] === 'src' && ['discover', 'scout'].includes(args[1]);

// How long the script lasts: about 25 s, or JOBADABRA_DEMO_SEARCH_SECONDS seconds when that is a positive number (the hero video plays a short one).
export const SECONDS_ENV = 'JOBADABRA_DEMO_SEARCH_SECONDS';
const TOTAL_MS = SCRIPT.reduce((sum, [wait]) => sum + wait, 0);
export const scaleFor = (env = process.env) => { const seconds = Number(env[SECONDS_ENV]); return seconds > 0 && Number.isFinite(seconds) ? seconds * 1000 / TOTAL_MS : 1; };

export async function play(onLine, {sleep = ms => new Promise(resolve => setTimeout(resolve, ms)), env = process.env} = {}) {
  const scale = scaleFor(env);
  for (const [wait, line] of SCRIPT) { await sleep(Math.round(wait * scale)); onLine(line); }
  return {code: 0, stdout: '', result: null};
}

// A fresh demo (its settings say no search ran yet) lists no jobs until its search has run; the usual demo, which has a last search, is untouched.
export const hideJobsUntilSearched = (data, settings = {}) => (settings.lastSearchAt ? data : {...data, jobs: [], total: 0, filtered: 0});
