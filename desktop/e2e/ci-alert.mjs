// Telegram alerts for the scheduled CI checks (owner, 14 Oct 2026): a failure of e2e.yml (scheduled and gate runs) and site-replays.yml sends 🔴 once per commit and set of failed jobs (16 Oct 2026), and the
// first success after a failure sends 🟢. Bot @jobpilotto_ci_alerts_bot: CI_ALERTS_TELEGRAM_BOT_TOKEN + CI_ALERTS_TELEGRAM_CHAT_ID (missing: one line, no send).
// The token is never printed; no AI. Guard: e2e/test/ci-alert.test.mjs.
//   node ci-alert.mjs <failure|success> "<cause in a few words>" "<the one next action>"      (GITHUB_* and GH_TOKEN from the runner)
// Job: report health
import path from 'node:path';
import fs from 'node:fs';
import {alertHtml} from './lib/telegram-html.mjs';
import {isBackbone, suiteOfKey} from './lib/suite-shards.mjs';

const readLanes = () => JSON.parse(fs.readFileSync(new URL('./lanes.json', import.meta.url), 'utf8'));
// Invariant: a non-backbone suite result cannot cause an owner failure or recovery alert.
const backbone = (name, lanes = readLanes()) => isBackbone(lanes, suiteOfKey(name));

// Until 28 Oct 2026 a renamed workflow's old file is read too (replay-offline.yml → site-replays.yml, 14 Oct 2026).
export const OLD_FILES = {'site-replays.yml': 'replay-offline.yml'};
/**
 * The previous finished run of this workflow on the same branch (not this one), from the GitHub runs API -> {conclusion, id}, conclusion '' when none is read
 * (API errors try the old file name, then give ''). An e2e.yml run whose failed jobs are all non-backbone lanes counts as 'success'.
 */
export async function previousRun(env = process.env, fetcher = fetch, lanes = readLanes()) {
  const file = path.basename(String(env.GITHUB_WORKFLOW_REF || '').split('@')[0]);
  for (const name of [file, OLD_FILES[file]].filter(Boolean)) {
    const url = `${env.GITHUB_API_URL || 'https://api.github.com'}/repos/${env.GITHUB_REPOSITORY}/actions/workflows/${name}/runs?branch=${encodeURIComponent(env.GITHUB_REF_NAME || 'main')}&status=completed&per_page=10`;
    try {
      const answer = await fetcher(url, {headers: {Authorization: `Bearer ${env.GH_TOKEN || ''}`, Accept: 'application/vnd.github+json'}, signal: AbortSignal.timeout(15000)});
      const body = await answer.json();
      const found = (body.workflow_runs || []).find(run => String(run.id) !== String(env.GITHUB_RUN_ID));
      if (file === 'e2e.yml' && found?.conclusion === 'failure') {
        const jobs = await failedJobLinks(found.id, env, fetcher);
        if (!jobs.some(job => backbone(job.name, lanes))) return {conclusion: 'success', id: found.id};
      }
      if (found?.conclusion) return {conclusion: found.conclusion, id: found.id};
    } catch { /* try the next name */ }
  }
  return {conclusion: '', id: null};
}

/** previousRun's conclusion alone. */
export const previousConclusion = async (...args) => (await previousRun(...args)).conclusion;

const API = env => env.GITHUB_API_URL || 'https://api.github.com';
const unsuccessful = job => ['failure', 'cancelled', 'timed_out'].includes(job.conclusion);
const get = (url, env, fetcher) => fetcher(url, {headers: {Authorization: `Bearer ${env.GH_TOKEN || ''}`, Accept: 'application/vnd.github+json'}, signal: AbortSignal.timeout(15000)}).then(answer => answer.json());

// Why (31 Oct 2026, owner: a suite past its budget is our bug, red): a job's own conclusion is the verdict, no annotation turns a failed job into health.
const unsuccessfulJobs = async (runId, env, fetcher) =>
  ((await get(`${API(env)}/repos/${env.GITHUB_REPOSITORY}/actions/runs/${runId}/jobs?per_page=100`, env, fetcher)).jobs || []).filter(unsuccessful);

