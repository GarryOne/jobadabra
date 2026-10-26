#!/usr/bin/env node
// Layer 3, the hand-started live smoke (spec: docs/superpowers/specs/2026-10-10-applying-reliability-layers.md). For each shape of smoke-sites.json: one of the owner's
// postings (read-only from the app's jobs.sqlite, rotating by day), run live through the e2e app with the real extension (the `npm run live` machinery,
// headless, HELD: no account button, never Submit), read where it got to (lib/record-sites.mjs parseLive), compare with the last report, and list the boards the
// fleet digest flags as dropped (layer 4). Report: <QA folder>/smoke-reports/<day>.json (outside the repo: it names real postings, and outlives worktrees). Exit 1 when a shape reached less than last time.
// Usage: cd desktop/e2e && npm run record-sites [-- --only <shape words> | --all] [RECORD_SHARE=10] [RECORD_SECONDS=90]: this run's share of the pool (the least recently run first), or
// --all / --only. Each shape is compared with ITS last run, however long ago. It never schedules itself: the owner starts it by hand.
import {SiteLimitError, blockSignal, guardLiveVisit, markBlocked} from './lib/site-ledger.mjs';
import {recordVar} from '../../tools/record-env.mjs';
import {ensureStagedWorker} from './lib/staged-worker.mjs';
import {execFileSync, spawn} from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {orderPool} from './lib/record-sites-order.mjs';
import {SITE_REFUSED, compare, engineLine, lastSeen, poolShapes, runShare, selectRows, shareSize, marksBlind, parseLive, pickPosting, placeFound, rungFields, shortfall, signature, smokeEngine, verdictFields} from './lib/record-sites.mjs';
import {hostOnly, ping, poolRows, upload} from './lib/applying-report.mjs';
import {uploadLedger} from './lib/fix-ledger.mjs';
import {poolCard, sendPoolCard} from './lib/pool-card.mjs';
import {earlierReports, recordSite} from './lib/record-sites-record.mjs';
import {keepsSteps, removeOldEvidence, stateOf} from './lib/evidence-clean.mjs';
import {evidenceLines, runFinished, saveElectronLeg, writeBundle} from './lib/evidence-bundle.mjs';
import {dropCandidate, saveCandidate} from './lib/replay-candidate.mjs';
import {keepCapture} from './lib/capture-library.mjs';
import {fetchWanted, wantedFirst} from './lib/wanted-hosts.mjs';
import {heavy, yieldHeavy} from './lib/heavy.mjs';
import {runArtifacts} from './lib/run-artifacts.mjs';
import {POOL_LINE, eligibilityOff, poolEnv} from './lib/pool-eligibility.mjs';
import {capRows, ciLimits, electronLegs, stopReason} from './lib/pool-ci.mjs';
import {causeWord, endingOf, endingWord} from './lib/ending.mjs';
import {isCi} from './lib/engine.mjs';
import {electronLegRefused, visitsLeft, settleRefusal, lastPaired, lessThanLast, pairResult, pairedLine, pairedSample, pairedSize, pathDifferenceLine, secondVisitsAllowed, visitPlan} from './lib/record-sites-paths.mjs';
heavy('e2e-smoke', import.meta.url, {klass: process.argv.includes('--only') ? 'proof' : process.argv.includes('--discover') ? 'explore' : 'pool'});   // one heavy run at a time on this Mac (tools/heavy-lock.sh); a held row proof goes before the pool's whole list

const here = path.dirname(fileURLToPath(import.meta.url));
export const QA_DIR = path.join(os.homedir(), 'Library/Application Support/Job Pilotto QA');   // survives profile resets and removed worktrees
const REPORTS = recordVar('REPORTS') || path.join(QA_DIR, 'smoke-reports');
const CANDIDATES = recordVar('CANDIDATES') || path.join(QA_DIR, 'replay-candidates');   // failing shapes' pages, scrubbed: on this Mac, never in the repo (lib/replay-candidate.mjs)
export const POOL_SITES = path.join(here, 'smoke-sites.json');   // THE pool (owner, 12 Oct 2026: every row in the repo, so CI runs them all); discovery writes it
export const LOCAL_SITES = recordVar('SITES') || path.join(QA_DIR, 'smoke-sites.json');   // a Mac's optional extra rows not yet moved into the repo: read, never written
const JOBS_DB = path.join(os.homedir(), 'Library/Application Support/Job Pilotto/data/jobs.sqlite');

