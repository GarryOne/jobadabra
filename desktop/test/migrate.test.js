import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {test} from 'node:test';
import * as migrate from '../lib/migrate.js';
import {createStorage} from '../lib/storage.js';

const fakeCrypto = {encrypt: v => Buffer.from(v).toString('base64'), decrypt: s => Buffer.from(s, 'base64').toString()};
const connected = () => {
  const storage = createStorage(fs.mkdtempSync(path.join(os.tmpdir(), 'pilot-')), fakeCrypto);
  storage.setSecret('NOTION_TOKEN', 'ntn_x');
  storage.saveSettings({setupDone: true, notionIds: {NOTION_PROFILE_PAGE_ID: 'p'}});
  return storage;
};

test('moves to Notion run once set up with Notion; a failing step is reported and retried next start', async () => {
  const storage = connected();
  const lines = [];
  const moved = await migrate.run(storage, line => lines.push(line), [
    {name: 'a', run: async () => true},
    {name: 'b', run: async () => { throw new Error('Notion is down'); }},
    {name: 'c', run: async () => false},  // nothing to move
  ]);
  assert.deepEqual(moved, ['a']);
  assert.match(lines.join('\n'), /Moving b to Notion failed \(will retry next start\): Notion is down/);
  assert.match(lines.join('\n'), /Moved to Notion: a\./);
});

test('nothing moves before setup or without Notion', async () => {
  const storage = connected();
  storage.saveSettings({setupDone: false});
  assert.deepEqual(await migrate.run(storage, () => {}, [{name: 'a', run: async () => true}]), []);
});

test('an install set up before the central index keeps its daily scout; a new install starts without one', () => {
  const existing = connected();
  assert.equal(migrate.pinScoutSchedule(existing), true);
  assert.equal(existing.settings().schedule.scout, 'daily');
  const chosen = connected();
  chosen.saveSettings({schedule: {scout: 'weekly', mail: 3}});
  migrate.pinScoutSchedule(chosen);
  assert.deepEqual(chosen.settings().schedule, {scout: 'weekly', mail: 3});  // their own choice stays
  const fresh = createStorage(fs.mkdtempSync(path.join(os.tmpdir(), 'pilot-')), fakeCrypto);
  assert.equal(migrate.pinScoutSchedule(fresh), false);
  assert.equal(fresh.settings().schedule?.scout, undefined);
  fresh.saveSettings({setupDone: true});   // finishes setup later: still no scout, the pin ran only once
  assert.equal(migrate.pinScoutSchedule(fresh), false);
  assert.equal(fresh.settings().schedule?.scout, undefined);
});

test('Origin is backfilled once, after the workspace step adds the column; a failed run is retried next start', async () => {
  const names = migrate.STEPS.map(s => s.name);
  assert.ok(names.indexOf('workspace') < names.indexOf('origin'));
  const step = migrate.STEPS.find(s => s.name === 'origin');
  const storage = connected(), calls = [];
  await assert.rejects(step.run(storage, undefined, async (_, args) => { calls.push(args); return {code: 1}; }), /could not fill Origin/);
  assert.equal(storage.settings().originFilled, undefined);  // not marked: next start tries again
  assert.equal(await step.run(storage, undefined, async (_, args) => { calls.push(args); return {code: 0}; }), true);
  assert.deepEqual(calls[1], ['src.notion.origin', '--backfill', '--apply']);
  assert.equal(storage.settings().originFilled, true);
  assert.equal(await step.run(storage, undefined, async () => { throw new Error('must not run again'); }), false);
});

test('employers checked on this Mac are written to each Employers database once, after the workspace step creates it', async () => {
  const names = migrate.STEPS.map(s => s.name);
  assert.ok(names.indexOf('workspace') < names.indexOf('employers from this Mac'));
  const step = migrate.STEPS.find(s => s.name === 'employers from this Mac');
  const storage = connected(), calls = [];
  assert.equal(await step.run(storage, undefined, async () => { throw new Error('no database yet: must not run'); }), false);
  storage.saveSettings({notionIds: {NOTION_EMPLOYERS_DB: 'emp-1'}});
  await assert.rejects(step.run(storage, undefined, async () => ({code: 1})), /could not write the employers/);
  assert.equal(storage.settings().employersSyncedTo, undefined);   // retried next start
  assert.equal(await step.run(storage, undefined, async (_, args) => { calls.push(args); return {code: 0, stdout: 'Employers: 45 written to Notion\n'}; }), true);
  assert.deepEqual(calls[0], ['src', 'scout', '--sync-notion']);
  assert.equal(await step.run(storage, undefined, async () => { throw new Error('must not run again'); }), false);
  storage.saveSettings({notionIds: {NOTION_EMPLOYERS_DB: 'emp-2'}});   // another workspace: its database gets them too
  assert.equal(await step.run(storage, undefined, async () => ({code: 0, stdout: 'Employers: 0 written to Notion\n'})), false);
  assert.equal(storage.settings().employersSyncedTo, 'emp-2');
});

