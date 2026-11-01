// Ready to send builds tonight's batch the same way on every store (store contract, docs/rules/data-ownership.md): a job's kit is saved by the engine
// (src/ai/kit.py kit_markdown, as a drafted kit is), then lib/ready-batch.js buildBatch reads it back through lib/store/extension-store.js and the real
// engine (`python -m src.stores call`), once on SQLite (every user's default) and once on Notion (the in-memory stand-in, desktop/e2e/lib/notion-fake.mjs).
// The two batches must be equal, field for field, and carry the kit's answers and letter: a field only one adapter returns fails here.
// Isolated: temp data and config folders, a fictional job, no real token, the app's folder never followed. Parked by session 8d, built 18 Oct 2026.
import assert from 'node:assert/strict';
import {execFile} from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {test} from 'node:test';
import {fileURLToPath} from 'node:url';
import * as engine from '../lib/store/engine.js';
import {extensionStore} from '../lib/store/extension-store.js';
import {buildBatch} from '../lib/ready-batch.js';
import {startNotionFake} from '../e2e/lib/notion-fake.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(here, '../..');
const python = process.env.JOBADABRA_CHECK_PYTHON || (process.platform === 'win32' ? 'python' : 'python3');
const SCHEMA = JSON.parse(fs.readFileSync(path.join(root, 'config', 'notion_schema.json'), 'utf8'));
// Async, never spawnSync: the Notion stand-in answers from this same process, so a blocked event loop would time the engine out.
const py = (args, env) => new Promise(resolve => execFile(python, args, {cwd: root, env, encoding: 'utf8', maxBuffer: 1 << 24}, (error, stdout, stderr) => resolve({code: error ? (error.code ?? 1) : 0, stdout, stderr})));
const COMPUTED = new Set(['formula', 'rollup', 'last_edited_time', 'created_time', 'unique_id', 'people']);   // as tests/test_store_notion.py
const URL_ = 'https://job-boards.example.com/acme/jobs/4242';
const JOB = {url: URL_, title: 'Platform Engineer', company: 'Acme Fictional', location: 'Basel'};
const KIT = {answers: [{field: 'why', question: 'Why Acme?', answer: 'Because of the on-call culture.', needs_review: false, category: 'motivation'}],
  cover_letter: 'Dear Acme Fictional,\n\nI would like to join.', check_before_sending: ['Salary'], highlights: ['Ran on call for a payments platform']};

// The engine's side: the job and its kit, written as a drafted kit is.
const SEED = `
import json, sys
from src.stores import open_stores
from src.ai import kit
stores = open_stores()
job, drafted = json.loads(sys.argv[1]), json.loads(sys.argv[2])
row = stores.applications.create(job, 'Kit ready')
stores.applications.set_section(row['id'], kit.KIT_SECTION, kit.kit_markdown(job, drafted, [], 'claude-haiku-5-5'))
print('SEEDED ' + row['id'])
`;

const baseEnv = () => {
  const env = {...process.env, JOBADABRA_DATA_DIR: fs.mkdtempSync(path.join(os.tmpdir(), 'jp-ready-data-')),
    JOBADABRA_CONFIG_DIR: fs.mkdtempSync(path.join(os.tmpdir(), 'jp-ready-config-')), JOBADABRA_FOLLOW_APP: '0', PYTHONUTF8: '1', PYTHONIOENCODING: 'utf-8'};
  for (const name of Object.keys(env)) if (/^NOTION_|^GITHUB_RUN_ID$|^ANTHROPIC_API_KEY$/.test(name)) delete env[name];
  return env;
};

async function notionEnv(fake) {
  const post = async (route, body) => (await fetch(`${fake.url}/v1/${route}`, {method: 'POST', body: JSON.stringify(body),
    headers: {Authorization: `Bearer ${fake.token}`, 'Content-Type': 'application/json', 'Notion-Version': '2022-06-28'}})).json();
  const env = {...baseEnv(), JOBADABRA_STORE: 'notion', NOTION_TOKEN: fake.token, JOBADABRA_E2E: '1', JOBADABRA_E2E_NOTION_BASE_URL: fake.url};
  for (const [variable, spec] of Object.entries(SCHEMA.databases)) {
    const properties = Object.fromEntries(Object.entries(spec.columns).filter(([, column]) => !COMPUTED.has(column.type)).map(([name, column]) => [name, {[column.type]: {}}]));
    env[variable] = (await post('databases', {parent: {page_id: 'stand-in-root'}, title: [{text: {content: spec.title}}], properties})).id;
  }
  for (const variable of ['NOTION_PROFILE_PAGE_ID', 'NOTION_ANSWERS_PAGE_ID', 'NOTION_KNOWLEDGE_PAGE']) {
    env[variable] = (await post('pages', {parent: {page_id: 'stand-in-root'}, properties: {title: {title: [{text: {content: variable}}]}}})).id;
  }
  return env;
}

// Tonight's batch for one job, built from what the engine saved on this store. Files on this Mac (the CV PDF, the letter PDF) are not the store's: fixed here.
async function batchOn(env) {
  const seeded = await py(['-c', SEED, JSON.stringify(JOB), JSON.stringify(KIT)], env);
  assert.equal(seeded.code, 0, seeded.stderr);
  const run = (_, args) => py(['-m', ...args], env);
  const store = extensionStore({}, {call: (storage, entity, method, kwargs) => engine.call(storage, entity, method, kwargs, {run})});
  const me = async () => ({contact: {first_name: 'Ada', email: 'ada@example.com'}, resume: {data: 'Q1Y='}, coverLetterFile: {data: 'TEw='}});
  const deps = {store, me, facts: async () => ({profile: 'fictional'})};
  const found = await store.findJob(`${URL_}/`);   // the URL form a posting link may carry
  const {batch, skipped} = await buildBatch([{code: 'c1', url: URL_, title: JOB.title, company: JOB.company, fit: 82}], deps, {now: new Date(2026, 9, 18, 20, 0)});
  return {batch, skipped, found: found && {...found, id: found.id ? 'an id' : ''}};
}

test('tonight\'s batch is the same from SQLite and from Notion, with the kit\'s answers and letter', async () => {
  const fake = await startNotionFake();
  try {
    const on = {sqlite: await batchOn({...baseEnv(), JOBADABRA_STORE: 'sqlite'}), notion: await batchOn(await notionEnv(fake))};
    for (const [name, {batch, skipped, found}] of Object.entries(on)) {
      assert.deepEqual(skipped, [], `${name}: nothing left out`);
      assert.equal(batch.jobs.length, 1, name);
      assert.deepEqual(batch.jobs[0].kit.answers.map(a => [a.question, a.answer]), [['Why Acme?', 'Because of the on-call culture.']], `${name}: the kit's answers`);
      assert.equal(batch.jobs[0].letter, KIT.cover_letter, `${name}: the kit's letter`);
      assert.ok(found?.id, `${name}: the job is found by its link`);
    }
    assert.deepEqual(on.notion.batch, on.sqlite.batch, 'the same batch on both stores');
    assert.deepEqual({...on.notion.found, notion_url: ''}, {...on.sqlite.found, notion_url: ''}, 'the same job record for the night');
  } finally { await fake.close(); }
});