export function postingsLike(likes, run = execFileSync, limit = 40) {
  const where = likes.map(like => `jobs.url like '${String(like).replace(/'/g, "''")}'`).join(' or ');
  const out = run('sqlite3', ['-readonly', '-separator', '\t', JOBS_DB, `select jobs.url, jobs.title, companies.name from jobs join companies on companies.id = jobs.company_id where ${where} order by jobs.url limit ${Number(limit) || 40}`], {encoding: 'utf8'});
  return String(out).split('\n').filter(Boolean).map(line => { const [url, title, company] = line.split('\t'); return {url, title, company}; });
}

// The posting still exists (by its HTTP status only: 404/410 = gone). A gone posting is noted, never counted as a regression.
export async function postingStatus(url, fetcher = fetch) {
  try { const answer = await fetcher(url, {method: 'GET', redirect: 'follow', signal: AbortSignal.timeout(20000)}); return answer.status; } catch { return 0; }
}

// The last error line of a run's output, so a leg that did not finish says why (18:20, 11 Oct 2026: the Electron leg's seed failed, and only a temp folder knew).
const lastError = output => (String(output || '').split('\n').filter(line => /Error|✗|not ok|never /.test(line)).at(-1) || 'no error line').trim().slice(0, 200);

function liveRun(posting, seconds, captureDir = '', engine = smokeEngine()) {
  return new Promise(resolve => {
    const started = Date.now();
    // The default (lib/record-sites.mjs smokeEngine): the row on the app's own path without Electron (live.mjs), printing the same lines parseLive reads.
    if (engine === 'node') {
      const child = spawn('node', ['live.mjs', posting.url, '--title', posting.title || '', '--company', posting.company || '', ...(captureDir ? ['--capture', captureDir, '--no-library'] : [])],
        {cwd: here, env: {...poolEnv(), LIVE_SECONDS: String(seconds), ...(posting.row ? {JP_ROW_NAME: posting.row} : {}), ...(isCi() ? {JP_FILL_VIDEO_DIR: path.join(os.tmpdir(), 'jp-fill-videos')} : {})}});   // the pool row's name: its network record carries it (lib/live-row.mjs)
      let output = '';
      child.stdout.on('data', chunk => { output += chunk; }); child.stderr.on('data', chunk => { output += chunk; });
      child.on('close', (code, signal) => resolve({output, code, signal, seconds: Math.round((Date.now() - started) / 1000)}));
      return;
    }
    const child = spawn('node', ['run-all.mjs', '--only', 'applyflows'], {cwd: here, env: {...poolEnv(), E2E_ARTIFACTS: runArtifacts(), LIVE: '1', LIVE_URL: posting.url, LIVE_TITLE: posting.title || '', LIVE_COMPANY: posting.company || '', LIVE_SECONDS: String(seconds), LIVE_CAPTURE_DIR: captureDir, ...(captureDir ? {JOB_PILOTTO_MODEL_MEMO: path.join(captureDir, 'model-memo.json')} : {}), LIVE_ENGINE: process.env.LIVE_ENGINE || 'cli'}});
    let output = '';
    child.stdout.on('data', chunk => { output += chunk; });
    child.stderr.on('data', chunk => { output += chunk; });
    child.on('close', (code, signal) => resolve({output, code, signal, seconds: Math.round((Date.now() - started) / 1000)}));
  });
}

// The whole pool to /admin/form-filling/lab, also sites never run: each shape's newest known flow signature (this run, else the last report, else the one stored with it).
const sendPool = (shapes, reports, results = {}) => upload('pool', poolRows(shapes, {...Object.fromEntries(shapes.filter(item => item.signature).map(item => [item.shape, item.signature])),
  ...Object.fromEntries(Object.entries(lastSeen(reports)).map(([shape, item]) => [shape, item.signature])), ...Object.fromEntries(Object.entries(results).map(([shape, item]) => [shape, item.signature]))}), {full: true});   // `shapes` is the whole pool list, not this run's share: the site drops the names it lacks

