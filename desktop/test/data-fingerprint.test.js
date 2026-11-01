// The upgrade + data test's compare (lib/data-fingerprint.js): a data folder becomes one map of hashes; an update that loses or changes anything outside the expected list is red, one that
// only adds columns, tables or settings is not, and the compare can prove it is not blind (positive control). Real SQLite and real files in a temp folder; no secret is ever read.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {createRequire} from 'node:module';
import {test} from 'node:test';
import {compare, describe, fingerprintFolder, withoutOne} from '../lib/data-fingerprint.js';

const {DatabaseSync} = createRequire(import.meta.url)('node:sqlite');

function folder(mutate = () => {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'data-fingerprint-'));
  fs.mkdirSync(path.join(dir, 'data'));
  fs.mkdirSync(path.join(dir, 'cv'));
  fs.mkdirSync(path.join(dir, 'config'));
  const db = new DatabaseSync(path.join(dir, 'data', 'tracker.sqlite'));
  db.exec("CREATE TABLE jobs (id INTEGER PRIMARY KEY, title TEXT, stage TEXT); CREATE TABLE notes (a TEXT, b TEXT)");
  for (let n = 1; n <= 30; n++) db.prepare('INSERT INTO jobs (id, title, stage) VALUES (?, ?, ?)').run(n, `Role ${n}`, n % 3 ? 'new' : 'applied');
  db.prepare('INSERT INTO notes VALUES (?, ?)').run('x', 'y');
  fs.writeFileSync(path.join(dir, 'profile.md'), '# Ada\n');
  fs.writeFileSync(path.join(dir, 'answers.md'), 'Why us? Because.\n');
  fs.writeFileSync(path.join(dir, 'portrait.md'), 'A careful nurse.\n');
  fs.writeFileSync(path.join(dir, 'cv.pdf'), '%PDF-1.4 demo');
  fs.writeFileSync(path.join(dir, 'cv', 'cv.json'), '{"summary":"s"}');
  fs.writeFileSync(path.join(dir, 'settings.json'), JSON.stringify({setupDone: true, cadence: 'daily', models: {a: 1, b: 2}}));
  fs.writeFileSync(path.join(dir, 'config', 'search.json'), JSON.stringify({roles: ['nurse'], places: ['Zurich']}));
  fs.writeFileSync(path.join(dir, 'secrets.json'), JSON.stringify({ANTHROPIC_API_KEY: 'SENTINEL-SECRET-VALUE'}));
  mutate(db, dir);
  db.close();
  return dir;
}
const prints = mutate => fingerprintFolder(folder(mutate));

test('the same folder twice is the same map: every row and column, whole text files, JSON per key, every cv file; no secret is read', () => {
  const a = prints(), b = prints();
  assert.deepEqual(a, b);
  assert.ok(Object.keys(a).length > 90, 'cells of 30 jobs x 3 columns + notes + files + keys (positive control: it reads something)');
  assert.ok(a['sqlite:data/tracker.sqlite:jobs:7:stage'] && a['file:profile.md'] && a['file:portrait.md'] && a['file:cv.pdf'] && a['file:cv/cv.json'] && a['json:settings.json:cadence'] && a['json:config/search.json:roles']);
  assert.ok(!Object.keys(a).some(key => /secrets|SECRET/i.test(key)), 'secrets.json is never listed');
  assert.ok(!JSON.stringify(a).includes('SENTINEL'), 'and never hashed in');
  const result = compare(a, b);
  assert.deepEqual([result.ok, result.lost, result.changed, result.added], [true, [], [], []]);
});

test('an update that only ADDS (a column with a default, a table, a setting, a file) is not a loss', () => {
  const before = prints();
  const after = fingerprintFolder(folder((db, dir) => {
    db.exec("ALTER TABLE jobs ADD COLUMN posted_at TEXT DEFAULT 'x'; CREATE TABLE extra (k TEXT)");
    fs.writeFileSync(path.join(dir, 'settings.json'), JSON.stringify({setupDone: true, cadence: 'daily', models: {a: 1, b: 2}, newSetting: 1}));
    fs.writeFileSync(path.join(dir, 'cv', 'extra.txt'), 'new');
  }));
  const result = compare(before, after);
  assert.equal(result.ok, true);
  assert.ok(result.added.includes('sqlite:data/tracker.sqlite:jobs:1:posted_at') && result.added.includes('json:settings.json:newSetting') && result.added.includes('file:cv/extra.txt'));
});

