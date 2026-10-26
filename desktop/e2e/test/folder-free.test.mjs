// The wait for a folder a leftover process may still hold: a lock is waited for, anything else is thrown at once, a holder that never leaves is said.
import test from 'node:test';
import assert from 'node:assert/strict';
import {waitForFolderFree} from '../lib/folder-free.mjs';

const refusing = (times, code = 'EPERM') => { let left = times; const calls = []; return {calls, rename: (from, to) => { calls.push([from, to]); if (left > 0) { left -= 1; throw Object.assign(new Error(`${code}: rename ${from}`), {code}); } }}; };

test('a folder held for a while is waited for, then probed free and put back', async () => {
  const held = refusing(3);
  const waited = await waitForFolderFree('/p/data', {every: 1, rename: held.rename, exists: () => true});
  assert.equal(waited, 3);
  assert.deepEqual(held.calls.slice(-2), [['/p/data', '/p/data.probe'], ['/p/data.probe', '/p/data']]);
});

test('a folder that is not there needs no wait; an error that is not a lock is thrown at once', async () => {
  assert.equal(await waitForFolderFree('/p/none', {exists: () => false}), 0);
  await assert.rejects(waitForFolderFree('/p/data', {every: 1, rename: refusing(1, 'ENOENT').rename, exists: () => true}), /ENOENT/);
});

test('a holder that never leaves is said after the timeout', async () => {
  await assert.rejects(waitForFolderFree('/p/data', {every: 1, timeout: 5, rename: refusing(99).rename, exists: () => true}), /stayed held by a process after the app exited/);
});

test('holders: off Windows nothing is listed; on Windows the process lines are cut short and capped, and a failing shell gives nothing', async () => {
  const {holders} = await import('../lib/folder-free.mjs');
  assert.equal(holders({platform: 'darwin', run: () => assert.fail('no shell off Windows')}), '');
  const lines = Array.from({length: 40}, (_, index) => `${index} <- 1 python.exe ${'x'.repeat(400)}`).join('\r\n');
  const listed = holders({platform: 'win32', run: () => ({stdout: lines})}).split(' | ');
  assert.equal(listed.length, 25);
  assert.ok(listed.every(line => line.length <= 220));
  assert.equal(holders({platform: 'win32', run: () => { throw new Error('no powershell'); }}), '');
});

test('the give-up message names the processes still running when it can', async () => {
  await assert.rejects(waitForFolderFree('/p/data', {every: 1, timeout: 5, rename: () => { throw Object.assign(new Error('EPERM x'), {code: 'EPERM'}); }, exists: () => true, who: () => '7 <- 1 pip.exe install --target data'}),
    /stayed held by a process.*processes still running: 7 <- 1 pip\.exe install --target data/);
});

test('holders also asks for any process whose command line names the folder', async () => {
  const {holders} = await import('../lib/folder-free.mjs');
  let script = '';
  holders({platform: 'win32', dir: 'C:\\Users\\RUNNER~1\\AppData\\Local\\Temp\\jp-e2e-Eq7E5e', run: (_shell, args) => { script = args.at(-1); return {stdout: ''}; }});
  assert.match(script, /CommandLine -like '\*jp-e2e-Eq7E5e\*'/);
});

test('a folder still held after endAfter has its own leftover processes ended once, then probed free', async () => {
  const held = refusing(6);
  let ended = 0;
  const waited = await waitForFolderFree('/p/data', {every: 1, endAfter: 3, rename: held.rename, exists: () => true, end: () => { ended += 1; return [7, 8]; }});
  assert.equal(ended, 1);
  assert.equal(waited, 6);
});

// Beta 4 (26 Oct 2026, Windows settings): after a reset the app's own Electron child (pid 2020) held files in the data folder past 20 s; the 8 s end had
// ended the three processes whose command line names the folder (700, 6296, 4136) and missed it: its command line does not name the folder.
const TABLE = [
  {pid: 5040, parent: 900, name: 'electron.exe', cmd: 'electron.exe . --remote-debugging-port=0'},           // the app's main (gone after its exit in life; a row here, so it is ended if alive)
  {pid: 2020, parent: 5040, name: 'electron.exe', cmd: 'electron.exe --type=utility --utility-sub-type=network.mojom.NetworkService'},
  {pid: 2100, parent: 2020, name: 'python.exe', cmd: 'python -m src.desktop jobs'},                              // a grandchild
  {pid: 2200, parent: 5040, name: 'conhost.exe', cmd: 'conhost.exe 0x4'},                                         // a child, but not ours to end by name
  {pid: 3000, parent: 900, name: 'electron.exe', cmd: 'electron.exe --user-data-dir=C:\\Temp\\jp-e2e-m8crhW\\x'}, // names the folder: ended as before
  {pid: 4000, parent: 900, name: 'electron.exe', cmd: 'electron.exe another app'},                                // someone else's: never ended
  {pid: 4100, parent: 900, name: 'node.exe', cmd: 'node suite.mjs settings'},                                     // the harness itself
];

test('leftoverPids: the app main\'s descendants and the processes naming the run folder, only ours by name, never another app or the harness', async () => {
  const {leftoverPids} = await import('../lib/folder-free.mjs');
  assert.deepEqual(leftoverPids(TABLE, {name: 'jp-e2e-m8crhW', mainPid: 5040, self: 4100}).sort(), [2020, 2100, 3000, 5040]);
  assert.deepEqual(leftoverPids(TABLE, {name: 'jp-e2e-m8crhW', self: 4100}), [3000]);   // no main pid known: the folder match alone, as before
  assert.deepEqual(leftoverPids(TABLE, {name: 'jp-e2e-none', mainPid: 4100, self: 4100}), []);   // never the harness's own tree
  const loop = [{pid: 1, parent: 2, name: 'electron.exe', cmd: ''}, {pid: 2, parent: 1, name: 'electron.exe', cmd: ''}];
  assert.deepEqual(leftoverPids(loop, {name: 'jp-e2e-x', mainPid: 1, self: 9}).sort(), [1, 2]);   // a parent cycle (pid reuse) ends
});