function droppedBoards() {
  try {
    const key = execFileSync('security', ['find-generic-password', '-s', 'job-pilotto.site.api_key', '-w'], {encoding: 'utf8'}).trim();   // never printed
    const json = execFileSync('curl', ['-s', '--max-time', '20', '-H', `Authorization: Bearer ${key}`, '-H', 'X-Caller: smoke-dropped-boards', 'https://www.jobpilotto.top/admin/form-filling/real-users/digest.json'], {encoding: 'utf8'});
    return (JSON.parse(json).boards || []).filter(board => board.dropped).map(board => ({board: board.board, earlier: board.earlierFilledShare, recent: board.recentFilledShare}));
  } catch { return null; }   // no key or no network: the report says the fleet was not read
}

// --discover [--limit N]: candidates from the loaded profile's jobs (a few per host, more from job boards; none already in the pool), each run once live
// (held); one that shows a flow signature the pool does not have joins the repo's pool list (POOL_SITES: commit it, then CI runs it). Report: <QA folder>/smoke-reports/discover-<day>.json.
async function discover(limit) {
  const read = file => { try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return {shapes: []}; } };
  const repo = read(POOL_SITES), pool = poolShapes(repo.shapes, read(LOCAL_SITES).shapes);
  const knownUrls = new Set(pool.flatMap(item => item.urls || []));
  const reports = fs.existsSync(REPORTS) ? fs.readdirSync(REPORTS).filter(name => /^\d{4}-\d\d-\d\d\.json$/.test(name)).map(name => read(path.join(REPORTS, name))) : [];
  const knownSignatures = new Set([...pool.map(item => item.signature), ...Object.values(lastSeen(reports)).map(item => item.signature)].filter(Boolean));
  const jobs = postingsLike(['http%'], undefined, 3000).filter(item => !/mail\.google\./.test(item.url));
  const day = new Date().toISOString().slice(0, 10), reportFile = path.join(REPORTS, `discover-${day}.json`);
  const seen = [...(read(reportFile).seen || [])];   // a restart the same day carries on: what the report already holds is not visited again (a stopped run used to start over, 10 Oct 2026)
  const wanted = await fetchWanted(), ordered = wantedFirst(jobs, wanted.hosts, new Set([...knownUrls, ...seen.map(item => item.url)]));   // hosts real users apply on that the pool lacks come first (lib/wanted-hosts.mjs)
  const chosen = ordered.chosen.slice(0, limit);
  const save = () => { fs.mkdirSync(REPORTS, {recursive: true}); fs.writeFileSync(reportFile, `${JSON.stringify({day, seen, suggested: wanted.hosts.map(item => item.host), noPosting: ordered.missing}, null, 1)}\n`); };   // after every candidate, not only at the end
  console.log(`smoke discover: ${wanted.hosts.length} suggested host(s) from real use${wanted.why ? ` (${wanted.why})` : ''}${ordered.missing.length ? `; no posting among your jobs for: ${ordered.missing.join(', ')}` : ''}`);
  console.log(`smoke discover: ${chosen.length} candidate(s) from ${jobs.length} job(s); ${knownSignatures.size} signature(s) already in the pool`);
  for (const posting of chosen) {
    const status = await postingStatus(posting.url);
    if (status === 404 || status === 410) { seen.push({url: posting.url, note: `gone (HTTP ${status})`}); save(); continue; }
    const run = await liveRun(posting, Number(recordVar('SECONDS') || 90)), result = parseLive(run.output), flow = signature(result);
    const fresh = result.reached !== 'none' && flow !== 'unclear' && !knownSignatures.has(flow);   // an unclear run teaches nothing: listed for the twin loop, not added
    seen.push({url: posting.url, signature: flow, reached: result.reached, added: fresh});
    save();
    console.log(`smoke discover: ${flow} ${fresh ? 'NEW: added to the pool' : 'known'} (${hostOnly(posting.url)})`);
    if (fresh) {
      knownSignatures.add(flow);
      placeFound(repo.shapes, posting, flow, day);
      fs.writeFileSync(POOL_SITES, `${JSON.stringify(repo, null, 1)}\n`);
      // the page follows each find, not only the end of the run: a run that stops early (session closed, 10 Oct 2026) used to leave the page behind
      try { console.log(`smoke discover: ${await sendPool(poolShapes(repo.shapes, read(LOCAL_SITES).shapes), reports)}`); } catch (error) { console.log(`smoke discover: upload failed, the run goes on (${String(error?.message || error).slice(0, 120)})`); }
    }
  }
  save();
  console.log(`smoke discover: ${seen.filter(item => item.added).length} new shape(s) added to ${POOL_SITES}: commit them, and CI runs them too`);
  console.log(`smoke discover: ${await sendPool(poolShapes(repo.shapes, read(LOCAL_SITES).shapes), reports)}`);
  return 0;
}

