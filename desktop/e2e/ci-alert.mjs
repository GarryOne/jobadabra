// Telegram alerts for the scheduled CI checks (owner, 14 Oct 2026): a failure of e2e.yml (scheduled and gate runs) and site-replays.yml sends 🔴 once per commit and set of failed jobs (16 Oct 2026), and the
// first success after a failure sends 🟢. Bot @jobpilotto_ci_alerts_bot: CI_ALERTS_TELEGRAM_BOT_TOKEN + CI_ALERTS_TELEGRAM_CHAT_ID (missing: one line, no send).
// The token is never printed; no AI. Guard: e2e/test/ci-alert.test.mjs.
//   node ci-alert.mjs <failure|success> "<cause in a few words>" "<the one next action>"      (GITHUB_* and GH_TOKEN from the runner)
import path from 'node:path';
import {alertHtml} from './lib/telegram-html.mjs';

// The previous finished run of this workflow on the same branch (not this one) -> its conclusion, or ''.
// Until 28 Oct 2026 a renamed workflow's old file is read too (replay-offline.yml → site-replays.yml, 14 Oct 2026).
export const OLD_FILES = {'site-replays.yml': 'replay-offline.yml'};
export async function previousConclusion(env = process.env, fetcher = fetch) {
  const file = path.basename(String(env.GITHUB_WORKFLOW_REF || '').split('@')[0]);
  for (const name of [file, OLD_FILES[file]].filter(Boolean)) {
    const url = `${env.GITHUB_API_URL || 'https://api.github.com'}/repos/${env.GITHUB_REPOSITORY}/actions/workflows/${name}/runs?branch=${encodeURIComponent(env.GITHUB_REF_NAME || 'main')}&status=completed&per_page=10`;
    try {
      const answer = await fetcher(url, {headers: {Authorization: `Bearer ${env.GH_TOKEN || ''}`, Accept: 'application/vnd.github+json'}, signal: AbortSignal.timeout(15000)});
      const body = await answer.json();
      const found = (body.workflow_runs || []).find(run => String(run.id) !== String(env.GITHUB_RUN_ID))?.conclusion;
      if (found) return found;
    } catch { /* try the next name */ }
  }
  return '';
}

const API = env => env.GITHUB_API_URL || 'https://api.github.com';
const get = (url, env, fetcher) => fetcher(url, {headers: {Authorization: `Bearer ${env.GH_TOKEN || ''}`, Accept: 'application/vnd.github+json'}, signal: AbortSignal.timeout(15000)}).then(answer => answer.json());

// A run's failed jobs, sorted (the alert's own job is still running, so it never counts).
export async function failedJobs(runId, env = process.env, fetcher = fetch) {
  const body = await get(`${API(env)}/repos/${env.GITHUB_REPOSITORY}/actions/runs/${runId}/jobs?per_page=100`, env, fetcher);
  return (body.jobs || []).filter(job => job.conclusion === 'failure').map(job => job.name).sort();
}

// The failed jobs of this run with their pages. -> [{name, url}]
export async function failedJobLinks(runId, env = process.env, fetcher = fetch) {
  const body = await get(`${API(env)}/repos/${env.GITHUB_REPOSITORY}/actions/runs/${runId}/jobs?per_page=100`, env, fetcher);
  return (body.jobs || []).filter(job => job.conclusion === 'failure').map(job => ({name: job.name, url: job.html_url}));
}

/**
 * The failed steps' own words: per failed job, its first annotation titled "<suite> · <step>" (lib/artifacts.mjs annotationLines). Errors: [] (the caller's cause stays).
 * @returns {Promise<string[]>} e.g. ['quality · a Jobs check …: 3 AI question(s) had no recorded answer …']
 */
export async function stepCauses(runId, env = process.env, fetcher = fetch) {
  try {
    const body = await get(`${API(env)}/repos/${env.GITHUB_REPOSITORY}/actions/runs/${runId}/jobs?per_page=100`, env, fetcher);
    const out = [];
    for (const job of (body.jobs || []).filter(item => item.conclusion === 'failure')) {
      const notes = await get(`${API(env)}/repos/${env.GITHUB_REPOSITORY}/check-runs/${job.id}/annotations?per_page=50`, env, fetcher);
      const note = (Array.isArray(notes) ? notes : []).find(item => / · /.test(item.title || ''));
      if (note) out.push(`${note.title}: ${note.message}`);
    }
    return out;
  } catch { return []; }
}

