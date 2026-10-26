// Files tonight's findings as GitHub issues (one per problem, found again = a comment) and picks the one ready to be fixed.
//   node triage.mjs --artifacts <dir> --run-url <url> --out <dir>      (needs `gh` and GH_TOKEN with issues: write)
// Writes <out>/candidate.json + <out>/prompt.md when a finding is ready, and sets the step output `candidate` (the issue number, or "none").
import {execFileSync} from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import {pickCandidates, fixerCard, scorecard, appVersionAt, versionLabel, CONFIRMED, FALSE_POSITIVE, NEEDS_HUMAN, recentSightings, score, LABEL, NOT_SEEN, closedByFixComment, probeCleared, namesIssue, firstBuildSha, testedSha, SEEN_AGAIN, SIGHTINGS_NEEDED, sightings, PRIORITIES, priorityLabel, rankIssues, rankingBody, issueBody, issueTitle, labelFor, labelsFor, LIMIT_TESTED, NO_CREDIT, capNewAi, droppedTable, macTwin, matchExisting, normalize, notSeenComment, closedComment, suiteOfIssue, toClose, suppressedBy, pickCandidate, readinessSummary, screenshotOf, seenAgainComment} from './lib/triage.mjs';
import {FLAKY, REGRESSION, fixedBefore, flakyOn, regressionComment} from './lib/triage.mjs';
import {INTERMITTENT, labelRerun} from './lib/flaky-proof.mjs';
import {foundText} from './lib/triage-issues.mjs';
import {asIssues, entryOf, NOISE_WORDS, pendingOf, REGISTER_LABEL, registerBody, registerEntries, signatureVerdict, wordOf} from './lib/prejudge.mjs';
import {POSSIBLE_DUPLICATE, sameCauseComment, sameCauseLinks} from './lib/same-cause.mjs';
import {setResolution} from './lib/resolution.mjs';
import {contextLine, stepAgeLine} from './lib/run-context.mjs';
import {runSummary} from './lib/run-summary.mjs';
import {trackerRow, writeTrackerRow} from './lib/tracker-write.mjs';
import {pathSummary, replayFromSeed} from './lib/replay.mjs';
import {staleComment, staleSighting} from './lib/stale.mjs';
import {holdFinding, holdReason} from './lib/freshness.mjs';
import {breakerState, trippedSources} from './lib/breaker.mjs';
import {suiteOfKey} from './lib/suite-shards.mjs';
import {judgedSeverity} from './lib/severity.mjs';
import {learnSignatures, SIGNATURE_LABEL, signaturesBody, signaturesFromBody} from './lib/signatures.mjs';
import {verdictComment} from './lib/verdict-comment.mjs';
import {publishFiles} from './lib/evidence.mjs';

const read = file => { try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return null; } };
// The findings files below a folder, whatever the suite folders are called.
export function filesNamed(folder) {
  const out = {'ui-findings.json': [], 'ai-findings.json': [], 'suite-failures.json': [], 'interactions.json': [], 'a11y.json': [], 'replay.json': []};
  const walk = dir => { for (const entry of fs.existsSync(dir) ? fs.readdirSync(dir, {withFileTypes: true}) : []) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full); else if (out[entry.name]) out[entry.name].push(full);
  } };
  walk(folder);
  return out;
}
const realGh = args => execFileSync('gh', args, {encoding: 'utf8', maxBuffer: 20 * 1024 * 1024});

// e2e-artifacts-<suite>, e2e-artifacts-windows-<suite> (e2e-windows.yml), or a gate's second store, e2e-artifacts-<suite>-standin (plan-run.mjs legs): the suite.
export const suiteOf = dir => suiteOfKey(path.basename(dir || '').replace(/^e2e-artifacts-(windows-)?/, ''));   // and a slice's, e2e-artifacts-recorded-2of4 (lib/suite-shards.mjs)
// Which platform an issue is about: its platform: label (issues filed before 3 Oct 2026 have none and are all from the Mac).
export const platformOf = issue => ((issue.labels || []).map(item => item.name || item).find(name => name.startsWith('platform:')) || 'platform:mac').slice(9);
const tail = (file, lines = 25, chars = 3500) => { try { return fs.readFileSync(file, 'utf8').split('\n').filter(Boolean).slice(-lines).join('\n').slice(-chars); } catch { return ''; } };
const slug = step => `failed-${String(step).replace(/\W+/g, '-').slice(0, 60)}`;   // the runner's name for a failed step's screenshot (lib/runner.mjs)
const views = dir => { try { return fs.readdirSync(dir).map(name => /^ui-(.+)\.png$/.exec(name)?.[1]).filter(Boolean); } catch { return []; } };

// The files that show a finding: the page's screenshot, or for a failed step its failure screenshot.
function evidenceFile(finding) {
  if (!finding.dir) return '';
  if (finding.file) { const own = path.join(finding.dir, finding.file); if (fs.existsSync(own)) return own; }   // the picture the AI review looked at (a page, or a failure screenshot)
  const choices = finding.source === 'suite-failure' ? [`${slug(finding.stepName || finding.title.replace(/^step failed: /, ''))}.png`, 'last.png'] : [`ui-${finding.shot || finding.view}.png`];
  return choices.map(name => path.join(finding.dir, name)).find(file => fs.existsSync(file)) || '';
}
const urlOf = (urls, to) => (to && urls[to]) || '';

