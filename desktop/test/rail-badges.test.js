// In the icon rail every nav badge and dot is a small marker inside its 48px button, above the icon, never over it (owner, 17 Oct 2026). Renders the demo app (electron); skipped only where electron or a display is missing (needs-electron.js).
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {needsElectron} from './needs-electron.js';
import {fileURLToPath} from 'node:url';
import {test} from 'node:test';
import {badgeLabel} from '../renderer/badge-label.js';
import {probe, problems} from '../e2e/lib/rail-markers.mjs';

const desktop = fileURLToPath(new URL('..', import.meta.url));
const source = `JSON.stringify((${probe})())`;

test('badge counts are capped to fit the rail', () => {
  assert.deepEqual([6, 99, 100, 474].map(badgeLabel), ['6', '99', '99+', '99+']);
});

test('in the rail, each badge and dot sits inside its button and clear of the icon', needsElectron, () => {
  const run = spawnSync('node', ['scripts/shot.mjs', 'jobs', '--no-picture', '--eval', source], {cwd: desktop, encoding: 'utf8', timeout: 90000});
  assert.deepEqual(problems(JSON.parse(JSON.parse(run.stdout.trim().split('\n').pop()))), []);
});
