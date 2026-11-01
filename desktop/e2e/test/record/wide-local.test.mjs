// Many-row replays go to CI: every local entry point that replays rows one after another refuses more than 3 rows outside CI (lib/wide-local.mjs).
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import test from 'node:test';
import {wideLocalRefusal, MOST_LOCAL_ROWS} from '../../lib/wide-local.mjs';

test('more than 3 rows on the Mac is refused with the CI command; CI and the named exception are not', () => {
  assert.equal(wideLocalRefusal(MOST_LOCAL_ROWS, {}), '');
  assert.match(wideLocalRefusal(25, {}), /gh workflow run site-replays\.yml --ref/);
  assert.equal(wideLocalRefusal(25, {CI: 'true'}), '');
  assert.equal(wideLocalRefusal(25, {GITHUB_ACTIONS: 'true'}), '');
  assert.equal(wideLocalRefusal(25, {JP_WIDE_LOCAL: '1'}), '');
});

// The class: a script that replays the published network records row after row (newestPerRow, not one row picked with .find) asks the guard. CI has those records;
// `npm run rows` / `npm run measure` replay the Mac's own captures, which CI does not have, so they stay local.
test('every many-row network-record replay runner asks the guard', () => {
  const here = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
  const loops = fs.readdirSync(path.join(here, '..')).filter(file => /\.mjs$/.test(file)).filter(file => {
    const text = fs.readFileSync(path.join(here, '..', file), 'utf8');
    return /replay-net\.mjs/.test(text) && /newestPerRow\((?![^)]*\)\.find)/.test(text.replace(/export function newestPerRow\(/, ''));
  });
  assert.deepEqual(loops, ['replay-records.mjs']);
  for (const file of loops) assert.match(fs.readFileSync(path.join(here, '..', file), 'utf8'), /wideLocalRefusal\(/, file);
});

test('replay-records.mjs refuses 4 rows outside CI before replaying any', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'wide-local-'));
  for (const name of ['a', 'b', 'c', 'd']) {
    fs.mkdirSync(path.join(root, 'records', name), {recursive: true});
    fs.writeFileSync(path.join(root, 'records', name, 'record.json'), JSON.stringify({name: `Row ${name}`, url: `https://jobs.example.com/${name}`, startMs: 1}));
  }
  const env = {...process.env}; delete env.CI; delete env.GITHUB_ACTIONS; delete env.JP_WIDE_LOCAL;
  const ran = spawnSync(process.execPath, [new URL('../../replay-records.mjs', import.meta.url).pathname, path.join(root, 'records'), path.join(root, 'out')], {encoding: 'utf8', env, timeout: 30000});
  assert.equal(ran.status, 4);
  assert.match(ran.stderr, /4 rows: a replay of more than 3 rows runs in CI/);
  assert.doesNotMatch(ran.stderr, /replaying/);
  fs.rmSync(root, {recursive: true, force: true});
});
