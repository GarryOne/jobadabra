// The twin's live update (lib/twin-refresh.mjs): what a change asks of the running twin, and that a refresh brings its worktree to origin/main and rewrites the
// extension copy the browser has loaded IN PLACE (with the test port, never the live app's 47111), without touching anything else. No browser, no app.
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {test} from 'node:test';
import {classify, refresh} from '../../lib/twin-refresh.mjs';

test('what a change asks of the twin: the app restarts only for its main process, the window reloads for the renderer, the extension reloads in place', () => {
  assert.deepEqual(classify(['desktop/renderer/pages/session-needs.js', 'desktop/renderer/style.css']), {app: false, renderer: true, extension: false});
  assert.deepEqual(classify(['extension/review.js', 'extension/manifest.json']), {app: false, renderer: false, extension: true});
  assert.equal(classify(['desktop/lib/server-env.js']).app, true);
  assert.equal(classify(['desktop/main.js']).app, true);
  assert.equal(classify(['desktop/preload.cjs']).app, true);
  assert.equal(classify(['worker/src/extension.js']).app, true);   // staged into the app: the app's main process runs it
  assert.deepEqual(classify(['src/ai/insights.py', 'docs/flows/applying.md', 'CODEMAP.md']), {app: false, renderer: false, extension: false});   // the engine starts afresh each run
  assert.deepEqual(classify([]), {app: false, renderer: false, extension: false});
});

const git = (cwd, ...args) => execFileSync('git', args, {cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe']}).trim();

test('a refresh fast-forwards the worktree, rewrites the extension copy in place on the twin\'s port, and stops (changing nothing) when it cannot move', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'jp-twin-refresh-'));
  const origin = path.join(root, 'origin'), twin = path.join(root, 'twin'), copy = path.join(root, 'loaded-extension');
  fs.mkdirSync(path.join(origin, 'extension'), {recursive: true});
  const write = (dir, file, text) => { fs.mkdirSync(path.dirname(path.join(dir, file)), {recursive: true}); fs.writeFileSync(path.join(dir, file), text); };
  git(root, 'init', '-q', '-b', 'main', origin);
  for (const [key, value] of [['user.email', 't@example.test'], ['user.name', 'T']]) git(origin, 'config', key, value);
  write(origin, 'extension/flow.js', "const APP = 'http://127.0.0.1:47111';\n");
  write(origin, 'extension/manifest.json', JSON.stringify({version: '1', host_permissions: ['https://a/*'], optional_host_permissions: ['https://*/*']}));
  git(origin, 'add', '-A'); git(origin, 'commit', '-q', '-m', 'one');
  git(root, 'clone', '-q', origin, twin);
  fs.mkdirSync(copy);
  // Nothing new: nothing changes.
  assert.deepEqual(refresh({repo: twin, extensionDir: copy, port: 55001}), {from: git(twin, 'rev-parse', '--short=7', 'HEAD'), to: git(twin, 'rev-parse', '--short=7', 'HEAD'), files: 0, kinds: {app: false, renderer: false, extension: false}});
  // A pushed change to the extension: the worktree follows, the loaded copy is rewritten with the twin's port, never 47111.
  write(origin, 'extension/flow.js', "const APP = 'http://127.0.0.1:47111'; // two\n");
  git(origin, 'commit', '-q', '-am', 'two');
  const done = refresh({repo: twin, extensionDir: copy, port: 55001});
  assert.deepEqual(done.kinds, {app: false, renderer: false, extension: true});
  assert.equal(done.files, 1);
  assert.match(fs.readFileSync(path.join(copy, 'flow.js'), 'utf8'), /127\.0\.0\.1:55001.*two/);
  assert.doesNotMatch(fs.readFileSync(path.join(copy, 'flow.js'), 'utf8'), /47111/);
  assert.deepEqual(JSON.parse(fs.readFileSync(path.join(copy, 'manifest.json'), 'utf8')).host_permissions, ['https://a/*', 'https://*/*']);   // the twin's "all sites" access
  // Local edits that the change touches stand in the way: said, nothing changed.
  write(origin, 'extension/flow.js', "const APP = 'http://127.0.0.1:47111'; // three\n");
  git(origin, 'commit', '-q', '-am', 'three');
  write(twin, 'extension/flow.js', 'local edit\n');
  const before = git(twin, 'rev-parse', 'HEAD');
  const blocked = refresh({repo: twin, extensionDir: copy, port: 55001});
  assert.ok(blocked.error, 'a worktree that cannot fast-forward says so');
  assert.equal(git(twin, 'rev-parse', 'HEAD'), before);
  assert.match(fs.readFileSync(path.join(copy, 'flow.js'), 'utf8'), /two/);   // the loaded copy was not touched
  fs.rmSync(root, {recursive: true, force: true});
});

test('a restart stops the app as a whole group (a quit prompt that never answers does not hold it) and waits until its ports are free', async () => {
  const {spawn} = await import('node:child_process');
  const {killGroup, portsFree} = await import('../../lib/twin-refresh.mjs');
  // A "shim" that ignores SIGTERM (like the app holding its quit prompt) and a child of its own: both must go.
  const shim = spawn(process.execPath, ['-e', "process.on('SIGTERM', () => {}); require('node:child_process').spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)']); setInterval(() => {}, 1000);"], {detached: true, stdio: 'ignore'});
  await new Promise(resolve => setTimeout(resolve, 400));
  assert.doesNotThrow(() => process.kill(-shim.pid, 0), 'the group is running');
  await killGroup(shim, 500);
  assert.throws(() => process.kill(-shim.pid, 0), 'SIGTERM was ignored: SIGKILL ended the whole group');
  const net = await import('node:net');
  const server = net.createServer();
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const {port} = server.address();
  try {
    assert.equal(await portsFree([port], 600), false, 'a held port is not free');
  } finally { await new Promise(resolve => server.close(resolve)); }
  assert.equal(await portsFree([port], 2000), true, 'a released port is free');
});
