// Uploads a run of the recorded pages (layer 2) or of the nightly smoke (layer 3) to the site's /admin/form-filling/lab (site/src/applying.js), with the owner key from
// the Keychain (never printed). Fixed words and hosts only: never a posting's address, never applicant data. Never from CI, nor from a control run against an
// old build (REAL_EXTENSION_DIR: its failures are on purpose). The recorded replays are the other way round: only CI on a push to main sends them (uploadReplays,
// replays-report.mjs), never a local run. Guard: e2e/test/applying-report.test.mjs.
import {execFileSync} from 'node:child_process';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {stampedAt} from '../../scripts/extension-stamp.mjs';

export const SITE = 'https://www.jobpilotto.top/admin/form-filling/lab';
export const REPLAYS = 'https://www.jobpilotto.top/applying/replays';
// desktop/e2e (not imported from app.mjs: that pulls playwright-core into the desktop unit job, which does not install it; main was red 11 Oct 2026).
const E2E = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const extensionVersion = () => stampedAt();   // the version this checkout's build stamps (scripts/extension-stamp.mjs)
// Whether the build that ran is main's (cc's review, 12 Oct 2026): the checkout's extension/ equals main's, AND its own commit is on main with no uncommitted
// change to the app or the extension (the extension check alone would pass a branch that changes desktop/lib only). A fixer's branch, an unlanded change, an
// unknown main or a git error is not main: its runs stay out of the Resolution tile (site/src/applying-resolution.js), as a PR's run does.
export function buildOnMain({git = args => execFileSync('git', args, {cwd: E2E, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore']})} = {}) {
  try {
    git(['diff', '--quiet', 'HEAD', 'origin/main', '--', '../../extension']);   // throws when the committed extension differs from main's
    git(['merge-base', '--is-ancestor', 'HEAD', 'origin/main']);   // throws when HEAD has commits main does not
    git(['diff', '--quiet', 'HEAD', '--', '../lib', '../renderer', '../main.js', '../../extension']);   // throws on an uncommitted change (paths from desktop/e2e)
    return true;
  } catch { return false; }
}
export const hostOnly = url => { try { return new URL(url).hostname; } catch { return ''; } };
export const skipReason = (env = process.env) => (env.CI ? 'CI' : env.REAL_EXTENSION_DIR ? 'a control run on another build' : env.JP_NO_REPORT ? 'JP_NO_REPORT' : '');

// The owner's site key from the Keychain (or the one given), '' when there is none. Never printed.
export function ownerKey(key) {
  if (key) return key;
  try { return execFileSync('security', ['find-generic-password', '-s', 'job-pilotto.site.api_key', '-w'], {encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore']}).trim(); } catch { return ''; }
}

// A recorded case uploads only with its control (owner, 10 Oct 2026: a case that passed on the old build reached /admin/form-filling/lab as a pass). case.json `control` is
// {build: <the older extension version it was seen failing on>, failed: <the check that failed>}, or {guard: <why it cannot fail on an old build>}. -> '' or why not.
const parts = text => (/^\d+(\.\d+)*$/.test(text || '') ? text.split('.').map(Number) : null);
const older = (a, b) => { for (let i = 0; i < Math.max(a.length, b.length); i++) { if ((a[i] || 0) !== (b[i] || 0)) return (a[i] || 0) < (b[i] || 0); } return false; };
export function controlProblem(item, current) {
  const control = item.control || {};
  if (typeof control.guard === 'string' && control.guard.trim()) return '';
  if (!control.build && !control.failed) return 'no control (case.json "control": {build, failed} seen on an older build, or {guard})';
  const build = parts(control.build), now = parts(current);
  if (!build) return 'control.build is not an extension version';
  if (!control.failed) return 'control has no failed check';
  return now && older(build, now) ? '' : `control.build ${control.build} is not older than this build ${current}`;
}
// The rows to send and the cases held back: {rows, held: [{name, why}]}.
export function uploadable(results, current) {
  const held = [], rows = [];
  for (const result of results) { const why = controlProblem(result, current); if (why) held.push({name: result.name, why}); else rows.push(result); }
  return {rows, held};
}

// -> a one-line outcome, for the run's own output.
// full: the rows are the WHOLE pool list (a pool upload only): the site then drops the names it lacks from the pool table (renamed or removed rows; hidden, not deleted).
export async function upload(kind, rows, {env = process.env, key, fetcher = fetch, day = new Date().toISOString().slice(0, 10), onMain = buildOnMain, full = false} = {}) {
  const why = skipReason(env);
  if (why) return `applying report: not sent (${why})`;
  const token = ownerKey(key);
  if (!token) return 'applying report: not sent (no site key in the Keychain)';
  try {
    const answer = await fetcher(SITE, {method: 'POST', headers: {Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', 'X-Caller': 'applying-upload'},
      body: JSON.stringify({kind, day, version: extensionVersion(), onMain: onMain(), rows, ...(full ? {full: true} : {})}), signal: AbortSignal.timeout(20000)});
    const body = await answer.json().catch(() => ({}));
    return answer.ok ? `applying report: ${body.stored ?? 0} ${kind} row(s) sent to /admin/form-filling/lab` : `applying report: refused (${answer.status} ${body.error || ''})`;
  } catch (error) { return `applying report: not sent (${String(error?.message || error).slice(0, 80)})`; }
}

// A site starts or ends its run ("start" | "end"): /admin/form-filling/lab shows a spinner on its row while it runs. Only the site's name and a fixed word; never throws, so a run never fails on it.
export const ping = (name, state, options = {}) => upload('running', [{name, state}], options).catch(() => '');

// The pool as the site lists it ("The pool" table, site/src/applying.js): every site of the pool, also one never run, with its start host and, when a run showed it,
// its flow signature (page kinds @ end host # step). Hosts and fixed words only: a signature that is not exactly that is dropped, never sent.
const SIGNATURE = /^(unclear|[a-z-]+(>[a-z-]+)*@[a-z0-9.-]+#(none|posting|account|code\/bot|form|ready))$/;
export const poolRows = (shapes, signatures = {}) => shapes.map(({shape, urls = [], stage, stageWhy}) => {
  const row = {name: shape}, host = hostOnly(urls[0] || ''), signature = signatures[shape];
  if (host) row.start_host = host;
  if (stage === 'watch' || stage === 'archived') row.stage = stage;   // the row's life-cycle data (site/src/applying-stage.js); the site keeps only its fixed words
  if (stage === 'archived' && stageWhy) row.stage_why = stageWhy;
  if (SIGNATURE.test(signature || '')) row.signature = signature;
  return row;
});

// The Fixed-site replays (site/src/applying-replays.js) show CI on main only (12 Oct 2026: fixers' work-in-progress branches and a loaded Mac showed main as broken).
// -> '' when this run may send them, else why not.
export const replayReason = (env = process.env) => (env.REAL_EXTENSION_DIR ? 'a control run on another build' : env.JP_NO_REPORT ? 'JP_NO_REPORT'
  : !env.CI ? 'a local run: the replay table shows CI on main only' : env.GITHUB_EVENT_NAME === 'push' && env.GITHUB_REF === 'refs/heads/main' ? '' : 'CI, not a push to main');

// One PUT for the whole run (every shard), with the build's sha, Bearer REPLAYS_PUBLISH_KEY (a key that can only write this table). JP_REPLAYS_DRY=1|true: say it, send nothing. -> one line.
export async function uploadReplays(rows, {env = process.env, fetcher = fetch, repo = null} = {}) {   // repo: what the repo holds to test with (lib/repo-counts.mjs), for the lab page's "What we test on"
  const sha = String(env.GITHUB_SHA || ''), short = sha.slice(0, 7);
  if (['1', 'true'].includes(String(env.JP_REPLAYS_DRY || '').toLowerCase())) return `replays report: dry run: would send ${rows.length} replay row(s) for ${short}`;
  const why = replayReason(env);
  if (why) return `replays report: not sent (${why})`;
  if (!env.REPLAYS_PUBLISH_KEY) return 'replays report: not sent (REPLAYS_PUBLISH_KEY not set up: the owner adds the GitHub secret)';
  try {
    const answer = await fetcher(REPLAYS, {method: 'PUT', headers: {Authorization: `Bearer ${env.REPLAYS_PUBLISH_KEY}`, 'Content-Type': 'application/json', 'X-Caller': 'replays-upload'},
      body: JSON.stringify({sha, version: extensionVersion(), rows, ...(repo ? {repo} : {})}), signal: AbortSignal.timeout(20000)});
    const body = await answer.json().catch(() => ({}));
    return answer.ok ? `replays report: ${body.stored ?? 0} replay row(s) sent for ${short}` : `replays report: refused (${answer.status} ${body.error || ''})`;
  } catch (error) { return `replays report: not sent (${String(error?.message || error).slice(0, 80)})`; }
}