export const RANKING_TITLE = '🔥 Top issues (ranked automatically)';
// Every open issue carries one priority:P0..P3 label (only changed ones are edited), and one pinned issue lists the top of the list, rewritten when it differs.
export function refreshRanking({gh = realGh, issues, repo = '', now = Date.now()}) {
  const ranked = rankIssues(issues, now);
  for (const band of PRIORITIES) gh(['label', 'create', priorityLabel(band), '--force', '--color', {P0: 'B60205', P1: 'D93F0B', P2: 'FBCA04', P3: 'C5DEF5'}[band], '--description', 'Ranked automatically by the UI loop']);
  for (const {issue, priority} of ranked) {
    const have = (issue.labels || []).map(item => item.name || item).filter(name => name.startsWith('priority:'));
    if (have.length === 1 && have[0] === priorityLabel(priority)) continue;
    const args = ['issue', 'edit', String(issue.number), '--add-label', priorityLabel(priority)];
    for (const old of have.filter(name => name !== priorityLabel(priority))) args.push('--remove-label', old);
    gh(args);
  }
  let prs = [];
  try { prs = JSON.parse(gh(['pr', 'list', '--label', 'auto-ui-fix', '--state', 'all', '--limit', '100', '--json', 'state,createdAt'])); } catch { /* no numbers this time */ }
  const body = rankingBody(ranked, now, 12, scorecard(issues, now), fixerCard(Array.isArray(prs) ? prs : [], issues, now));
  const found = JSON.parse(gh(['issue', 'list', '--label', 'top-issues', '--state', 'open', '--json', 'number,body,id']));
  if (found[0]) { if (found[0].body !== body) gh(['issue', 'edit', String(found[0].number), '--title', RANKING_TITLE, '--body', body]); return {ranked, number: found[0].number}; }
  gh(['label', 'create', 'top-issues', '--force', '--color', 'B60205', '--description', 'The pinned ranked list of open findings']);
  const url = gh(['issue', 'create', '--title', RANKING_TITLE, '--body', body, '--label', 'top-issues']).trim();
  try {   // pinned (GitHub allows three); already pinned or no room is not worth failing the loop for
    const number = url.split('/').pop();
    const id = JSON.parse(gh(['issue', 'view', number, '--json', 'id'])).id;
    gh(['api', 'graphql', '-f', `query=mutation { pinIssue(input: {issueId: "${id}"}) { issue { id } } }`]);
  } catch { /* not pinned */ }
  return {ranked, number: url.split('/').pop()};
}

