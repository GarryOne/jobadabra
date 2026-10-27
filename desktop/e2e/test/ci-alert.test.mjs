// CI alerts on Telegram (ci-alert.mjs): 🔴 on every failure, 🟢 only on the first success after one, nothing without the secrets, never the token in a line.
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {failedJobs, isRepeat, messageOf, previousConclusion, sinceGreen, send, stepCauses} from '../ci-alert.mjs';

const env = {GITHUB_WORKFLOW: 'CI · Site replays · all (offline)', GITHUB_SHA: 'abcdef1234', GITHUB_REF_NAME: 'main', GITHUB_REPOSITORY: 'o/r', GITHUB_RUN_ID: '42',
  GITHUB_WORKFLOW_REF: 'o/r/.github/workflows/site-replays.yml@refs/heads/main', GH_TOKEN: 'gh'};
const now = new Date('2026-10-14T00:30:00Z');

test('a failure says which workflow, cause, commit, next step and run; a success says something only after a failure', () => {
  const red = messageOf({status: 'failure', what: '1 row worse: Join', next: 'label the PR replay-accepted', env, now});
  assert.match(red.text, /^🔴 <b>CI · Site replays · all \(offline\)<\/b> failed\n\n• Cause: 1 row worse: Join\n• Commit: <a href="https:\/\/github\.com\/o\/r\/commit\/abcdef1234">abcdef1<\/a> · main · 14 Oct, 02:30\n• Next: label the PR replay-accepted\n\n<a href="https:\/\/github\.com\/o\/r\/actions\/runs\/42">Open run<\/a>$/);
  assert.match(messageOf({status: 'success', previous: 'failure', env, now}).text, /^🟢 <b>.*<\/b> is back to green/);
  assert.equal(messageOf({status: 'success', previous: 'success', env, now}), '');
});

test('a renamed workflow\'s earlier runs are read from its old file name too (until 28 Oct 2026)', async () => {
  const asked = [];
  const fetcher = async url => { asked.push(url); return {json: async () => ({workflow_runs: /replay-offline\.yml/.test(url) ? [{id: 30, conclusion: 'failure'}] : []})}; };
  assert.equal(await previousConclusion(env, fetcher), 'failure', 'nothing under the new name: the old one answers');
  assert.equal(asked.length, 2);
  asked.length = 0;
  assert.equal(await previousConclusion(env, async url => { asked.push(url); return {json: async () => ({workflow_runs: [{id: 40, conclusion: 'success'}]})}; }), 'success');
  assert.equal(asked.length, 1, 'the new name answered: the old one is not asked');
});

test('the previous run is the newest finished one that is not this run', async () => {
  let asked = '';
  const fetcher = async url => { asked = url; return {json: async () => ({workflow_runs: [{id: 42, conclusion: 'success'}, {id: 41, conclusion: 'failure'}]})}; };
  assert.equal(await previousConclusion(env, fetcher), 'failure');
  assert.match(asked, /\/repos\/o\/r\/actions\/workflows\/site-replays\.yml\/runs\?branch=main&status=completed/);
});

test('no secrets: no send; a failed send never prints the token', async () => {
  assert.match(await send('x', {}), /not sent \(CI_ALERTS_TELEGRAM_BOT_TOKEN or CI_ALERTS_TELEGRAM_CHAT_ID not set\)/);
  const secret = {CI_ALERTS_TELEGRAM_BOT_TOKEN: 'TOKEN123', CI_ALERTS_TELEGRAM_CHAT_ID: '7'};
  const line = await send('x', secret, async url => { throw new Error(`fetch failed ${url}`); });
  assert.doesNotMatch(line, /TOKEN123/);
  let body = null;
  assert.equal(await send('hello', secret, async (url, options) => { body = JSON.parse(options.body); return {ok: true}; }), 'ci-alert: sent');
  assert.deepEqual([body.chat_id, body.text], ['7', 'hello']);
});

test('"Since green" names the newest 5 PRs as links and "+N more"; none when the last green run is this commit or unknown', async () => {
  const commits = Array.from({length: 8}, (_, i) => ({commit: {message: `Fix ${i} (#${900 + i})\n\nbody`}})).concat([{commit: {message: 'A direct commit'}}]);
  const fetcher = async url => ({json: async () => (/compare/.test(url) ? {commits} : {workflow_runs: [{head_sha: 'green0'}]})});
  assert.deepEqual(await sinceGreen(env, fetcher), {prs: ['907', '906', '905', '904', '903'], more: 3});
  assert.deepEqual(await sinceGreen({...env, GITHUB_SHA: 'green0'}, fetcher), {prs: [], more: 0});
  assert.deepEqual(await sinceGreen(env, async () => { throw new Error('down'); }), {prs: [], more: 0});
  const text = messageOf({status: 'failure', what: 'x', since: {prs: ['907', '906'], more: 3}, env, now}).text;
  assert.match(text, /• Since green: <a href="https:\/\/github\.com\/o\/r\/pull\/907">#907<\/a>, <a href="https:\/\/github\.com\/o\/r\/pull\/906">#906<\/a> \+3 more/);
});

test('the same failure on the same commit alerts once: a repeat needs a new commit or other failed jobs', async () => {
  const runs = [{id: 42, head_sha: 'abcdef1234', conclusion: 'failure'}, {id: 41, head_sha: 'abcdef1234', conclusion: 'failure'}, {id: 40, head_sha: 'old', conclusion: 'success'}];
  const jobs = {42: ['plan', 'alert'], 41: ['plan']};
  const fetcher = async url => {
    const m = url.match(/runs\/(\d+)\/jobs/);
    if (m) return {json: async () => ({jobs: (jobs[m[1]] || []).map(name => ({name, conclusion: name === 'alert' ? null : 'failure'}))})};
    return {json: async () => ({workflow_runs: runs})};
  };
  assert.deepEqual(await failedJobs('42', env, fetcher), ['plan']);
  assert.equal(await isRepeat(env, fetcher), true);
  assert.equal(await isRepeat({...env, GITHUB_SHA: 'ffff'}, fetcher), false, 'a new commit alerts again');
  jobs[42] = ['plan', 'suite'];
  assert.equal(await isRepeat(env, fetcher), false, 'a new failed job alerts again');
});

// 27 Oct 2026 (6e): main's quality red said "the steps merge e7ab156 touched"; its step said "3 AI question(s) had no recorded answer" (#2234's prompt change).
test('the cause quotes each failed job\'s own step annotation ("<suite> · <step>"), not the runner\'s exit line; none found or an error: []', async () => {
  const fetcher = async url => {
    if (/runs\/42\/jobs/.test(url)) return {json: async () => ({jobs: [{id: 7, name: 'E2E · quality', conclusion: 'failure'}, {id: 8, name: 'plan', conclusion: 'success'}]})};
    if (/check-runs\/7\/annotations/.test(url)) return {json: async () => [{title: '', message: 'Process completed with exit code 1.'}, {title: 'First try failed', message: 'the next step decides'},
      {title: 'quality · a Jobs check on the golden postings', message: '3 AI question(s) had no recorded answer (asked live, not kept)'}]};
    throw new Error(`unexpected ${url}`);
  };
  assert.deepEqual(await stepCauses('42', env, fetcher), ['quality · a Jobs check on the golden postings: 3 AI question(s) had no recorded answer (asked live, not kept)']);
  assert.deepEqual(await stepCauses('42', env, async () => { throw new Error('down'); }), []);
});
