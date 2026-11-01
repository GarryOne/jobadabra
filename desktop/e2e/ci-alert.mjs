// Telegram alerts for the scheduled CI checks (owner, 14 Oct 2026): a failure of e2e.yml (scheduled and gate runs) and site-replays.yml sends 🔴 once per commit and set of failed jobs (16 Oct 2026), and the
// first success after a failure sends 🟢. Bot @jobpilotto_ci_alerts_bot: CI_ALERTS_TELEGRAM_BOT_TOKEN + CI_ALERTS_TELEGRAM_CHAT_ID (missing: one line, no send).
// The token is never printed; no AI. Guard: e2e/test/harness/ci-alert.test.mjs.
//   node ci-alert.mjs <failure|success> "<cause in a few words>" "<the one next action>"      (GITHUB_* and GH_TOKEN from the runner)
// Job: report health
import path from 'node:path';
import fs from 'node:fs';
import {alertHtml} from './lib/telegram-html.mjs';
import {TIMEOUT_FAILURE} from './lib/triage-match.mjs';
import {aiFailureCauses} from './lib/ai-miss-cause.mjs';
import {ghIo, verdictsForCauses} from './lib/flaky-evidence.mjs';
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
 * The failed steps' own words: per failed job, every annotation titled "<suite> · <step>" (lib/artifacts.mjs annotationLines). Errors: [] (the caller's cause stays).
 * @returns {Promise<{suite: string, step: string, message: string, job: string, url: string}[]>} e.g. [{suite: 'apply', step: 'fill the form', message: 'a required field is missing'}]
 */
export async function stepCauses(runId, env = process.env, fetcher = fetch, lanes = readLanes()) {
  try {
    const body = await get(`${API(env)}/repos/${env.GITHUB_REPOSITORY}/actions/runs/${runId}/jobs?per_page=100`, env, fetcher);
    const out = [];
    for (const job of (body.jobs || []).filter(item => item.conclusion === 'failure' && backbone(item.name, lanes))) {
      const notes = await get(`${API(env)}/repos/${env.GITHUB_REPOSITORY}/check-runs/${job.id}/annotations?per_page=50`, env, fetcher);
      for (const note of (Array.isArray(notes) ? notes : []).filter(item => / · /.test(item.title || ''))) {
        const at = note.title.indexOf(' · ');
        out.push({suite: note.title.slice(0, at), step: note.title.slice(at + 3), message: String(note.message || ''), job: job.name,
          url: job.html_url || `${env.GITHUB_SERVER_URL || 'https://github.com'}/${env.GITHUB_REPOSITORY}/actions/runs/${runId}/job/${job.id}`});
      }
    }
    return out;
  } catch { return []; }
}

/**
 * Mark the failed steps that are flaky: red on code unchanged since a green of the same step (lib/flaky-verdict.mjs). Errors and a slow read: the causes as they were.
 * @returns {Promise<object[]>} causes, each flaky one with `flaky: {green: {sha, run, url}, sameCommit}`
 */
export async function flakyCauses(causes, runId, env = process.env, fetcher = fetch, io = ghIo({repo: env.GITHUB_REPOSITORY}), deadlineMs = 90000) {
  let timer;
  try {
    const read = (async () => {
      const run = await get(`${API(env)}/repos/${env.GITHUB_REPOSITORY}/actions/runs/${runId}`, env, fetcher);
      return {redSha: run.head_sha, found: await verdictsForCauses(causes, {redSha: run.head_sha, redRun: runId, redAt: run.created_at, io})};
    })();
    const {redSha, found} = await Promise.race([read, new Promise((_, stop) => { timer = setTimeout(() => stop(new Error('flaky read took too long')), deadlineMs); })]);
    return causes.map(cause => {
      const verdict = found.find(item => item.suite === cause.suite && item.step === cause.step && item.verdict === 'flaky');
      return verdict ? {...cause, flaky: {green: verdict.green, sameCommit: verdict.green.sha === redSha}} : cause;
    });
  } catch { return causes; } finally { clearTimeout(timer); }
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

// Short names stop at a whole word; annotation evidence remains available in the linked job log.
const short = (text, max = 80) => text.length <= max ? text : `${text.slice(0, max - 1).replace(/\s+\S*$/, '')}…`;
const stepName = step => short(String(step).replace(/\s*\([^)]*\)\s*$/, ''));

