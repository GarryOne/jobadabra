// The e2e cause trailer (tools/e2e-cause-trailer.mjs): a push changing an e2e suite or lib names why the suite was red, in /admin/operations/e2e's words.
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {E2E_CAUSES, causeProblems, isE2ePush, missingCause} from '../../tools/e2e-cause-trailer.mjs';
import {messageProblems} from '../../tools/commit-trailers.mjs';

const SUITES = ['settings', 'apply', 'applyflows', 'quality'];

test('a push changing an e2e suite or its lib needs "E2E-cause:"; a harness test or the app alone does not', () => {
  assert.equal(isE2ePush(['desktop/e2e/suites/settings.mjs']), true);
  assert.equal(isE2ePush(['desktop/e2e/lib/pr-suites.mjs']), true);
  assert.equal(isE2ePush(['desktop/e2e/test/pr-suites.test.mjs', 'desktop/lib/server.js']), false);
  assert.match(missingCause(['desktop/e2e/suites/settings.mjs'], ['Expect the backup message to name the file']), /no commit says why the suite was red/,
    '27 Oct 2026: a harness-only fix carried no cause and the page could only guess drift or test bug');
  assert.equal(missingCause(['desktop/lib/server.js'], ['Fix the backup name']), '');
});

test('the cause is one of the page\'s ids with optional suites, or "none <why>"', () => {
  const ok = ['Follow the backup wording\n\nE2E-cause: drift settings', 'x\n\nE2E-cause: test applyflows-1of2, apply', 'x\n\nE2E-cause: none a new step for the export card'];
  for (const message of ok) assert.equal(missingCause(['desktop/e2e/suites/apply.mjs'], [message], SUITES), '', message);
  assert.match(missingCause(['desktop/e2e/suites/apply.mjs'], ['x\n\nE2E-cause: infra'], SUITES), /not one of/);
  assert.match(missingCause(['desktop/e2e/suites/apply.mjs'], ['x\n\nE2E-cause: none'], SUITES), /needs a reason/);
  assert.match(missingCause(['desktop/e2e/suites/apply.mjs'], ['x\n\nE2E-cause: drift setings'], SUITES), /no suite "setings"/);
  assert.deepEqual(causeProblems(['product'], SUITES), []);
});

test('the ids are the site\'s cause ids (jobadabra-web admin/e2e-causes.js), never "infra" or "credit" (rules 1-2 words)', () => {
  assert.deepEqual([...E2E_CAUSES].sort(), ['ai', 'ci', 'drift', 'flake', 'picker', 'product', 'runner', 'test', 'timing']);
});

test('a wrong E2E-cause value fails at commit time, like Rung', () => {
  assert.deepEqual(messageProblems('Fix\n\nE2E-cause: drift settings', [], {names: [], complete: false}), []);
  assert.match(messageProblems('Fix\n\nE2E-cause: because', [], {names: [], complete: false}).join('\n'), /E2E-cause/);
});