test('endLeftovers: only on Windows, only for a run folder named jp-e2e-; lists the processes, ends the picked ones, and a failing shell ends nothing', async () => {
  const {endLeftovers} = await import('../lib/folder-free.mjs');
  const never = () => assert.fail('no shell');
  assert.deepEqual(endLeftovers({platform: 'darwin', dir: '/t/jp-e2e-abc', run: never}), []);
  assert.deepEqual(endLeftovers({platform: 'win32', dir: 'C:\\Users\\x', run: never}), []);
  const scripts = [];
  const listing = TABLE.map(row => [row.pid, row.parent, row.name, row.cmd].join('\t')).join('\r\n');
  const run = (_shell, args) => { scripts.push(args.at(-1)); return {stdout: scripts.length === 1 ? listing : ''}; };
  assert.deepEqual(endLeftovers({platform: 'win32', dir: 'C:\\Temp\\jp-e2e-m8crhW', mainPid: 5040, self: 4100, run}).sort(), ['2020', '2100', '3000', '5040']);
  assert.match(scripts[0], /Win32_Process/);
  assert.match(scripts[1], /Stop-Process -Id \d+(,\d+){3} -Force/);
  const quiet = [];
  assert.deepEqual(endLeftovers({platform: 'win32', dir: 'C:\\Temp\\jp-e2e-zzz', mainPid: 77, self: 4100, run: (_s, args) => { quiet.push(args.at(-1)); return {stdout: listing}; }}), []);
  assert.equal(quiet.length, 1);   // nothing picked: no Stop-Process call
  assert.deepEqual(endLeftovers({platform: 'win32', dir: 'C:\\Temp\\jp-e2e-m8crhW', mainPid: 5040, run: () => { throw new Error('x'); }}), []);
});

test('the wait passes the app main pid to the leftover end', async () => {
  const held = refusing(6);
  let asked = null;
  await waitForFolderFree('/p/jp-e2e-a', {every: 1, endAfter: 3, mainPid: 5040, rename: held.rename, exists: () => true, end: pid => { asked = pid; return []; }});
  assert.equal(asked, 5040);
});

test('the class: every place that waits for a held app folder goes through the one shared wait, which can end the run\'s own leftovers', async () => {
  const fsx = await import('node:fs'), pathx = await import('node:path'), url = await import('node:url');
  const root = pathx.resolve(pathx.dirname(url.fileURLToPath(import.meta.url)), '..');
  const sources = dir => fsx.readdirSync(pathx.join(root, dir)).filter(name => name.endsWith('.mjs')).map(name => `${dir}/${name}`);
  const read = file => fsx.readFileSync(pathx.join(root, file), 'utf8');
  const all = [...sources('lib'), ...sources('suites')].filter(file => file !== 'lib/folder-free.mjs');
  // Callers of the shared wait: the app's own exit wait (ctx.waitForExit); a suite waits through it, never with its own rename loop.
  assert.deepEqual(all.filter(file => /waitForFolderFree\(/.test(read(file))), ['lib/context.mjs']);
  assert.match(read('lib/context.mjs'), /waitForFolderFree\(session\.profile, \{mainPid/);   // the app's main pid: its descendants are ended too (beta 4)
  assert.deepEqual(all.filter(file => /ctx\.waitForExit\(/.test(read(file))), ['suites/settings.mjs']);
  // The app's profile folder is the `jp-e2e-` one the leftovers' command lines name; a rename of the prefix would silently end nothing.
  assert.match(read('lib/app.mjs'), /mkdtempSync\(path\.join\(os\.tmpdir\(\), 'jp-e2e-'\)\)/);
  assert.match(read('lib/folder-free.mjs'), /\^jp-e2e-/);
});

const decoded = args => Buffer.from(args.at(-1), 'base64').toString('utf16le');

test('fileHolders: only on Windows; asks Restart Manager about the files inside the folder; lines are capped; a failing shell says why', async () => {
  const {fileHolders} = await import('../lib/folder-free.mjs');
  assert.equal(fileHolders({platform: 'darwin', dir: '/t/jp-e2e-abc', run: () => assert.fail('no shell off Windows')}), '');
  let script = '';
  const lines = Array.from({length: 40}, (_, index) => `${index} app${index}.exe`).join('\r\n');
  const listed = fileHolders({platform: 'win32', dir: 'C:\\Temp\\jp-e2e-m8crhW', run: (_shell, args) => { assert.equal(args.at(-2), '-EncodedCommand'); script = decoded(args); return {stdout: lines}; }}).split(' | ');
  assert.match(script, /RmGetList/);
  assert.match(script, /C:\\Temp\\jp-e2e-m8crhW/);
  assert.equal(listed.length, 25);
  assert.match(fileHolders({platform: 'win32', dir: 'C:\\x', run: () => { throw new Error('no powershell'); }}), /^could not ask: no powershell/);
});

test('the give-up message names the processes that hold files in the folder, before the process list', async () => {
  await assert.rejects(waitForFolderFree('/p/data', {every: 1, timeout: 5, rename: () => { throw Object.assign(new Error('EPERM x'), {code: 'EPERM'}); }, exists: () => true, whoHasFiles: () => '4242 MsMpEng.exe', who: () => '7 <- 1 node.exe'}),
    /held by a process.*files in it are open in: 4242 MsMpEng\.exe; processes still running: 7 <- 1 node\.exe/);
});
