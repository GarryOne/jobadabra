// CI alerts on Telegram (ci-alert.mjs): 🔴 on every failure, 🟢 only on the first success after one, nothing without the secrets, never the token in a line.
import assert from 'node:assert/strict';
import {test} from 'node:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import {failedJobLinks, failedJobs, isRepeat, messageOf, previousConclusion, sinceGreen, send, stepCauses} from '../ci-alert.mjs';

const env = {GITHUB_WORKFLOW: 'CI · Site replays · all (offline)', GITHUB_SHA: 'abcdef1234', GITHUB_REF_NAME: 'main', GITHUB_REPOSITORY: 'o/r', GITHUB_RUN_ID: '42',
  GITHUB_WORKFLOW_REF: 'o/r/.github/workflows/site-replays.yml@refs/heads/main', GH_TOKEN: 'gh'};
const lanes = {suites: {quality: {lane: 'tolerant'}, qualityai: {lane: 'tolerant'}, mailreading: {lane: 'tolerant'}}};
const now = new Date('2026-10-14T00:30:00Z');

test('a failure says which workflow, cause, commit, next step and run; a success says something only after a failure', () => {
  const red = messageOf({lanes, status: 'failure', what: '1 row worse: Join', next: 'label the PR replay-accepted', env, now});
  assert.match(red.text, /^🔴 <b>CI · Site replays · all \(offline\)<\/b> failed\n\n• Cause: 1 row worse: Join\n• Commit: <a href="https:\/\/github\.com\/o\/r\/commit\/abcdef1234">abcdef1<\/a> · main · 14 Oct, 02:30\n• Next: label the PR replay-accepted\n\n<a href="https:\/\/github\.com\/o\/r\/actions\/runs\/42">Open run<\/a>$/);
  assert.match(messageOf({lanes, status: 'success', previous: 'failure', env, now}).text, /^🟢 <b>.*<\/b> is back to green/);
  assert.equal(messageOf({lanes, status: 'success', previous: 'success', env, now}), '');
});

test('a renamed workflow\'s earlier runs are read from its old file name too (until 28 Oct 2026)', async () => {
  const asked = [];
  const fetcher = async url => { asked.push(url); return {json: async () => ({workflow_runs: /replay-offline\.yml/.test(url) ? [{id: 30, conclusion: 'failure'}] : []})}; };
  assert.equal(await previousConclusion(env, fetcher, lanes), 'failure', 'nothing under the new name: the old one answers');
  assert.equal(asked.length, 2);
  asked.length = 0;
  assert.equal(await previousConclusion(env, async url => { asked.push(url); return {json: async () => ({workflow_runs: [{id: 40, conclusion: 'success'}]})}; }, lanes), 'success');
  assert.equal(asked.length, 1, 'the new name answered: the old one is not asked');
});

test('the previous run is the newest finished one that is not this run', async () => {
  let asked = '';
  const fetcher = async url => { asked = url; return {json: async () => ({workflow_runs: [{id: 42, conclusion: 'success'}, {id: 41, conclusion: 'failure'}]})}; };
  assert.equal(await previousConclusion(env, fetcher, lanes), 'failure');
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
  const text = messageOf({lanes, status: 'failure', what: 'x', since: {prs: ['907', '906'], more: 3}, env, now}).text;
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
  assert.deepEqual(await failedJobs('42', env, fetcher, lanes), ['plan']);
  assert.equal(await isRepeat(env, fetcher, lanes), true);
  assert.equal(await isRepeat({...env, GITHUB_SHA: 'ffff'}, fetcher, lanes), false, 'a new commit alerts again');
  jobs[42] = ['plan', 'suite'];
  assert.equal(await isRepeat(env, fetcher, lanes), false, 'a new failed job alerts again');
});

