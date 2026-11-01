// The extension's routes give one answer whichever store holds the data (app-core/src/extension.js): fed from Notion (env.notionCall) and
// from the store on this Mac (env.store = lib/store/extension-store.js), the kit route answers the same job and kit, and a fill run is
// logged with the same values.
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {handleExtension} from '../shared/app-core/extension.js';
import {KIT_SECTION, extensionStore, kitOf} from '../lib/store/extension-store.js';

const URL_ = 'https://job-boards.greenhouse.io/acme/jobs/123';
const KIT = {answers: [{field: 'why', question: 'Why us?', answer: 'Because', needs_review: false, category: 'motivation', internal: 'x'}],
  cover_letter: 'Dear Acme', check_before_sending: ['Salary'], analysis: 'never sent to a form'};
const RUN = {url: URL_, started: '2026-10-09T10:00:00.000Z', ended: '2026-10-09T10:03:00.000Z', fields: 12, unfilled: 1, usd: 0.02, billed_to: 'Claude subscription',
  kit: true, todo: ['Salary'], trace: []};
const rich = text => [{plain_text: text, text: {content: text}}];

function notionEnv() {
  const pages = [];
  const row = {id: 'row1', url: 'https://www.notion.so/row1', properties: {Job: {title: rich('SRE')}, Company: {rich_text: rich('Acme')},
    Stage: {select: {name: 'Kit ready'}}, 'Job URL': {url: URL_}}};
  const notionCall = async (route, method, body) => {
    if (route.includes('/query')) return {results: body.filter.url.equals === URL_ ? [row] : []};
    if (route.startsWith('blocks/row1/children')) return {results: [{id: 'h', type: 'heading_2', heading_2: {rich_text: rich('📝 Application kit')}}], has_more: false};
    if (route.startsWith('blocks/h/children')) return {results: [{id: 'c', type: 'code', code: {rich_text: rich(JSON.stringify(KIT))}}], has_more: false};
    if (route === 'pages' && method === 'POST') { pages.push(body); return {url: 'https://www.notion.so/run1'}; }
    throw new Error(`unexpected ${method} ${route}`);
  };
  return {env: {EXTENSION_TOKEN: 't', NOTION_TOKEN: 'n', NOTION_APPLICATIONS_DB: 'apps', NOTION_AGENT_RUNS_DB: 'runs', notionCall}, pages};
}
function storeEnv() {
  const added = [], updated = [];
  const call = async (_, entity, method, kwargs) => {
    if (entity === 'applications' && method === 'get') return kwargs.url === URL_ ? {id: 'a1', url: URL_, title: 'SRE', company: 'Acme', stage: 'Kit ready'} : null;
    if (entity === 'applications' && method === 'list') return [];
    if (entity === 'applications' && method === 'section') return kwargs.name === KIT_SECTION ? `## ${KIT_SECTION}\n\n\`\`\`json\n${JSON.stringify(KIT)}\n\`\`\`\n` : null;
    if (entity === 'agent_runs' && method === 'add') { added.push(kwargs.run); return {id: 'r1', ...kwargs.run}; }
    if (entity === 'agent_runs' && method === 'get') return kwargs.run_id === 'r1' ? {id: 'r1', fields: {job: 'SRE', company: 'Acme', started: RUN.started, field_count: 12}} : null;
    if (entity === 'agent_runs' && method === 'update') { updated.push(kwargs); return {id: kwargs.run_id}; }
    throw new Error(`unexpected ${entity}.${method}`);
  };
  return {env: {EXTENSION_TOKEN: 't', store: extensionStore({}, {call})}, added, updated};
}
const ask = (env, path, body) => handleExtension(new Request(`http://127.0.0.1/extension/${path}`, body
  ? {method: 'POST', headers: {Authorization: 'Bearer t', 'Content-Type': 'application/json'}, body: JSON.stringify(body)}
  : {headers: {Authorization: 'Bearer t'}}), env).then(response => response.json());

test('the kit route: the same job and the same kit (only what a form needs) from either store', async () => {
  const fromNotion = await ask(notionEnv().env, `kit?url=${encodeURIComponent(URL_)}`);
  const fromMac = await ask(storeEnv().env, `kit?url=${encodeURIComponent(URL_)}`);
  assert.deepEqual({...fromMac.job, notion_url: undefined}, {...fromNotion.job, notion_url: undefined});
  assert.deepEqual(fromMac.kit, fromNotion.kit);
  assert.equal(fromMac.kit.answers[0].internal, undefined);
  assert.equal((await ask(storeEnv().env, `kit?url=${encodeURIComponent('https://other.example/9')}`)).error, 'not tracked');
});

