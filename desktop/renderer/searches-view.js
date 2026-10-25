// Reports → Searches, the logic without a window (owner, 25 Oct 2026: "all the numbers in the world, how the search was performed"): a list
// row per search run and the sections of one run's full report, from a store run record (src/stores CRON_RUN_FIELDS) and its `details`
// (src/run_details.py: steps, jobs, employers, boards, AI, scoring, problems). Every part is optional: a run from before the details were
// kept shows its totals and says so. Drawn by pages/reports-searches.js. Guarded by test/searches-view.test.js.
export const SEARCH_MODES = ['scheduled', 'run', 'first', 'visits', 'scout'];   // the runs that search: Find jobs (any trigger), in the browser, more employers
export const KEPT = 50;                                                          // runs listed (owner, 25 Oct 2026)
const NAMES = {scheduled: 'Find jobs', run: 'Find jobs', first: 'First jobs', visits: 'Find jobs using your browser', scout: 'More employers'};
const WHERE = {mac: 'This Mac', github: 'GitHub', cloud: 'In the cloud'};
const STAGES = {enrich: 'Reading jobs with AI', kits: 'Kits', insight: 'Insights', interview: 'Interviews', mail: 'Emails', sources: 'Reading sources'};
const TONES = {OK: 'good', Quiet: 'neutral', Warnings: 'warn', Failed: 'bad', Running: 'info'};
const n = value => (value === null || value === undefined || value === '' ? null : Number(value).toLocaleString('en-US'));
const some = pairs => pairs.filter(([, value]) => value !== null && value !== undefined && value !== '');

export const isSearchRun = row => SEARCH_MODES.includes(row?.mode || row?.kind);
// A run card or drawer entry links to its full report when it is a finished search run the store keeps (an app-side activity kind: renderer/pages/activity-basics.js KIND).
export const REPORT_KINDS = ['search', 'visits', 'scout'];
export const hasFullReport = run => !!run && !run.live && !!run.pageId && REPORT_KINDS.includes(run.kind);
export const kindName = row => NAMES[row?.mode || row?.kind] || 'Search';
export const secondsOf = row => row?.stats?.duration_s ?? (row?.finished_at && row?.started_at ? Math.round((Date.parse(row.finished_at) - Date.parse(row.started_at)) / 1000) : null);
export const duration = seconds => (seconds === null || seconds === undefined ? '–' : seconds < 90 ? `${seconds} s` : `${Math.round(seconds / 60)} min`);

// The latest search runs, newest first.
export const searchRuns = rows => (rows || []).filter(isSearchRun).sort((a, b) => String(b.started_at).localeCompare(String(a.started_at))).slice(0, KEPT);

export function listRow(row) {
  const added = row.stats?.new_jobs;
  return {id: row.id, at: row.started_at, name: kindName(row), where: WHERE[row.where] || '', by: row.trigger || '', seconds: secondsOf(row),
    added: added === undefined ? null : added, outcome: row.status === 'Running' ? 'Running' : row.status || 'OK', tone: TONES[row.status] || 'neutral',
    kept: !!row.details};
}

export const listLine = (runs, shown = runs) => (!runs.length ? '' : shown.length === runs.length ? `${runs.length} search${runs.length === 1 ? '' : 'es'}, newest first` : `${shown.length} of ${runs.length} searches`);

const money = usd => (usd ? `$${usd < 0.01 ? Number(usd).toFixed(3) : Number(usd).toFixed(2)}` : null);
const cell = ([label, value]) => ({label, value});
const share = (value, total) => (!total || !value ? 0 : Math.max(2, Math.min(100, Math.round(value / total * 100))));