// -> {filed, again, gone, candidate}. `gh` and `publish` (the screenshot upload: files -> {to: url}) are injected so the rules can be tested without GitHub.
// `pendingOnly`: plan, then return the new findings to judge before filing (lib/prejudge.mjs), with no write to GitHub. `verdicts`: {id: raw verdict} from that judgement.
export function triage({artifacts, runUrl, gh = realGh, publish = publishFiles, repo = process.env.REPO || process.env.GITHUB_REPOSITORY || '', build = '', platform = 'mac', pendingOnly = false, verdicts = null, incomplete = [], today = new Date().toISOString().slice(0, 10)}) {
  const found = filesNamed(artifacts);   // every suite's folder (e2e-artifacts/e2e-artifacts-<suite>/…), or one flat folder
  const withDir = (file, items) => items.map(item => ({...item, _dir: path.dirname(file)}));
  // A suite's failed steps: only the first is a finding (the later ones are its consequences), and none when the AI had no credit (not a product problem).
  const skipped = [], suiteFailures = [];
  for (const file of found['suite-failures.json']) {
    const items = withDir(file, read(file) || []);
    if (!items.length) continue;
    const dir = path.dirname(file), suite = items[0].suite;
    // The WHOLE logs are searched for the limit, not their tails: a long log pushed the message out of the last 40 kB.
    const whole = file => { try { return fs.readFileSync(file, 'utf8').slice(-4e6); } catch { return ''; } };
    const logs = `${whole(path.join(dir, 'logs', 'engine.log'))}\n${whole(path.join(dir, 'logs', 'app.log'))}`;
    if (items.some(item => NO_CREDIT.test(item.message || '')) || (!LIMIT_TESTED.includes(suite) && NO_CREDIT.test(logs))) { skipped.push({suite, why: 'the AI had no credit'}); continue; }
    // The first failed step decides: an environment failure (failed twice: the runner retried it) says nothing about the product. Listed in the summary, not filed.
    if (items[0].environment) { skipped.push({suite, why: `the test environment failed twice: ${String(items[0].message).slice(0, 100)}`}); continue; }
    // The CI job ran a red suite once more on the same commit (e2e.yml); passing then, its failed steps are flaky: the test, not the product (6 Oct 2026).
    const flaky = read(path.join(dir, 'flaky.json'))?.rerun === 'passed';
    suiteFailures.push({...items[0], also: items.slice(1).map(item => item.step), ...(flaky ? {flaky: true} : {})});
  }
  const dropped = [];   // what the filters cut this run, with why (shown in the run's log)
  for (const file of found['ai-findings.json']) for (const item of (read(file) || {}).dropped || []) dropped.push({...item, source: 'ai-review', why: `AI answer: ${item.why}`});
  const findings = normalize({dropped, ui: found['ui-findings.json'].flatMap(file => withDir(file, read(file) || [])), ai: found['ai-findings.json'].flatMap(file => withDir(file, (read(file) || {}).findings || [])),
    suite: suiteFailures});
  // A run on Windows (e2e-windows.yml) files its own issues: a Windows-only break must not hide in a Mac issue, nor a Mac one be cleared by a Windows run.
  if (platform !== 'mac') for (const finding of findings) finding.id = `${finding.id}-${platform.slice(0, 3)}`;
  const list = () => JSON.parse(gh(['issue', 'list', '--label', LABEL, '--state', 'all', '--limit', '300', '--json', 'number,state,stateReason,labels,body,comments,title,createdAt']));
  // Only this platform's issues are matched, marked "not seen" and closed here (the ranking below reads them all again).
  const everything = list();
  let issues = everything.filter(issue => platformOf(issue) === platform);
  // What the loop has learned about itself (lib/breaker.mjs, lib/signatures.mjs): the detectors whose last ten outcomes were poor, and the test mistakes it taught itself to drop.
  const breaker = breakerState(everything), tripped = trippedSources(breaker);
  let signatureIssue = null;
  try { signatureIssue = JSON.parse(gh(['issue', 'list', '--label', SIGNATURE_LABEL, '--state', 'open', '--limit', '1', '--json', 'number,body']))[0] || null; } catch { signatureIssue = null; }
  const learned = signaturesFromBody(signatureIssue?.body);
  const out = {filed: [], again: [], gone: [], closed: [], skipped, unreviewed: [], candidate: null, dropped};
  const createdNow = [];   // the numbers of the issues this run filed
  const createdRows = [];  // the same, with what found each (lib/same-cause.mjs)
  const runId = String(runUrl).split('/').pop() || 'run';
  // The app version this run tested (one lookup for the whole run): the label every issue it files or sees again carries.
  const tested = appVersionAt(testedSha(build), {gh, repo});
  const versionOfRun = tested ? versionLabel(tested.version) : '';
  // What the issues should say about this run (lib/run-context.mjs): how far the tested build is behind main, and when each suite's file last changed. One lookup each, never fatal.
  let behind = null;
  try { if (repo && testedSha(build)) behind = Number(String(gh(['api', `repos/${repo}/compare/${testedSha(build)}...main`, '--jq', '.ahead_by']) || '').trim()); } catch { behind = null; }
  if (!Number.isFinite(behind)) behind = null;
  out.behind = behind;
  out.breaker = breaker;
  out.paths = pathSummary(found['replay.json'].map(read));   // the paths this run walked (replay.json of every suite): fixed or seeded, windows, places, themes
  // The files that changed between the tested build and main, once per run: a finding about code that has changed since is held for a recheck (lib/freshness.mjs).
  let changedFiles = null;
  const changedSince = () => {
    if (changedFiles) return changedFiles;
    changedFiles = [];
    try { if (repo && testedSha(build) && behind > 0) changedFiles = JSON.parse(String(gh(['api', `repos/${repo}/compare/${testedSha(build)}...main`, '--jq', '[.files[].filename]']) || '[]')); } catch { changedFiles = []; }
    return changedFiles;
  };
  const suiteFile = new Map();
  const lastChange = suite => {
    if (!repo || !suite) return null;
    if (!suiteFile.has(suite)) {
      let last = null;
      try { const [sha, date] = String(gh(['api', `repos/${repo}/commits?path=desktop/e2e/suites/${suite}.mjs&per_page=1`, '--jq', '.[0] | "\(.sha) \(.commit.committer.date)"']) || '').trim().split(' '); if (sha && date) last = {sha, date}; } catch { last = null; }
      suiteFile.set(suite, last);
    }
    return suiteFile.get(suite);
  };
  // A commit between releases says which release it follows ("after 0.5.0 · main @ 9f5e0ad"): the line then always names a version.
  if (tested && !tested.exact && build && !/\d+\.\d+\.\d+[^@]*@/.test(build)) build = `after ${tested.version} · ${build}`;
  const addVersion = number => { if (!versionOfRun) return; gh(['label', 'create', versionOfRun, '--force', '--color', 'C5DEF5', '--description', 'The app version the finding was seen on']); gh(['issue', 'edit', String(number), '--add-label', versionOfRun]); };

  // 1. decide what each finding is: new, a repeat of an open issue (even when the AI worded it differently), or already told in this run.
  // A Windows finding the Mac already told becomes a comment on that issue ("also seen on Windows"), or nothing when the Mac one was rejected: not a second issue.
  // What was judged noise before filing in earlier runs (the pinned noise register): dropped like a person's rejection, with no new judgement.
  let register = null;
  try { register = JSON.parse(gh(['issue', 'list', '--label', REGISTER_LABEL, '--state', 'open', '--limit', '1', '--json', 'number,body']))[0] || null; } catch { register = null; }
  const remembered = registerEntries(register?.body);
  const rejected = [...issues, ...asIssues(remembered)];
  const planAll = findings.map(finding => { const existing = matchExisting(finding, issues); return {finding, existing, twin: !existing && platform !== 'mac' ? macTwin(finding, everything) : null}; })
    .filter(({finding, existing, twin}) => existing || twin || !suppressedBy(finding, rejected));   // a closed false positive (or one judged noise before filing) stays closed
  const plan = capNewAi(planAll);
  out.capped = planAll.length - plan.length;
  for (const item of planAll) if (!plan.includes(item)) dropped.push({view: item.finding.view, severity: item.finding.severity, title: item.finding.title, source: 'ai-review', why: 'over the 3-new-AI-issues-per-run cap'});
  for (const finding of findings) if (!planAll.some(item => item.finding === finding)) dropped.push({view: finding.view, severity: finding.severity, title: finding.title, source: finding.source, why: 'matches an issue closed as a false positive'});
  const matched = new Set(plan.filter(item => item.existing).map(item => item.existing.number));
  const needsPicture = plan.filter(({existing, twin}) => !twin && (!existing || (existing.state === 'OPEN' && !(existing.comments || []).some(comment => (comment.body || '').includes(runUrl)))));

  if (pendingOnly) {
    const fresh = plan.filter(({existing, twin}) => !existing && !twin).map(({finding}) => ({...finding, screenshot: evidenceFile(finding)}));
    return {...out, findings, pending: pendingOf(fresh, undefined, {tripped, learned})};
  }
  // Judged noise before filing: never filed, listed in the summary and remembered in the register.
  const verdictFor = finding => (verdicts && verdicts[finding.id]) || signatureVerdict(finding, learned);   // a known harness signature needs no model
  const noiseNow = plan.filter(({finding, existing, twin}) => !existing && !twin && verdictFor(finding) && NOISE_WORDS.includes(wordOf(verdictFor(finding))));
  for (const {finding} of noiseNow) dropped.push({view: finding.view, severity: finding.severity, title: finding.title, source: finding.source, why: `judged ${wordOf(verdictFor(finding))} before filing`});
  out.judgedNoise = noiseNow.map(({finding}) => finding.id);
  // 2. a finding that was open, whose page was photographed and reviewed again in this run and did not come back: it is "not seen" (a fix, or a one-off).
  const reviewed = {ai: new Set(), layout: new Set()};
  // A page counts as "reviewed again" only when the AI really looked at it (review-ui.mjs lists them): a page it could not review (no credit, an outage) is neither filed nor cleared, so a
  // run that hit the API limit can never mark an open AI finding "not seen" and, two runs later, close it. Older files have no list: every photographed page, as before.
  for (const file of found['ai-findings.json']) {
    const data = read(file), real = Array.isArray(data?.reviewed) ? new Set(data.reviewed) : null;
    for (const view of views(path.dirname(file))) if (!real || real.has(view)) reviewed.ai.add(view);
    for (const item of Array.isArray(data?.unreviewed) ? data.unreviewed : []) out.unreviewed.push({suite: suiteOf(path.dirname(file)), view: item.view, why: item.why});
  }
  for (const file of found['ui-findings.json']) for (const view of views(path.dirname(file))) reviewed.layout.add(view);
  // A suite-failure issue is cleared only when its suite ran in this run with NO failure at all (a different earlier failure would hide the later steps) and was not skipped.
  const ranSuites = new Set(fs.existsSync(artifacts) ? fs.readdirSync(artifacts).filter(name => /^e2e-artifacts-/.test(name)).map(name => suiteOf(name)) : []);
  const failedSuites = new Set([...suiteFailures.map(item => item.suite), ...skipped.map(item => item.suite)]);
  // A sidebar / brand / badge issue lives in the app's chrome, which every page photograph checks (view 'app-chrome') but which has no photograph of its own, so the "reviewed
  // again" test above can never see it: it is cleared when the layout check ran in this run and found nothing in the chrome (the narrow-window pass counts: it is a warning, not silence).
  const chromeIssue = issue => /^\[auto-ui\] (app-chrome|failure-screenshot):/.test(issue.title || '') && /sidebar|brand|badge|icon|nav/i.test(issue.title || '');
  const chromeCleared = issue => chromeIssue(issue) && found['ui-findings.json'].length > 0 && !findings.some(finding => finding.view === 'app-chrome');
  const suiteCleared = issue => { const suite = suiteOfIssue(issue); return !!suite && ranSuites.has(suite) && !failedSuites.has(suite); };
  // A window error of a whole suite (view "<suite>-journey", lib/journey.mjs) is cleared when that suite ran again and the error did not come back (it is not matched).
  // An accessibility rule (view "a11y") is cleared when a suite of this run checked pages with axe and that rule was not among its violations.
  const a11yRuns = found['a11y.json'].map(file => read(file)).filter(data => data?.checked > 0);
  const a11yCleared = issue => { const rule = /^\[auto-ui\] a11y: a11y on a11y: ([\w-]+)/.exec(issue.title || '')?.[1]; return !!rule && a11yRuns.length > 0 && !a11yRuns.some(data => (data.rules || []).includes(rule)); };
  const journeyCleared = issue => { const suite = /^\[auto-ui\] ([\w-]+)-journey:/.exec(issue.title || '')?.[1]; return !!suite && ranSuites.has(suite); };
  // The probe's own results: every control it pressed in this run, flagged or not (a flagged one is matched above, so a row here for an unmatched issue means "pressed, fine").
  const pressed = found['interactions.json'].flatMap(file => { const rows = read(file); return Array.isArray(rows) ? rows : []; });
  const clearedNow = issue => {
    if (suiteCleared(issue) || chromeCleared(issue) || probeCleared(issue, pressed) || journeyCleared(issue) || a11yCleared(issue)) return true;
    const view = /^\[auto-ui\] ([^:]+):/.exec(issue.title || '')?.[1] || '';
    const source = /found by (the AI screenshot review|the layout check)/.exec(issue.body || '')?.[1];
    return source === 'the AI screenshot review' ? reviewed.ai.has(view) : source === 'the layout check' ? reviewed.layout.has(view) : false;
  };
  const gone = issues.filter(issue => issue.state === 'OPEN' && !matched.has(issue.number) && !(issue.labels || []).some(item => (item.name || item) === NOT_SEEN)
    && !(issue.comments || []).some(comment => (comment.body || '').includes(runUrl))).map(issue => {
    const view = /^\[auto-ui\] ([^:]+):/.exec(issue.title || '')?.[1] || '';
    if (suiteCleared(issue) || chromeCleared(issue) || probeCleared(issue, pressed) || journeyCleared(issue) || a11yCleared(issue)) return {issue, view, dir: ''};   // a failed step's issue: its whole suite ran again and nothing failed in it; or a chrome issue the layout check no longer sees
    const source = /found by (the AI screenshot review|the layout check)/.exec(issue.body || '')?.[1];
    const seen = source === 'the AI screenshot review' ? reviewed.ai : source === 'the layout check' ? reviewed.layout : new Set();
    const dir = found[source === 'the AI screenshot review' ? 'ai-findings.json' : 'ui-findings.json'].map(file => path.dirname(file)).find(folder => views(folder).includes(view));
    return seen.has(view) ? {issue, view, dir} : null;
  }).filter(Boolean);

  // 3. one upload of every picture that is needed (a failure to upload never stops the issues).
  const uploads = [];
  const target = (finding, name) => `ui-loop/${finding.id}/${runId}-${name}`;
  for (const {finding} of needsPicture.filter(item => !noiseNow.includes(item))) { const from = evidenceFile(finding); if (from) uploads.push({from, to: target(finding, path.basename(from))}); }
  for (const {issue, view, dir} of gone) { const from = dir && path.join(dir, `ui-${view}.png`); const id = /fp:(\S+)/.exec((issue.labels || []).map(item => item.name || item).join(' '))?.[1] || `issue-${issue.number}`;
    if (from && fs.existsSync(from)) uploads.push({from, to: `ui-loop/${id}/${runId}-${view}-clear.png`}); }
  let urls = {};
  if (uploads.length && repo) { try { urls = publish({repo, files: uploads, message: `Evidence of run ${runId}`, tag: `ui-evidence-${runId}`}); } catch (error) { console.error(`screenshots not uploaded: ${error.message}`); } }

  gh(['label', 'create', LABEL, '--force', '--color', 'C2E0C6', '--description', 'Found by the nightly UI loop']);
  for (const {finding, existing, twin} of plan) {
    if (!existing && twin) {   // already told by the Mac
      if (twin.state === 'OPEN' && !(twin.comments || []).some(comment => (comment.body || '').includes(runUrl))) gh(['issue', 'comment', String(twin.number), '--body', `Also seen on Windows in ${runUrl}. Not filed again as a Windows issue (the same finding).`]);
      out.again.push(finding.id);
      continue;
    }
    const suite = suiteOf(finding.dir) || (finding.source === 'suite-failure' ? finding.view : '');
    const from = evidenceFile(finding), to = from ? target(finding, path.basename(from)) : '';
    const picture = urlOf(urls, to);
    if (!existing && noiseNow.some(item => item.finding === finding)) continue;
    if (!existing) {
      // The same defect a fix closed, seen on a build older than that fix: a stale sighting, not a regression and not a new issue (lib/stale.mjs).
      const closedBefore = fixedBefore(finding, everything);
      const stale = closedBefore && repo ? staleSighting({issue: closedBefore, tested: testedSha(build),
        compare: (base, head) => String(gh(['api', `repos/${repo}/compare/${base}...${head}`, '--jq', '.status']) || '').trim(),
        merged: number => String(gh(['pr', 'view', String(number), '--repo', repo, '--json', 'mergeCommit', '-q', '.mergeCommit.oid']) || '').trim()}) : null;
      if (stale?.stale) {
        if (!(closedBefore.comments || []).some(comment => (comment.body || '').includes(runUrl))) gh(['issue', 'comment', String(closedBefore.number), '--body', staleComment(closedBefore, {fix: stale.fix, tested: testedSha(build)}, runUrl)]);
        out.stale = [...(out.stale || []), {id: finding.id, issue: closedBefore.number}];
        dropped.push({view: finding.view, severity: finding.severity, title: finding.title, source: finding.source, why: `stale sighting: the fix ${stale.fix.slice(0, 7)} of #${closedBefore.number} is newer than the tested build ${testedSha(build)}`});
        continue;
      }
      // About code that has changed since the tested build: not filed now, filed by the next run on a newer build if it is still there (counted in the run log).
      const held = holdFinding(finding, {suite, behind, changed: changedSince()});
      if (held.hold) {
        out.held = [...(out.held || []), {id: finding.id, files: held.files}];
        dropped.push({view: finding.view, severity: finding.severity, title: finding.title, source: finding.source, why: holdReason(held.files, testedSha(build))});
        continue;
      }
      const judged = verdictFor(finding), word = judged ? wordOf(judged) : '';
      // The judge's level replaces the detector's (lib/severity.mjs); one it rates low is not filed, like every low finding (owner, 4 Oct 2026).
      const rated = judged ? judgedSeverity(judged, finding) : '';
      if (rated) finding.severity = rated;
      if (rated === 'low') { dropped.push({view: finding.view, severity: 'low', title: finding.title, source: finding.source, why: 'judged low before filing (never filed)'}); continue; }
      // A detector whose last ten outcomes were poor files nothing that no one has judged: held for a later run's judgement (lib/breaker.mjs).
      if (tripped.has(finding.source) && !judged) {
        const row = breaker[finding.source];
        out.watched = [...(out.watched || []), finding.id];
        dropped.push({view: finding.view, severity: finding.severity, title: finding.title, source: finding.source, why: `held, detector under watch: ${row.wrong} of its last ${row.judged} outcomes were wrong, so nothing it finds is filed unjudged`});
        continue;
      }
      const facts = finding.dir ? read(path.join(finding.dir, `ui-${finding.view}.json`)) : null;
      const logs = finding.source === 'suite-failure' && finding.dir ? {'engine.log': tail(path.join(finding.dir, 'logs', 'engine.log')), 'app.log': tail(path.join(finding.dir, 'logs', 'app.log'))} : {};
      const codeFile = fs.existsSync(new URL(`../../renderer/pages/${finding.view}.js`, import.meta.url)) ? `desktop/renderer/pages/${finding.view}.js` : '';
      const variation = finding.dir ? read(path.join(finding.dir, 'seed.json')) : null;   // a run that walked a seeded path says which (lib/variation.mjs)
      // How the run was walked (replay.json, every suite since 5 Oct 2026); an older artifact has only seed.json, which still gives its path.
      const replay = finding.dir ? (read(path.join(finding.dir, 'replay.json')) || (variation ? replayFromSeed(variation, {suite}) : null)) : null;
      const evidence = {replay, suite, seed: variation && !variation.fixed ? variation.seed : 0, window: variation?.window, detail: variation?.detail, [finding.source === 'suite-failure' ? 'failedScreenshot' : 'screenshot']: picture, facts, logs, codeFile};
      const regressed = closedBefore;   // the same defect a fix closed, on a build that has the fix: it did not hold
      const labels = [LABEL, labelFor(finding.id), ...labelsFor(finding, suite), `platform:${platform}`, ...(versionOfRun ? [versionOfRun] : []), ...(word === 'real' ? [CONFIRMED] : word === 'needs-human' ? [NEEDS_HUMAN] : []), ...(regressed ? [REGRESSION] : [])];
      if (regressed) gh(['label', 'create', REGRESSION, '--force', '--color', 'B60205', '--description', 'A defect a fix had closed came back']);
      for (const label of labels.slice(1).filter(name => name !== CONFIRMED && name !== NEEDS_HUMAN && name !== REGRESSION)) gh(['label', 'create', label, '--force', '--color', label.startsWith('severity:high') ? 'D93F0B' : label === 'severity:low' ? '0E8A16' : label.startsWith('severity:') ? 'FBCA04' : 'EDEDED']);
      const url = String(gh(['issue', 'create', '--title', issueTitle(finding), '--body', issueBody(finding, runUrl, {...evidence, build, platform, context: contextLine({behind, incomplete, suite}), stepAge: finding.source === 'suite-failure' ? stepAgeLine({last: lastChange(suite)}) : ''}), '--label', labels.join(',')]) || '').trim();
      if (/\/issues\/\d+$/.test(url)) { createdNow.push(Number(url.split('/').pop())); if (finding.kind === 'detector-miss') out.trackerRows = [...(out.trackerRows || []), {number: Number(url.split('/').pop()), url, title: issueTitle(finding), labels: [...labels], body: ''}];   // a planted bug no detector caught: a Bug Tracker row (lib/tracker-write.mjs)
      createdRows.push({number: Number(url.split('/').pop()), source: finding.source, suite, view: finding.view, text: `${finding.title} ${finding.detail || ''} ${finding.impact || ''}`}); }
      // Judged before filing: the verdict is the issue's first comment (the same layout as the verdict pass's).
      if (regressed && /\/issues\/\d+$/.test(url)) { out.regressions = [...(out.regressions || []), Number(url.split('/').pop())]; gh(['issue', 'comment', url.split('/').pop(), '--body', regressionComment(regressed, runUrl)]); }
      if (judged && /\/issues\/\d+$/.test(url)) gh(['issue', 'comment', url.split('/').pop(), '--body', verdictComment(judged, {number: Number(url.split('/').pop())})]);
      out.filed.push(finding.id);
      if (finding.flaky && /\/issues\/\d+$/.test(url)) markFlaky(Number(url.split('/').pop()), finding.detail);
    } else if (existing.state === 'OPEN' && !(existing.comments || []).some(comment => (comment.body || '').includes(runUrl))) {
      const comment = seenAgainComment(runUrl, picture, build);
      gh(['issue', 'comment', String(existing.number), '--body', comment]);
      existing.comments = [...(existing.comments || []), {body: comment}];   // a second finding of this run on the same issue sees it: one "Seen again" per run (#1711)
      // Seen on a second commit (one sighting per commit, lib/triage.mjs): labelled, so the list shows what is reproduced and what is a one-off.
      if (sightings(existing) >= SIGHTINGS_NEEDED && !(existing.labels || []).some(item => (item.name || item) === SEEN_AGAIN)) {
        gh(['label', 'create', SEEN_AGAIN, '--force', '--color', '5319E7', '--description', 'Seen on two or more commits: reproduced, not a one-off']);
        gh(['issue', 'edit', String(existing.number), '--add-label', SEEN_AGAIN]);
      }
      if ((existing.labels || []).some(item => (item.name || item) === NOT_SEEN)) gh(['issue', 'edit', String(existing.number), '--remove-label', NOT_SEEN]);
      if (versionOfRun && !(existing.labels || []).some(item => (item.name || item) === versionOfRun)) addVersion(existing.number);   // seen on another version: that one is added too
      out.again.push(finding.id);
      if (finding.flaky) markFlaky(existing.number, finding.detail);
    }
  }
  // A failed step and a screenshot or layout finding of the same suite in this run: probably one defect, linked and labelled, not merged.
  const links = sameCauseLinks(createdRows);
  if (links.length) gh(['label', 'create', POSSIBLE_DUPLICATE, '--force', '--color', 'CFD3D7', '--description', 'Probably the same cause as another issue filed by the same run']);
  for (const {later, earlier} of links) { gh(['issue', 'edit', String(later), '--add-label', POSSIBLE_DUPLICATE]); gh(['issue', 'comment', String(later), '--body', sameCauseComment(earlier, runUrl)]); }
  out.sameCause = links;
  // The register remembers this run's noise (one pinned issue, created on first use).
  if (noiseNow.length) {
    const entries = [...remembered, ...noiseNow.map(({finding}) => entryOf(finding, verdictFor(finding), today))];
    gh(['label', 'create', REGISTER_LABEL, '--force', '--color', 'CCCCCC', '--description', 'The pinned list of findings judged noise before filing']);
    if (register) gh(['issue', 'edit', String(register.number), '--body', registerBody(entries)]);
    else gh(['issue', 'create', '--title', '🧹 Judged noise before filing (kept automatically)', '--label', REGISTER_LABEL, '--body', registerBody(entries)]);
  }
  // A commit that says "Fixes #N", between the build the issue was first seen on and this one: the fix is known, so one clean run closes it (otherwise two, as before).
  const fixOf = issue => {
    const from = firstBuildSha(issue), to = testedSha(build);
    if (!repo || !from || !to || from === to) return null;
    try {
      const commits = JSON.parse(gh(['api', `repos/${repo}/compare/${from}...${to}`, '--jq', '[.commits[] | {sha: .sha[0:7], message: .commit.message}]']));
      return commits.find(commit => namesIssue(commit.message, issue.number)) || null;
    } catch { return null; }
  };
  // A step that failed and then passed on the same commit (flaky.json, or its suite passing now): flaky only with proof, its failure being timing or the test's
  // environment; a wrong value that came right is intermittent, a bug that shows sometimes (gate G5, lib/flaky-proof.mjs; #1897 was labelled flaky and was a bug).
  function markFlaky(number, message) { return labelRerun({gh, number, message, sha7: testedSha(build), runUrl, out}); }   // a declaration: the filing loop above calls it
  for (const {issue, view} of gone) {
    // Failed on this very commit, and its suite passed now: flaky, whatever happens next (it still closes after two clean runs).
    if (suiteCleared(issue) && flakyOn(issue, testedSha(build)) && !(issue.labels || []).some(item => [FLAKY, INTERMITTENT].includes(item.name || item))) markFlaky(issue.number, foundText(issue.body));
    const fix = fixOf(issue);
    if (fix && !(issue.labels || []).some(item => (item.name || item) === NOT_SEEN)) {
      gh(['issue', 'comment', String(issue.number), '--body', closedByFixComment(runUrl, fix.sha, build)]);
      gh(['issue', 'close', String(issue.number), '--reason', 'completed']);
      setResolution(gh, issue.number, 'fixed');
      out.closed.push(issue.number);
      continue;
    }
    const id = /fp:(\S+)/.exec((issue.labels || []).map(item => item.name || item).join(' '))?.[1] || `issue-${issue.number}`;
    const picture = urlOf(urls, `ui-loop/${id}/${runId}-${view}-clear.png`);
    gh(['label', 'create', NOT_SEEN, '--force', '--color', 'BFD4F2', '--description', 'The page was reviewed again and the finding did not come back']);
    gh(['issue', 'comment', String(issue.number), '--body', notSeenComment(runUrl, picture, build)]);
    gh(['issue', 'edit', String(issue.number), '--add-label', NOT_SEEN]);
    // The open fix pull request for it gets the same "after" picture.
    const branch = id ? `auto-fix/${id}` : '';
    const prs = branch ? JSON.parse(gh(['pr', 'list', '--head', branch, '--state', 'open', '--json', 'number'])) : [];
    for (const pr of prs) gh(['pr', 'comment', String(pr.number), '--body', `${notSeenComment(runUrl, picture, build)}\n\nThis is the "after" for #${issue.number}.`]);
    out.gone.push(id);
  }
  // 4. second clean run in a row: close it, naming the build that did not show it.
  for (const issue of toClose(issues, matched, runUrl, clearedNow)) {
    gh(['issue', 'comment', String(issue.number), '--body', closedComment(runUrl, build)]);
    gh(['issue', 'close', String(issue.number), '--reason', 'completed']);
    setResolution(gh, issue.number, 'not-seen');
    out.closed.push(issue.number);
  }
  issues = list();
  // GitHub's issue list lags a few seconds behind a create (4 Oct 2026: #265 was filed at 12:42:15 and the pinned list, rebuilt at 12:42:28, said "0 open"). An issue made with
  // the workflow's token starts no ranking run of its own, so read each issue this run filed by number, which is consistent, when the list does not have it yet.
  for (const number of createdNow.filter(number => !issues.some(issue => issue.number === number))) {
    try { issues.push(JSON.parse(gh(['issue', 'view', String(number), '--json', 'number,state,stateReason,labels,body,comments,title,createdAt']))); } catch { /* the next run ranks it */ }
  }
  refreshRanking({gh, issues, repo});
  // Test mistakes the loop teaches itself: a text that closed as a harness mistake three times is dropped from now on; one a real fix closed is unlearned (lib/signatures.mjs).
  const taught = learnSignatures(everything, learned);
  out.learned = {added: taught.added.map(item => item.id), revoked: taught.revoked, total: taught.all.length};
  if (taught.added.length || taught.revoked.length) {
    try {
      gh(['label', 'create', SIGNATURE_LABEL, '--force', '--color', 'CCCCCC', '--description', 'The pinned list of test mistakes the Finder learned to drop before filing']);
      if (signatureIssue) gh(['issue', 'edit', String(signatureIssue.number), '--body', signaturesBody(taught.all)]);
      else gh(['issue', 'create', '--title', '🧠 Test mistakes the Finder learned (kept automatically)', '--label', SIGNATURE_LABEL, '--body', signaturesBody(taught.all)]);
    } catch (error) { console.error(`learned signatures not stored: ${error.message}`); }
  }
  const branches = JSON.parse(gh(['pr', 'list', '--state', 'open', '--limit', '100', '--json', 'headRefName'])).map(pr => pr.headRefName);
  out.candidate = pickCandidate(issues, {openBranches: branches});
  return {...out, findings};
}