/** A run's blocking backbone job names. */
export async function failedJobs(runId, env = process.env, fetcher = fetch, lanes = readLanes()) {
  return (await unsuccessfulJobs(runId, env, fetcher)).filter(job => backbone(job.name, lanes)).map(job => job.name).sort();
}

/** Unsuccessful jobs with their links, for the alert's job list. */
export async function failedJobLinks(runId, env = process.env, fetcher = fetch) {
  return (await unsuccessfulJobs(runId, env, fetcher)).map(job => ({name: job.name, url: job.html_url}));
}

/**
 * The failed steps' own words: per failed job, its first annotation titled "<suite> · <step>" (lib/artifacts.mjs annotationLines). Errors: [] (the caller's cause stays).
 * @returns {Promise<{suite: string, step: string, message: string}[]>} e.g. [{suite: 'apply', step: 'fill the form', message: 'a required field is missing'}]
 */
export async function stepCauses(runId, env = process.env, fetcher = fetch, lanes = readLanes()) {
  try {
    const body = await get(`${API(env)}/repos/${env.GITHUB_REPOSITORY}/actions/runs/${runId}/jobs?per_page=100`, env, fetcher);
    const out = [];
    for (const job of (body.jobs || []).filter(item => item.conclusion === 'failure' && backbone(item.name, lanes))) {
      const notes = await get(`${API(env)}/repos/${env.GITHUB_REPOSITORY}/check-runs/${job.id}/annotations?per_page=50`, env, fetcher);
      const note = (Array.isArray(notes) ? notes : []).find(item => / · /.test(item.title || ''));
      if (note) { const at = note.title.indexOf(' · '); out.push({suite: note.title.slice(0, at), step: note.title.slice(at + 3), message: String(note.message || '')}); }
    }
    return out;
  } catch { return []; }
}

// The PRs that landed since this workflow's last green run on the branch (a merge commit "Merge pull request #123 from …", or a squash "Title (#123)"), newest first.
// -> {prs: [number], more: number}; empty when unknown. Why (30 Oct 2026): main merges PRs by merge commit since 27 Oct; matching only "(#123)" left "Since green" empty.
export async function sinceGreen(env = process.env, fetcher = fetch, shown = 5) {
  const file = path.basename(String(env.GITHUB_WORKFLOW_REF || '').split('@')[0]), repo = `${API(env)}/repos/${env.GITHUB_REPOSITORY}`;
  try {
    const green = (await get(`${repo}/actions/workflows/${file}/runs?branch=${encodeURIComponent(env.GITHUB_REF_NAME || 'main')}&status=success&per_page=1`, env, fetcher)).workflow_runs?.[0];
    if (!green?.head_sha || green.head_sha === env.GITHUB_SHA) return {prs: [], more: 0};
    const commits = (await get(`${repo}/compare/${green.head_sha}...${env.GITHUB_SHA}`, env, fetcher)).commits || [];
    const all = commits.map(commit => /^Merge pull request #(\d+)\b|\(#(\d+)\)\s*$/.exec(String(commit.commit?.message || '').split('\n')[0])).filter(Boolean).map(found => found[1] || found[2]).reverse();
    return {prs: all.slice(0, shown), more: Math.max(0, all.length - shown)};
  } catch { return {prs: [], more: 0}; }
}

// One alert per (workflow, commit, failed jobs): true when an earlier finished run of this workflow on this commit failed with the same failed jobs. Errors: false (alert).
export async function isRepeat(env = process.env, fetcher = fetch, lanes = readLanes()) {
  const file = path.basename(String(env.GITHUB_WORKFLOW_REF || '').split('@')[0]);
  try {
    const body = await get(`${API(env)}/repos/${env.GITHUB_REPOSITORY}/actions/workflows/${file}/runs?branch=${encodeURIComponent(env.GITHUB_REF_NAME || 'main')}&status=completed&per_page=10`, env, fetcher);
    const earlier = (body.workflow_runs || []).filter(run => String(run.id) !== String(env.GITHUB_RUN_ID) && run.head_sha === env.GITHUB_SHA && run.conclusion === 'failure');
    if (!earlier.length) return false;
    const now = [...await failedJobs(env.GITHUB_RUN_ID, env, fetcher, lanes), ...(env.CI_ALERT_ASSUME_FAILED ? [env.CI_ALERT_ASSUME_FAILED] : [])].sort().join('|');   // ASSUME_FAILED: the job that sends is itself the failing one, not yet marked
    if (!now) return false;
    for (const run of earlier) if ((await failedJobs(run.id, env, fetcher, lanes)).join('|') === now) return true;
  } catch { /* alert rather than stay silent */ }
  return false;
}

// Human words for a step's text: a value that ends the line as null/undefined reads "nothing" (never inside an error such as "of undefined"), a quoted name before ":" loses its quotes.
const plain = text => String(text).replace(/\b(shows|says|is) (?:null|undefined)$/, '$1 nothing').replace(/^"([^"]+)":/, '$1:');

