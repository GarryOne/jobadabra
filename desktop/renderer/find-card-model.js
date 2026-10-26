// The "Find jobs" card on top of Jobs, as data (pure): which of its five states shows (empty first run, searching, done, failed, none), the step chips
// with the one that is running, the last lines in words, and the one number (jobs added). Drawn by pages/jobs-find.js. Guarded by: test/find-card.test.js.
// Spec: docs/superpowers/specs/2026-10-16-first-jobs-fast.md
import {readableLog} from './human-log.js';
import {hasFullReport} from './searches-view.js';

// A first run reads a slice and scores 3 jobs first; the usual run starts with the employer sites. The latest line that matches a step is the
// running one. The job boards are read beside the employer sites (src/sources/boards_ahead.py, the web search from second 0), so their chip
// is not moved by the others' order: it runs from its first line or the employer read, and shows ✓ only on the engine's "Job boards: done"
// (src/sources/aggregators.py scan) or once a step after it starts (owner, 26 Oct 2026: ✓ showed before the boards a web search found were read).
export const FIRST = /^(Finding your first jobs|First jobs:)/;
const EMPLOYERS = /^(Checking employer|Reading employer|⏳ Reading employer|Titles:|Places:|⏳ Scoring|Scored |Added |Job Matches)/;
const BOARDS = {label: 'Job boards', match: /^(Searching job boards|Job boards( found| first)?:|⏳ Reading job boards)/, done: /^Job boards: done\b/, beside: true};
const MORE = /^(Growing your sources|Source scout|🔭)/;
const WEB = {label: 'Web search', web: true, beside: true};   // its own chip, beside the others (webSearchChip)
const SLICE_END = /^First jobs: (\d+ scored|\d+ found, none to score)/;
const STEPS = {
  first: [{label: 'First jobs', match: FIRST}, WEB, {label: 'All employers', match: EMPLOYERS}, BOARDS, {label: 'More employers', match: MORE}],
  usual: [WEB, BOARDS, {label: 'Employer sites', match: EMPLOYERS}, {label: 'More employers', match: MORE}],
};

export function stepChips(log = []) {
  const first = log.some(line => FIRST.test(String(line)));
  const steps = STEPS[first ? 'first' : 'usual'], order = steps.filter(step => !step.beside);   // the steps that follow each other
  let active = 0, sliceDone = !first, boardsSeen = false, boardsDone = false;   // the slice reads feeds and scores too: its own lines are not the "All employers" step
  for (const raw of log) {
    const line = String(raw);
    if (SLICE_END.test(line)) sliceDone = true;
    if (BOARDS.match.test(line)) boardsSeen = true;
    if (BOARDS.done.test(line)) boardsDone = true;
    order.forEach(({match}, i) => { if (match.test(line) && i >= active && (sliceDone || i === 0 || i > 1)) active = i; });
  }
  const employers = order.findIndex(step => step.match === EMPLOYERS);
  const state = i => (i < active ? 'done' : i === active ? 'active' : 'pending');
  const web = webSearchChip(log), last = active === order.length - 1;   // a search that never said a word about it, at its last step: not run
  return steps.map(step => (step.web ? (web.state === 'pending' && last ? {label: 'Web search · not run', state: 'skipped'} : web) : {label: step.label, state: !step.beside ? state(order.indexOf(step))
    : boardsDone || last ? 'done' : boardsSeen || active >= employers ? 'active' : 'pending'}));
}

// The web search's own chip (owner, 26 Oct 2026: "why I don't see here a chip with Web Search?"), its state in words from the engine's lines
// (src/sources/board_web.py): searching, the boards it found, rested until its next date (when it last searched in the note), off (why in the
// note) or no answer. Guarded by: test/live-updates.test.js.
const day = iso => new Date(iso).toLocaleDateString('en-GB', {day: 'numeric', month: 'short'});
const clock = iso => new Date(iso).toLocaleTimeString('en-GB', {hour: '2-digit', minute: '2-digit'});
const boardCount = names => names.replace(/\([^)]*\)/g, '').split(',').filter(name => name.trim()).length;   // "A (x, y), B" is 2 boards
const SAME_RUN = /^Job boards: no web search: searched in this run/;
export function webSearchChip(log = []) {
  let chip = {label: 'Web search', state: 'pending'}, m;
  for (const raw of log) {
    const line = String(raw);
    if (SAME_RUN.test(line)) continue;   // a second ask in this run: no news
    if (/^Job boards: (searching the web|the web search is still searching)/.test(line)) chip = {label: 'Web search', state: 'active'};
    else if ((m = /^Job boards: a web search found (.+)$/.exec(line))) {
      const n = /^no trade or local board/.test(m[1]) ? 0 : boardCount(m[1]);
      chip = {label: `Web search · ${n ? `${n} board${n === 1 ? '' : 's'} found` : 'none found'}`, state: 'done', note: m[1]};
    } else if ((m = /^Job boards: no web search: searched (\S+), next after (\S+?);/.exec(line))) {
      chip = {label: `Web search · rested until ${day(m[2])}`, state: 'skipped', note: `Searched ${day(m[1])}, ${clock(m[1])}; searches again after ${day(m[2])}`};
    } else if ((m = /^Job boards: no web search: (.+)$/.exec(line))) {
      chip = {label: /^searched lately/.test(m[1]) ? 'Web search · rested' : 'Web search · off', state: 'skipped', note: m[1]};
    } else if (/^Job boards: the web search .*did not answer/.test(line)) chip = {label: 'Web search · no answer', state: 'failed', note: line.replace(/^Job boards: /, '')};
  }
  return chip;
}

