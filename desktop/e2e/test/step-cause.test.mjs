// One cause, many red steps (gate G3): lib/step-cause.mjs on the notes of beta 1 and beta 2 (25 Oct 2026, cardstates).
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {causeOf, sharedCauseLines, sharedCauses} from '../lib/step-cause.mjs';

const timeout = (pick, resolved = '') => ['locator.click: Timeout 30000ms exceeded.', 'Call log:', `  - waiting for locator('#activity-recent li:not(.recent-group) button')${pick}`,
  ...(resolved ? [`    - locator resolved to ${resolved}`, '  - attempting click action', '    2 × waiting for element to be visible, enabled and stable', '      - element is not visible'] : [])].join('\n');
const failed = (name, note) => ({name, status: 'failed', note});

// Beta 1 (cardstates, Linux): six steps, one locator (only .first()/.nth(n) differ), one bare first line each.
const BETA1 = [
  failed('every finished state reads in plain words', timeout('.first()', '<button class="recent-row current">…</button>')),
  failed('Find jobs using your browser: its card counts the sites', timeout('.nth(35)')),
  failed('a partial Tailor run: its counts agree', timeout('.nth(21)')),
  failed('Gmail "which job?" answers', timeout('.first()', '<button class="recent-row current">…</button>')),
  failed('Gmail connected now', timeout('.nth(7)', '<button class="recent-row" data-state="error">…</button>')),
  failed('Gmail disconnected now', timeout('.nth(7)', '<button class="recent-row" data-state="error">…</button>')),
  {name: 'a live run, mocked', status: 'passed', seconds: '0.3'},
];
// Beta 2: the same steps' own checks, five different failures.
const BETA2 = [
  failed('Find jobs using your browser', 'Claude help on: no "Read with Claude" on the stopped site'),
  failed('a partial Tailor run', 'the heading is not "3 of 5 CVs ready"'),
  failed('Gmail "which job?" answers', 'the count is not 3: "Anthropic'),
  failed('Gmail connected now', 'the not-connected run does not say it was not connected then'),
  failed('Gmail disconnected now', 'the schedule does not say Connection required'),
];

test('a Playwright timeout names its action, locator and what it saw, in one line', () => {
  assert.deepEqual(causeOf(BETA1[0].note), {key: "click locator('#activity-recent li:not(.recent-group) button')",
    text: "click on locator('#activity-recent li:not(.recent-group) button'): not visible (gave up after 30 s)"});
  assert.equal(causeOf(BETA1[1].note).text, "click on locator('#activity-recent li:not(.recent-group) button'): never found (gave up after 30 s)");
  assert.equal(causeOf(`step name: ${BETA1[0].note}`).key, causeOf(BETA1[0].note).key, 'a note that starts with more words still reads');
  assert.match(causeOf('x: page.waitForSelector: Timeout 5000ms exceeded.\nCall log:\n  - waiting for getByRole(\'button\', { name: \'Save\' }) to be visible\n  - element intercepts pointer events').text, /^waitForSelector on getByRole\('button', \{ name: 'Save' \}\): another element covers it \(gave up after 5 s\)$/);
});

test('beta 1: six reds are one cause, said once', () => {
  const shared = sharedCauses(BETA1);
  assert.equal(shared.length, 1);
  assert.equal(shared[0].steps.length, 6);
  assert.deepEqual(sharedCauseLines(BETA1), ["⚠ one cause, 6 steps: click on locator('#activity-recent li:not(.recent-group) button'): not visible (gave up after 30 s). Fix it first: these steps stopped there, so their own checks never ran."]);
});

test('beta 2: five different checks are five causes, none shared', () => {
  assert.deepEqual(sharedCauses(BETA2), []);
  assert.equal(causeOf(BETA2[1].note).text, 'the heading is not "3 of 5 CVs ready"');
});

test('steps not run over the budget share one cause', () => {
  const over = n => ({name: `step ${n}`, status: 'failed', note: 'not run: the suite was over its 7-minute budget', budget: true});
  assert.deepEqual(sharedCauses([over(1), over(2), over(3)]).map(group => group.steps.length), [3]);
});