/** A step cause -> its lines: "Check: <step>", then the one problem, or "N problems:" with 2 of them and "+N more" (annotationLines writes "a; b; +3 more"). */
export function causeLines({suite, step, message}, named = false) {
  const items = String(message || '').split('; ').filter(Boolean).map(plain);
  const counted = /^\+(\d+) more$/.exec(items.at(-1) || '');
  if (counted) items.pop();
  const total = items.length + (counted ? Number(counted[1]) : 0);
  const lines = [{label: 'Check', parts: [`${named ? `${suite} · ` : ''}${String(step).replace(/\s*\([^)]*\)\s*$/, '')}`]}];
  if (total === 1) return [...lines, {parts: [items[0]]}];
  const shown = items.slice(0, 2);
  return [...lines, ...(total ? [{parts: [`${total} problems:`]}] : []), ...shown.map(item => ({bullet: true, parts: [item]})), ...(total > shown.length ? [{parts: [`+${total - shown.length} more`]}] : [])];
}

// -> the message ({text, parse_mode, ...} from lib/telegram-html.mjs), or '' when there is nothing to say (a success after a success).
// what / next: a few words each from the caller; causes: stepCauses()'s answer; since: sinceGreen()'s; jobs: failedJobLinks()'s; recovered: the suites the previous red run failed.
// Why (30 Oct 2026, owner: "more human readable, more succinct", picked shape A): the red suite is the title, the step and up to 2 problems follow, then the PRs since green.
export function messageOf({status, what = '', causes = [], next = '', previous = '', recovered = [], since = {prs: [], more: 0}, jobs = [], env = process.env, now = new Date(), lanes = readLanes()}) {
  const blocking = jobs.filter(job => backbone(job.name, lanes));
  if (status === 'failure' && jobs.length && !blocking.length) status = 'success';
  const where = placeOf(env, now);
  const named = names => (where.e2e ? [...new Set(names.map(suiteOfKey))].filter(suite => backbone(suite, lanes)) : []);
  if (status === 'failure') {
    const red = named(blocking.map(job => job.name));
    return alertHtml({icon: '🔴', title: red.join(', ') || where.workflow, verdict: `failed on ${where.branch}`, blocks: [failureLines({what, causes, next, jobs: blocking}), [afterLine(since, where)]], links: jobLinks(blocking, where.run)});
  }
  if (status === 'success' && ['failure', 'timed_out'].includes(previous)) {
    const back = named(recovered);
    return alertHtml({icon: '🟢', title: back.join(', ') || where.workflow, verdict: `${back.length > 1 ? 'are' : 'is'} green again on ${where.branch}`, blocks: [[afterLine(since, where)]]});
  }
  return '';
}

