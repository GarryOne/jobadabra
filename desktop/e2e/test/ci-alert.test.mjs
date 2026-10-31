// CI alerts on Telegram (ci-alert.mjs): 🔴 on every failure, 🟢 only on the first success after one, nothing without the secrets, never the token in a line.
import assert from 'node:assert/strict';
import {test} from 'node:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import {failedJobLinks, failedJobs, isRepeat, messageOf, previousConclusion, sinceGreen, send, stepCauses} from '../ci-alert.mjs';
import {annotationLines} from '../lib/artifacts.mjs';
import {fields} from '../lib/telegram-fake.mjs';
import {nameAiFailure} from '../lib/ai-miss-cause.mjs';

const env = {GITHUB_WORKFLOW: 'CI · Site replays · all (offline)', GITHUB_SHA: 'abcdef1234', GITHUB_REF_NAME: 'main', GITHUB_REPOSITORY: 'o/r', GITHUB_RUN_ID: '42',
  GITHUB_WORKFLOW_REF: 'o/r/.github/workflows/site-replays.yml@refs/heads/main', GH_TOKEN: 'gh'};
const lanes = {suites: {quality: {lane: 'tolerant'}, qualityai: {lane: 'tolerant'}, mailreading: {lane: 'retired'}}};
const now = new Date('2026-10-14T00:30:00Z');