test('a fill run is logged with the same values in either store', async () => {
  const notion = notionEnv(), mac = storeEnv();
  assert.equal((await ask(notion.env, 'run', RUN)).ok, true);
  assert.equal((await ask(mac.env, 'run', RUN)).ok, true);
  const p = notion.pages[0].properties, r = mac.added[0], f = r.fields;
  assert.deepEqual([r.url, r.ats, r.outcome, r.learnings], [p['Job URL'].url, p.ATS.select.name, p.Status.select.name, p.Learnings.rich_text[0].text.content]);
  assert.deepEqual([f.minutes, f.field_count, f.unfilled_required, f.billed_to, f.reason, f.agent, f.started, f.ended],
    [p.Minutes.number, p.Fields.number, p['Unfilled required'].number, p['Billed to'].select.name, p.Reason.rich_text[0].text.content, p.Agent.select.name,
      p.Started.date.start, p.Ended.date.start]);
  assert.deepEqual([f.job, f.company], ['SRE', 'Acme']);
});

test('the kit in its section: a fenced JSON block; anything else is no kit', () => {
  assert.deepEqual(kitOf('intro\n```json\n{"a":1}\n```\n'), {a: 1});
  assert.deepEqual(kitOf('### ✉️ Cover letter\n```json\n{"example":true}\n```\n### Machine-readable kit\n```json\n{"kit":2}\n```\n'), {kit: 2});   // the last fence
  assert.equal(kitOf('```\n{"a":1}\n```'), null);   // only a json fence is the kit
  assert.equal(kitOf('```json\n[1, 2]\n```'), null);   // not an object
  assert.equal(kitOf('text ```json\n{"a":1}\n```'), null);   // a fence opens on its own line
  assert.deepEqual(kitOf('```json  \n{"a":1}\n```'), {a: 1});   // trailing spaces after json are fine
  assert.equal(kitOf('no kit here'), null);
  assert.equal(kitOf('```json\n{broken\n```'), null);
});

test('the shared kit sample reads the same in JS as in Python (tests/fixtures/stores/kit-section.md, base.kit_from)', async () => {
  const fs = await import('node:fs');
  const sample = fs.readFileSync(new URL('../../tests/fixtures/stores/kit-section.md', import.meta.url), 'utf8');
  const kit = kitOf(sample);
  assert.equal(kit.version, 1);
  assert.equal(kit.url, 'https://jobs.example.com/sre-1');
  assert.equal(kit.answers[1].needs_review, true);
});

// The record update (extension/ladder/record-update.js): a box the page emptied after the record was sent and the retype typed again corrects THAT run's row, through the store
// interface (agent_runs.update, every adapter); it never adds a second row, and an update the store cannot place is dropped, never added.
test('a run update replaces the row of that run (same values as a new row would carry), never adds one', async () => {
  const mac = storeEnv();
  const update = {...RUN, update: 'r1', fields: 14, unfilled: 0, trace: [{label: 'First name', required: true, source: 'your details', outcome: 'filled', reason: ''}]};
  assert.deepEqual(await ask(mac.env, 'run', update), {ok: true, id: 'r1'});
  assert.equal(mac.added.length, 0, 'no second row');
  assert.equal(mac.updated.length, 1);
  const [{run_id: id, fields}] = mac.updated, row = {...fields, fields: {...fields.fields}};
  assert.equal(id, 'r1');
  assert.deepEqual([fields.outcome, fields.fields.field_count, fields.fields.unfilled_required, fields.fields.status], ['Ready', 14, 0, 'Ready']);
  assert.equal(fields.fields.data.fields[0].outcome, 'filled');
  assert.equal(row.url, undefined, 'the url never changes');
  assert.deepEqual([fields.fields.job, fields.fields.company, fields.fields.started], ['SRE', 'Acme', RUN.started], 'the row keeps its own job, company and start');
});

test('an update with no store to place it (the Cloudflare worker) is skipped: no row is added', async () => {
  const notion = notionEnv();
  assert.deepEqual(await ask(notion.env, 'run', {...RUN, update: 'r1'}), {ok: false, skipped: true});
  assert.equal(notion.pages.length, 0);
  assert.equal((await ask(storeEnv().env, 'run', {...RUN, update: 7})).skipped, true, 'an id that is not a plain id is no update');
  const gone = storeEnv();
  assert.deepEqual(await ask(gone.env, 'run', {...RUN, update: 'zz'}), {ok: false, skipped: true});   // the row is gone: no update, no new row
  assert.deepEqual([gone.added.length, gone.updated.length], [0, 0]);
});
