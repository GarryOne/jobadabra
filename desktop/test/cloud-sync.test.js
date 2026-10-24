// Always on's repo is kept in step with the app at every start (lib/github.js updateRepo): the workflow files, retired ones deleted,
// and the secrets and variables, models included, sent again when they changed (8 Oct 2026: before, only when Always on was turned on).
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {test} from 'node:test';
import * as github from '../lib/github.js';
import {MODELS} from '../lib/pipeline.js';
import {createStorage} from '../lib/storage.js';

const KEY = Buffer.alloc(32, 7).toString('base64');   // a well-formed public key for the sealed secrets

function setUp() {
  const storage = createStorage(fs.mkdtempSync(path.join(os.tmpdir(), 'jp-sync-')), {encrypt: v => v, decrypt: v => v});
  storage.saveSettings({cloud: {repo: 'me/job-pilotto-private'}, notionIds: {NOTION_APPLICATIONS_DB: 'db1'}});
  storage.setSecret('GITHUB_TOKEN', 'ghu_x');
  storage.setSecret('ANTHROPIC_API_KEY', 'sk-ant-x');
  return storage;
}

// A fake GitHub: the repo's files (path -> text) and every call made.
function fakeGitHub(files = {}) {
  const calls = [];
  const fetcher = async (url, options = {}) => {
    const method = options.method || 'GET', route = new URL(url).pathname;
    calls.push(`${method} ${route}`);
    const json = (body, status = 200) => new Response(JSON.stringify(body), {status});
    if (route.endsWith('/actions/secrets/public-key')) return json({key: KEY, key_id: 'k1'});
    const file = route.split('/contents/')[1];
    if (route.endsWith('/contents/.github/workflows') && method === 'GET') {
      return json(Object.keys(files).filter(name => name.startsWith('.github/workflows/')).map(name => ({type: 'file', name: path.basename(name), path: name})));
    }
    if (file && method === 'GET') return file in files ? json({content: Buffer.from(files[file]).toString('base64'), sha: `sha-${file}`}) : json({message: 'Not Found'}, 404);
    if (file && method === 'PUT') { files[file] = Buffer.from(JSON.parse(options.body).content, 'base64').toString(); return json({}); }
    if (file && method === 'DELETE') { delete files[file]; return json({}); }
    return json({});
  };
  return {calls, fetcher, files};
}

test('the models reach the repo as variables, the small one included, and nothing is sent again while unchanged', async () => {
  const storage = setUp();
  const gh = fakeGitHub();
  const changed = await github.updateRepo(storage, {fetcher: gh.fetcher});
  assert.ok(changed.includes('variable JOB_PILOTTO_SMALL_MODEL') && changed.includes('variable JOB_PILOTTO_ENRICH_MODEL'), changed.join(', '));
  assert.ok(gh.calls.some(call => call === 'PUT /repos/me/job-pilotto-private/actions/secrets/ANTHROPIC_API_KEY'));
  assert.equal(MODELS.small, 'claude-haiku-5-5');
  const again = fakeGitHub(gh.files);
  assert.deepEqual(await github.updateRepo(storage, {fetcher: again.fetcher}), []);
  assert.ok(!again.calls.some(call => /actions\/(secrets|variables)/.test(call)), again.calls.join('\n'));
});

test('a changed key or setting is sent at the next start; the result names it, never its value', async () => {
  const storage = setUp();
  const gh = fakeGitHub();
  await github.updateRepo(storage, {fetcher: gh.fetcher});
  storage.setSecret('ANTHROPIC_API_KEY', 'sk-ant-new');
  const next = fakeGitHub(gh.files);
  const changed = await github.updateRepo(storage, {fetcher: next.fetcher});
  assert.ok(next.calls.includes('PUT /repos/me/job-pilotto-private/actions/secrets/ANTHROPIC_API_KEY'));
  assert.ok(!changed.join(' ').includes('sk-ant'), changed.join(', '));
});

test('a workflow this app no longer ships is deleted; the user\'s own workflows stay', async () => {
  const storage = setUp();
  const gh = fakeGitHub({'.github/workflows/old.yml': '# Jobadabra — a check we stopped shipping\non: push\n',
    '.github/workflows/mine.yml': '# my own\non: push\n'});
  const changed = await github.updateRepo(storage, {fetcher: gh.fetcher});
  assert.ok(changed.includes('removed .github/workflows/old.yml'), changed.join(', '));
  assert.ok(!('.github/workflows/old.yml' in gh.files));
  assert.ok('.github/workflows/mine.yml' in gh.files);
  assert.ok('.github/workflows/daily.yml' in gh.files, 'the shipped ones are written');
});

test('a retired workflow is found by either header: the old name and Jobadabra (24 Oct 2026 rename)', async () => {
  const storage = setUp();
  const gh = fakeGitHub({'.github/workflows/a.yml': '# Jobadabra — retired\non: push\n', '.github/workflows/b.yml': '# Jobadabra — retired\non: push\n'});
  const changed = await github.updateRepo(storage, {fetcher: gh.fetcher});
  assert.ok(changed.includes('removed .github/workflows/a.yml') && changed.includes('removed .github/workflows/b.yml'), changed.join(', '));
});

test('turning Always on on records what it sent, so the next start sends nothing again', async () => {
  const storage = setUp();
  const gh = fakeGitHub();
  const fetcher = async (url, options = {}) => {
    const route = new URL(url).pathname;
    if (route === '/user') return new Response(JSON.stringify({login: 'me'}));
    if (route === '/user/installations') return new Response(JSON.stringify({installations: [{id: 1}]}));
    if (route === '/user/installations/1/repositories') return new Response(JSON.stringify({repositories: [{full_name: 'me/job-pilotto-private', name: 'job-pilotto-private', private: true}]}));
    return gh.fetcher(url, options);
  };
  await github.connect(storage, 'ghu_x', {fetcher});
  assert.match(storage.settings().cloud.synced, /^[0-9a-f]{64}$/);
  const after = fakeGitHub(gh.files);
  await github.updateRepo(storage, {fetcher: after.fetcher});
  assert.ok(!after.calls.some(call => /actions\/(secrets|variables)/.test(call)), after.calls.join('\n'));
});