// The open issues of the loop and the open fix branches -> the most critical issue that is ready (or null). Used by the fixer (pick.mjs).
// The candidates for the parallel fixer, each with its siblings (the other open findings of its kind).
export function chooseCandidates({gh = realGh, now = Date.now(), max = 4} = {}) {
  const issues = JSON.parse(gh(['issue', 'list', '--label', LABEL, '--state', 'open', '--limit', '300', '--json', 'number,state,stateReason,labels,body,comments,title,createdAt']));
  const branches = JSON.parse(gh(['pr', 'list', '--state', 'open', '--limit', '100', '--json', 'headRefName'])).map(pr => pr.headRefName);
  return pickCandidates(issues, {openBranches: branches, now, max}).map(candidate => withSiblings(candidate, issues));
}
export function withSiblings(candidate, issues) {
  const kindOf = issue => /·\s*([a-z0-9-]+)\s*·/.exec(issue.body || '')?.[1] || '';
  return {...candidate, siblings: issues.filter(issue => issue.number !== candidate.number && issue.state === 'OPEN' && kindOf(issue) === kindOf(candidate)).map(issue => `#${issue.number} ${issue.title}`)};
}
export function chooseCandidate({gh = realGh, now = Date.now()} = {}) {
  const issues = JSON.parse(gh(['issue', 'list', '--label', LABEL, '--state', 'open', '--limit', '300', '--json', 'number,state,stateReason,labels,body,comments,title,createdAt']));
  const branches = JSON.parse(gh(['pr', 'list', '--state', 'open', '--limit', '100', '--json', 'headRefName'])).map(pr => pr.headRefName);
  const candidate = pickCandidate(issues, {openBranches: branches, now});
  // The other open findings of the same kind: one root cause often shows on several pages (#66 and #74, 3 Oct 2026), and the fix should cover them all.
  const kindOf = issue => /·\s*([a-z0-9-]+)\s*·/.exec(issue.body || '')?.[1] || '';
  return candidate && {...candidate, siblings: issues.filter(issue => issue.number !== candidate.number && issue.state === 'OPEN' && kindOf(issue) === kindOf(candidate)).map(issue => `#${issue.number} ${issue.title}`)};
}