test('a failure says which workflow, cause, next step, commit and run; a success says something only after a failure', () => {
  const red = messageOf({lanes, status: 'failure', what: '1 row worse: Join', next: 'label the PR replay-accepted', env, now});
  assert.equal(render(red), '🔴  CI · Site replays · all (offline) · red on main\n     CI · Site replays · all (offline) · 0 steps · 1 cause\n\n'
    + '🔌  1 row worse: Join\n\nNext: label the PR replay-accepted\n\n🕐  14 Oct, 02:30\n🔗  Run · abcdef1');
  assert.match(messageOf({lanes, status: 'success', previous: 'failure', env, now}).text, /^🟢  <b>CI · Site replays · all \(offline\)<\/b> is green again on main\n\n🕐/);
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

test('"Since green" finds merged PRs (merge commit or squash), newest first; the alert links every PR and "+N more"; none when the last green run is this commit or unknown', async () => {
  // Main merges by merge commit since 27 Oct 2026: "Merge pull request #n from …" counts like a squash title "… (#n)"; a PR's own commits do not.
  const commits = Array.from({length: 8}, (_, i) => ({commit: {message: i % 2 ? `Fix ${i} (#${900 + i})\n\nbody` : `Merge pull request #${900 + i} from o/topic-${i}\n\nFix ${i}`}}))
    .concat([{commit: {message: 'A direct commit'}}, {commit: {message: 'A PR branch commit naming #12 in passing'}}]);
  const fetcher = async url => ({json: async () => (/compare/.test(url) ? {commits} : {workflow_runs: [{head_sha: 'green0'}]})});
  assert.deepEqual(await sinceGreen(env, fetcher), {prs: ['907', '906', '905', '904', '903'], more: 3});
  assert.deepEqual(await sinceGreen({...env, GITHUB_SHA: 'green0'}, fetcher), {prs: [], more: 0});
  assert.deepEqual(await sinceGreen(env, async () => { throw new Error('down'); }), {prs: [], more: 0});
  const text = messageOf({lanes, status: 'failure', what: 'x', since: {prs: ['907', '906', '905', '904', '903'], more: 3}, env, now}).text;
  for (const pr of ['907', '906', '905', '904', '903']) assert.ok(text.includes(`<a href="https://github.com/o/r/pull/${pr}">#${pr}</a>`));
  assert.match(text, /\+3 more\n🕐  14 Oct, 02:30\n/);
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
  assert.deepEqual(await stepCauses('42', env, fetcher, lanes), [{suite: 'apply', step: 'fill the form', message: '3 AI question(s) had no recorded answer (asked live, not kept)', job: 'E2E · apply', url: 'https://github.com/o/r/actions/runs/42/job/7'}]);
  assert.deepEqual(await stepCauses('42', env, async () => { throw new Error('down'); }, lanes), []);
});

const e2eEnv = {...env, GITHUB_WORKFLOW: 'CI · End-to-end on Mac + Linux', GITHUB_WORKFLOW_REF: 'o/r/.github/workflows/e2e.yml@refs/heads/main'};
const failed = names => names.map(name => ({name, url: 'https://job/' + encodeURIComponent(name)}));

test('owner scenario: tolerant quality and retired mailreading red send no message, including shards, stand-ins and burn-in names', () => {
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
  assert.deepEqual(await stepCauses('42', e2eEnv, fetcher, lanes), [{suite: 'apply', step: 'fill', message: 'missing field', job: 'apply', url: 'https://github.com/o/r/actions/runs/42/job/2'}]);
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
    assert.match(messages[1], /^🟢  <b>apply<\/b> is green again on main\n/, 'names the suite that was red');
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

test('with no step words the failed jobs are the cause, and an after-merge run names the merge it checked', () => {
  const input = {lanes, status: 'failure', jobs: failed(['quality', 'apply']), env: {...e2eEnv, AFTER_MERGE: 'abc1234'}, now};
  assert.match(messageOf(input).text, /^🔴  <b>apply<\/b> · red on main/);
  assert.match(messageOf(input).text, /🔌  Failed job: apply/);
  assert.match(messageOf(input).text, /<a href="https:\/\/github\.com\/o\/r\/commit\/abc1234">abc1234<\/a>$/);
  assert.match(messageOf({...input, causes: [{suite: 'apply', step: 'fill', message: 'missing field'}]}).text, /✗  missing field\n     ✗ <a [^>]+>fill<\/a>/);
});

// Owner, 30 Oct 2026 (Telegram, main's quality red): "let's improve this telegram message. Let's make it more human radable. more succint." Picked shape A.
// Before: "• Cause: quality · the app's list agrees with Notion (same jobs, same scores): …, the app shows null; … \"Senior DevOps Engineer\": Noti (Failed job: quality, after merge 6af7e52)".
test('quality assertions retain their own words, counted annotation overflow and PR context', async () => {
  const jobs = ['Senior Platform Engineer', 'Cloud Infrastructure Engineer', 'Engineering Manager, Infrastructure', 'Junior DevOps Engineer', 'Senior DevOps Engineer'];
  const step = {suite: 'quality', step: "the app's list agrees with Notion (same jobs, same scores)",
    message: [...jobs, ...jobs].map((job, i) => `"${job}": Notion says ${[78, 58, 43, 35, 30][i % 5]}, the app shows null`).join('; ')};   // 10 problems: past the annotation's length
  const [line] = annotationLines([step]);
  const annotation = {title: decodeURIComponent(/title=([^:]+)::/.exec(line)[1]), message: decodeURIComponent(line.split('::')[2])};
  const fetcher = async url => ({json: async () => (url.includes('/jobs?') ? {jobs: [{id: 7, name: 'quality', conclusion: 'failure', html_url: 'https://github.com/o/r/actions/runs/42/job/7'}]} : [annotation])});
  const causes = await stepCauses('42', e2eEnv, fetcher, {suites: {}});
  const message = messageOf({lanes: {suites: {}}, status: 'failure', causes, jobs: await failedJobLinks('42', e2eEnv, fetcher), since: {prs: ['2538'], more: 0}, env: e2eEnv, now: new Date('2026-10-30T01:29:00Z')});
  assert.match(render(message), /^🔴  quality · red on main\n     quality · 1 step · 4 causes/);
  assert.match(render(message), /✗  Senior Platform Engineer: Notion says 78, the app shows nothing/);
  assert.match(render(message), /✗  Cloud Infrastructure Engineer: Notion says 58, the app shows nothing/);
  assert.match(message.text, /<blockquote expandable>\+6 more<\/blockquote>/);
  assert.match(message.text, /<a href="https:\/\/github\.com\/o\/r\/pull\/2538">#2538<\/a>/);
});

// Gitar on #2547: "+N more" subtracted a fixed 2 even when one problem was shown; "null" was rewritten inside real error text.
test('"+N more" counts the problems left after the ones shown, and only a value ending the line reads "nothing"', () => {
  const lines = message => messageOf({lanes: {suites: {}}, status: 'failure', causes: [{suite: 'quality', step: 'a check', message}], env: e2eEnv, now}).text;
  assert.match(lines('"A long job": Notion says 78, the app shows null; +4 more'), /✗  A long job: Notion says 78, the app shows nothing[\s\S]*<blockquote expandable>\+4 more<\/blockquote>/, 'one shown of 5: 4 more');
  assert.match(lines('"A": Notion says 1, the app shows null; "B": Notion says 2, the app shows null; +3 more'), /✗  A: [\s\S]*✗  B: [\s\S]*<blockquote expandable>\+3 more<\/blockquote>/);
  assert.doesNotMatch(lines('"A": x; "B": y'), /more/, 'all shown: no count');
  assert.match(lines("Cannot read properties of undefined (reading 'x')"), /Cannot read properties of undefined \(reading 'x'\)/, 'an error text keeps its words');
});

test('a failed backbone job is a failure whatever its annotations say: its own conclusion is the verdict', async () => {
  // Why (31 Oct 2026, owner: a suite past its budget is our bug): no "Grey" annotation turns a failed job into health, so annotations are not even fetched.
  const fetcher = async url => {
    assert.doesNotMatch(url, /annotations/, 'the verdict does not read annotations');
    return {json: async () => ({jobs: [{id: 81, name: 'apply', conclusion: 'failure', html_url: 'u81'}]})};
  };
  assert.deepEqual(await failedJobs(1, env, fetcher, lanes), ['apply']);
  assert.deepEqual(await failedJobLinks(1, env, fetcher), [{name: 'apply', url: 'u81'}]);
  const jobs = await failedJobLinks(1, env, fetcher);
  assert.match(messageOf({lanes, status: 'failure', env: {...env, GITHUB_WORKFLOW_REF: 'o/r/.github/workflows/e2e.yml@refs/heads/main'}, jobs, now}).text, /apply/);
});

// Owner-selected 12:45 shape, run 41196661516 / job 124524161393; runner-owned annotation wording.
const applyJob = {name: 'apply-1of2', url: 'https://github.com/GarryOne/jobadabra/actions/runs/41196661516/job/124524161393'};
const applyEnv = {...e2eEnv, GITHUB_REPOSITORY: 'GarryOne/jobadabra', GITHUB_RUN_ID: '41196661516', GITHUB_SHA: '23e73e5'};
const applyNotes = [
  {title: 'apply · Background automation fills several queued jobs', message: "the suite's 11-minute budget ran out during this step (the suite is too long: split it): the window answers, the main process answers"},
  {title: 'apply · Full automation presses each queued job', message: 'not run: the suite was over its 11-minute budget'},
  {title: 'apply · "Ready to submit" over an unfilled control', message: 'not run: the suite was over its 11-minute budget'},
];
const render = message => message.text.replace(/<[^>]+>/g, '').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');
async function applyFixture(extra = {}) {
  const fetcher = async url => ({json: async () => url.includes('/jobs?')
    ? {jobs: [{...applyJob, id: 124524161393, html_url: applyJob.url, conclusion: 'failure'}]} : applyNotes});
  return {lanes: {suites: {}}, status: 'failure', env: applyEnv, now: new Date('2026-10-31T11:45:00Z'), jobs: [applyJob],
    since: {prs: ['2676', '2682'], more: 0}, causes: await stepCauses('41196661516', applyEnv, fetcher, {suites: {}}), ...extra};
}

test('12:45 apply alert renders every annotation grouped under its one budget cause', async () => {
  const message = messageOf(await applyFixture());
  assert.equal(render(message), '🔴  apply · red on main\n     apply-1of2 · 3 steps · 1 cause\n\n'
    + '⏱  Over its 11-min budget\n     the suite is too long: split it\n'
    + '     ✗ Background automation fills several queued jobs ← cut here\n'
    + '     ⏭ Full automation presses each queued job (not run)\n'
    + '     ⏭ "Ready to submit" over an unfilled control (not run)\n\n'
    + '🔀  After #2676 · #2682\n🕐  31 Oct, 12:45\n🔗  Open apply-1of2 · Run · 23e73e5');
  assert.match(message.text, /<i>apply-1of2 · 3 steps · 1 cause<\/i>/);
  assert.doesNotMatch(message.text, /window answers|main process/);
  let delivered;
  await send(message, {CI_ALERTS_TELEGRAM_BOT_TOKEN: 'fake', CI_ALERTS_TELEGRAM_CHAT_ID: 'fake'}, async (_url, options) => {
    delivered = fields(options.headers['Content-Type'], options.body); return {ok: true};
  });
  assert.equal(delivered.text, message.text, 'the fake Telegram payload preserves the rendered fixture');
});

test('two red suites have separate blocks for budget and the 03:23/04:30 refused-AI shapes', async () => {
  const input = await applyFixture();
  const wizard = {suite: 'wizard', step: 'the strategy is built from the CV', job: 'wizard', url: 'https://job/wizard',
    message: 'AI asks with no stored answer: 1 (first: abc); the AI was refused: broker: budget:own-share 67% of 60% (scheduled); the step then failed: the strategy is empty; the window answers, the main process answers'};
  const text = render(messageOf({...input, jobs: [...input.jobs, {name: 'wizard', url: wizard.url}], causes: [...input.causes, wizard]}));
  assert.equal((text.match(/red on main/g) || []).length, 2);
  assert.match(text, /\n\n─ ─ ─\n\n🔴  wizard · red on main\n     wizard · 1 step · 2 causes\n\n🤖  AI refused: credit 67% of 60%\n     ✗ the strategy is built from the CV\n\n📭  1 ask with no stored answer\n     ✗ the strategy is built from the CV/);
  assert.doesNotMatch(text, /first: abc|step then failed|window answers/);
});

test('more than 3 steps per cause show two and keep the others in an expandable quote', async () => {
  const input = await applyFixture();
  const causes = Array.from({length: 6}, (_, i) => ({...input.causes[0], step: `queued job ${i}`}));
  const message = messageOf({...input, causes});
  assert.match(message.text, /queued job 0<\/a> ← cut here\n     ✗ .*queued job 1<\/a> ← cut here\n<blockquote expandable>.*queued job 2/s);
  assert.match(message.text, /queued job 5<\/a> ← cut here<\/blockquote>/);
});

test('each PR, step, job, run and commit is a named HTML hyperlink', async () => {
  const message = messageOf(await applyFixture());
  for (const pr of ['2676', '2682']) assert.ok(message.text.includes(`<a href="https://github.com/GarryOne/jobadabra/pull/${pr}">#${pr}</a>`));
  for (const note of applyNotes) assert.ok(message.text.includes(`<a href="${applyJob.url}">${note.title.split(' · ')[1]}</a>`));
  assert.ok(message.text.includes(`<a href="${applyJob.url}">Open apply-1of2</a>`));
  assert.ok(message.text.includes('<a href="https://github.com/GarryOne/jobadabra/actions/runs/41196661516">Run</a>'));
  assert.ok(message.text.includes('<a href="https://github.com/GarryOne/jobadabra/commit/23e73e5">23e73e5</a>'));
});

test('many long linked steps stay within Telegram limits with balanced HTML and a +N more quote', async () => {
  const input = await applyFixture();
  const causes = Array.from({length: 100}, (_, i) => ({...input.causes[0], step: `job ${i} ${'a & <b> '.repeat(30)}`}));
  const message = messageOf({...input, causes});
  assert.ok(message.text.length <= 4096, String(message.text.length));
  assert.match(message.text, /<blockquote expandable>[\s\S]*\+\d+ more<\/blockquote>/);
  const shown = (message.text.match(/     ✗ /g) || []).length;
  assert.equal(shown + Number(/\+(\d+) more/.exec(message.text)[1]), causes.length, 'every omitted step is counted once');
  assert.match(message.text, /&amp; &lt;b&gt;/);
  for (const tag of ['a', 'b', 'i', 'blockquote']) {
    assert.equal((message.text.match(new RegExp(`<${tag}(?: |>).*?`, 'g')) || []).length, (message.text.match(new RegExp(`</${tag}>`, 'g')) || []).length, tag);
  }
  assert.match(message.text, /23e73e5<\/a>$/);
});

test('two shards group the same cause once while each step keeps its own job link and a short name', async () => {
  const input = await applyFixture();
  const other = {name: 'apply-2of2', url: 'https://job/apply-2of2'};
  const message = messageOf({...input, jobs: [...input.jobs, other], causes: [input.causes[0],
    {...input.causes[0], job: other.name, url: other.url, step: 'a lengthy step '.repeat(20)}]});
  assert.equal((message.text.match(/⏱  /g) || []).length, 1);
  assert.match(message.text, /apply-1of2, apply-2of2 · 2 steps · 1 cause/);
  const label = /<a href="https:\/\/job\/apply-2of2">([^<]+)<\/a>/.exec(message.text)?.[1];
  assert.ok(label && label.length <= 80 && label.endsWith('…'));
  assert.ok(message.text.includes(`<a href="${applyJob.url}">Background automation fills several queued jobs</a>`));
});

test('many distinct causes preserve the Next action and footer without counting either as an omitted step', async () => {
  const input = await applyFixture();
  const causes = Array.from({length: 40}, (_, i) => ({...input.causes[0], step: `queued job ${i}`, message: `wrong value ${i}`}));
  const message = messageOf({...input, causes, next: 'label the PR replay-accepted'});
  assert.ok(message.text.length <= 4096);
  assert.match(message.text, /Next: label the PR replay-accepted/);
  assert.match(message.text, /23e73e5<\/a>\n<blockquote expandable>\+\d+ more<\/blockquote>$/);
  const shown = (message.text.match(/     ✗ /g) || []).length;
  assert.equal(shown + Number(/\+(\d+) more/.exec(message.text)[1]), causes.length);
});


test('a refusal without an unstored ask uses the current writer protocol without inventing a missing-answer cause', async () => {
  const input = await applyFixture();
  const message = nameAiFailure('the strategy is empty', {capped: {why: 'broker: budget:own-share 67% of 60% (scheduled)'}});
  const alert = messageOf({...input, causes: [{...input.causes[0], message}]});
  assert.match(alert.text, /🤖  AI refused: credit 67% of 60%/);
  assert.doesNotMatch(alert.text, /📭|no stored answer|the step then failed/);
});
