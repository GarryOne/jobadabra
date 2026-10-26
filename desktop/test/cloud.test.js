import assert from 'node:assert/strict';
import fs from 'node:fs';
import {createRequire} from 'node:module';
import os from 'node:os';
import path from 'node:path';
import {test} from 'node:test';
import * as github from '../lib/github.js';
import {due} from '../lib/schedule.js';
import {createStorage} from '../lib/storage.js';
import {telegramEnv} from '../lib/telegram.js';

const sodium = createRequire(import.meta.url)('libsodium-wrappers');
const fakeCrypto = {encrypt: s => s, decrypt: s => s};

function userStorage() {
  const storage = createStorage(fs.mkdtempSync(path.join(os.tmpdir(), 'jp-cloud-')), fakeCrypto);
  storage.setSecret('ANTHROPIC_API_KEY', 'sk-ant-test');
  storage.setSecret('NOTION_TOKEN', 'ntn_test');
  storage.setSecret('TELEGRAM_BOT_TOKEN', '123:bot');
  storage.saveSettings({telegramChatId: 42, notionIds: {NOTION_APPLICATIONS_DB: 'apps', NOTION_MATCHES_DB: 'matches'}, setupDone: true});
  storage.writeText('config/search.json', '{"locations": ["zurich"]}\n');
  storage.writeText('config/preferences.json', '{"excluded_companies": ["Acme"]}\n');
  return storage;
}

// A small GitHub: records calls, answers like the real API.
async function fakeGitHub({repoExists = true, variableExists = [], createdAt = new Date().toISOString()} = {}) {
  await sodium.ready;
  const keys = sodium.crypto_box_keypair();
  const calls = [];
  const files = {};
  const fetcher = async (url, {method = 'GET', body} = {}) => {
    const route = url.replace('https://api.github.com', '');
    const data = body ? JSON.parse(body) : undefined;
    calls.push({method, route, data});
    const json = (status, value) => ({ok: status < 300, status, json: async () => value});
    if (route === '/user') return json(200, {login: 'ada'});
    if (route.startsWith('/user/installations?')) return json(200, {installations: repoExists === null ? [] : [{id: 7}]});
    if (route.startsWith('/user/installations/7/repositories')) return json(200, {repositories: [
      {name: 'dotfiles', full_name: 'ada/dotfiles', private: false}, {name: 'job-pilotto-private', full_name: 'ada/job-pilotto-private', private: true, created_at: createdAt}]});
    const content = route.match(/^\/repos\/ada\/job-pilotto-private\/contents\/(.+)$/);
    if (content && method === 'GET') return files[content[1]] ? json(200, files[content[1]]) : json(404, {});
    if (content && method === 'PUT') { files[content[1]] = {content: data.content, sha: 'x'}; return json(201, {}); }
    if (route.endsWith('/actions/secrets/public-key')) return json(200, {key: sodium.to_base64(keys.publicKey, sodium.base64_variants.ORIGINAL), key_id: 'k1'});
    if (route.includes('/actions/secrets/')) return json(201, {});
    if (route.endsWith('/actions/variables') && method === 'POST') return variableExists.includes(data.name) ? json(409, {}) : json(201, {});
    if (route.includes('/actions/variables/')) return {ok: true, status: 204, json: async () => null};
    if (/\/actions\/workflows\/[\w.-]+\/(enable|disable)$/.test(route)) return {ok: true, status: 204, json: async () => null};
    if (route.includes('/dispatches')) return {ok: true, status: 204, json: async () => null};
    throw new Error(`unexpected ${method} ${route}`);
  };
  const open = sealed => sodium.to_string(sodium.crypto_box_seal_open(sodium.from_base64(sealed, sodium.base64_variants.ORIGINAL), keys.publicKey, keys.privateKey));
  return {fetcher, calls, files, open};
}

