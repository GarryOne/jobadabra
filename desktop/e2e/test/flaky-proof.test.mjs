// "Flaky" needs proof (gate G5): lib/flaky-proof.mjs and triage's closing rule. The CI job has one try (tests/test_e2e_single_try.py).
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {INTERMITTENT, flakyProof, intermittentComment, labelRerun} from '../lib/flaky-proof.mjs';
import {runJourneys} from '../lib/apply-journeys.mjs';
import {LATE, REVEAL} from '../lib/forms.mjs';
import {stepClock} from '../lib/wait-on-state.mjs';
import {toClose} from '../lib/triage-issues.mjs';

// #1897 (25 Oct 2026): this step failed, passed on the rerun, was labelled flaky and closed, then failed beta 2. It was a product bug (bd368f8).
const STEP_1897 = 'Notion is busy (429) for a moment during a Jobs check: the run ends normally, in words, with nothing left Running';
const MESSAGE_1897 = 'the list says "Completed" and the panel "Completed with warnings"';

test('#1897: a wrong value that came right on the rerun is intermittent, not flaky', () => {
  const proof = flakyProof(MESSAGE_1897);
  assert.equal(proof.flaky, false);
  assert.match(proof.why, /a wrong value, not timing: "the list says "Completed"/);
});

test('the step name is never read: "Notion is busy (429)" in a name is not an environment failure', () => {
  assert.equal(flakyProof(`${STEP_1897}: ${MESSAGE_1897}`).flaky, true, 'guard: the name alone WOULD read as environment, so only the message may be passed');
});

test('timing and the test environment are proof', () => {
  assert.deepEqual(flakyProof('locator.click: Timeout 30000ms exceeded.\nCall log:\n  - waiting for locator(\'#x\')'), {flaky: true, kind: 'timing', why: 'timing: "Timeout 30000ms exceeded"'});
  assert.equal(flakyProof('Unexpected token \'<\', "<!DOCTYPE "... is not valid JSON').flaky, true);
  assert.equal(flakyProof('request to http://127.0.0.1:8790 failed, reason: socket hang up').flaky, true);
  assert.equal(flakyProof('').flaky, false, 'no message proves nothing');
});

// Beta 40275152602 (26 Oct 2026): the suite's own budget cut a step short and the steps after it never ran; G5 called them "a wrong value" and kept the job red.
// A wait that expires before any fill state arrives is timing too (owner, 31 Oct 2026).
test('a step the suite budget cut short, one it never ran, and a fill still running at its wait are timing; a reported error is not', async () => {
  const {fillNote} = await import('../lib/extension.mjs');
  assert.equal(flakyProof('the suite\'s 7-minute budget ran out during this step (the suite is too long: split it): the window answers, the main process answers').flaky, true);
  assert.equal(flakyProof('not run: the suite was over its 7-minute budget').flaky, true);
  assert.equal(flakyProof(`the one-page form was not filled as the application (${fillNote({state: 'running'}, 90)}): a CV upload beside the password makes it the form`).flaky, true);
  assert.equal(flakyProof(`the application form after the sign-up was not filled (at https://e2e.wd3.myworkdayjobs.com/e2e/signup, ${fillNote(null, 60)})`).flaky, true);
  assert.equal(flakyProof(`the fill did not finish (${fillNote({state: 'error', error: 'x'}, 90)})`).flaky, false, 'an error is a value');
});

test('an intermittent issue is never closed by "not seen" twice', () => {
  const issue = labels => ({number: 1897, state: 'OPEN', labels: labels.map(name => ({name})), comments: []});
  const closing = issues => toClose(issues, new Set(), 'https://run/2', () => true).map(item => item.labels.map(label => label.name).join(','));
  assert.deepEqual(closing([issue(['not-seen-latest', 'flaky']), issue(['not-seen-latest', INTERMITTENT])]), ['not-seen-latest,flaky']);
  assert.match(intermittentComment('4bbcb93', 'https://run/1', 'a wrong value'), /only a fix closes it/);
});

test('triage labels the rerun: #1897 intermittent, a timeout flaky with its proof', () => {
  const calls = [], out = {};
  const gh = args => { calls.push(args); return ''; };
  assert.equal(labelRerun({gh, number: 1897, message: MESSAGE_1897, sha7: '4bbcb93', runUrl: 'https://run/1', out}), INTERMITTENT);
  assert.equal(labelRerun({gh, number: 7, message: 'Timeout 30000ms exceeded', sha7: '4bbcb93', runUrl: 'https://run/1', out}), 'flaky');
  assert.deepEqual(out, {intermittent: [1897], flaky: [7]});
  assert.match(calls.find(args => args[1] === 'comment' && args[2] === '7')[4], /on timing: "Timeout 30000ms exceeded"/);
});

test('a red of the harness\'s own isolation check is the harness\'s: never flaky, never "a wrong value" (6e, 27 Oct 2026: main read like a product bug)', () => {
  const proof = flakyProof('NOT ISOLATED: the extension is not on the stand-in app\'s port 42941 ("47111" stored at 3520: …)');
  assert.equal(proof.flaky, false);
  assert.equal(proof.harness, 'isolation');
  assert.match(proof.why, /^harness: isolation: "NOT ISOLATED/);
  assert.doesNotMatch(proof.why, /wrong value/);
});


async function journeyFailure(t, {head, showTab = true, state = null, immediate = false, expectSuccess = false}) {
  t.mock.timers.enable({apis: ['Date', 'setTimeout']});
  let failure, opened = false;
  const late = head.startsWith('a form drawn after a spinner');
  const tab = {url: () => late ? LATE.formUrl : REVEAL.url, evaluate: async fn => {
    if (String(fn).includes('window.got')) return {name: 'cv.pdf', size: 10};
    if (String(fn).includes('Object.fromEntries')) return late ? {question_3001: {value: '5'}} : {};
    if (String(fn).includes('getElementById')) return true;
    return Array.isArray(state) ? state.shift() : state;
  }};
  const ctx = {browser: {context: {pages: () => showTab && opened ? [tab] : []}}, run: async (name, step) => {
    if (!name.startsWith(head)) return;
    stepClock(3000);
    try { await step(); } catch (error) { failure = error; } finally { stepClock(null); }
  }};
  let settled = false;
  const started = Date.now();
  const pending = runJourneys(ctx, {page: {evaluate: async () => { opened = true; }}, forms: {fired: []}, cv: {name: 'cv.pdf', size: 10}, dumpExtension: async () => {}, fail: problems => {
    if (problems.length) throw new Error(problems.join('; '));
  }}).finally(() => { settled = true; });
  for (let tick = 0; !settled && tick < 20; tick++) { await new Promise(setImmediate); if (!settled) t.mock.timers.tick(500); }
  assert.equal(settled, true, 'uses the step cap, not the old 60/90-second inline clock');
  await pending;
  if (immediate) assert.equal(Date.now() - started, 0, 'a closed tab fails on its first read');
  if (expectSuccess) { assert.equal(failure, undefined); return; }
  assert.ok(failure, 'the step must report the missing state or wrong value');
  return failure.message;
}

// Replay both incident situations through their producers; G5 reads only the new cap messages.
for (const [head, showTab] of [
  ['an upload slot that appears only', true],
  ['a form drawn after a spinner', false],
]) test(`a stalled journey reports timing without fallout: ${head}`, async t => {
  const message = await journeyFailure(t, {head, showTab});
  assert.equal(flakyProof(message).flaky, true, message);
  assert.match(flakyProof(message).why, /^timing:/);
  assert.doesNotMatch(message, /slot never received|first name was not filled|Kubernetes years/);
});

for (const state of ['done', 'error', 'stopped']) test(`a reported ${state} stays a wrong value`, async t => {
  const message = await journeyFailure(t, {head: 'an upload slot that appears only', state: {state}});
  if (state === 'done') assert.match(message, /the first name was not filled; Kubernetes years is not the kit's 8/);
  else assert.equal(message, `state: {"state":"${state}"}`);
  assert.equal(flakyProof(message).flaky, false);
});

test('a closed tab fails immediately and is a wrong value, never timing', async t => {
  const state = {state: 'unreadable', closed: true, error: 'Target page has been closed'};
  const message = await journeyFailure(t, {head: 'an upload slot that appears only', state, immediate: true});
  assert.equal(message, `state: ${JSON.stringify(state)}`);
  assert.equal(flakyProof(message).flaky, false);
});

test('a late form reporting no-form before done is awaited instead of failed early', async t => {
  await journeyFailure(t, {head: 'a form drawn after a spinner', state: [{state: 'no-form'}, {state: 'done'}], expectSuccess: true});
});

test('a late form stuck at a provisional no-form state until the cap is timing', async t => {
  const message = await journeyFailure(t, {head: 'a form drawn after a spinner', state: {state: 'no-form'}});
  assert.match(message, /did not finish within/);
  assert.equal(flakyProof(message).flaky, true);
});