// Live updates (owner, 26 Oct 2026: "Keep each step's result visible: 'web search found…', 'boards read', 'employers stopped'"): every step's
// result line of this run, in words, kept until it ends, then the newest progress tick, last; ticks replace each other. A result is a line the
// engine starts with a step's name (and the scoring, added and digest lines); per-item lines (one employer, one job, one AI answer) are the
// technical log's, in Recent activity. Guarded by: test/live-updates.test.js.
const RESULT = /^((First jobs|Job boards|Job boards found|Job boards first|Employers|Titles|Places|Source scout|Warning): |Scored \d+ of |Added \d+ new job|Digest ready|⏱ Time is up \()/;
export function liveLines(log = []) {
  const results = [], tick = [];
  let matches = 0;
  for (const raw of log) {
    const line = String(raw);
    if (/^⏳ (?!Still running)/.test(line)) tick[0] = line;
    else if (RESULT.test(line) && !SAME_RUN.test(line)) results.push(line);
    else if (COUNTS.test(line)) matches = Number(COUNTS.exec(line)[2]);
  }
  // the tick says the jobs that match so far (owner, 26 Oct 2026: "13 pilot jobs found" showed nowhere while 1,221 listings were read)
  if (tick[0] && matches) tick[0] += ` · ${matches.toLocaleString('en-US')} match your search so far`;
  return readableLog([...results, ...tick]);
}

// This search's own numbers: the engine's last "Run counts: looked=N matches=M scored=K" line (src/run_counts.py, each job once by its URL).
const COUNTS = /^Run counts: looked=(\d+) matches=(\d+) scored=(\d+)(?: good=(\d+))?\s*$/;
export function runCounts(log = []) {
  for (let i = log.length - 1; i >= 0; i--) {
    const found = COUNTS.exec(String(log[i]));
    if (found) return {looked: Number(found[1]), matches: Number(found[2]), scored: Number(found[3]), good: Number(found[4] || 0)};
  }
  return {looked: 0, matches: 0, scored: 0, good: 0};
}

// The one number a run result shows (owner, 24 Oct 2026: "jobs added to the list", scoring and its queue are internal): the jobs this run added to the
// user's list. A finished run has its own record (run.new); a running one adds up the engine's "Added N new job(s)" lines (src/daily_search.py).
export function addedSoFar(log = []) {
  return (log || []).reduce((sum, line) => sum + Number((/^Added (\d+) new job/.exec(String(line)) || [])[1] || 0), 0);
}
export const addedWords = n => (n ? `${n.toLocaleString('en-US')} job${n === 1 ? '' : 's'} added to your list` : 'No jobs added to your list');

// The employer read as progress: the latest "Reading employer job sites: 1953 of 2251" ticker line (src/progress.py), or null before it starts.
// When time ran out, the engine's "Employers: read 78 of 608 sites in the time" ends the bar there, not at the last tick (owner, 26 Oct 2026).
export function employersRead(log = []) {
  for (let i = log.length - 1; i >= 0; i--) {
    const stopped = /^Employers: read (\d+) of (\d+) sites in the time/.exec(String(log[i]));
    if (stopped) return {done: Number(stopped[1]), total: Number(stopped[2]), stopped: true};
    const found = /Reading employer job sites: (\d+) of (\d+)/.exec(String(log[i]));
    if (found) return {done: Number(found[1]), total: Number(found[2])};
  }
  return null;
}

// The bar under the numbers: counted once the engine says "N of M" employers, a sliding bar before (the search is working, the count is not known yet).
export const readProgressModel = employers => (employers
  ? {kind: 'count', done: employers.done, total: employers.total, percent: employers.total ? Math.max(2, Math.min(100, Math.round(100 * employers.done / employers.total))) : 2}
  : {kind: 'indeterminate'});

// running: window.pilot.runs().running; last: the newest finished search run; listed/scored: the Jobs list's counts (kept for the none state); finishedHere: a search ended while this window was open.
export function findCard({running = null, last = null, lastSearchAt = '', listed = 0, scored = 0, finishedHere = false} = {}) {
  const searching = running && (running.kind || 'search') === 'search';
  if (searching) {
    const log = running.log || [];
    return {state: 'searching', chips: stepChips(log), lines: liveLines(log), ...runCounts(log), added: addedSoFar(log), employers: employersRead(log), first: log.some(line => FIRST.test(String(line)))};
  }
  if (last && last.ok === false && (finishedHere || !listed)) return {state: 'failed', problem: last.problem || last.result || '', listed};
  if (finishedHere && last) return {state: 'done', listed, runId: hasFullReport(last) ? last.pageId : null, added: last.new ?? addedSoFar(last.log), ...runCounts(last.log)};
  if (!lastSearchAt && !listed) return {state: 'empty'};
  return {state: 'none'};
}