// The run's place and time, from the GitHub env: links, branch, the commit it checked, whether it is the e2e workflow (suites name its alerts).
function placeOf(env, now) {
  const repo = `${env.GITHUB_SERVER_URL || 'https://github.com'}/${env.GITHUB_REPOSITORY}`;
  return {repo, run: `${repo}/actions/runs/${env.GITHUB_RUN_ID}`, branch: env.GITHUB_REF_NAME || 'main', sha: String(env.AFTER_MERGE || env.GITHUB_SHA || ''),
    workflow: env.GITHUB_WORKFLOW || 'CI', e2e: path.basename(String(env.GITHUB_WORKFLOW_REF || '').split('@')[0]) === 'e2e.yml',
    time: new Intl.DateTimeFormat('en-GB', {timeZone: 'Europe/Zurich', day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit'}).format(now)};
}

// "After #2538, #2535 +2 more · 30 Oct, 02:29": the PRs since green (3 shown), or the commit when none is known.
function afterLine(since, where) {
  const prs = since.prs.slice(0, 3), more = since.more + since.prs.length - prs.length;
  if (!prs.length) return {parts: ['After ', {text: where.sha.slice(0, 7), url: `${where.repo}/commit/${where.sha}`}, ` · ${where.time}`]};
  return {parts: ['After ', ...prs.flatMap((number, i) => [i ? ', ' : '', {text: `#${number}`, url: `${where.repo}/pull/${number}`}]), more ? ` +${more} more` : '', ` · ${where.time}`]};
}

// The red's own words: each step cause (2 at most, suite named when they differ), else the caller's cause or the failed jobs; then the caller's next step.
function failureLines({what, causes, next, jobs}) {
  const named = new Set(causes.slice(0, 2).map(cause => cause.suite)).size > 1;
  const lines = causes.length ? causes.slice(0, 2).flatMap(cause => causeLines(cause, named))
    : [{parts: [plain(what) || `Failed job: ${jobs.map(job => job.name).join(', ') || 'see the run'}`]}];
  return next ? [...lines, {label: 'Next', parts: [next]}] : lines;
}

// One failed job: "Open the failed job"; several: one link each (3 at most); none known: the run.
const jobLinks = (jobs, run) => (jobs.length === 1 ? [{text: 'Open the failed job', url: jobs[0].url}]
  : jobs.length ? jobs.slice(0, 3).map(job => ({text: `Open ${job.name}`, url: job.url})) : [{text: 'Open the run', url: run}]);

// text: a message from messageOf (or a plain string) -> the line to print.
export async function send(message, env = process.env, fetcher = fetch) {
  if (!message) return 'ci-alert: nothing to send';
  if (!env.CI_ALERTS_TELEGRAM_BOT_TOKEN || !env.CI_ALERTS_TELEGRAM_CHAT_ID) return 'ci-alert: not sent (CI_ALERTS_TELEGRAM_BOT_TOKEN or CI_ALERTS_TELEGRAM_CHAT_ID not set)';
  const payload = typeof message === 'string' ? {text: message, disable_web_page_preview: true} : message;
  try {
    const answer = await fetcher(`https://api.telegram.org/bot${env.CI_ALERTS_TELEGRAM_BOT_TOKEN}/sendMessage`, {method: 'POST', headers: {'Content-Type': 'application/json'},
      body: JSON.stringify({chat_id: env.CI_ALERTS_TELEGRAM_CHAT_ID, ...payload}), signal: AbortSignal.timeout(15000)});
    return answer.ok ? 'ci-alert: sent' : `ci-alert: not sent (Telegram ${answer.status})`;
  } catch (error) { return `ci-alert: not sent (${String(error?.name || 'error')})`; }   // never the error text: it can carry the URL with the token
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(new URL(import.meta.url).pathname)) {
  const [status, what, next] = process.argv.slice(2);
  if (status === 'failure' && await isRepeat()) console.log('ci-alert: not sent (same failure on this commit already alerted)');
  else {
    const failure = status === 'failure';
    const {conclusion: previous, id: previousId} = await previousRun();
    const red = ['failure', 'timed_out'].includes(previous);
    const since = failure || red ? await sinceGreen() : undefined, jobs = failure ? await failedJobLinks(process.env.GITHUB_RUN_ID).catch(() => []) : undefined;
    const causes = failure ? await stepCauses(process.env.GITHUB_RUN_ID) : [];
    const recovered = red && previousId ? await failedJobs(previousId).catch(() => []) : [];
    console.log(await send(messageOf({status, what, causes, next, previous, recovered, since, jobs})));
  }
}
