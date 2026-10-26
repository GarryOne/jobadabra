// The PR check that names suites quoting UI text a PR removes: strings come from removed app lines only, a lib file counts for its importing suites, a touched step is told apart.
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {removedStrings, suitesExpecting, stepTouched, report} from '../lib/pr-suites.mjs';

const DIFF = [
  '+++ b/desktop/renderer/pages/settings.js', "-  toast('Backup saved to the folder');", "+  toast('Backup saved as a file');", "-  const id = 'x-1';",
  '+++ b/desktop/e2e/suites/settings.mjs', "-  await expect('Old words in a test');",
  '+++ b/desktop/test/foo.test.js', "-  'Unit test words here'",
].join('\n');

test('only quoted words on removed app lines count: not tests, not short or code-looking strings', () => {
  assert.deepEqual(removedStrings(DIFF), ['Backup saved to the folder']);
});

const sources = {'suites/settings.mjs': "import {x} from '../lib/layout.mjs';\nfoo('Other');", 'lib/layout.mjs': "expect('Backup saved to the folder')", 'suites/jobs.mjs': 'nothing here'};

test('a lib file counts for the suites that import it, and a suite that does not quote the text is not named', () => {
  assert.deepEqual(suitesExpecting(['Backup saved to the folder'], sources), {settings: ['Backup saved to the folder']});
});

test('a step counts as touched when the PR changes its suite file or a lib it imports', () => {
  assert.equal(stepTouched('settings', ['desktop/e2e/lib/layout.mjs'], sources), true);
  assert.equal(stepTouched('settings', ['desktop/renderer/pages/settings.js'], sources), false);
});

test('the report warns about an untouched suite and says so plainly when nothing matches', () => {
  const hits = suitesExpecting(['Backup saved to the folder'], sources);
  const stale = report({strings: ['Backup saved to the folder'], hits, changedFiles: ['desktop/renderer/pages/settings.js'], sources});
  assert.deepEqual(stale.stale, ['settings']);
  assert.match(stale.text, /not touched/);
  assert.deepEqual(report({strings: ['Backup saved to the folder'], hits, changedFiles: ['desktop/e2e/lib/layout.mjs'], sources}).stale, []);
  assert.match(report({strings: [], hits: {}, changedFiles: [], sources}).text, /no suite is named/);
});

import {planPrSuites, MAX_PR_SUITES} from '../lib/pr-suites.mjs';

test('the PR plan joins pointed and quoting suites, keeps Linux ones, drops manual ones, and caps the count at 4 (report only, owner 26 Oct 2026)', () => {
  const plan = planPrSuites({pointed: ['settings', 'apply'], hits: {jobs: ['x'], quality: ['y'], personas: ['z'], strategy: ['w'], focus: ['v']}, linux: suite => suite !== 'apply', cadence: {personas: 'manual'}});
  assert.equal(MAX_PR_SUITES, 4);
  assert.deepEqual(plan.suites, ['settings', 'jobs', 'quality', 'strategy']);
  assert.deepEqual(plan.left, ['apply', 'focus'], 'a Mac suite and the ones over the cap are left to the nightly run and the beta; a manual suite is not named at all');
});