// The fixer's job log: open findings, which are ready, and why each other one was passed over (readinessSummary).
export function fixerSummary({gh = realGh, now = Date.now(), candidate = null} = {}) {
  const issues = JSON.parse(gh(['issue', 'list', '--label', LABEL, '--state', 'open', '--limit', '300', '--json', 'number,state,stateReason,labels,body,comments,title,createdAt']));
  const branches = JSON.parse(gh(['pr', 'list', '--state', 'open', '--limit', '100', '--json', 'headRefName'])).map(pr => pr.headRefName);
  return readinessSummary(issues, {openBranches: branches, now, candidate});
}

// A verdict-only pass (off unless the repo variable JOB_PILOTTO_FIXER_VERDICTS is "on": it spends AI credit): an open finding seen on ONE commit, which the fixer will not touch, is read by Claude
// WITHOUT editing anything. It says `false-positive` (the issue is closed `wontfix-auto`) or `real` (labelled `confirmed`, so the next normal run fixes it). Six of fourteen issues on 3 Oct 2026
// were false positives that a person had to find by reading the handler. Most critical first; never one already judged, parked, or clean in the latest run.
// Up to `max` of them, most critical first: ui-verdict.yml judges several at once, in parallel (one per fixer run took days for a run's worth of findings).
export function chooseVerdictCandidates({gh = realGh, now = Date.now(), max = 5} = {}) {
  const issues = JSON.parse(gh(['issue', 'list', '--label', LABEL, '--state', 'open', '--limit', '300', '--json', 'number,state,stateReason,labels,body,comments,title,createdAt']));
  const ready = issues.filter(issue => {
    const labels = (issue.labels || []).map(label => label.name || label);
    // "Not seen in the latest run" is judged too: the AI review is not deterministic and a failure-state bug shows only sometimes, so a real one could close
    // itself unjudged (4 Oct 2026: "Failed run shows all steps with green checks"). A confirmed one is never auto-closed.
    if (!labels.some(name => name.startsWith('fp:')) || [NEEDS_HUMAN, FALSE_POSITIVE, CONFIRMED].some(name => labels.includes(name))) return false;
    if (/\*\*LOW\*\*/.test(issue.body || '')) return false;   // no AI credit on polish: low findings are listed, not judged or fixed
    const kind = /·\s*([a-z0-9-]+)\s*·/.exec(issue.body || '')?.[1] || '';
    // Every one-off finding, a failed step too (6 Oct 2026: until then only one that ran out of time was judged, and 14 of 25 filed failed steps were the test's mistake).
    return !!kind && recentSightings(issue, now) < SIGHTINGS_NEEDED;
  });
  ready.sort((a, b) => score(b, now) - score(a, now) || a.number - b.number);
  return ready.slice(0, max).map(issue => ({...issue, mode: 'verdict'}));
}
// The fixer's own fallback (one when nothing is ready to fix): the most critical one-off finding.
export const chooseVerdictCandidate = options => chooseVerdictCandidates({...options, max: 1})[0] || null;

