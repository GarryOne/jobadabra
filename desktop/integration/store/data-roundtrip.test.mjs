// Layer 3 (Node + the engine's real SQLite store, no window): Settings → Your data keeps the person's data. Moved from the e2e `settings` suite (1 Nov 2026, owner: "storemove it not a critical user
// journey … This again should be an integrations"; "None of these are critical user journeys"): the steps "Your data: export with keys, reset, then import from the setup brings this computer back as
// it was", "Automatic backup: the backup file, imported after a reset, brings this computer back as it was", "Automatic backup: Back up now writes a backup with no keys in its folder" and
// "Automatic backup: a due backup runs once at start and once on the weekly tick".
// The code is the app's own, not a copy: lib/reset.js (exportTo, request, applyPending, stageImport, adoptKeys), lib/backup.js, lib/data-job.js (backupNow, the one-at-a-time job) and the app's own
// backupIfDue block of lib/background-handlers.js; the records are the engine's own seed (e2e/lib/store_seed.py) in a real SQLite store; only the two native dialogs and the restart are left out
// (the app's restart swaps the folder at its next start, which applyPending does here). Never the owner's folders: every path is a temp folder, the backup folder is passed in (lib/backup.js refuses the real one).
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import {execFileSync} from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {test} from 'node:test';
import vm from 'node:vm';
import {seedStore} from '../../e2e/lib/storemove-steps.mjs';
import {storeCall} from '../../e2e/lib/store-call.mjs';
import * as backup from '../../lib/backup.js';
import {createDataJob} from '../../lib/data-job.js';
import * as reset from '../../lib/reset.js';
import {createStorage, SECRET_NAMES} from '../../lib/storage.js';
import {tar} from '../../lib/tar.js';

const fakeCrypto = {encrypt: value => Buffer.from(value).toString('base64'), decrypt: text => Buffer.from(text, 'base64').toString()};
const MARKER = 'sk-e2e-backup-marker-7f3a91c2';
const FILES = ['profile.md', 'answers.md', 'knowledge.md', 'cv.pdf'];
const NOTION_IDS = {NOTION_PROFILE_PAGE_ID: '0123456789abcdef0123456789abcdef', NOTION_JOBS_DB: 'fedcba9876543210fedcba9876543210'};

/** A set-up install on this Mac's store: a key, a Notion workspace named in the settings, the seeded records (3 jobs, 2 events, an interview, a run, a match) and the person's CV. */
function install() {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'jp-data-roundtrip-'));
  const dir = path.join(base, 'Jobadabra');
  const storage = createStorage(dir, fakeCrypto);
  fs.mkdirSync(path.join(dir, 'data'), {recursive: true});
  storage.saveSettings({store: 'sqlite', setupDone: true, notionIds: NOTION_IDS, cvName: 'CV.pdf'});
  storage.setSecret('ANTHROPIC_API_KEY', 'sk-ant-e2e-roundtrip');
  storage.setSecret('NOTION_TOKEN', 'ntn_e2e_roundtrip');
  const seeded = seedStore(dir);
  assert.equal(seeded.applications, 3, `positive control: the seed wrote ${JSON.stringify(seeded)}`);
  fs.writeFileSync(path.join(dir, 'cv.pdf'), '%PDF-1.4 e2e round trip CV');
  return {base, dir, storage};
}
const digest = (dir, name) => (fs.existsSync(path.join(dir, name)) ? crypto.createHash('sha256').update(fs.readFileSync(path.join(dir, name))).digest('hex') : null);
const records = async dir => {
  const ctx = {profile: dir, store: 'sqlite', appEnv: {}};
  return {applications: await storeCall(ctx, 'applications', 'list', {}), events: await storeCall(ctx, 'events', 'list', {}), interviews: await storeCall(ctx, 'interviews', 'list', {}),
    matches: await storeCall(ctx, 'matches', 'list', {})};
};
/** What a person sees as "this computer as it was": the files byte for byte, the keys, the Notion workspace the settings name, and every record of the store. */
async function snapshot(dir, storage) {
  return {files: Object.fromEntries(FILES.map(name => [name, digest(dir, name)])), keys: Object.fromEntries(SECRET_NAMES.map(name => [name, storage.secret(name)]).filter(([, value]) => value)),
    notionIds: storage.settings().notionIds, setupDone: storage.settings().setupDone, ...await records(dir)};
}
/** Reset (the folder goes at the app's next start), the app opens at the setup, then "Import an export…" on its Welcome and the restart that swaps the folder in. -> the storage on the imported folder. */
async function resetThenImport(dir, file) {
  reset.request(dir);
  assert.deepEqual(reset.applyPending(dir), {deleted: true});
  assert.ok(!fs.existsSync(path.join(dir, 'profile.md')), 'the reset left profile.md in place: the round trip would prove nothing');
  createStorage(dir, fakeCrypto).saveSettings({setupDone: false});   // the app's fresh start at the setup
  await reset.stageImport(dir, file);
  assert.equal(reset.applyPending(dir).imported, true);
  const back = createStorage(dir, fakeCrypto);
  reset.adoptKeys(back);   // keys that came in plain text are stored again (only an export made with keys has them)
  return back;
}