// ---- Notion later: the strategy kept on this Mac while trying moves in at connect ----
const withLocal = mode => {
  const storage = connected();
  storage.saveSettings({notionIds: {NOTION_PROFILE_PAGE_ID: 'prof', NOTION_ANSWERS_PAGE_ID: 'ans'}, notionMoveIn: mode});
  storage.writeText('profile.md', '# Me\nSRE');
  storage.writeText('answers.md', 'Notice: 1 month');
  return storage;
};
const step = () => migrate.STEPS.find(s => s.name === 'strategy from this Mac');

test('strategy from this Mac: a fresh workspace gets the local Profile, answers and search settings, then the files go', async () => {
  const storage = withLocal('fresh');
  const written = [];
  const writePage = async (_token, page, text) => { written.push([page, text]); };
  const run = async () => ({code: 0, stdout: '## Roles\n- sre'});
  const ensurePage = async () => 'search-page';
  assert.equal(await step().run(storage, undefined, {writePage, run, ensurePage}), true);
  assert.deepEqual(written, [['prof', '# Me\nSRE'], ['ans', 'Notice: 1 month'], ['search-page', '## Roles\n- sre']]);
  assert.equal(storage.readText('profile.md'), '');
  assert.equal(storage.readText('answers.md'), '');
  assert.equal(storage.settings().notionMoveIn, undefined);
});

test('strategy from this Mac: an existing workspace wins; the files are only backed up', async () => {
  const storage = withLocal('existing');
  const writePage = async () => { throw new Error('must not write'); };
  assert.equal(await step().run(storage, undefined, {writePage}), true);
  const folder = storage.settings().notionKeptFolder;
  assert.ok(folder && fs.readFileSync(path.join(folder, 'profile.md'), 'utf8') === '# Me\nSRE');
  assert.equal(fs.readFileSync(path.join(folder, 'answers.md'), 'utf8'), 'Notice: 1 month');
  assert.equal(storage.readText('profile.md'), '');
  assert.equal(storage.settings().notionMoveIn, undefined);
});

test('strategy from this Mac: a failed write keeps both files and the flag, so the next start finishes the job', async () => {
  const storage = withLocal('fresh');
  const writePage = async (_t, page) => { if (page === 'ans') throw new Error('429'); };
  await assert.rejects(step().run(storage, undefined, {writePage, run: async () => ({code: 0, stdout: 'x'}), ensurePage: async () => 'sp'}), /429/);
  assert.equal(storage.readText('profile.md'), '# Me\nSRE');
  assert.equal(storage.readText('answers.md'), 'Notice: 1 month');
  assert.equal(storage.settings().notionMoveIn, 'fresh');
  // retry succeeds
  assert.equal(await step().run(storage, undefined, {writePage: async () => {}, run: async () => ({code: 0, stdout: 'x'}), ensurePage: async () => 'sp'}), true);
  assert.equal(storage.readText('profile.md'), '');
});

test('strategy from this Mac: without the flag (installs that already had Notion) it does nothing', async () => {
  const storage = connected();
  storage.writeText('profile.md', 'old copy');
  assert.equal(await step().run(storage, undefined, {writePage: async () => { throw new Error('no'); }}), false);
  assert.equal(storage.readText('profile.md'), 'old copy');
});

test('strategy from this Mac runs after the workspace step and before the steps that would hide it', () => {
  const names = migrate.STEPS.map(s => s.name);
  const at = names.indexOf('strategy from this Mac');
  assert.ok(names.indexOf('workspace') < at);
  assert.ok(at < names.indexOf('profile copies'));
  assert.ok(at < names.indexOf('search settings'));
});

