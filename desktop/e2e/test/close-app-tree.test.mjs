// A crash close ends the whole tree a launch started, not only the process Playwright holds. Guards lib/app.mjs closeApp.
// Why (1 Nov 2026, #2717): on Windows Playwright starts Electron through a shell (shell: true), so app.process() is that shell and the real electron.exe is its child. closeApp killed the shell
// when the app was still tearing down, the app went on as an orphan holding the profile (beta 41220959824: pid 8092, parent gone), and the next start of the same profile met it.
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {once} from 'node:events';
import test from 'node:test';
import {isAlive} from '../lib/app-tree.mjs';
import {closeApp} from '../lib/app.mjs';

const START_THE_APP = "const {spawn} = require('node:child_process'); const app = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], {stdio: 'ignore'}); console.log(app.pid); setInterval(() => {}, 1000);";
const firstLine = async stream => { for await (const chunk of stream) return String(chunk).split('\n')[0]; return ''; };

test('closing the app ends the program the launcher started, when only the launcher exits', async t => {
  const launcher = spawn(process.execPath, ['-e', START_THE_APP], {stdio: ['ignore', 'pipe', 'ignore']});
  const app = Number(await firstLine(launcher.stdout));
  t.after(() => { for (const pid of [app, launcher.pid]) { try { process.kill(pid, 'SIGKILL'); } catch (error) { if (error.code !== 'ESRCH') throw error; } } });
  assert.ok(isAlive(app), 'positive control: the program is running before the close');
  // electron.exit(0) on Windows: the program the launcher started is tearing down, the launcher (a shell) is what Node sees leave first.
  const exits = once(launcher, 'exit');
  const fake = {process: () => launcher, evaluate: async fn => { if (!/exit\(/.test(String(fn))) return ''; launcher.kill('SIGKILL'); await exits; }};   // other asks (the Windows key wait) are answered, only the exit ends the launcher
  await closeApp(fake, {graceMs: 300});
  assert.equal(isAlive(app), false, 'the program the launcher started is still running after the close: it would hold the profile the next start uses');
});

test('a quit the app never answers ends the program the launcher started too, and still says it did not quit', async t => {
  const launcher = spawn(process.execPath, ['-e', START_THE_APP], {stdio: ['ignore', 'pipe', 'ignore']});
  const app = Number(await firstLine(launcher.stdout));
  t.after(() => { for (const pid of [app, launcher.pid]) { try { process.kill(pid, 'SIGKILL'); } catch (error) { if (error.code !== 'ESRCH') throw error; } } });
  assert.ok(isAlive(app), 'positive control: the program is running before the quit');
  const hung = {process: () => launcher, evaluate: async () => {}};   // electron.quit() is asked and nothing happens
  await assert.rejects(closeApp(hung, {how: 'quit', exitCapMs: 300}), /did not quit by itself within 0\.3 s/);
  assert.equal(isAlive(app), false, 'the program the launcher started is still running after the late quit: it would hold the profile the next start uses');
});

// Why (1 Nov 2026, #2755 Linux settings red): a reset or an import ends the app by itself, then ctx.relaunch closes it again. Playwright cannot say the process of an app that is gone
// ("Cannot read properties of undefined (reading '_object')"), and closeApp let that escape after a refactor moved app.process() out of its try.
test('closing an app that already exited by itself (a reset, an import) is quiet, and has nothing to end', async () => {
  const gone = {process: () => { throw new TypeError("Cannot read properties of undefined (reading '_object')"); }, evaluate: async () => { throw new Error('Target page, context or browser has been closed'); }};
  await closeApp(gone);
  await closeApp(gone, {how: 'crash', graceMs: 10});
});

// Why (1 Nov 2026, beta #4 run 41309751593, Windows apply-2of3): the close listed 155 processes "below" the app, because Windows keeps a dead parent's pid as the parent id of what it made and
// a newer process can take that pid. The runner's own processes were among them and were ended. A process created before the app is not its child, whatever its parent id says.
test('closing the app ends what the app started and leaves a live process whose parent id is the launcher\'s pid but was created before it', async t => {
  const launcher = spawn(process.execPath, ['-e', START_THE_APP], {stdio: ['ignore', 'pipe', 'ignore']});
  const app = Number(await firstLine(launcher.stdout));
  const bystander = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], {stdio: 'ignore'});   // stands for a runner process: alive, not the app's
  t.after(() => { for (const pid of [app, launcher.pid, bystander.pid]) { try { process.kill(pid, 'SIGKILL'); } catch (error) { if (error.code !== 'ESRCH') throw error; } } });
  const row = (pid, ppid, started, command) => ({pid, ppid, started, command});
  const GONE = 2000000000;   // a pid nothing has: it makes the tree closeApp reads from `list` differ from the real one (main ignored `list` and saw 1 process below the launcher)
  const list = () => [row(launcher.pid, process.pid, 2000, 'launcher'), row(app, launcher.pid, 2500, 'the app'), row(GONE, launcher.pid, 2600, 'a second child of the app'),
    row(bystander.pid, launcher.pid, 1000, 'bystander: made before the launcher by the pid\'s earlier owner')];
  const exits = once(launcher, 'exit');
  const fake = {process: () => launcher, evaluate: async fn => { if (!/exit\(/.test(String(fn))) return ''; launcher.kill('SIGKILL'); await exits; }};
  const said = [], log = console.log;
  console.log = (...parts) => { said.push(parts.join(' ')); };
  try { await closeApp(fake, {graceMs: 300, list}); } finally { console.log = log; }
  assert.match(said.join('\n'), /closing the app \(pid \d+, 2 process\(es\) below it\)/, 'the tree is read from the list: the app and its second child, not the stale row');
  assert.equal(isAlive(app), false, 'the program the launcher started is still running after the close');
  assert.equal(isAlive(bystander.pid), true, 'a process that is not the app\'s was ended by the close (a stale parent id took it into the tree)');
});