/** Waits for a state the app reaches by itself (the backup runs beside it, `tar` in a child). The limit is a hang guard (30 s, the slowest backup here takes under 2 s), not a pause. */
async function until(reached, hangMs = 30000) {
  const hang = Date.now() + hangMs;
  while (!reached() && Date.now() < hang) await new Promise(resolve => setTimeout(resolve, 20));   // Why (1 Nov 2026): a poll interval for a state that is not here yet, bounded by the hang guard
}

test('Your data: export with keys, reset, then import from the setup brings this computer back as it was', async () => {
  const {base, dir, storage} = install();
  const before = await snapshot(dir, storage);
  assert.ok(Object.keys(before.keys).length >= 2, 'positive control: the set-up install has keys to lose');
  const file = path.join(base, 'export.tar.gz');
  const keys = Object.fromEntries(SECRET_NAMES.map(name => [name, storage.secret(name)]).filter(([, value]) => value));
  await reset.exportTo(dir, file, {keys, version: 'test'});
  assert.ok(fs.existsSync(file) && fs.statSync(file).size > 1000, 'the export wrote no file');
  const after = await snapshot(dir, await resetThenImport(dir, file));
  assert.deepEqual(after, before, 'not as before the export');
  assert.ok(!fs.existsSync(path.join(dir, reset.KEYS_FILE)), 'the plain keys stayed in the data folder after the import');
});

test('Automatic backup: the backup file, imported after a reset, brings this computer back as it was', async () => {
  const {base, dir, storage} = install();
  const before = await snapshot(dir, storage);
  const {file} = await backup.run(storage, {target: path.join(base, 'backups'), version: 'test'});
  const after = await snapshot(dir, await resetThenImport(dir, file));
  // A backup never holds keys (lib/backup.js): after a reset they come back only where the platform kept them (the Mac's Keychain), so they are not part of "as it was" here.
  assert.deepEqual({...after, keys: null}, {...before, keys: null}, 'not as before the backup');
});