// 27 Oct 2026 (6e): main's quality red said "the steps merge e7ab156 touched"; its step said "3 AI question(s) had no recorded answer" (#2234's prompt change).
test('the cause quotes each failed job\'s own step annotation ("<suite> · <step>"), not the runner\'s exit line; none found or an error: []', async () => {
  const fetcher = async url => {
    if (/runs\/42\/jobs/.test(url)) return {json: async () => ({jobs: [{id: 7, name: 'E2E · apply', conclusion: 'failure'}, {id: 8, name: 'plan', conclusion: 'success'}]})};
    if (/check-runs\/7\/annotations/.test(url)) return {json: async () => [{title: '', message: 'Process completed with exit code 1.'}, {title: 'First try failed', message: 'the next step decides'},
      {title: 'apply · fill the form', message: '3 AI question(s) had no recorded answer (asked live, not kept)'}]};
    throw new Error(`unexpected ${url}`);
  };
  assert.deepEqual(await stepCauses('42', env, fetcher, lanes), ['apply · fill the form: 3 AI question(s) had no recorded answer (asked live, not kept)']);
  assert.deepEqual(await stepCauses('42', env, async () => { throw new Error('down'); }, lanes), []);
});

const e2eEnv = {...env, GITHUB_WORKFLOW: 'CI · End-to-end on Mac + Linux', GITHUB_WORKFLOW_REF: 'o/r/.github/workflows/e2e.yml@refs/heads/main'};
const failed = names => names.map(name => ({name, url: 'https://job/' + encodeURIComponent(name)}));

test('owner scenario: quality and mailreading red send no message, including shards, stand-ins and burn-in names', () => {
  for (const names of [['quality', 'mailreading'], ['quality-1of2-standin · burn-in 2/5', 'mailreading-standin']]) {
    assert.equal(messageOf({lanes, status: 'failure', jobs: failed(names), env: e2eEnv}), '');
  }
});

test('owner scenario: quality and apply red name only apply in the message', () => {
  const message = messageOf({lanes, status: 'failure', jobs: failed(['quality', 'apply']), env: e2eEnv});
  assert.match(message.text, /🔴/);
  assert.match(message.text, /apply/);
  assert.doesNotMatch(message.text, /quality/);
});

test('tolerant failed step annotations do not enter a mixed alert cause', async () => {
  const asked = [];
  const fetcher = async url => {
    asked.push(url);
    return {json: async () => url.includes('/jobs?') ? {jobs: [{id: 1, name: 'quality', conclusion: 'failure'}, {id: 2, name: 'apply', conclusion: 'failure'}]} : [{title: 'apply · fill', message: 'missing field'}]};
  };
  assert.deepEqual(await stepCauses('42', e2eEnv, fetcher, lanes), ['apply · fill: missing field']);
  assert.ok(!asked.some(url => url.includes('/check-runs/1/')));
});

test('a success following only tolerant reds sends no back-to-green message', async () => {
  const fetcher = async url => ({json: async () => url.includes('/jobs?') ? {jobs: [{name: 'quality', conclusion: 'failure'}, {name: 'mailreading', conclusion: 'failure'}]} : {workflow_runs: [{id: 41, conclusion: 'failure'}]}});
  const previous = await previousConclusion(e2eEnv, fetcher, lanes);
  assert.equal(messageOf({lanes, status: 'success', previous, env: e2eEnv}), '');
});

test('suspended and retired jobs are also silent while unlisted plan failures still alert', () => {
  const lanes = {suites: {old: {lane: 'retired'}, flipped: {lane: 'suspended'}}};
  assert.equal(messageOf({lanes, status: 'failure', jobs: failed(['old-1of2', 'flipped-standin · burn-in 1/5']), env: e2eEnv}), '');
  assert.match(messageOf({lanes, status: 'failure', jobs: failed(['old', 'plan']), env: e2eEnv}).text, /Failed job: plan/);
});

// e2e.yml uses keys and burn-in titles; desktop.yml prefixes the matrix key.
for (const name of ['quality', 'quality-1of2-standin', 'quality-1of2-sqlite',
  'quality · burn-in 2/5', 'quality-1of2-standin · burn-in 2/5', 'E2E · Mac + Linux · quality-1of2-sqlite']) {
  test(`real job shape stays non-backbone: ${name}`, () => {
    assert.equal(messageOf({lanes, status: 'failure', jobs: failed([name]), env: e2eEnv}), '');
  });
}