async function main() {
  ensureStagedWorker();   // a worker edit since the last staging would run the old prompt (lib/staged-worker.mjs)
  removeOldEvidence(path.join(REPORTS, 'evidence'));   // old evidence folders; the newest of each row stays (lib/evidence-clean.mjs)
  if (process.argv.includes('--discover')) return discover(Number(process.argv[process.argv.indexOf('--limit') + 1]) || 30);
  const only = process.argv.includes('--only') ? process.argv[process.argv.indexOf('--only') + 1] : '';
  const seconds = Number(recordVar('SECONDS') || 90);
  // The pool is one list in the repo (owner, 12 Oct 2026: postings are public pages; the owner's details never enter a run), plus a Mac's optional extra rows.
  const read = file => { try { return JSON.parse(fs.readFileSync(file, 'utf8')).shapes || []; } catch { return []; } };
  const shapes = poolShapes(read(POOL_SITES), read(LOCAL_SITES));
  const day = new Date().toISOString().slice(0, 10), results = {}, earlierList = earlierReports(REPORTS, day), previous = lastSeen(earlierList);
  // Each site is saved to the day's report and sent to /admin/form-filling/lab the moment it ends, so stopping a run loses only the site in progress (lib/record-sites-record.mjs).
  const finish = async shape => {
    const appLog = (() => { try { return fs.readFileSync(path.join(REPORTS, `${day}-${shape.replace(/\W+/g, '-')}.app.log`), 'utf8'); } catch { return ''; } })();
    const ended = endingOf(results[shape], appLog, {ci: isCi()});   // the outcome contract's ending (lib/ending.mjs): in the day's report, the CI summary and the upload
    Object.assign(results[shape], {ending: endingWord(ended), cause: causeWord(ended)}, ended.aiMiss ? {aiMiss: true} : {});
    const item = results[shape], found = recordSite({dir: REPORTS, day, shape, result: item, earlier: previous});
    console.log(`record-sites: ${shape}: ${await sendPoolCard(poolCard(shape, item, {day}))}`);   // the same loop users' fills feed (lib/pool-card.mjs)
    console.log(`record-sites: ${await upload('smoke', [{name: shape, host: hostOnly(item.url), reached: item.reached, filled: item.filled, left: item.left, note: item.note || '', regression: !!found, ending: item.ending || '', cause: item.cause || '', ...rungFields(item), ...verdictFields(item)}])}`);
  };
  const archived = shapes.filter(item => item.stage === 'archived');   // life cycle (site/src/applying-stage.js): an archived row is never re-run by a list or a share; only a fixer's --only names it
  const pool = selectRows(shapes, only).filter(item => only || item.stage !== 'archived');   // a row's exact name, one row's words, or several rows' joined by |
  if (archived.length && !only) console.log(`record-sites: ${archived.length} archived row(s) not run (kept for history and offline debugging)`);
  const today = (() => { try { return [JSON.parse(fs.readFileSync(path.join(REPORTS, `${day}.json`), 'utf8'))]; } catch { return []; } })();   // a run earlier today counts too
  // Every mode starts with the rows tested the least (lib/record-sites-order.mjs); only --only is a fixer's own choice. A row resting today (site-ledger) is skipped and listed.
  const postingOf = ({urls = [], like = []}) => pickPosting([...urls.map(url => ({url, title: '', company: ''})), ...(like.length ? postingsLike(like) : [])]);
  const resting = item => { const posting = postingOf(item); if (!posting) return false; try { guardLiveVisit(posting.url, {record: false}); return false; } catch (error) { return error instanceof SiteLimitError; } };
  const ranked = only ? {order: pool, rested: [], lines: []} : orderPool(pool, [...earlierList, ...today], day, {rested: resting});
  const limits = ciLimits();   // the CI workflow's hard caps (rows, AI dollars); a Mac run has none unless it sets them (lib/pool-ci.mjs)
  const chosen = only || process.argv.includes('--all') ? ranked.order : runShare(ranked.order, shareSize());
  const capped = capRows(chosen, limits.maxRows);
  chosen.splice(capped.run.length);   // the row cap: the rows past it are named below, not run
  const thisRun = {ran: [], unfinished: [], skipped: [], cut: capped.cut.map(item => item.shape), stopped: '', usd: 0, maxUsd: limits.maxUsd, maxRows: limits.maxRows};   // the day report's record of this run (lib/pool-ci.mjs summary)
  if (thisRun.cut.length) console.log(`record-sites: row cap ${limits.maxRows}: not run this time: ${thisRun.cut.join(', ')}`);
  if (limits.maxUsd) console.log(`record-sites: AI dollar cap $${limits.maxUsd.toFixed(2)}: the run stops between rows once its spend reaches it`);
  console.log(`record-sites: ${chosen.length} of ${shapes.length} shapes in this run (${only ? `--only ${only}` : 'the least tested first: never run, then the fewest runs in 14 days, then the oldest'})`);
  for (const line of ranked.lines.slice(0, chosen.length)) console.log(line);
  if (ranked.rested.length) console.log(`record-sites: rested today (site limit or block page), not counted as tested: ${ranked.rested.map(item => item.shape).join(', ')}`);
  console.log(engineLine(smokeEngine()));
  console.log(`record-sites: ${eligibilityOff(poolEnv()) ? POOL_LINE : 'eligibility check: ON in this run (RECORD_ELIGIBILITY=on)'}`);
  // The pool runs on plain node; a few rows each pass run on Electron too, the least recently paired first (lib/record-sites-paths.mjs; RECORD_PAIRED=0 skips).
  const pairs = new Set(smokeEngine() === 'node' ? pairedSample(chosen, lastPaired([...earlierList, ...today]), pairedSize(process.env, only), item => visitsLeft(item.urls?.[0] || '', guardLiveVisit) >= 2) : []);
  console.log(`record-sites: paired sample this pass (plain node and Electron): ${[...pairs].join(', ') || 'none'}`);
  const legs = electronLegs() && secondVisitsAllowed(process.env, only);   // CI: no second visit after a block page, and the runner has no Electron (lib/pool-ci.mjs); a single-row run: none (lib/record-sites-paths.mjs)
  console.log(visitPlan(chosen, pairs, legs).line);   // before anything starts: the hosts and how many visits (a single-row recording is one)
  if (!legs) console.log(`record-sites: no Electron leg ${electronLegs() ? 'in a single-row run (RECORD_ELECTRON_LEG=1 asks for one)' : 'on CI'}: a refused or fallen row is not visited again`);
  for (const {shape, like = [], urls = []} of chosen) {
    yieldHeavy();   // between two sites a waiting proof (or shorter run) goes first; this run waits for its place back (tools/heavy-lock.sh yield)
    const aiDown = Object.entries(results).find(([, item]) => item.aiRefused);   // a refused AI: every later row would run without AI too
    if ((thisRun.stopped = stopReason({spent: thisRun.usd, maxUsd: limits.maxUsd, refused: aiDown && {shape: aiDown[0], why: aiDown[1].aiRefused.why}}))) { console.log(`record-sites: stopped: ${thisRun.stopped}; not run: ${chosen.slice(chosen.findIndex(item => item.shape === shape)).map(item => item.shape).join(', ')}`); break; }
    const posting = pickPosting([...urls.map(url => ({url, title: '', company: ''})), ...(like.length ? postingsLike(like) : [])]);
    if (!posting) { results[shape] = {reached: 'none', note: 'no posting of this shape in the job list'}; console.log(`record-sites: ${shape}: no posting`); await finish(shape); continue; }
    const status = await postingStatus(posting.url);
    if (status === 404 || status === 410) { results[shape] = {url: posting.url, reached: 'none', note: `posting gone (HTTP ${status})`}; console.log(`record-sites: ${shape}: posting gone (HTTP ${status}): replace it in smoke-sites.json`); await finish(shape); continue; }
    try { guardLiveVisit(posting.url, {record: false}); } catch (error) { thisRun.skipped.push({shape, why: error.message.slice(0, 200)}); console.log(`record-sites: ${shape}: skipped, nothing recorded: ${error.message}`); continue; }   // the per-site daily limit (lib/site-ledger.mjs); the run itself records the visit
    console.log(`record-sites: ${shape}: ${posting.url} (HELD: no account button, never Submit; ~${seconds}s)`);
    await ping(shape, 'start');
    const captureDir = fs.mkdtempSync(path.join(os.tmpdir(), 'jp-capture-'));
    const run = await liveRun({...posting, row: shape}, seconds, captureDir).finally(() => ping(shape, 'end'));
    if (!runFinished(run)) {   // killed or cut short (eb's 23 s Datadog row, 11 Oct 2026): nothing is recorded, uploaded or saved as a candidate
      fs.rmSync(captureDir, {recursive: true, force: true});
      thisRun.unfinished.push({shape, why: run.signal ? `killed by ${run.signal}` : `no end of the watch, exit ${run.code}`});
      console.log(`record-sites: ${shape}: the run did not finish (${run.signal ? `killed by ${run.signal}` : `no end of the watch, exit ${run.code}`}, ${run.seconds}s): nothing recorded, nothing uploaded`);
      continue;
    }
    results[shape] = {url: posting.url, ...parseLive(run.output), exit: run.code, seconds: run.seconds};
    thisRun.ran.push(shape);
    results[shape].applicant = process.env.JP_APPLICANT || 'thin';   // which test applicant ran it (lib/applicant-seed.mjs): runs compare only with the same one
    thisRun.usd += results[shape].usd || 0;   // the row's AI on the CI key (live.mjs prints it; a Mac's plan has none)
    results[shape].signature = signature(results[shape]);
    results[shape].marksBlind = marksBlind(results[shape]);
    results[shape].short = shortfall(results[shape]);   // reached the form but filled under half: a failure the step alone hides
    // Less than its last result on plain node: once more on Electron at once, the same posting; a regression only if Electron shows it too (lib/record-sites-paths.mjs).
    const fell = smokeEngine() === 'node' ? lessThanLast(previous[shape], results[shape]) : '';
    const blocked = blockSignal(run.output);
    if (blocked) markBlocked(posting.url, blocked);   // a block page: this site rests until tomorrow, so no Electron leg either (lib/site-ledger.mjs)
    const refused = !blocked && smokeEngine() === 'node' && results[shape].note === SITE_REFUSED;   // a block page on plain node: Electron decides whether the site refuses (lib/record-sites-paths.mjs settleRefusal)
    const legRefused = legs && !blocked && (fell || refused || pairs.has(shape)) ? electronLegRefused(posting.url, guardLiveVisit) : '';
    if (legRefused) { results[shape].electronSkipped = legRefused.slice(0, 200); console.log(`record-sites: ${shape}: no Electron leg (the site limit, not the product): ${legRefused}`); }
    if (legs && !blocked && !legRefused && (fell || refused || pairs.has(shape))) {
      console.log(`record-sites: ${shape}: ${fell ? `less than its last result on plain node (${fell}): once more on Electron, the same posting` : refused ? 'refused on plain node: once more on Electron, the same posting' : 'paired sample: the same posting on Electron'}`);
      const electronCapture = fs.mkdtempSync(path.join(os.tmpdir(), 'jp-capture-electron-'));
      const again = await liveRun(posting, seconds, electronCapture, 'electron'), electron = runFinished(again) ? parseLive(again.output) : null;
      saveElectronLeg({dir: path.join(REPORTS, 'evidence'), day, shape, output: again.output, captureDir: electronCapture});   // what Electron saw, beside the plain run's bundle (lib/evidence-bundle.mjs)
      fs.rmSync(electronCapture, {recursive: true, force: true});
      Object.assign(results[shape], pairResult(results[shape], electron, {day, previous: previous[shape]}));
      const settled = settleRefusal(results[shape], electron);   // the paired line above keeps the plain/Electron difference; the row itself becomes Electron's result
      if (settled) {
        Object.assign(results[shape], settled);
        if (!settled.note) delete results[shape].note;
        results[shape].signature = signature(results[shape]); results[shape].marksBlind = marksBlind(results[shape]); results[shape].short = shortfall(results[shape]);
      }
      console.log(`record-sites: ${shape}: Electron reached ${electron ? `${electron.reached}${electron.filled != null ? `, ${electron.filled} filled` : ''}` : `nothing (the run did not finish: ${lastError(again.output)})`}${results[shape].pathDifference ? ': PATH DIFFERENCE, not a regression' : ''}`);
    }
    fs.mkdirSync(REPORTS, {recursive: true});
    fs.writeFileSync(path.join(REPORTS, `${day}-${shape.replace(/\W+/g, '-')}.log`), run.output);
    // A failed run keeps its last page as a replay candidate (the owner's question "did we save a site replay?": no); a run that passed drops an older candidate of the day.
    const html = (() => { try { return fs.readFileSync(path.join(captureDir, 'page.html'), 'utf8'); } catch { return ''; } })();
    try { fs.writeFileSync(path.join(REPORTS, `${day}-${shape.replace(/\W+/g, '-')}.app.log`), fs.readFileSync(path.join(captureDir, 'app.log'), 'utf8')); } catch { /* no app log kept: the run did not get that far */ }
    const aiCalls = (() => { try { return fs.readFileSync(path.join(captureDir, 'ai-calls.json'), 'utf8'); } catch { return ''; } })();   // the app's live page-kind calls (desktop/lib/live-capture.js)
    const appLog = (() => { try { return fs.readFileSync(path.join(captureDir, 'app.log'), 'utf8'); } catch { return ''; } })();
    results[shape].evidence = path.relative(REPORTS, writeBundle({dir: path.join(REPORTS, 'evidence'), day, shape, output: run.output, appLog, aiCalls, result: results[shape], captureDir, keepSteps: keepsSteps({...results[shape], regression: Boolean(fell)}), state: stateOf({...results[shape], regression: Boolean(fell)})}));   // one bundle per shape (lib/evidence-bundle.mjs)
    results[shape].lines = evidenceLines(appLog);   // the four lines that matter, quoted in the day's report
    console.log(`record-sites: ${shape}: evidence ${path.join(REPORTS, results[shape].evidence, 'evidence.md')}`);
    const kept = saveCandidate({dir: CANDIDATES, day, shape, result: results[shape], html, output: run.output, aiCalls, captureDir, appLog, always: recordVar('KEEP_CANDIDATES') === '1'});   // with the journey, the sheets and the model answers (lib/capture-journey.mjs)
    if (kept) console.log(`record-sites: ${shape}: replay candidate saved in ${kept}`); else dropCandidate({dir: CANDIDATES, day, shape});
    const library = results[shape].tripped ? null : keepCapture({day, shape, result: results[shape], output: run.output, aiCalls, captureDir, appLog});   // every row, passing or not: npm run measure re-runs a build on it offline (lib/capture-library.mjs)
    if (library) console.log(`record-sites: ${shape}: capture kept in ${library}`);
    fs.rmSync(captureDir, {recursive: true, force: true});
    console.log(`record-sites: ${shape}: reached ${results[shape].reached}${results[shape].filled != null ? `, ${results[shape].filled} filled, ${results[shape].left} left` : ''} (${run.seconds}s)`);
    if (results[shape].marksBlind) console.log(`record-sites: ${shape}: MARKS BLIND ${results[shape].marksBlind.starred} labels marked "*", ${results[shape].marksBlind.required} counted required: the required rule missed a layout`);
    if (results[shape].blocked) console.log(`record-sites: ${shape}: BLOCKED (${results[shape].blocked}): the form judge saw the page covered or gone after the fill: needs a fix, not a success`);
    if (results[shape].short) console.log(`record-sites: ${shape}: SHORTFALL ${results[shape].short.miss} missed and ${results[shape].short.noSuggestion} with no suggestion, of ${results[shape].short.total} asked fields (${results[shape].short.done} filled or expected)`);
    await finish(shape);
    try { await sendPool(shapes, earlierList, results); } catch (error) { console.log(`record-sites: pool upload failed, the run goes on (${String(error?.message || error).slice(0, 100)})`); }   // the page follows each site (its flow too), not only the run's end
  }
  const previousFile = earlierList.length ? `${earlierList.length} earlier report(s)` : null;
  const regressions = compare(previous, results), dropped = droppedBoards();
  const differs = pathDifferenceLine(results);   // a fall on plain node that Electron did not show (lib/record-sites-paths.mjs)
  fs.mkdirSync(REPORTS, {recursive: true});
  const saved = (() => { try { return JSON.parse(fs.readFileSync(path.join(REPORTS, `${day}.json`), 'utf8')); } catch { return {}; } })();   // what this run and the day's other runs saved site by site
  fs.writeFileSync(path.join(REPORTS, `${day}.json`), `${JSON.stringify({paired: pairedLine({...saved.results, ...results}), ...(differs ? {pathDifference: differs} : {}), ...saved, day, results: {...saved.results, ...results}, regressions, dropped, comparedWith: previousFile, thisRun}, null, 1)}\n`);
  console.log(`record-sites: ${pairedLine(results)}`);   // the report's first lines: do the paths agree, and what fell on plain node only
  if (differs) console.log(`record-sites: ${differs}`);
  console.log(`record-sites: ${regressions.length ? `REGRESSIONS: ${regressions.map(item => `${item.shape} (${item.why})`).join('; ')}` : 'no regression'}${previousFile ? ` vs ${previousFile}` : ' (first report)'}`);
  const blindMarks = Object.entries(results).filter(([, item]) => item.marksBlind);
  console.log(`record-sites: ${blindMarks.length ? `MARKS BLIND (more "*" labels than required questions counted): ${blindMarks.map(([name, item]) => `${name} (${item.marksBlind.starred} vs ${item.marksBlind.required})`).join('; ')}` : 'no marks blind spot'}`);
  const blockedRows = Object.entries(results).filter(([, item]) => item.blocked);
  console.log(`record-sites: ${blockedRows.length ? `BLOCKED AFTER THE FILL (a dialog, error or overlay over the form): ${blockedRows.map(([name, item]) => `${name} (${item.blocked})`).join('; ')}` : 'none blocked after the fill'}`);
  const shorts = Object.entries(results).filter(([, item]) => item.short);
  console.log(`record-sites: ${shorts.length ? `SHORTFALLS (reached the form, under half filled): ${shorts.map(([name, item]) => `${name} (${item.short.miss + item.short.noSuggestion} unexplained of ${item.short.total})`).join('; ')}` : 'no shortfall'}`);
  console.log(`record-sites: fleet boards dropped: ${dropped == null ? 'not read' : dropped.length ? dropped.map(item => `${item.board} ${item.earlier}→${item.recent}`).join(', ') : 'none'}`);
  console.log(`record-sites: report ${path.join(REPORTS, `${day}.json`)}`);
  console.log(`record-sites: ${await sendPool(shapes, earlierList, results)}`);
  console.log(`record-sites: ${await uploadLedger()}`);   // the Fixed tab's ledger and claims (lib/fix-ledger.mjs)
  return regressions.length ? 1 : 0;
}
if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) process.exit(await main());