// The PRs that landed since this workflow's last green run on the branch (a commit "Title (#123)" is one), newest first. -> {prs: [number], more: number}; empty when unknown.
export async function sinceGreen(env = process.env, fetcher = fetch, shown = 5) {
  const file = path.basename(String(env.GITHUB_WORKFLOW_REF || '').split('@')[0]), repo = `${API(env)}/repos/${env.GITHUB_REPOSITORY}`;
  try {
    const green = (await get(`${repo}/actions/workflows/${file}/runs?branch=${encodeURIComponent(env.GITHUB_REF_NAME || 'main')}&status=success&per_page=1`, env, fetcher)).workflow_runs?.[0];
    if (!green?.head_sha || green.head_sha === env.GITHUB_SHA) return {prs: [], more: 0};
    const commits = (await get(`${repo}/compare/${green.head_sha}...${env.GITHUB_SHA}`, env, fetcher)).commits || [];
    const all = commits.map(commit => /\(#(\d+)\)\s*$/.exec(String(commit.commit?.message || '').split('\n')[0])?.[1]).filter(Boolean).reverse();
    return {prs: all.slice(0, shown), more: Math.max(0, all.length - shown)};
  } catch { return {prs: [], more: 0}; }
}

// One alert per (workflow, commit, failed jobs): true when an earlier finished run of this workflow on this commit failed with the same failed jobs. Errors: false (alert).
export async function isRepeat(env = process.env, fetcher = fetch) {
  const file = path.basename(String(env.GITHUB_WORKFLOW_REF || '').split('@')[0]);
  try {
    const body = await get(`${API(env)}/repos/${env.GITHUB_REPOSITORY}/actions/workflows/${file}/runs?branch=${encodeURIComponent(env.GITHUB_REF_NAME || 'main')}&status=completed&per_page=10`, env, fetcher);
    const earlier = (body.workflow_runs || []).filter(run => String(run.id) !== String(env.GITHUB_RUN_ID) && run.head_sha === env.GITHUB_SHA && run.conclusion === 'failure');
    if (!earlier.length) return false;
    const now = [...await failedJobs(env.GITHUB_RUN_ID, env, fetcher), ...(env.CI_ALERT_ASSUME_FAILED ? [env.CI_ALERT_ASSUME_FAILED] : [])].sort().join('|');   // ASSUME_FAILED: the job that sends is itself the failing one, not yet marked
    if (!now) return false;
    for (const run of earlier) if ((await failedJobs(run.id, env, fetcher)).join('|') === now) return true;
  } catch { /* alert rather than stay silent */ }
  return false;
}

// -> the message ({text, parse_mode, ...} from lib/telegram-html.mjs), or '' when there is nothing to say (a success after a success).
// cause / next: a few words each (the caller knows them); since: sinceGreen()'s answer; jobs: failedJobLinks()'s answer.
export function messageOf({status, what = '', next = '', previous = '', since = {prs: [], more: 0}, jobs = [], env = process.env, now = new Date()}) {
  const name = env.GITHUB_WORKFLOW || 'CI', repo = env.GITHUB_REPOSITORY, site = env.GITHUB_SERVER_URL || 'https://github.com', branch = env.GITHUB_REF_NAME || 'main';
  const sha = String(env.GITHUB_SHA || ''), run = `${site}/${repo}/actions/runs/${env.GITHUB_RUN_ID}`;
  const time = new Intl.DateTimeFormat('en-GB', {timeZone: 'Europe/Zurich', day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit'}).format(now);
  const commit = {label: 'Commit', parts: [{text: sha.slice(0, 7), url: `${site}/${repo}/commit/${sha}`}, ` · ${branch} · ${time}`]};
  if (status === 'failure') {
    const bullets = [{label: 'Cause', parts: [String(what || 'see the run').replace(/\s*\n\s*/g, '; ').slice(0, 600)]}, commit];
    if (since.prs.length) bullets.push({label: 'Since green', parts: [...since.prs.flatMap((number, i) => [i ? ', ' : '', {text: `#${number}`, url: `${site}/${repo}/pull/${number}`}]), since.more ? ` +${since.more} more` : '']});
    if (next) bullets.push({label: 'Next', parts: [next]});
    return alertHtml({icon: '🔴', title: name, verdict: 'failed', bullets, links: [{text: 'Open run', url: run}, ...jobs.slice(0, 3).map(job => ({text: `Failed job: ${job.name}`, url: job.url}))]});
  }
  if (status === 'success' && ['failure', 'timed_out'].includes(previous)) return alertHtml({icon: '🟢', title: name, verdict: 'is back to green', bullets: [commit], links: [{text: 'Open run', url: run}]});
  return '';
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
    const previous = status === 'success' ? await previousConclusion() : '';
    const since = failure ? await sinceGreen() : undefined, jobs = failure ? await failedJobLinks(process.env.GITHUB_RUN_ID).catch(() => []) : undefined;
    // Why (27 Oct 2026): the failed step's own words lead the cause; the caller's words (which job, after which merge) follow as context.
    const causes = failure ? await stepCauses(process.env.GITHUB_RUN_ID) : [];
    console.log(await send(messageOf({status, what: causes.length ? `${causes.slice(0, 2).join('; ')} (${what})` : what, next, previous, since, jobs})));
  }
}