test('each way an update hurts a user is red and named: a deleted row, a changed value, a dropped or renamed column, a dropped table, an edited answer, a removed setting', () => {
  const before = prints();
  const hurt = {
    'a deleted job': [db => db.exec('DELETE FROM jobs WHERE id = 12'), 'lost', 'sqlite:data/tracker.sqlite:jobs:12:title'],
    'a changed stage': [db => db.exec("UPDATE jobs SET stage = 'rejected' WHERE id = 5"), 'changed', 'sqlite:data/tracker.sqlite:jobs:5:stage'],
    'a renamed column': [db => db.exec('ALTER TABLE jobs RENAME COLUMN title TO name'), 'lost', 'sqlite:data/tracker.sqlite:jobs:3:title'],
    'a dropped column': [db => db.exec('ALTER TABLE jobs DROP COLUMN stage'), 'lost', 'sqlite:data/tracker.sqlite:jobs:3:stage'],
    'a dropped table': [db => db.exec('DROP TABLE notes'), 'lost', 'sqlite:data/tracker.sqlite:notes:1:a'],
    'a rewritten answer': [(db, dir) => fs.writeFileSync(path.join(dir, 'answers.md'), 'Why us? Different.\n'), 'changed', 'file:answers.md'],
    'a deleted portrait': [(db, dir) => fs.rmSync(path.join(dir, 'portrait.md')), 'lost', 'file:portrait.md'],
    'a replaced cv pdf': [(db, dir) => fs.writeFileSync(path.join(dir, 'cv.pdf'), 'other'), 'changed', 'file:cv.pdf'],
    'a lost cv file': [(db, dir) => fs.rmSync(path.join(dir, 'cv', 'cv.json')), 'lost', 'file:cv/cv.json'],
    'a removed setting': [(db, dir) => fs.writeFileSync(path.join(dir, 'settings.json'), JSON.stringify({setupDone: true, models: {a: 1, b: 2}})), 'lost', 'json:settings.json:cadence'],
    'a changed nested setting': [(db, dir) => fs.writeFileSync(path.join(dir, 'settings.json'), JSON.stringify({setupDone: true, cadence: 'daily', models: {b: 2, a: 9}})), 'changed', 'json:settings.json:models'],
  };
  for (const [what, [mutate, kind, key]] of Object.entries(hurt)) {
    const result = compare(before, fingerprintFolder(folder(mutate)));
    assert.equal(result.ok, false, what);
    assert.ok(kind === 'lost' ? result.lost.includes(key) : result.changed.some(item => item.key === key), `${what}: ${kind} ${key}`);
  }
  assert.equal(compare(before, fingerprintFolder(folder((db, dir) => fs.writeFileSync(path.join(dir, 'settings.json'), JSON.stringify({models: {b: 2, a: 1}, cadence: 'daily', setupDone: true}))))).ok, true, 'key order is not a change');
});

test('rows still in the -wal of a store that was just closed by a quit are read, and the folder is not touched', () => {
  const dir = folder();
  const live = new DatabaseSync(path.join(dir, 'data', 'tracker.sqlite'));
  live.exec('PRAGMA journal_mode = WAL; PRAGMA wal_autocheckpoint = 0');
  live.prepare('INSERT INTO jobs (id, title, stage) VALUES (?, ?, ?)').run(99, 'Only in the wal', 'new');
  assert.ok(fs.statSync(path.join(dir, 'data', 'tracker.sqlite-wal')).size > 0, 'positive control: the row is in the -wal');
  const before = fs.readdirSync(path.join(dir, 'data')).sort();
  const found = fingerprintFolder(dir);
  const after = fs.readdirSync(path.join(dir, 'data')).sort();
  live.close();
  assert.ok(found['sqlite:data/tracker.sqlite:jobs:99:title'], 'the wal row is in the fingerprint');
  assert.deepEqual(after, before, 'nothing was added or removed in the data folder by reading it');
});

test('a store the new build left unreadable is a change, never silence', () => {
  const before = prints();
  const broken = folder((db, dir) => {});
  fs.writeFileSync(path.join(broken, 'data', 'tracker.sqlite'), 'not a database');
  const result = compare(before, fingerprintFolder(broken));
  assert.equal(result.ok, false);
  assert.ok(result.added.includes('sqlite:data/tracker.sqlite:unreadable') && result.lost.some(key => key.startsWith('sqlite:data/tracker.sqlite:jobs:')));
});

test('expected changes (a migration that rewrites a value on purpose) are allowed with their reason; a stale entry is reported so the list does not rot', () => {
  const before = prints();
  const after = fingerprintFolder(folder(db => db.exec("UPDATE jobs SET stage = 'saved' WHERE stage = 'new'")));
  assert.equal(compare(before, after).ok, false);
  const expected = [{key: 'sqlite:data/tracker.sqlite:jobs:*:stage', reason: 'stage "new" renamed "saved"', pr: '#1'}, {key: 'json:settings.json:gone', reason: 'old setting', pr: '#2'}];
  const result = compare(before, after, expected);
  assert.equal(result.ok, true);
  assert.equal(result.allowed.length, 20);
  assert.deepEqual(result.stale.map(entry => entry.key), ['json:settings.json:gone']);
  const prefix = compare(before, after, [{key: 'sqlite:data/tracker.sqlite:jobs:', reason: 'x', pr: '#3'}]);
  assert.equal(prefix.ok, false, 'without a * the key is exact, never a prefix');
  const wrongColumn = compare(before, after, [{key: 'sqlite:data/tracker.sqlite:jobs:*:title', reason: 'x', pr: '#4'}]);
  assert.equal(wrongColumn.ok, false, 'allowing one column does not allow another');
});

test('positive control: the compare sees a loss it is given, and the report names it without a value', () => {
  const before = prints(), {key, fingerprint} = withoutOne(before);
  assert.match(key, /^sqlite:/);
  const result = compare(before, fingerprint);
  assert.deepEqual(result.lost, [key]);
  const lines = describe(result);
  assert.match(lines[0], /^DATA LOST OR CHANGED: \d+ entries before, \d+ after/);
  assert.equal(lines[1], `lost ${key}`);
  assert.doesNotMatch(lines.join('\n'), /Role \d+|Because|Ada/, 'hashes and keys only, never a value');
  assert.match(describe(compare(before, before))[0], /^kept everything/);
});
