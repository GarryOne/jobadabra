// With the SQLite store, an export (and so the weekly backup) carries the user's records as one consistent database, even while
// the live one is open in WAL mode with writes not yet checkpointed, plus the three Markdown texts; an import puts it back.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {test} from 'node:test';
import {createRequire} from 'node:module';
import {execFileSync} from 'node:child_process';
import * as reset from '../lib/reset.js';
import * as tracker from '../lib/tracker-snapshot.js';
import {createStorage} from '../lib/storage.js';
import {tar} from '../lib/tar.js';

const {DatabaseSync} = createRequire(import.meta.url)('node:sqlite');
const fakeCrypto = {encrypt: v => Buffer.from(v).toString('base64'), decrypt: s => Buffer.from(s, 'base64').toString()};

function sqliteProfile() {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'jp-'));
  const dir = path.join(base, 'Jobadabra');
  createStorage(dir, fakeCrypto).saveSettings({setupDone: true, store: 'sqlite'});
  for (const name of ['profile.md', 'answers.md', 'knowledge.md']) fs.writeFileSync(path.join(dir, name), `# ${name}`);
  fs.mkdirSync(path.join(dir, 'data'), {recursive: true});
  const live = new DatabaseSync(path.join(dir, tracker.LIVE));
  live.exec("PRAGMA journal_mode=WAL; PRAGMA wal_autocheckpoint=0; CREATE TABLE applications (id TEXT, data TEXT)");
  live.exec("INSERT INTO applications VALUES ('a1', '{\"stage\":\"Applied\"}')");
  return {base, dir, live};
}

test('an export carries the records written to the WAL, not yet in the main file, and leaves no snapshot behind', async () => {
  const {base, dir, live} = sqliteProfile();
  assert.ok(fs.statSync(path.join(dir, 'data', 'tracker.sqlite-wal')).size > 0, 'the setup has unflushed writes');
  const file = path.join(base, 'export.tar.gz');
  await reset.exportTo(dir, file);
  live.close();
  const names = execFileSync(tar(), ['-tzf', file]).toString().split(/\r?\n/).map(name => name.trim());   // Windows tar ends lines with \r\n
  assert.ok(names.includes('data/tracker.snapshot.sqlite'));
  assert.ok(!names.some(name => /^data\/tracker\.sqlite/.test(name)), 'the live file and its WAL stay out');
  for (const name of ['profile.md', 'answers.md', 'knowledge.md']) assert.ok(names.includes(name), name);
  assert.ok(!fs.existsSync(path.join(dir, tracker.SNAPSHOT)));
});

test('an import makes the snapshot the tracker, with every row', async () => {
  const {base, dir, live} = sqliteProfile();
  const file = path.join(base, 'export.tar.gz');
  await reset.exportTo(dir, file);
  live.close();
  const other = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'jp-')), 'Jobadabra');
  fs.mkdirSync(other);
  await reset.stageImport(other, file);
  const staged = `${other} (import)`;
  assert.ok(!fs.existsSync(path.join(staged, tracker.SNAPSHOT)));
  const db = new DatabaseSync(path.join(staged, tracker.LIVE));
  assert.deepEqual(db.prepare('SELECT id FROM applications').all().map(row => row.id), ['a1']);
  db.close();
});

test('without a tracker (the Notion store) an export is as before', async () => {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'jp-'));
  const dir = path.join(base, 'Jobadabra');
  createStorage(dir, fakeCrypto).saveSettings({setupDone: true});
  assert.equal(tracker.take(dir), null);
  const file = path.join(base, 'export.tar.gz');
  await reset.exportTo(dir, file);
  assert.ok(!execFileSync(tar(), ['-tzf', file]).toString().includes('tracker'));
});
