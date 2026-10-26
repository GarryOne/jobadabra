import {STATS_SINCE} from './stats-epoch.mjs';
import {classify, detectorOf} from './selfheal-stats.mjs';
// Which suites a run starts. A push to main runs only the suites whose files changed (every test-file push used to run all of them, and the shared test key's
// AI credit ran out); a schedule or a manual run runs all, or the ones named. The CI matrix is built from this (suite.mjs --list).
import {FALSE_POSITIVE, FIX_KINDS, LABEL, NEEDS_HUMAN, SIGHTINGS_NEEDED, sightings} from './triage.mjs';

const SMOKE = 'settings';   // AI-free, about 30 s: proof that the shared test code still launches the app and drives a page

// A suite's cadence (its `cadence` export): 'always' (default) runs on every automatic run, 'nightly' only in the nightly release gate and on a push that touches
// its own files or `watches`, 'watched' never in a schedule or the nightly gate but ONLY on a push that touches its own files or `watches` (a suite that
// costs real AI money and judges one piece of code: the mail reading eval), 'manual' never by itself (a person names it). cadence: {suite: 'nightly'}; watches: {suite: ['src/ai/score.py', 'dir/']}.
// 'slim' runs like 'always' (the night's schedule, every release gate, a push that touches it) but never in a release's repeats: the soak top-ups and the stable canary
// (`repeat`). The e2e audit's keep 11 / slim 15 / drop 4 (owner's yes, 26 Oct 2026): no product bug caught in 30 days, so a night and a beta are enough.
export function autoSuites(all, cadence = {}, alwaysOnly = false, repeat = false) {
  return all.filter(suite => {
    const when = cadence[suite] || 'always';
    if (when === 'slim') return !repeat;
    return alwaysOnly ? when === 'always' : (when !== 'manual' && when !== 'watched');
  });
}

// The slim suites, as one table here rather than a `cadence` export in each suite: a PR that edits a suite file runs that suite, so 15 exports would run 15 suites
// on the PR that slims them. A dropped suite exports cadence 'manual' itself (a manual suite never runs on a PR). Guard: test/suite-cadence.test.mjs.
export const SLIM = ['calendar', 'failuresnotion', 'focus', 'focusdismiss', 'interviews', 'jobs', 'recorded', 'storemove', 'stores', 'strategy', 'updates', 'visitread', 'visitsauto', 'wander', 'wizard'];
// A suite's cadence from its module: the table's 'slim', else its own export. Every reader (plan-run.mjs suiteFacts, suite.mjs, run-all.mjs) goes through it.
export const cadenceOf = (suite, module) => (SLIM.includes(suite) ? 'slim' : module.cadence);

