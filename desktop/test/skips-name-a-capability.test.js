// A desktop test may skip for a missing capability (electron, a display), never for "CI" alone: a test CI skips runs nowhere automatically, and goes red on main unseen.
// Why (31 Oct 2026, owner: "was this a flaky e2e? OR what's the root cause of this ? How did it endup in main ?"): palette-one-row-per-card skipped on `process.env.CI`,
// so no CI run executed it and #2695 was needed to fix what it caught on the owner's Mac. Run under xvfb in tests-desktop.yml and build.yml.
import assert from 'node:assert/strict';
import {readdirSync, readFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {test} from 'node:test';
import {cannotRender} from './needs-electron.js';

const folder = fileURLToPath(new URL('.', import.meta.url));
const ENV_CI = /process\.env\.(?:CI|GITHUB_ACTIONS)\b|env\[['"](?:CI|GITHUB_ACTIONS)['"]\]/;
const SKIPS = /\bskip\b/i;   // `skip:`, `SKIP`, `t.skip(`, `{skip}`

test('no desktop test skips because it runs on CI', () => {
  const offenders = [];
  for (const name of readdirSync(folder).filter(file => /\.test\.m?js$/.test(file))) {
    readFileSync(folder + name, 'utf8').split('\n').forEach((line, index) => {
      if (SKIPS.test(line) && ENV_CI.test(line)) offenders.push(`${name}:${index + 1}  ${line.trim().slice(0, 120)}`);
    });
  }
  assert.deepEqual(offenders, [], 'a skip must name a missing capability (test/needs-electron.js: electron or a display), not "CI"');
});

test('electron tests are skipped for a missing electron or display and for nothing else, CI or not', () => {
  const CI = {CI: 'true', GITHUB_ACTIONS: 'true'};
  assert.equal(cannotRender(CI, 'linux', true) !== false, true, 'linux CI without a display must skip, naming the display');
  assert.match(cannotRender(CI, 'linux', true), /display/);
  assert.equal(cannotRender({...CI, DISPLAY: ':99'}, 'linux', true), false, 'CI with electron and xvfb must run');
  assert.equal(cannotRender(CI, 'darwin', true), false, 'macOS needs no DISPLAY');
  assert.equal(cannotRender(CI, 'win32', true), false, 'Windows needs no DISPLAY');
  assert.match(cannotRender({DISPLAY: ':99'}, 'linux', false), /electron/);
});