// ---- Runs made on this Mac before Notion was connected reach ⏱️ Search runs (7 Oct 2026) ----
test('runs from this Mac: each finished local run with no Notion row gets one, once per database; Recent activity then shows it once', async () => {
  const names = migrate.STEPS.map(s => s.name);
  assert.ok(names.indexOf('workspace') < names.indexOf('runs from this Mac'));
  const stepRuns = migrate.STEPS.find(s => s.name === 'runs from this Mac');
  const storage = connected();
  const at = Date.parse('2026-10-05T09:00:00Z');
  const local = [
    {id: at, kind: 'search', trigger: 'you', startedAt: '2026-10-05T09:00:00.000Z', endedAt: '2026-10-05T09:04:10.000Z', ok: true, notionUrl: null,
      runId: 'r-1', new: 3, usd: 0.12, log: ['Crawling…', 'Done: 3 new'], message: '3 new jobs'},
    {id: at + 3600e3, kind: 'mail', trigger: 'schedule', startedAt: '2026-10-05T10:00:00.000Z', endedAt: '2026-10-05T10:00:30.000Z', ok: false, notionUrl: null,
      log: ['Gmail check failed: token expired'], summary: null},
    {id: at + 7200e3, kind: 'scout', trigger: 'you', startedAt: '2026-10-05T11:00:00.000Z', endedAt: '2026-10-05T11:02:00.000Z', ok: true, notionUrl: null,
      summary: 'checked 12 · 🆕 2 new sources', log: []},   // a row already exists for it (written, but the link line was lost): linked, not copied
    {id: at + 9000e3, kind: 'kits', trigger: 'you', startedAt: '2026-10-05T11:30:00.000Z', endedAt: '2026-10-05T11:31:00.000Z', ok: true,
      notionUrl: 'https://www.notion.so/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa', summary: 'Drafted 2 kits', log: []},   // already in Notion
    {id: at + 9500e3, kind: 'search', trigger: 'you', startedAt: '2026-10-05T11:40:00.000Z', ok: true, notionUrl: null, url: 'https://github.com/u/r/actions/runs/1', log: []},   // a GitHub run writes its own
    {id: at + 9900e3, kind: 'search', trigger: 'you', startedAt: '2026-10-05T11:50:00.000Z', notionUrl: null, log: []},   // never ended
  ];
  storage.writeText('runs.json', JSON.stringify(local));
  const created = [], queries = [];
  const fetcher = async (url, init) => {
    const body = init.body ? JSON.parse(init.body) : null;
    if (url.endsWith('/query')) {
      queries.push(body);
      const scout = body.filter.and.some(f => f.select?.equals === 'scout');
      return Response.json({results: scout ? [{id: 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', url: 'https://www.notion.so/bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
        properties: {Started: {date: {start: '2026-10-05T11:01:00.000Z'}}}}] : []});
    }
    const n = created.push(body);
    return Response.json({id: `c${n}`, url: `https://www.notion.so/${String(n).padStart(32, 'c')}`, ...body});
  };
  assert.equal(await stepRuns.run(storage, fetcher), false);   // no Search runs database yet: nothing to do
  storage.saveSettings({notionIds: {NOTION_PROFILE_PAGE_ID: 'p', NOTION_CRON_RUNS_DB: 'runs-1'}});
  assert.equal(await stepRuns.run(storage, fetcher), true);
  assert.equal(created.length, 2);
  const [search, mail] = created.map(body => body.properties);
  assert.equal(created[0].parent.database_id, 'runs-1');
  assert.equal(search.Mode.select.name, 'run');
  assert.equal(search.Trigger.select.name, 'Mac (you)');
  assert.equal(search.Status.select.name, 'OK');
  assert.equal(search.Started.date.start, '2026-10-05T09:00:00.000Z');
  assert.equal(search['Duration (s)'].number, 250);
  assert.equal(search['New jobs'].number, 3);
  assert.equal(search['AI cost (USD)'].number, 0.12);
  assert.equal(search['Run id'].rich_text[0].text.content, 'r-1');
  assert.equal(mail.Mode.select.name, 'mail');
  assert.equal(mail.Trigger.select.name, 'Mac schedule');
  assert.equal(mail.Status.select.name, 'Failed');
  assert.equal(mail.Summary.rich_text[0].text.content, 'Gmail check failed: token expired');   // why, from its log
  const toggle = created[0].children.find(block => block.type === 'toggle');
  assert.match(toggle.toggle.rich_text[0].text.content, /^Technical log/);
  assert.match(toggle.toggle.children[0].code.rich_text[0].text.content, /Done: 3 new/);
  // Each local run now points at its row: the activity list shows one entry per run, from Notion, with the run's own result.
  const after = JSON.parse(storage.readText('runs.json'));
  assert.equal(after[0].notionUrl, 'https://www.notion.so/' + '1'.padStart(32, 'c'));
  assert.equal(after[2].notionUrl, 'https://www.notion.so/bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb');
  assert.equal(after[4].notionUrl, null);
  assert.equal(after[5].notionUrl, null);
  const {fromRow, merge} = await import('../lib/run-history.js');
  const rows = created.map((body, i) => fromRow({id: `c${i + 1}`, url: after[i].notionUrl, created_time: body.properties.Started.date.start, properties: body.properties}));
  const shown = merge(rows, after.slice(0, 2)).runs;
  assert.equal(shown.length, 2);
  assert.equal(shown.find(r => r.kind === 'search').result, '3 new jobs');
  // Once per database: a second start writes nothing; another workspace's database gets what never reached one.
  assert.equal(await stepRuns.run(storage, async () => { throw new Error('must not run again'); }), false);
  assert.equal(storage.settings().runsSyncedTo, 'runs-1');
});

