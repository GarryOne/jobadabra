// Upgrade proof for the Mac rename: runs the real swap script on temp folders (a fake old Job Pilotto.app, a fake new Jobadabra.app) and checks what a user ends up with.
import test from 'node:test';
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {macSwapScript, swapTarget, MAC_APP} from '../lib/updater.js';

const runnable = process.platform !== 'win32';

// A sandbox "Applications" folder with the old app in it, a fresh new app beside the download, and a fake `open` that records what it was asked to open.
function sandbox() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'mac-swap-'));
  const apps = path.join(root, 'Applications'), download = path.join(root, 'dl'), bin = path.join(root, 'bin');
  for (const dir of [apps, download, bin]) fs.mkdirSync(dir);
  const oldApp = path.join(apps, 'Job Pilotto.app'), newApp = path.join(download, MAC_APP);
  for (const [app, version] of [[oldApp, 'old'], [newApp, 'new']]) { fs.mkdirSync(path.join(app, 'Contents'), {recursive: true}); fs.writeFileSync(path.join(app, 'Contents', 'version'), version); }
  const opened = path.join(root, 'opened.txt');
  fs.writeFileSync(path.join(bin, 'open'), `#!/bin/sh\necho "$1" >> '${opened}'\n`, {mode: 0o755});
  const run = (script) => execFileSync('/bin/sh', ['-c', script], {env: {...process.env, PATH: `${bin}:${process.env.PATH}`}});
  return {root, apps, oldApp, newApp, opened, run};
}

test('swapTarget: an old Job Pilotto.app moves to Jobadabra.app unless that name is taken', () => {
  assert.equal(swapTarget('/Applications/Job Pilotto.app', () => false), '/Applications/Jobadabra.app');
  assert.equal(swapTarget('/Applications/Jobadabra.app', () => false), '/Applications/Jobadabra.app');
  assert.equal(swapTarget('/Applications/Job Pilotto.app', () => true), '/Applications/Job Pilotto.app');
});

test('renaming swap: the new app is Jobadabra.app, the old path is a link to it, nothing is left over, and the new app opens', { skip: !runnable }, () => {
  const s = sandbox();
  s.run(macSwapScript(2 ** 22 + 1, s.oldApp, s.newApp, '', swapTarget(s.oldApp)));   // a pid that does not exist: the app "already quit"
  const target = path.join(s.apps, MAC_APP);
  assert.equal(fs.readFileSync(path.join(target, 'Contents', 'version'), 'utf8'), 'new');
  assert.ok(fs.lstatSync(s.oldApp).isSymbolicLink(), 'the old path stays as a link');
  assert.equal(fs.readFileSync(path.join(s.oldApp, 'Contents', 'version'), 'utf8'), 'new', 'the old path opens the new app');
  assert.deepEqual(fs.readdirSync(s.apps).sort(), ['Job Pilotto.app', MAC_APP], 'no .old leftovers, one real app');
  assert.equal(fs.readFileSync(s.opened, 'utf8').trim(), target);
});

test('same-name swap (an install already called Jobadabra.app) keeps its path and leaves no link', { skip: !runnable }, () => {
  const s = sandbox();
  const app = path.join(s.apps, MAC_APP);
  fs.renameSync(s.oldApp, app);
  s.run(macSwapScript(2 ** 22 + 1, app, s.newApp, '', swapTarget(app)));
  assert.deepEqual(fs.readdirSync(s.apps), [MAC_APP]);
  assert.equal(fs.readFileSync(path.join(app, 'Contents', 'version'), 'utf8'), 'new');
  assert.equal(fs.readFileSync(s.opened, 'utf8').trim(), app);
});

test('when Jobadabra.app is already taken the old path is replaced in place, as before the rename', { skip: !runnable }, () => {
  const s = sandbox();
  fs.mkdirSync(path.join(s.apps, MAC_APP));
  s.run(macSwapScript(2 ** 22 + 1, s.oldApp, s.newApp, '', swapTarget(s.oldApp)));
  assert.equal(fs.readFileSync(path.join(s.oldApp, 'Contents', 'version'), 'utf8'), 'new');
  assert.ok(!fs.lstatSync(s.oldApp).isSymbolicLink());
});