test('Automatic backup: Back up now writes a backup with no keys in its folder', async () => {
  const {base, dir, storage} = install();
  storage.setSecret('OPENAI_API_KEY', MARKER);
  const target = path.join(base, 'backups');
  const told = [];
  const {backupNow} = createDataJob({toWindow: (...args) => told.push(args), backupWith: options => backup.run(storage, {target, version: 'test', ...options})});
  const done = await backupNow('button');
  assert.equal(done.ok, true, `Back up now did not work: ${done.error}`);
  const files = fs.readdirSync(target);
  assert.equal(files.length, 1, `Back up now should leave one backup file in the folder, found ${files.join(', ')}`);
  assert.match(files[0], /^Job Pilotto backup .*\.tar\.gz$/);
  assert.ok(storage.settings().lastBackupAt && storage.settings().lastBackupFile.endsWith(files[0]), '"Last backup" was not written');
  assert.ok(told.some(([name, event]) => name === 'dataProgress' && event.kind === 'backup' && event.state === 'done'), 'the window was not told the backup is done');
  const out = fs.mkdtempSync(path.join(os.tmpdir(), 'jp-backup-open-'));
  execFileSync(tar(), ['-xzf', path.join(target, files[0]), '-C', out]);
  const names = fs.readdirSync(out, {recursive: true}).map(name => String(name).replace(/\\/g, '/'));
  for (const left of ['keys.json', 'accounts.json']) assert.ok(!names.some(name => name.split('/').pop() === left), `the backup holds ${left}: keys must never be in it`);
  assert.ok(names.some(name => /(^|\/)manifest\.json$/.test(name)), 'the backup has no manifest: it is not a Jobadabra export');
  const leaked = names.filter(name => fs.statSync(path.join(out, name)).isFile() && fs.readFileSync(path.join(out, name)).includes(MARKER));
  assert.deepEqual(leaked, [], 'a saved key\'s value is readable in the backup');
  assert.ok(names.some(name => /tracker\.(snapshot\.)?sqlite$/.test(name)), 'the backup lacks the SQLite store');
  fs.rmSync(out, {recursive: true, force: true});
});

test('Automatic backup: a due backup runs once at start and once on the weekly tick', async () => {
  const {base, storage} = install();
  const target = path.join(base, 'backups');
  storage.saveSettings({lastBackupAt: ''});
  const lines = [];
  const appLog = (...args) => lines.push(JSON.parse(JSON.stringify(args)));
  const {backupNow} = createDataJob({toWindow() {}, backupWith: options => backup.run(storage, {target, version: 'test', ...options}), appLog});
  // The app's own decision (lib/background-handlers.js): taken from its source, the way test/files.test.js does, so a change there changes this test.
  const source = fs.readFileSync(new URL('../../lib/background-handlers.js', import.meta.url), 'utf8');
  const block = source.slice(source.indexOf('const backupIfDue ='), source.indexOf("backupIfDue('due at start');"));
  const decide = vm.runInNewContext(`${block} backupIfDue`, {storage, backup, backupNow, appLog});
  const saved = why => lines.filter(([area, what, fields]) => area === 'data' && what === 'backup saved' && (!why || fields.decidedBy === why)).length;
  const files = () => fs.readdirSync(target).filter(name => name.endsWith('.tar.gz'));

  decide('due at start');
  await until(() => saved('due at start') >= 1);
  assert.equal(saved('due at start'), 1, `a backup that was due when the app started did not run; the app logged ${JSON.stringify(lines)}`);
  const first = storage.settings().lastBackupAt;
  assert.ok(Number.isFinite(Date.parse(first)), `"Last backup" was not written by the start-up backup (${first})`);
  for (let tick = 0; tick < 3; tick++) decide('weekly tick');
  assert.equal(saved(), 1, `a due backup should run once at start and not again on the ticks, it ran ${saved()} times`);
  assert.equal(lines.filter(([, what, fields]) => what === 'backup not due' && fields.decidedBy === 'weekly tick').length, 3, 'each tick that finds the backup done says so');
  assert.equal(files().length, 1);

  const backdated = new Date(Date.now() - 8 * 24 * 3600 * 1000).toISOString();
  storage.saveSettings({lastBackupAt: backdated});
  decide('weekly tick');
  await until(() => saved('weekly tick') >= 1);
  assert.equal(saved('weekly tick'), 1, 'a backup a week old did not run on the weekly tick');
  for (let tick = 0; tick < 2; tick++) decide('weekly tick');
  assert.equal(saved(), 2, `the weekly tick should back up once, ${saved()} backups in all`);
  assert.notEqual(storage.settings().lastBackupAt, backdated, 'the tick\'s backup did not write "Last backup"');
});