test('turning it on fills the repo the app was installed on: schedules, settings, sealed keys, Notion IDs', async () => {
  const storage = userStorage();
  const gh = await fakeGitHub({variableExists: ['NOTION_MATCHES_DB']});
  const result = await github.connect(storage, 'gho_token', {fetcher: gh.fetcher});

  assert.equal(result.repo, 'ada/job-pilotto-private');
  assert.ok(!gh.calls.some(c => c.route === '/user/repos'));  // never creates repos: it has no such permission
  for (const file of ['.github/workflows/daily.yml', '.github/workflows/scout.yml', '.github/workflows/mail.yml', 'README.md',
    'config/search.json', 'config/preferences.json']) assert.ok(gh.files[file], file);
  assert.match(Buffer.from(gh.files['.github/workflows/daily.yml'].content, 'base64').toString(), /GarryOne\/jobadabra\/.github\/workflows\/daily.yml@main/);

  const secrets = Object.fromEntries(gh.calls.filter(c => c.method === 'PUT' && c.route.includes('/actions/secrets/'))
    .map(c => [c.route.split('/').pop(), gh.open(c.data.encrypted_value)]));
  assert.deepEqual(secrets, {ANTHROPIC_API_KEY: 'sk-ant-test', NOTION_TOKEN: 'ntn_test', TELEGRAM_BOT_TOKEN: '123:bot', TELEGRAM_CHAT_ID: '42'});
  assert.ok(gh.calls.some(c => c.method === 'PATCH' && c.route.endsWith('/actions/variables/NOTION_MATCHES_DB')));  // existing: updated
  assert.ok(gh.calls.some(c => c.method === 'POST' && c.data?.name === 'JOB_PILOTTO_SCORE_MODEL'));
  assert.equal(storage.settings().cloud.repo, 'ada/job-pilotto-private');
});

test('Always on: turning it on enables every scheduled workflow, turning it off pauses every one (and one failure does not stop the rest)', async () => {
  const storage = userStorage();
  const gh = await fakeGitHub();
  await github.connect(storage, 'gho_token', {fetcher: gh.fetcher});
  const files = Object.keys(github.payload(storage).files).filter(f => f.startsWith('.github/workflows/')).map(f => path.basename(f));
  const routes = action => gh.calls.filter(c => c.method === 'PUT' && c.route.endsWith(`/${action}`)).map(c => path.basename(path.dirname(c.route)));
  assert.deepEqual(routes('enable').sort(), files.sort());

  storage.setSecret('GITHUB_TOKEN', 'gho_token');
  assert.deepEqual(await github.pauseWorkflows(storage, {fetcher: gh.fetcher}), []);
  assert.deepEqual(routes('disable').sort(), files.sort());

  const failing = async (url, init) => url.includes('/mail.yml/') ? {ok: false, status: 403, json: async () => ({message: 'no'})} : gh.fetcher(url, init);
  const failed = await github.pauseWorkflows(storage, {fetcher: failing});
  assert.equal(failed.length, 1);
  assert.match(failed[0], /^mail\.yml/);
});

test('a repository from an earlier setup is reused, and the setup says so (only the first time)', async () => {
  const storage = userStorage();
  const steps = [];
  const gh = await fakeGitHub({createdAt: '2026-09-27T21:48:14Z'});
  const first = await github.connect(storage, 'gho_token', {fetcher: gh.fetcher, onStep: step => steps.push(step)});
  assert.deepEqual(first.existing, {createdAt: '2026-09-27T21:48:14Z'});
  assert.ok(steps.some(step => /Found your repository ada\/job-pilotto-private \(created 27 Sept? 2026\)/.test(step)), steps.join(' | '));
  assert.equal((await github.connect(storage, 'gho_token', {fetcher: gh.fetcher})).existing, null);  // Update: already in use
  const fresh = await github.connect(userStorage(), 'gho_token', {fetcher: (await fakeGitHub()).fetcher});
  assert.equal(fresh.existing, null);  // made just now, in this setup
});

test('running it again leaves unchanged files alone', async () => {
  const storage = userStorage();
  const gh = await fakeGitHub();
  await github.connect(storage, 't', {fetcher: gh.fetcher});
  const writes = gh.calls.filter(c => c.method === 'PUT' && c.route.includes('/contents/')).length;
  gh.calls.length = 0;
  await github.connect(storage, 't', {fetcher: gh.fetcher});
  assert.ok(writes > 0);
  assert.equal(gh.calls.filter(c => c.method === 'PUT' && c.route.includes('/contents/')).length, 0);
});

test('with the cloud on: no local timer, and buttons start runs in the repo', async () => {
  const storage = userStorage();
  storage.setSecret('GITHUB_TOKEN', 'gho_token');
  storage.saveSettings({cloud: {repo: 'ada/job-pilotto-private'}});
  assert.equal(due(storage.settings()), false);
  const gh = await fakeGitHub();
  await github.cloudDispatch(storage, () => {}, {fetcher: gh.fetcher})({mode: 'apply', job: 'ab12', page: undefined, seed: 7}, 'daily.yml');
  const call = gh.calls.find(c => c.route.includes('/dispatches'));
  assert.equal(call.route, '/repos/ada/job-pilotto-private/actions/workflows/daily.yml/dispatches');
  assert.deepEqual(call.data, {ref: 'main', inputs: {mode: 'apply', job: 'ab12', seed: '7'}});
  assert.match(telegramEnv(storage).status(), /even with your computer off/);
});