// A helper file under desktop/e2e (not a suite) also runs the suites that import it, when they are few: `uses` = {path under desktop/e2e: [suites]} (lib/import-graph.mjs).
// One that nearly every suite imports (layout.mjs) stays the settings smoke: it would otherwise run them all.
export const MAX_USERS = 3;
export function suitesFor(files, all, {watches = {}, cadence = {}, uses = {}} = {}) {
  const chosen = new Set();
  for (const file of files.map(name => String(name).trim()).filter(Boolean)) {
    const suite = /^desktop\/e2e\/suites\/([^/]+)\.mjs$/.exec(file)?.[1];
    if (suite) { if (all.includes(suite)) chosen.add(suite); continue; }
    if (/^extension\//.test(file)) { chosen.add('apply'); chosen.add('applyflows'); chosen.add('recorded'); continue; }
    if (/^desktop\/e2e\/(recorded\/|lib\/page-replay\.mjs$)/.test(file)) { chosen.add('recorded'); continue; }   // layer 2: a case or its harness
    if (/^desktop\/e2e\/test\//.test(file) || /\.md$/.test(file)) continue;   // unit tests run on their own; docs run nothing
    if (/^desktop\/e2e\//.test(file) || file === '.github/workflows/e2e.yml') {
      chosen.add(SMOKE);
      const users = uses[file.replace(/^desktop\/e2e\//, '')] || [];
      if (users.length <= MAX_USERS) for (const user of users) if (all.includes(user)) chosen.add(user);
    }
  }
  for (const file of files.map(name => String(name).trim()).filter(Boolean)) {   // files a suite watches (the scoring prompt, a model id): that suite runs too
    for (const [suite, paths] of Object.entries(watches)) if (all.includes(suite) && paths.some(path => file === path || (path.endsWith('/') && file.startsWith(path)))) chosen.add(suite);
  }
  return all.filter(suite => chosen.has(suite) && (cadence[suite] || 'always') !== 'manual');   // a manual suite is never chosen by a push
}

// A manual run's `suite` input: "" = all, else a comma-separated list.
export function suitesNamed(text, all) {
  const names = String(text || '').split(',').map(name => name.trim()).filter(Boolean);
  const unknown = names.filter(name => !all.includes(name));
  if (unknown.length) throw new Error(`unknown suite: ${unknown.join(', ')} (known: ${all.join(', ')})`);
  return names.length ? all.filter(suite => names.includes(suite)) : all;
}

// Open findings of the UI loop that wait for a second sighting before anything acts on them (a failed step or a parked finding never gets a fix, so it needs none).
export function waitingFindings(issues) {
  return issues.filter(issue => {
    const labels = (issue.labels || []).map(label => label.name || label);
    const kind = /·\s*([a-z-]+)\s*·/.exec(issue.body || '')?.[1] || '';
    return issue.state === 'OPEN' && labels.includes(LABEL) && !labels.includes(NEEDS_HUMAN) && !labels.includes(FALSE_POSITIVE) && FIX_KINDS.includes(kind) && sightings(issue) < SIGHTINGS_NEEDED;
  }).length;
}

// One rule for a scheduled run: a commit gets at most MAX_RUNS_PER_COMMIT looks, then nothing runs until the next commit.
//  - the first look is for what changed; the others walk another seeded random path over the same code (lib/variation.mjs), which is where a second look finds something;
//  - a new commit starts over, so a busy day costs exactly the schedule (3 runs a day, whatever the number of commits) and an idle weekend costs 3 runs in all;
//  - nothing goes stale while it waits: code that did not change cannot make an open finding wrong, and code that changed always gets a run at the next slot.
export const MAX_RUNS_PER_COMMIT = 3;

// runsOnHead: completed runs of main's code on this commit. -> {run, exploring, why}
export function exploreDecision({head, lastSha, runsOnHead = [], max = MAX_RUNS_PER_COMMIT}) {
  if (!lastSha) return {run: true, exploring: false, why: 'no earlier run'};
  if (head !== lastSha) return {run: true, exploring: false, why: 'a new commit'};
  if (runsOnHead.length >= max) return {run: false, exploring: false, why: `${runsOnHead.length} looks at this commit already: waiting for the next one`};
  return {run: true, exploring: true, why: `look ${runsOnHead.length + 1} of ${max} at this commit, another path`};
}

// Kept for the plain "same commit and nothing waits" question (the old rule): true when a run would only repeat the last one.
export const shouldSkipScheduled = ({event, head, lastSha, waiting}) => event === 'schedule' && !!lastSha && head === lastSha && waiting === 0;

// The AI review of screenshots is the costly part of a run: only when the UI (or the tests that drive it) changed since the last run, or a finding waits to be confirmed.
// The noise breaker for the AI screenshot review, which spends the owner's money on every run (owner, 4 Oct 2026: "it burns my tokens and produces noise"). When most of the
// issues the review filed SINCE the job-seeker prompt (NOISE_SINCE) were judged noise (rejected, duplicate, harness) rather than real (fixed or confirmed), the review pauses:
// fewer tokens until its recent record recovers (rules of 9 Oct below). It needs NOISE_MIN judged issues before it can trip.
export const NOISE_SINCE = STATS_SINCE;
export const NOISE_MIN = 6, NOISE_SHARE = 0.5, NOISE_WINDOW = 10;
// 9 Oct 2026 (owner: "more and more real issues, fewer and fewer false"; real bugs first, money second): the breaker had paused the review since 6 Oct on 7 noise of 14,
// six of them caught by the judge BEFORE filing, and a paused review can never earn its way back. Now: (1) only noise that reached the owner (filed issues) counts here;
// noise judged before filing is the safety net working, and still counts in the stats and the weekly lessons (lib/selfheal-stats.mjs); (2) only the last NOISE_WINDOW judged
// outcomes count, so a better prompt shows at once; (3) plan-run.mjs keeps the review on for scheduled runs while tripped (a probe), so the record can recover.
export function noiseTripped(issues, {since = NOISE_SINCE, min = NOISE_MIN, share = NOISE_SHARE, window = NOISE_WINDOW} = {}) {
  const judged = [];
  for (const issue of issues) {
    if (issue.prejudged || detectorOf(issue) !== 'ai-review' || !(issue.createdAt >= since)) continue;
    const kind = classify(issue);
    if (['falsePositive', 'duplicate', 'harness'].includes(kind)) judged.push({at: issue.createdAt, noise: true});
    else if (['fixed', 'queued'].includes(kind)) judged.push({at: issue.createdAt, noise: false});
  }
  const recent = judged.sort((a, b) => String(b.at).localeCompare(String(a.at))).slice(0, window);
  const noise = recent.filter(item => item.noise).length, real = recent.length - noise;
  return {tripped: recent.length >= min && noise / recent.length > share, noise, real, judged: recent.length};
}
export const reviewNeeded = ({files, waiting, known}) => !known || waiting > 0 || files.some(file => /^desktop\/(renderer|e2e)\//.test(file));

// Where a suite runs in CI (6 Oct 2026, the 5-minute e2e): Linux by default (20 runner slots, about twice as fast as a Mac); macOS only for a suite that needs the Mac
// itself (Keychain, `open` to Chrome and the extension, pixels and fonts), which exports `macos = true` with its reason. The Free plan runs at most 5 macOS jobs at once.
export const runnerOf = module => (module.macos ? 'macos-latest' : 'ubuntu-24.04');

// What Windows runs, outside a run by hand that names its suites: apply (the fill, where Windows' own product reds came from: #2074's night fill) and the settings
// smoke (the app launches and draws). The e2e audit (owner's yes, 26 Oct 2026): Windows was 38% of e2e runner-minutes, ~14,200 a month, and its other reds were CI
// or test timing. Read by plan-run.mjs (the release run's Windows matrix) and plan-windows.mjs (after main's checks, a gate by hand). Guard: test/windows-two.test.mjs.
export const WINDOWS = ['apply', 'settings'];
export const onWindows = suites => suites.filter(suite => WINDOWS.includes(suite));