// Parse only runner-owned budget wording, after the shared timeout classifier has identified timing.
function timingCause(message) {
  const minutes = /(?:suite's |over its )(\d+)-minute budget/.exec(message)?.[1];
  return minutes ? {icon: '⏱', text: `Over its ${minutes}-min budget`, cut: !message.startsWith('not run: '),
    detail: message.includes('the suite is too long: split it') ? 'the suite is too long: split it' : ''}
    : {icon: '⏱', text: short(message.split(': ')[0])};
}

// Each annotation can carry multiple recorded problems; an unknown cause keeps its own words.
function problemsOf(message) {
  const ai = aiFailureCauses(message);
  if (ai.length) return ai;
  if (TIMEOUT_FAILURE.test(message)) return [timingCause(message)];
  const items = String(message || 'see the job log').split('\n')[0].split('; ').filter(Boolean);
  const more = /^\+(\d+) more$/.exec(items.at(-1) || '');
  if (more) items.pop();
  return items.map((text, i) => ({icon: '✗', key: text, text: short(plain(text), 120), more: i === items.length - 1 ? Number(more?.[1] || 0) : 0}));
}

// Why (31 Oct 2026, owner: "You detect flakiness and immediately treat the flakiness root cause"): a step red on code unchanged since a green is its own cause, with the green it compared to.
const flakyProblem = flaky => ({icon: '🎲', key: 'flaky', text: 'Flaky: red on code unchanged since it passed', green: flaky.green, same: Boolean(flaky.sameCommit)});

function groupedCauses(causes, fallback) {
  const groups = new Map();
  for (const cause of causes) for (const problem of cause.flaky ? [flakyProblem(cause.flaky)] : problemsOf(cause.message)) {
    const key = `${problem.icon}:${problem.key || problem.text}`;
    const group = groups.get(key) || {...problem, more: 0, steps: []};
    group.detail ||= problem.detail;
    group.more = (group.more || 0) + (problem.more || 0);
    group.steps.push({...cause, cut: problem.cut, skipped: String(cause.message).startsWith('not run: ')});
    groups.set(key, group);
  }
  return groups.size ? [...groups.values()] : [{icon: '🔌', text: short(plain(fallback), 160), steps: []}];
}

function causeBlock(group, run) {
  const lines = [{parts: [`${group.icon}  ${group.text}`]}];
  if (group.detail) lines.push({parts: [`     ${group.detail}`]});
  if (group.green) lines.push({parts: [`     passed on ${group.same ? 'this same commit' : 'code the step does not touch'}: `, {text: String(group.green.sha).slice(0, 7), url: group.green.url}, ' (fix its input, not the step)']});
  group.steps.forEach((step, i) => lines.push({step: true, expandable: group.steps.length > 3 && i >= 2,
    parts: [`     ${step.skipped ? '⏭' : '✗'} `, {text: stepName(step.step), url: step.url || run}, step.skipped ? ' (not run)' : step.cut ? ' ← cut here' : '']}));
  if (group.more) lines.push({expandable: true, count: group.more, parts: [`+${group.more} more`]});
  return lines;
}

// Invariant: suites and their job links remain separate; counts refer to annotations, not repeated cause memberships.
function redSection(suite, jobs, causes, what, next, since, where) {
  const own = (where.e2e ? causes.filter(cause => cause.suite === suite) : causes).map(cause => ({...cause,
    url: cause.url || jobs.find(job => job.name === cause.job)?.url || jobs[0]?.url || where.run}));
  const fallback = what || `Failed job: ${jobs.map(job => job.name).join(', ') || 'see the run'}`;
  const groups = groupedCauses(own, fallback);
  const keys = jobs.map(job => job.name).join(', ') || suite;
  const subtitle = `${keys} · ${own.length} ${own.length === 1 ? 'step' : 'steps'} · ${groups.length} ${groups.length === 1 ? 'cause' : 'causes'}`;
  return {icon: '🔴 ', title: suite, verdict: `· red on ${where.branch}`, subtitle,
    blocks: [...groups.map(group => causeBlock(group, where.run)), ...(next ? [[{label: 'Next', parts: [short(next, 240)]}]] : []), footer(since, where, jobs)]};
}

/** Build a pure Telegram payload: one block per red suite, or the first recovery after red; non-backbone reds stay silent. */
// Why (31 Oct 2026, owner selected grouped-by-cause): each suite has its own causes, steps and links; evidence stays in job logs.
export function messageOf({status, what = '', causes = [], next = '', previous = '', recovered = [], since = {prs: [], more: 0}, jobs = [], env = process.env, now = new Date(), lanes = readLanes()}) {
  const blocking = jobs.filter(job => backbone(job.name, lanes));
  if (status === 'failure' && jobs.length && !blocking.length) status = 'success';
  const where = placeOf(env, now);
  const named = names => [...new Set(names.map(suiteOfKey))].filter(suite => backbone(suite, lanes));
  if (status === 'failure') {
    const suites = where.e2e ? named([...blocking.map(job => job.name), ...causes.map(cause => cause.suite)]) : [];
    const sections = (suites.length ? suites : [where.workflow]).map(suite => redSection(suite,
      where.e2e ? blocking.filter(job => suiteOfKey(job.name) === suite) : blocking, causes, what, next, since, where));
    return alertHtml({sections});
  }
  if (status === 'success' && ['failure', 'timed_out'].includes(previous)) {
    const back = where.e2e ? named(recovered) : [];
    return alertHtml({icon: '🟢 ', title: back.join(', ') || where.workflow, verdict: `${back.length > 1 ? 'are' : 'is'} green again on ${where.branch}`, blocks: [footer(since, where, [])]});
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

// Footer links are shared by red and recovery messages; no raw URLs or evidence tails.
function footer(since, where, jobs) {
  const prs = since.prs, more = since.more;
  const after = prs.length ? ['🔀  After ', ...prs.flatMap((number, i) => [i ? ' · ' : '', {text: `#${number}`, url: `${where.repo}/pull/${number}`}]), more ? ` +${more} more` : ''] : [];
  return [...(after.length ? [{parts: after}] : []), {parts: [`🕐  ${where.time}`]}, {parts: ['🔗  ',
    ...jobs.flatMap(job => [{text: `Open ${job.name}`, url: job.url || where.run}, ' · ']), {text: 'Run', url: where.run},
    ...(where.sha ? [' · ', {text: where.sha.slice(0, 7), url: `${where.repo}/commit/${where.sha}`}] : [])]}];
}

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
    const seen = failure ? await stepCauses(process.env.GITHUB_RUN_ID) : [];
    const causes = failure && placeOf(process.env, new Date()).e2e ? await flakyCauses(seen, process.env.GITHUB_RUN_ID) : seen;
    const recovered = red && previousId ? await failedJobs(previousId).catch(() => []) : [];
    console.log(await send(messageOf({status, what, causes, next, previous, recovered, since, jobs})));
  }
}
