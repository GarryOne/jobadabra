// lib/notion-page-lock.mjs: a machine-wide lock on the real Notion test page, taken by a run on store 'notion' only; stale when its pid is gone.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import {fileURLToPath} from 'node:url';
import {holderText, lockNeeded, takeNotionPage} from '../../lib/notion-page-lock.mjs';

const fresh = () => path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'jp-page-lock-')), 'lock');
const quiet = () => { const lines = []; return {say: line => lines.push(line), lines}; };

test('only a run on the real workspace needs the lock: sqlite and the stand-in never share the page', () => {
  assert.equal(lockNeeded({store: 'notion', env: {}}), true);
  for (const store of ['sqlite', 'standin', '']) assert.equal(lockNeeded({store, env: {}}), false, store);
  assert.equal(lockNeeded({store: 'notion', env: {CI: 'true'}}), false, 'a CI job has its own runner');
  assert.equal(lockNeeded({store: 'notion', env: {JOBADABRA_NOTION_LOCK: '0'}}), false, 'the escape hatch');
});

test('the holder is written with pid, session, what and since; release frees it', async () => {
  const lock = fresh(), log = quiet();
  const held = await takeNotionPage({lock, what: 'notion-real', session: 'job-x', say: log.say});
  assert.equal(fs.readFileSync(path.join(lock, 'pid'), 'utf8').trim(), String(process.pid));
  assert.equal(fs.readFileSync(path.join(lock, 'session'), 'utf8').trim(), 'job-x');
  assert.equal(fs.readFileSync(path.join(lock, 'what'), 'utf8').trim(), 'notion-real');
  assert.match(holderText(lock), /pid \d+ \(notion-real, session job-x\) since \d\d:\d\d:\d\d/);
  held.release();
  assert.equal(fs.existsSync(lock), false);
});

test('a lock whose pid is gone is taken over, and says so', async () => {
  const lock = fresh(), log = quiet();
  fs.mkdirSync(lock, {recursive: true});
  fs.writeFileSync(path.join(lock, 'pid'), '999999'); fs.writeFileSync(path.join(lock, 'what'), 'old run'); fs.writeFileSync(path.join(lock, 'session'), 'job-gone');
  const held = await takeNotionPage({lock, what: 'notion-real', session: 'job-x', say: log.say, alive: () => false});
  assert.match(log.lines.join('\n'), /stale lock: old run \(job-gone;/);
  held.release();
});

test('a live holder makes the second run wait and print who holds it; then it gets the page', async () => {
  const lock = fresh(), log = quiet();
  const first = await takeNotionPage({lock, what: 'notion-real', session: 'job-a', say: () => {}});
  const second = takeNotionPage({lock, what: 'other', session: 'job-b', say: log.say, every: 20, wait: 5000});
  await new Promise(resolve => setTimeout(resolve, 120));
  assert.match(log.lines.join('\n'), /other waits: the Notion test page is held by pid \d+ \(notion-real, session job-a\)/);
  first.release();
  (await second).release();
  assert.equal(fs.existsSync(lock), false);
});

test('after the longest wait the run goes on and says so (never a silent hang)', async () => {
  const lock = fresh(), log = quiet();
  const first = await takeNotionPage({lock, what: 'notion-real', session: 'job-a', say: () => {}});
  const second = await takeNotionPage({lock, what: 'other', session: 'job-b', say: log.say, every: 10, wait: 60});
  assert.match(log.lines.join('\n'), /waited [\d.]+ s for the page held by pid \d+ \(notion-real, session job-a\).*running anyway/);
  second.release();   // not the holder: leaves the first's lock alone
  assert.equal(fs.existsSync(lock), true);
  first.release();
});

test('the shared runner takes the lock and frees it on close, so no caller can forget', () => {
  const source = fs.readFileSync(new URL('../../lib/context.mjs', import.meta.url), 'utf8');
  assert.match(source, /lockNeeded\(\{store\}\)\) ctx\.pageLock = await takeNotionPage/);
  assert.match(source, /finally \{ ctx\.pageLock\?\.release\(\); \}/);
});

test('every suite that pins the real workspace is the only kind that needs the lock', async () => {
  const dir = fileURLToPath(new URL('../../suites/', import.meta.url));
  const pinned = [];
  for (const file of fs.readdirSync(dir).filter(name => name.endsWith('.mjs'))) if ((await import(`${dir}${file}`)).store === 'notion') pinned.push(file);
  assert.deepEqual(pinned, ['notion-real.mjs'], 'a new suite on the real page is covered by the lock (it takes it in openContext); say so in docs/rules/applying.md');
});