test('three CLI runs: apply red alerts, apply fixed beside quality red recovers, all green stays silent', () => {
  const runs = [
    {id: 1, conclusion: 'failure', jobs: [{name: 'apply', conclusion: 'failure'}, {name: 'quality', conclusion: 'success'}]},
    {id: 2, conclusion: 'failure', jobs: [{name: 'apply', conclusion: 'success'}, {name: 'quality', conclusion: 'failure'}]},
    {id: 3, conclusion: 'success', jobs: [{name: 'apply', conclusion: 'success'}, {name: 'quality', conclusion: 'success'}]},
  ];
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ci-alert-'));
  try {
    const messages = [];
    for (const run of runs) {
      const preload = path.join(dir, 'api.mjs'), sent = path.join(dir, `sent-${run.id}.json`);
      fs.writeFileSync(preload, `import fs from 'node:fs'; import {syncBuiltinESMExports} from 'node:module';
const read = fs.readFileSync;
fs.readFileSync = function(file, ...args) {
  return String(file).endsWith('/e2e/lanes.json') ? ${JSON.stringify(JSON.stringify(lanes))} : read.call(this, file, ...args);
};
syncBuiltinESMExports();
const runs = ${JSON.stringify(runs)}, current = ${run.id};
globalThis.fetch = async (url, options) => {
  if (url.startsWith('https://api.telegram.org/')) {
    fs.writeFileSync(${JSON.stringify(sent)}, options.body); return {ok: true};
  }
  const id = url.match(/runs\\/(\\d+)\\/jobs/)?.[1];
  if (id) return {json: async () => ({jobs: runs.find(item => String(item.id) === id).jobs})};
  if (url.includes('/annotations?')) return {json: async () => []};
  if (url.includes('/runs?')) return {json: async () => ({workflow_runs: url.includes('status=success') ? [] : runs.filter(item => item.id <= current).toReversed()})};
  throw new Error('Unexpected API route: ' + url);
};`);
      const result = spawnSync(process.execPath, ['--import', preload, new URL('../ci-alert.mjs', import.meta.url).pathname, run.conclusion], {
        encoding: 'utf8', timeout: 10000, env: {...process.env, ...e2eEnv, GITHUB_RUN_ID: String(run.id),
          AFTER_MERGE: '', CI_ALERT_ASSUME_FAILED: '', CI_ALERTS_TELEGRAM_BOT_TOKEN: 'fake', CI_ALERTS_TELEGRAM_CHAT_ID: 'fake'},
      });
      assert.equal(result.status, 0, result.stderr);
      messages.push(fs.existsSync(sent) ? JSON.parse(fs.readFileSync(sent, 'utf8')).text : '');
    }
    assert.match(messages[0], /🔴/);
    assert.match(messages[1], /🟢.*is back to green/);
    assert.equal(messages[2], '');
  } finally { fs.rmSync(dir, {recursive: true, force: true}); }
});

test('a cancelled backbone job beside a tolerant failure still alerts and counts as previous red', async () => {
  const fetcher = async url => ({json: async () => url.includes('/jobs?') ? {jobs: [
    {name: 'apply', conclusion: 'cancelled', html_url: 'https://job/apply'},
    {name: 'quality', conclusion: 'failure', html_url: 'https://job/quality'},
  ]} : {workflow_runs: [{id: 41, conclusion: 'failure'}]}});
  const jobs = await failedJobLinks('42', e2eEnv, fetcher);
  const message = messageOf({lanes, status: 'failure', jobs, env: e2eEnv});
  assert.match(message.text, /🔴/);
  assert.match(message.text, /Failed job: apply/);
  assert.doesNotMatch(message.text, /quality/);
  assert.equal(await previousConclusion(e2eEnv, fetcher, lanes), 'failure');
});

test('step cause and failed-job context share the after-merge message formatter', () => {
  const input = {lanes, status: 'failure', jobs: failed(['quality', 'apply']), env: {...e2eEnv, AFTER_MERGE: 'abc1234'}};
  assert.match(messageOf(input).text, /Cause: Failed job: apply, after merge abc1234/);
  assert.match(messageOf({...input, causes: ['apply · fill: missing field']}).text,
    /Cause: apply · fill: missing field \(Failed job: apply, after merge abc1234\)/);
});