// The files the fix step reads: which issue, its id, its "before" screenshot, and the prompt.
export function writeCandidate(candidate, outDir) {
  const base = fs.readFileSync(new URL(candidate.mode === 'verdict' ? './ui-verdict-prompt.md' : './ui-fix-prompt.md', import.meta.url), 'utf8');
  fs.writeFileSync(path.join(outDir, 'candidate.json'), JSON.stringify({mode: candidate.mode || 'fix', number: candidate.number, title: candidate.title, id: candidate.labels.map(l => l.name).find(n => n.startsWith('fp:')).slice(3), screenshot: screenshotOf(candidate)}));
  // The owner's corrections (reversals.mjs writes them first): the judge learns from the cases a person decided the other way.
  const lessons = candidate.mode === 'verdict' && fs.existsSync(path.join(outDir, 'lessons.md')) ? fs.readFileSync(path.join(outDir, 'lessons.md'), 'utf8') : '';
  fs.writeFileSync(path.join(outDir, 'prompt.md'), promptFor(candidate, base) + lessons);
}

// What people wrote on the issue: the loop's own comments (Seen again, Not seen, Closed, verdicts) are left out; a person's note often names the real cause. Until 3 Oct 2026 the
// fixer never saw them: #94's comment said "the bug is the raw API error, not the overflow" and PR #101 fixed the overflow only.
const LOOP_COMMENT = /^(?:<!-- ui-loop-|Seen again|Not seen|Closed|Closed by the UI loop|Judged real by|The UI loop could not|A fix was tried|The proposed change was refused|Correction: my earlier)/;
// Only the repository's own people: the repo is public, and a stranger's comment must never steer what the fixer writes.
const TRUSTED = ['OWNER', 'MEMBER', 'COLLABORATOR'];
export const peopleSaid = issue => (issue.comments || []).filter(comment => TRUSTED.includes(comment.authorAssociation) && !LOOP_COMMENT.test(String(comment.body || '').trim())
  && !/\[bot\]$|^github-actions$/.test(comment.author?.login || ''))
  .slice(-5).map(comment => String(comment.body || '').trim().slice(0, 800)).filter(Boolean);