// The report of one run, as widgets: `tiles` (the main figures, each with an icon and a tone: components summaryTiles) and `cards` in reading order.
// A card is {id, category, title, ...}: kind 'steps' (bars sized by seconds), 'funnel' (bars from postings to your list, chips of what dropped them),
// 'facts' (a number strip + chips), 'boards' (a row per board), 'list' (lines or none), 'fold' (closed by default).
export function report(row) {
  const d = row.details || {}, stats = row.stats || {}, jobs = d.jobs || {}, boards = d.boards || {}, employers = d.employers || {};
  const added = jobs.added ?? stats.new_jobs;
  const tiles = [
    added !== undefined && added !== null && {icon: 'plus', tone: added > 0 ? 'good' : 'neutral', label: 'Added to your list', value: n(added)},
    jobs.fetched !== undefined && {icon: 'globe', tone: 'info', label: 'Postings seen', value: n(jobs.fetched)},
    jobs.in_places !== undefined && {icon: 'pin', tone: 'teal', label: 'In your places', value: n(jobs.in_places)},
    jobs.matched !== undefined && {icon: 'target', tone: 'signal', label: 'Match your roles', value: n(jobs.matched)},
    employers.employers_checked !== undefined && {icon: 'building', tone: 'violet', label: 'Employers checked', value: n(employers.employers_checked)},
    secondsOf(row) !== null && {icon: 'clock', tone: 'neutral', label: 'Time', value: duration(secondsOf(row))},
  ].filter(Boolean);
  const cards = [];
  if (!row.details) cards.push({id: 'note', kind: 'list', category: 'DETAILS', title: 'Not kept for this run', lines: ['This run ran before Jobadabra saved how a search ran. Its totals are below.']});
  const steps = d.steps || [], total = steps.reduce((sum, step) => sum + (step.secs || 0), 0);
  if (steps.length) cards.push({id: 'steps', kind: 'steps', category: 'HOW IT RAN', title: 'The search, step by step',
    steps: steps.map(step => ({label: step.label, at: duration(step.at_s), took: duration(step.secs), share: share(step.secs, total)}))});
  if (Object.keys(jobs).length) {
    const bars = some([['Postings seen', jobs.fetched, 'info'], ['In your places', jobs.in_places, 'teal'], ['Match your roles', jobs.matched, 'signal'], ['Added to your list', jobs.added, 'good']])
      .map(([label, value, tone]) => ({label, value: n(value), share: share(value, jobs.fetched), tone}));
    const other = jobs.title_hits !== undefined ? Math.max(0, jobs.title_hits - (jobs.matched || 0)) : null;
    cards.push({id: 'jobs', kind: 'funnel', category: 'JOBS', title: 'From postings to your list', bars: bars.filter(bar => bar.value !== null),
      cells: some([['Changed', n(jobs.changed)], ['Expired', n(jobs.expired)], ['Matched a role in other places', n(other)]]).map(cell),
      chips: (jobs.dropped || []).map(item => ({label: `Dropped by “${item.filter}”`, detail: n(item.count), tone: 'warn'}))});
  }
  const empCells = some([['Employers checked', n(employers.employers_checked)], ['Pages read', n(employers.feeds)], ['Pages that failed', n(employers.feed_errors)],
    ['Had a matching job', n(employers.matched)], ['Ideas left to check', n(employers.pending)], ['Checked per run, up to', n(employers.batch)]]);
  if (empCells.length) cards.push({id: 'employers', kind: 'facts', category: 'EMPLOYERS', title: 'Employers', cells: empCells.map(cell),
    chips: employers.feed_errors ? [{label: 'Some pages failed', tone: 'warn'}] : [{label: 'Every page read', tone: 'good'}]});
  if ((boards.list || []).length || Object.keys(boards).length) {
    const chips = some([['Sites that refused', boards.refused_reads, 'warn'], ['Asked us to slow down', boards.refused_slow_down, 'warn'], ['Showed a bot check', boards.refused_captcha, 'warn'],
      ['Stopped', boards.refused_stopped, 'warn'], ['Read after its scripts ran', boards.headless_reads, 'info'], ['Left to open by hand', boards.left_to_open, boards.left_to_open ? 'bad' : 'good']])
      .map(([label, value, tone]) => ({label, detail: n(value), tone}));
    cards.push({id: 'boards', kind: 'boards', category: 'JOB BOARDS', title: boards.read === undefined ? 'Job boards' : `${n(boards.read)} board${boards.read === 1 ? '' : 's'} read`,
      rows: (boards.list || []).map(item => ({name: item.name, jobs: n(item.jobs), relevant: n(item.relevant)})), chips});
  }
  const ai = Object.entries(d.ai || {}).filter(([stage]) => STAGES[stage]);
  const calls = ai.reduce((sum, [, info]) => sum + (info.cli_calls || 0) + (info.api_calls || 0), 0);
  const tokens = ai.reduce((sum, [, info]) => sum + (info.tokens_in || 0) + (info.tokens_out || 0), 0);
  if (ai.length || stats.billed_to) cards.push({id: 'ai', kind: 'facts', category: 'AI', title: 'AI',
    cells: some([['Calls', n(calls || null)], ['Tokens', n(tokens || null)], ['Cost', money(stats.ai_cost_usd)]]).map(cell),
    chips: [...ai.map(([stage, info]) => ({label: STAGES[stage], detail: info.model || info.provider || '', tone: 'info'})), ...(stats.billed_to ? [{label: stats.billed_to, tone: 'neutral'}] : [])]});
  const scoring = {...(d.scoring || {}), ...(d.ai?.score ? {model: d.ai.score.model, usd: d.ai.score.usd, tokens: (d.ai.score.tokens_in || 0) + (d.ai.score.tokens_out || 0)} : {})};
  if (Object.keys(scoring).length || stats.scored) cards.push({id: 'scoring', kind: 'fold', category: 'SCORING', title: 'Scoring', lines: some([
    ['Scored', n(scoring.done ?? stats.scored)], ['Failed', n(scoring.failed)], ['Waiting for the next refresh', n(scoring.waiting)], ['Not scored yet', n(scoring.pending)],
    ['Top new score', n(stats.top_new_score)], ['Model', scoring.model], ['Tokens', n(scoring.tokens)], ['Cost', money(scoring.usd)]]).map(([label, value]) => `${label}: ${value}`)});
  cards.push({id: 'problems', kind: 'list', category: 'PROBLEMS', title: d.problems?.length ? `${d.problems.length} problem${d.problems.length === 1 ? '' : 's'}` : 'No problems',
    tone: d.problems?.length ? 'warn' : 'good', lines: d.problems || []});
  if (!row.details) cards.push({id: 'totals', kind: 'facts', category: 'TOTALS', title: 'What the row kept', cells: some([['New jobs', n(stats.new_jobs)], ['Changed', n(stats.changed_jobs)],
    ['Employer pages read', n(stats.feeds)], ['Pages that failed', n(stats.feed_errors)], ['Expired', n(stats.closed_stale)], ['Tokens', n(stats.tokens_total)], ['AI cost', money(stats.ai_cost_usd)]]).map(cell), chips: []});
  const log = String(row.log || '').split('\n').filter(Boolean);
  if (log.length) cards.push({id: 'log', kind: 'fold', category: 'RAW', title: 'Technical log', lines: log, mono: true, wide: true});
  // Two small cards per row (the shared .card-grid, card-grid.js), a wide one (the Technical log) last on its own row (owner, 25 Oct 2026: "Technical log should
  // be last, full-row. The others, which have fixed height, and not too much content, they can 2 columns per row"). Guard: test/searches-view.test.js.
  return {tiles, cards: [...cards.filter(card => !card.wide), ...cards.filter(card => card.wide)]};
}

// What a list row shows at a glance: the run's one-line meta (when is drawn by the page).
export const metaOf = view => [view.where, duration(view.seconds), view.by && `Started: ${view.by}`].filter(Boolean).join(' · ');