test('the schedule and job choices reach the repo: crons, kits on, insights off', async () => {
  const storage = userStorage();
  storage.saveSettings({schedule: {search: 2, kits: 3, insights: 'off', scout: 'off', mail: 1}});
  const gh = await fakeGitHub();
  await github.connect(storage, 't', {fetcher: gh.fetcher});
  const file = name => Buffer.from(gh.files[`.github/workflows/${name}`].content, 'base64').toString();
  assert.match(file('daily.yml'), /- cron: '\d+ [\d,]+ \* \* \*'/);
  assert.equal(file('daily.yml').match(/- cron: '\d+ ([\d,]+)/)[1].split(',').length, 12);  // every 2 hours
  assert.doesNotMatch(file('scout.yml'), /schedule:/);
  assert.ok(gh.calls.some(c => c.method === 'POST' && c.data?.name === 'JOB_PILOTTO_AUTO_KIT_MAX' && c.data.value === '3'));
  assert.ok(gh.calls.some(c => c.method === 'DELETE' && c.route.endsWith('/actions/variables/JOB_PILOTTO_INSIGHT_MODEL')));
});

test('not installed yet: it says so, with the two setup links', async () => {
  const gh = await fakeGitHub({repoExists: null});
  await assert.rejects(github.connect(userStorage(), 't', {fetcher: gh.fetcher}), error => error.needsRepo === true);
  assert.match(github.CREATE_URL, /template_name=job-pilotto-starter.*visibility=private/);
  assert.match(github.INSTALL_URL, /github\.com\/apps\/.+\/installations\/new/);
  if (!process.env.JOB_PILOTTO_GITHUB_APP) assert.equal(github.INSTALL_URL, 'https://github.com/apps/jobadabra/installations/new', 'the app is named Jobadabra on GitHub since 26 Oct 2026; apps/job-pilotto answers 404');
});

test('installed on several repositories: the user chooses one; the choice is used', async () => {
  const gh = await fakeGitHub();
  const fetcher = async (url, init) => {
    if (url.includes('/user/installations/7/repositories')) return {ok: true, status: 200, json: async () => ({repositories: [
      {name: 'jobs', full_name: 'ada/jobs', private: true}, {name: 'notes', full_name: 'ada/notes', private: true}]})};
    return gh.fetcher(url, init);
  };
  await assert.rejects(github.connect(userStorage(), 't', {fetcher}), error => error.needsChoice && error.repos.length === 2);
});

// A dispatch is the one action that spends money and time on GitHub. Until 1 Oct 2026 it left no trace on this Mac, so
// two runs 38 s apart for one interview could not be told apart. Every attempt now goes to the app's log with what
// asked for it — and the inputs' values never do (a Telegram action can carry the user's own words).
test('a dispatched run is the one created after the dispatch, and the link is its job', async () => {
  const storage = userStorage();
  storage.setSecret('GITHUB_TOKEN', 'gho_token');
  storage.saveSettings({cloud: {repo: 'ada/job-pilotto-private'}});
  const fetcher = async url => {
    const route = url.replace('https://api.github.com', '');
    const json = value => ({ok: true, status: 200, json: async () => value});
    if (route.startsWith('/repos/ada/job-pilotto-private/actions/workflows/mail.yml/runs')) {
      return json({workflow_runs: [
        {id: 1, html_url: 'https://github.com/ada/job-pilotto-private/actions/runs/1', status: 'completed', conclusion: 'success', created_at: '2026-10-01T13:40:00Z'},
        {id: 20, html_url: 'https://github.com/ada/job-pilotto-private/actions/runs/20', status: 'in_progress', conclusion: null, created_at: '2026-10-01T13:47:20Z'},
      ]});
    }
    if (route.startsWith('/repos/ada/job-pilotto-private/actions/runs/20/jobs')) {
      return json({jobs: [{id: 99, status: 'in_progress', html_url: 'https://github.com/ada/job-pilotto-private/actions/runs/20/job/99'}]});
    }
    throw new Error(route);
  };
  const since = Date.parse('2026-10-01T13:47:00Z');
  const runs = await github.dispatchedRuns(storage, {workflow: 'mail.yml', since, fetcher});
  assert.deepEqual(runs.map(run => run.id), [20]);
  assert.equal(github.runLink(runs[0], await github.runJobs(storage, 20, {fetcher})).url,
    'https://github.com/ada/job-pilotto-private/actions/runs/20/job/99');
  assert.equal(github.runLink(runs[0], []).url, 'https://github.com/ada/job-pilotto-private/actions/runs/20');
});

test('a dispatch is logged with its caller, and its failure is reported, not swallowed', async () => {
  const storage = userStorage();
  storage.setSecret('GITHUB_TOKEN', 'gho_token');
  storage.saveSettings({cloud: {repo: 'ada/job-pilotto-private'}});
  const lines = [];
  const gh = await fakeGitHub();
  const send = github.cloudDispatch(storage, () => {}, {fetcher: gh.fetcher, note: line => lines.push(line)});
  const started = await send({mode: 'interview', interview: '3ec62be8-fd86-8173-9446-d83a1e46c805'}, 'daily.yml', 'Interview review (Review)');
  assert.equal(started.ok, true);
  assert.match(lines[0], /^start Interview review \(Review\) → daily \(interview\) #[0-9a-f]{8} in ada\/job-pilotto-private$/);
  assert.match(lines[1], /^sent Interview review \(Review\) → daily \(interview\) #[0-9a-f]{8} in ada\/job-pilotto-private$/);
  assert.ok(!lines.join(' ').includes('3ec62be8'), 'the log carries no input values');
  assert.ok(!lines.join(' ').includes('gho_token'), 'and no token');
  // The same inputs give the same tag, which is what makes a duplicate dispatch visible; another interview does not.
  const again = [];
  await github.cloudDispatch(storage, () => {}, {fetcher: gh.fetcher, note: line => again.push(line)})
    ({mode: 'interview', interview: '3ec62be8-fd86-8173-9446-d83a1e46c805'}, 'daily.yml', 'Interview review (Review again)');
  assert.equal(again[0].split('#')[1].split(' ')[0], lines[0].split('#')[1].split(' ')[0]);
  const other = [];
  await github.cloudDispatch(storage, () => {}, {fetcher: gh.fetcher, note: line => other.push(line)})
    ({mode: 'interview', interview: 'another-page'}, 'daily.yml', 'Interview review (Review)');
  assert.notEqual(other[0].split('#')[1].split(' ')[0], lines[0].split('#')[1].split(' ')[0]);
  // A refused dispatch comes back as a failure: the window must not say "reviewing" when nothing was started.
  const failing = github.cloudDispatch(storage, () => {}, {fetcher: async () => ({ok: false, status: 422, json: async () => ({message: 'Workflow does not have'})}), note: line => lines.push(line)});
  const failed = await failing({mode: 'run'}, 'daily.yml', 'Run now (Refresh)');
  assert.equal(failed.ok, false);
  assert.equal(failed.error, 'Workflow does not have');
  assert.match(lines.at(-1), /^failed Run now \(Refresh\) → daily \(run\) #[0-9a-f]{8} in ada\/job-pilotto-private: Workflow does not have$/);
});

test('Stop on a GitHub run cancels it there, by the run id in its address', async () => {
  assert.equal(github.runIdOf('https://github.com/ada/job-pilotto-private/actions/runs/20/job/99'), '20');
  assert.equal(github.runIdOf('https://github.com/ada/job-pilotto-private/actions/runs/20'), '20');
  assert.equal(github.runIdOf('https://www.notion.so/page'), null);   // a row with no GitHub address: nothing to cancel
  const storage = userStorage();
  storage.setSecret('GITHUB_TOKEN', 'gho_token');
  storage.saveSettings({cloud: {repo: 'ada/job-pilotto-private'}});
  const calls = [];
  const fetcher = async (url, init) => { calls.push([init.method, url.replace('https://api.github.com', '')]); return {ok: true, status: 202, json: async () => ({})}; };
  await github.cancelRun(storage, '20', {fetcher});
  assert.deepEqual(calls, [['POST', '/repos/ada/job-pilotto-private/actions/runs/20/cancel']]);
  await assert.rejects(github.cancelRun(storage, null, {fetcher}), /not listed this run yet/);
  storage.saveSettings({cloud: null});
  await assert.rejects(github.cancelRun(storage, '20', {fetcher}), /not connected/);
});