export const promptFor = (issue, base) => `${base}\n\n---\nTHE FINDING (issue #${issue.number}):\n${issue.title}\n\n${issue.body}\n` + (peopleSaid(issue).length
  ? `\n---\nWHAT PEOPLE WROTE ON THE ISSUE (read it first: it may name the real cause, and it outranks the finding's own wording):\n${peopleSaid(issue).map(text => `- ${text}`).join('\n')}\n` : '') + (issue.siblings?.length
  ? `\n---\nOTHER OPEN FINDINGS OF THE SAME KIND (check whether they have the same root cause; if so, fix it once where they all go through, and name them in your summary):\n${issue.siblings.join('\n')}\n` : '');

if (import.meta.url === pathToFileURL(process.argv[1] || '').href) {
  const args = process.argv.slice(2);
  const option = name => { const i = args.indexOf(`--${name}`); return i >= 0 ? args[i + 1] : ''; };
  const outDir = option('out') || '.heal';
  fs.mkdirSync(outDir, {recursive: true});
  // Only the pinned list: rebuilt when an issue is opened, closed or relabelled (ui-ranking.yml), not just after an e2e run.
  if (args.includes('--rank-only')) {
    const issues = JSON.parse(realGh(['issue', 'list', '--label', LABEL, '--state', 'all', '--limit', '300', '--json', 'number,state,stateReason,labels,body,comments,title,createdAt']));
    const {ranked} = refreshRanking({issues, repo: process.env.REPO || process.env.GITHUB_REPOSITORY || ''});
    console.log(`Ranking rebuilt: ${ranked.length} open.`);
    process.exit(0);
  }
  // Judge before filing, step 1: the new findings and their pictures, nothing written to GitHub (ui-findings.yml).
  if (option('pending-out')) {
    const {pending} = triage({artifacts: option('artifacts'), runUrl: option('run-url'), build: option('build'), platform: option('platform') || 'mac', pendingOnly: true});
    fs.writeFileSync(option('pending-out'), JSON.stringify(pending, null, 2));
    console.log(`${pending.length} new finding(s) to judge before filing`);
    if (process.env.GITHUB_OUTPUT) fs.appendFileSync(process.env.GITHUB_OUTPUT, `pending=${pending.length}\n`);
    process.exit(0);
  }
  const verdictsFile = option('verdicts');
  const verdicts = verdictsFile && fs.existsSync(verdictsFile) ? JSON.parse(fs.readFileSync(verdictsFile, 'utf8')) : null;
  const incomplete = String(option('incomplete') || '').split(',').map(name => name.trim()).filter(Boolean);   // the suites whose job was cancelled or timed out (ui-findings.yml)
  const result = triage({artifacts: option('artifacts'), runUrl: option('run-url'), build: option('build'), platform: option('platform') || 'mac', verdicts, incomplete});
  for (const item of result.trackerRows || []) console.log(`Bug Tracker row for #${item.number}: ${(await writeTrackerRow({token: process.env.NOTION_BRAIN_WRITE_TOKEN, db: process.env.BUG_TRACKER_DB, row: trackerRow(item)})).status}`);
  const lines = [`## UI findings`, `${result.findings.length} finding(s) in this run: ${result.filed.length} new, ${result.again.length} seen again, ${result.gone.length} not seen any more, ${result.closed.length} closed after a second clean run${result.judgedNoise?.length ? `, ${result.judgedNoise.length} judged noise before filing (not filed)` : ''}${result.regressions?.length ? `, ${result.regressions.length} regression(s) (a fixed defect came back)` : ''}${result.flaky?.length ? `, ${result.flaky.length} step(s) marked flaky` : ''}${result.intermittent?.length ? `, ${result.intermittent.length} step(s) intermittent (a wrong value that came right on a rerun: a bug, not a flake)` : ''}${result.skipped.length ? `; ${result.skipped.length} suite(s) not filed (${result.skipped.map(item => `${item.suite}: ${item.why}`).join(', ')})` : ''}${result.unreviewed.length ? `; the AI could not review ${result.unreviewed.length} page(s) (${[...new Set(result.unreviewed.map(item => `${item.view}: ${item.why}`))].join(', ')}): nothing filed or cleared for them` : ''}.`];
  // The producer only files and updates issues. The fixer (ui-fix.yml, four times a day) picks the most critical one: node pick.mjs.
  if (!args.includes('--file-only')) {
    const candidate = result.candidate;
    if (candidate) { writeCandidate(candidate, outDir); lines.push(`Ready to fix: #${candidate.number} ${candidate.title}`); }
    else lines.push('Nothing is ready to fix.');
    if (process.env.GITHUB_OUTPUT) fs.appendFileSync(process.env.GITHUB_OUTPUT, `candidate=${candidate ? candidate.number : 'none'}\n`);
  }
  if (result.dropped?.length) lines.push(droppedTable(result.dropped));
  fs.writeFileSync(path.join(outDir, 'run-summary.json'), JSON.stringify(runSummary(result, {runUrl: option('run-url'), build: option('build'), incomplete})));
  console.log(lines.join('\n'));
}