test('runs from this Mac: a row Notion refuses is retried next start, and the ones written are not written twice', async () => {
  const stepRuns = migrate.STEPS.find(s => s.name === 'runs from this Mac');
  const storage = connected();
  storage.saveSettings({notionIds: {NOTION_PROFILE_PAGE_ID: 'p', NOTION_CRON_RUNS_DB: 'runs-1'}});
  const run = (id, kind) => ({id, kind, trigger: 'you', startedAt: new Date(id).toISOString(), endedAt: new Date(id + 1000).toISOString(), ok: true, notionUrl: null, summary: 'x', log: []});
  storage.writeText('runs.json', JSON.stringify([run(2e12, 'insight'), run(2e12 + 600e3, 'weekly')]));
  let made = 0;
  const flaky = refuse => async (url, init) => url.endsWith('/query') ? Response.json({results: []})
    : JSON.parse(init.body).properties.Mode.select.name === refuse ? new Response('{"message":"bad"}', {status: 400}) : Response.json({id: `c${++made}`, url: `https://www.notion.so/${String(made).padStart(32, 'c')}`});
  await assert.rejects(stepRuns.run(storage, flaky('weekly')), /1 of 2 runs could not be written/);
  assert.equal(storage.settings().runsSyncedTo, undefined);
  assert.equal(await stepRuns.run(storage, flaky('none')), true);
  assert.equal(made, 2);   // the insight once, the weekly report on the retry
  assert.equal(storage.settings().runsSyncedTo, 'runs-1');
});

// On this Mac's store its data is the store's own: the move (lib/store-move.js) takes it whole. 9 Oct 2026, the storemove e2e: a connect before
// the move deleted profile.md and answers.md while the store was still this Mac's.
test('a connect on this Mac\'s store moves no Profile in, and remembers whether the workspace was just built; elsewhere as before', () => {
  assert.deepEqual(migrate.connectSettings({store: 'sqlite'}, {hadLocal: true, fresh: true}), {storeTextsWin: true});
  assert.deepEqual(migrate.connectSettings({store: 'sqlite'}, {hadLocal: true, fresh: false}), {storeTextsWin: false});
  assert.deepEqual(migrate.connectSettings({}, {hadLocal: true, fresh: true}), {notionMoveIn: 'fresh'});
  assert.deepEqual(migrate.connectSettings({store: 'notion'}, {hadLocal: true, fresh: false}), {notionMoveIn: 'existing'});
  assert.deepEqual(migrate.connectSettings({}, {hadLocal: false, fresh: true}), {});
});

test('the real strategy step keeps profile.md and answers.md on this Mac\'s store, even with a move-in flag left over', async () => {
  const storage = connected();
  storage.saveSettings({store: 'sqlite', notionMoveIn: 'fresh'});
  storage.writeText('profile.md', '# Profile\n\nOn call for ten years.');
  storage.writeText('answers.md', '- Notice period: three months');
  const steps = migrate.STEPS.filter(step => ['strategy from this Mac', 'profile copies'].includes(step.name));
  assert.equal(steps.length, 2);
  await migrate.run(storage, () => {}, steps);
  assert.match(storage.readText('profile.md'), /ten years/);
  assert.match(storage.readText('answers.md'), /three months/);
});

// Every step says why it does not run while the data lives on this Mac (run() runs none there): a new one fails here until it says.
test('every migrate step says why it waits on this Mac\'s store: this Mac\'s data, or a workspace part the move does itself', () => {
  const data = ['strategy from this Mac', 'reached via', 'employers from this Mac', 'runs from this Mac', 'origin', 'profile copies', 'open questions',
    'contact details'];
  const workspace = ['daily target', 'workspace', 'search settings', 'search settings format'];
  assert.deepEqual(migrate.STEPS.filter(step => step.onMac === 'data').map(step => step.name).sort(), [...data].sort());
  assert.deepEqual(migrate.STEPS.filter(step => step.onMac === 'workspace').map(step => step.name).sort(), [...workspace].sort());
  assert.equal(migrate.STEPS.filter(step => !['data', 'workspace'].includes(step.onMac)).length, 0);
});
