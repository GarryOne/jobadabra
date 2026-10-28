// The windowless Chrome an automation left behind (lib/background-chrome.js): it holds macOS's one Apple Event
// connection to Chrome, which is what made the app report "no tab matches" about tabs that were open.
import assert from 'node:assert/strict';
import test from 'node:test';
import * as chrome from '../lib/background-chrome.js';

const line = (pid, ppid, command) => `${pid} ${ppid} Thu Oct  1 00:09:42 2026 ${command}`;
const BROWSER = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';

test('an orphaned, windowless Chrome is a stray; an owned one and a normal one are not', () => {
  const ps = [
    line(48581, 1, `${BROWSER} --no-startup-window --headless=new --user-data-dir=/tmp/left-behind`),
    line(48582, 999, `${BROWSER} --headless=new --user-data-dir=/tmp/an-automation-at-work`),
    line(53464, 1, `${BROWSER} --origin-trial-disabled-features=CanvasTextNg`),
    // a helper, not the browser itself
    line(53550, 53464, '/Applications/Google Chrome.app/Contents/Frameworks/Google Chrome Framework.framework/Versions/153/Helpers/Google Chrome Helper.app/Contents/MacOS/Google Chrome Helper --type=gpu-process'),
    'something that is not ps output',
  ].join('\n');
  assert.deepEqual(chrome.parseChromeProcesses(ps), [
    {pid: 48581, ppid: 1, since: 'Thu Oct  1 00:09:42 2026', profile: '/tmp/left-behind'},
  ]);
});

test('nothing on a Mac that has no stray, and nothing at all off one', async () => {
  assert.deepEqual(chrome.parseChromeProcesses(''), []);
  assert.deepEqual(await chrome.stray({exec: async () => '', platform: 'darwin'}), []);
  assert.deepEqual(await chrome.stray({exec: async () => 'ignored', platform: 'win32'}), []);
});

test('quitting takes a pid it has just reported, never a bare number from a caller', async () => {
  const killed = [];
  const list = async () => [{pid: 42, since: 'x', profile: ''}];
  assert.deepEqual(await chrome.quit(42, {list, kill: pid => killed.push(pid)}), {ok: true, pid: 42});
  assert.deepEqual(killed, [42]);
  // the user's own Chrome, or a pid that has gone: refused
  assert.equal((await chrome.quit(53464, {list, kill: pid => killed.push(pid)})).ok, false);
  assert.equal((await chrome.quit(NaN, {list, kill: pid => killed.push(pid)})).ok, false);
  assert.deepEqual(killed, [42]);
  const failed = await chrome.quit(42, {list, kill: () => { throw new Error('not permitted'); }});
  assert.deepEqual(failed, {ok: false, error: 'not permitted'});
});

test("Jobadabra's own hidden browser is never a stray: it is another app, so it holds no Chrome scripting link and is never offered to quit", () => {
  // Why (2026-10-28, Background apply B): it outlives the app on purpose (a held form keeps its tab), headless and orphaned like a stray, but it is Chrome for Testing.
  const own = '/Users/x/Library/Application Support/Jobadabra/background-browser-runtime/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing --user-data-dir=/x/profile --headless=new --no-startup-window';
  assert.deepEqual(chrome.parseChromeProcesses(line(51000, 1, own)), []);
});
