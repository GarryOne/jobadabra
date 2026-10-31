// npm run shot --mark draws a red frame around the matched element (owner, 17 Oct 2026: PR screens point at "where to look"). Renders a tiny page in electron; skipped only where electron or a display is missing (needs-electron.js), like rail-badges.test.js.
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {needsElectron} from './needs-electron.js';
import {fileURLToPath, pathToFileURL} from 'node:url';
import {test} from 'node:test';
import {markSteps} from '../scripts/shot-mark.mjs';

const desktop = fileURLToPath(new URL('..', import.meta.url));
const probe = count => {
  const run = spawnSync(`${desktop}node_modules/.bin/electron`, [`${desktop}test/fixtures/mark-probe.cjs`], {cwd: desktop, encoding: 'utf8', timeout: 60000,
    env: {...process.env, MARK_MODULE: pathToFileURL(`${desktop}scripts/shot-mark.mjs`).href, MARK_COUNT: String(count)}});
  const line = run.stdout.split('\n').find(l => l.startsWith('PROBE '));
  assert.ok(line, `no probe output: ${run.stderr.slice(0, 300)}`);
  return JSON.parse(line.slice(6));
};

test('the steps name every selector and throw on one that matches nothing', () => {
  const steps = markSteps(['#a', '.b']);
  assert.match(steps, /"#a","\.b"/);
  assert.match(steps, /no element matches/);
});

test('the frame is red around the box and the box and the page stay as they were', needsElectron, () => {
  const seen = probe(1);
  assert.equal(seen.error, null);
  const [r, g, b] = seen.frame;
  assert.ok(r > 150 && g < 80 && b < 80, `the frame pixel is not red: ${seen.frame}`);
  assert.deepEqual(seen.inside, [255, 255, 255]);
  assert.deepEqual(seen.outside, [255, 255, 255]);
});

test('a selector with no match is an error, never a shot without the mark', needsElectron, () => {
  assert.match(probe(2).error, /no element matches #missing/);
});
