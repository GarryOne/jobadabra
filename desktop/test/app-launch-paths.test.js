// Every way a test or tool starts the desktop app keeps the owner's own app safe: it never takes port 47111 and it ends with the script that started it.
// Why (30 Oct 2026, owner's demo: "not able to open the tab in Chrome… cards stuck in Checking"): a test app left running held 47111 for 27 h, so the owner's app never
// heard Chrome; that night a demo app (30 h) and an offline app (3 days) were still running too, each started by a script that had long ended.
// Reads the sources only (no app is started). A new way to start the app passes by keeping the rules below, never by being added to a list.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {test} from 'node:test';
import {fileURLToPath} from 'node:url';

const DESKTOP = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const ROOTS = ['e2e', 'scripts', 'test', 'lib', '../tools'].map(dir => path.join(DESKTOP, dir));
const rel = file => path.relative(DESKTOP, file).replace(/\\/g, '/');
function sources(dir) {
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir, {withFileTypes: true}).flatMap(entry => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) return ['node_modules', 'fixtures', 'shared', 'out', 'dist'].includes(entry.name) ? [] : sources(full);
    return /\.(m|c)?js$/.test(entry.name) ? [full] : [];
  });
}
const FILES = [...new Set(ROOTS.flatMap(sources))].map(file => ({file: rel(file), text: fs.readFileSync(file, 'utf8')}));
const SELF = rel(fileURLToPath(import.meta.url));

// A spawn of the Electron binary whose first argument is the app folder ('.', DESKTOP or desktop) starts the app; any other first argument runs a script of its own.
// The binary may be a path built with commas (twin.mjs: path.join(DESKTOP, 'node_modules', '.bin', 'electron')) or a variable (`electron`, `electronPath()`): the text up to the argument array.
const START = /\b(?:spawn|spawnSync|execFile|execFileSync)\(\s*([^[]*?(?:\belectron\w*|\.bin[/'", ]+electron)[^[]*)\[\s*('\.'|DESKTOP\b|desktop\b)/g;
const appStarts = () => FILES.filter(({file}) => file !== SELF).flatMap(({file, text}) => [...text.matchAll(START)].map(() => ({file, text})));

test('Playwright starts the app in one place only: e2e/lib/app.mjs launch(), which gives it its own port and its runner', () => {
  // The import of Playwright's launcher, or a launch call: `_electron` alone is also the unused first parameter of app.evaluate callbacks (e2e/suites/explore.mjs).
  const launchers = FILES.filter(({file, text}) => file !== SELF && /\{\s*_electron\b[^}]*\}\s*from|\b_?electron\.launch\(/.test(text)).map(({file}) => file);
  assert.deepEqual(launchers, ['e2e/lib/app.mjs'], 'start the app through launch() (e2e/lib/app.mjs), never a second Playwright launch');
  const app = FILES.find(({file}) => file === 'e2e/lib/app.mjs').text;
  assert.match(app, /ownPortEnv\(/, 'launch() gives every test app its own port');
  assert.match(app, /JOBADABRA_E2E_RUNNER_PID/, 'launch() names its runner, so the app ends with it (lib/e2e-host.js watchRunner)');
});

test('every other start of the app has no socket or its own port, and ends with the script that started it', () => {
  const starts = appStarts();
  assert.deepEqual([...new Set(starts.map(({file}) => file))].sort(), ['e2e/twin.mjs', 'scripts/screenshots.mjs', 'scripts/shot.mjs', 'scripts/ui-shots.mjs'],
    'the scan finds the three shot tools and the twin: the pattern above still matches them (a new start is added here with its rules)');
  for (const {file, text} of starts) {
    assert.match(text, /JOBADABRA_DEMO|JOBADABRA_PORT/, `${file}: a demo app (no socket) or its own port, never the owner's 47111`);
    // The twin is the one start meant to outlive its script: the owner looks at it after `twin.mjs start` returns, and `twin.mjs stop` ends it (docs/live-test.md).
    if (file === 'e2e/twin.mjs') { assert.match(text, /JOBADABRA_PORT: String\(port\)/, 'the twin listens on its own port'); continue; }
    assert.match(text, /JOBADABRA_E2E_RUNNER_PID: String\(process\.pid\)/, `${file}: name the runner, so the app ends with this script (lib/e2e-host.js watchRunner); a timeout kills only the .bin/electron shim`);
  }
});

test('a plain-node copy of the app\'s server ends with the harness that started it', () => {
  const servers = FILES.filter(({file, text}) => file !== SELF && !file.startsWith('lib/') && !file.startsWith('test/') && /lib\/server\.js/.test(text) && /\bstart\(storage/.test(text));
  assert.ok(servers.some(({file}) => file === 'e2e/lib/offline-app-child.mjs'), 'the scan finds the offline app');
  for (const {file, text} of servers) {
    assert.match(text, /\bwatchRunner\(/, `${file}: call watchRunner (lib/e2e-host.js) so it ends with its harness`);
    const name = path.basename(file);
    const launchers = FILES.filter(other => other.file !== file && other.file !== SELF && other.text.includes(name) && /\bspawn\(/.test(other.text));
    assert.ok(launchers.length, `${file}: its launcher is found`);
    for (const launcher of launchers) assert.match(launcher.text, /JOBADABRA_E2E_RUNNER_PID: String\(process\.pid\)/, `${launcher.file}: name the runner when starting ${name}`);
  }
});
