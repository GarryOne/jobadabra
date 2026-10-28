// A test run closes every Electron call that reaches the owner's computer (lib/e2e-host.js), and the app has no such call that is neither closed nor reviewed.
// Why (28 Oct 2026): a local interactions run opened ch.indeed.com in the owner's real Chrome; #2362 stubbed the `open` on PATH, but shell.openExternal never reads PATH.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {test} from 'node:test';
import {fileURLToPath} from 'node:url';
import {DOORS, standInHost} from '../lib/e2e-host.js';

const fresh = () => {
  const called = [];
  const real = name => async (...args) => { called.push(`${name}(${args})`); return 'REAL'; };
  const host = {shell: {openExternal: real('openExternal'), openPath: real('openPath'), showItemInFolder: real('showItemInFolder')}, clipboard: {writeText: real('writeText'), readImage: real('readImage')}, app: {setLoginItemSettings: real('setLoginItemSettings')}};
  return {host, called};
};

test('a person\'s app (no JOB_PILOTTO_E2E) keeps every call real', () => {
  const {host} = fresh(), before = {...host.shell};
  assert.deepEqual(standInHost(host, {}), []);
  assert.equal(host.shell.openExternal, before.openExternal);
});

test('a test run records each door and never calls the real one; the spool gets a line', async () => {
  const spool = fs.mkdtempSync(path.join(os.tmpdir(), 'jp-host-')), {host, called} = fresh();
  globalThis.__jpHost = [];
  assert.deepEqual(standInHost(host, {JOB_PILOTTO_E2E: '1', JOB_PILOTTO_E2E_OPEN_DIR: spool}), DOORS.map(([owner, method]) => `${owner}.${method}`));
  await host.shell.openExternal('https://ch.indeed.com/job/1');
  assert.equal(await host.shell.openPath('/Users/someone/Documents'), '', 'openPath answers "" like a real success');
  host.shell.showItemInFolder('/tmp/x'); host.clipboard.writeText('secret'); host.app.setLoginItemSettings({openAtLogin: true});
  assert.equal(host.clipboard.readImage().isEmpty(), true, 'the owner\'s clipboard is never read');
  assert.deepEqual(called, [], 'no real call was made');
  assert.deepEqual(globalThis.__jpHost.map(entry => entry.api), ['shell.openExternal', 'shell.openPath', 'shell.showItemInFolder', 'clipboard.writeText', 'app.setLoginItemSettings', 'clipboard.readImage']);
  const lines = fs.readFileSync(path.join(spool, 'host.log'), 'utf8').trim().split('\n').map(line => JSON.parse(line));
  assert.equal(lines[0].api, 'shell.openExternal');
  assert.deepEqual(lines[0].args, ['https://ch.indeed.com/job/1']);
});

test('a missing spool folder never opens the real door', async () => {
  const {host, called} = fresh();
  standInHost(host, {JOB_PILOTTO_E2E: '1', JOB_PILOTTO_E2E_OPEN_DIR: path.join(os.tmpdir(), 'jp-host-missing', 'nope')});
  await host.shell.openExternal('https://example.com');
  assert.deepEqual(called, []);
});

// The class: every call in the app that reaches the owner's computer is a door above or on this list, each with its reason. A new one fails here until someone decides.
const REVIEWED = {
  'dialog.*': 'a native window the harness answers per step (e2e/lib/app.mjs pickFile, storemove-steps answerSave); an unanswered one blocks the run, it reaches nothing',
  'new Notification': 'a toast the test app shows on the owner\'s screen; carries no data out',
  'safeStorage.*': 'a test run keeps its secrets in its own file; the step "nothing in this Mac\'s real Keychain changed" asserts it (e2e/lib/suite-main.mjs)',
};
test('every host call in the app is a closed door or on the reviewed list', () => {
  const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
  const files = [path.join(root, 'main.js')];
  const walk = dir => { for (const entry of fs.readdirSync(dir, {withFileTypes: true})) { const full = path.join(dir, entry.name); if (entry.isDirectory()) walk(full); else if (entry.name.endsWith('.js')) files.push(full); } };
  walk(path.join(root, 'lib'));
  const doors = new Set(DOORS.map(([owner, method]) => `${owner}.${method}`)), unknown = new Set();
  for (const file of files) {
    const text = fs.readFileSync(file, 'utf8');
    for (const [, api] of text.matchAll(/\b((?:shell|clipboard)\.[a-zA-Z]+)\(/g)) if (!doors.has(api)) unknown.add(`${api} in ${path.relative(root, file)}`);
    for (const [, api] of text.matchAll(/\b(app\.(?:setLoginItemSettings|setAsDefaultProtocolClient|removeAsDefaultProtocolClient))\(/g)) if (!doors.has(api)) unknown.add(`${api} in ${path.relative(root, file)}`);
  }
  assert.deepEqual([...unknown], [], 'a call that reaches the owner\'s computer needs a door in lib/e2e-host.js or an entry (with its reason) in REVIEWED');
  assert.ok(Object.keys(REVIEWED).length > 0);
});

test('a screenshot run (JOB_PILOTTO_SMOKE) is a test run too: its shell calls stay recorded, as lib/e2e-hidden.js did before #2363', async () => {
  const {host, called} = fresh();
  assert.ok(standInHost(host, {JOB_PILOTTO_SMOKE: '/tmp/a.png'}).includes('shell.openExternal'));
  await host.shell.openExternal('https://example.com');
  assert.deepEqual(called, []);
});
