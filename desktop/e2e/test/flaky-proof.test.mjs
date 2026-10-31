// "Flaky" needs proof (gate G5): lib/flaky-proof.mjs, flaky-proof.mjs, triage's closing rule and every CI rerun step.
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {test} from 'node:test';
import {fileURLToPath} from 'node:url';
import {INTERMITTENT, greyProof, flakyProof, intermittentComment, labelRerun, unproved} from '../lib/flaky-proof.mjs';
import {runJourneys} from '../lib/apply-journeys.mjs';
import {REVEAL} from '../lib/forms.mjs';
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
  assert.deepEqual(unproved([{suite: 'failuresnotion', step: STEP_1897, message: MESSAGE_1897}]).map(failure => failure.step), [STEP_1897]);
});

test('timing and the test environment are proof', () => {
  assert.deepEqual(flakyProof('locator.click: Timeout 30000ms exceeded.\nCall log:\n  - waiting for locator(\'#x\')'), {flaky: true, why: 'timing: "Timeout 30000ms exceeded"'});
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

test('the CLI keeps the job red on an intermittent step, green when every step was timing', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'flaky-proof-'));
  const write = (name, failures) => { const file = path.join(dir, name); fs.writeFileSync(file, JSON.stringify(failures)); return file; };
  const cli = file => { try { return {code: 0, out: execFileSync(process.execPath, ['flaky-proof.mjs', file], {cwd: new URL('..', import.meta.url), encoding: 'utf8'})}; } catch (error) { return {code: error.status, out: String(error.stdout)}; } };
  const red = cli(write('red.json', [{step: 'a', message: 'Timeout 5000ms exceeded'}, {step: STEP_1897, message: MESSAGE_1897}]));
  assert.equal(red.code, 1);
  assert.match(red.out, /🎲 flaky: a: timing/);
  assert.match(red.out, /🔁 intermittent: Notion is busy/);
  assert.match(red.out, /1 step\(s\) failed on a wrong value/);
  assert.equal(cli(write('green.json', [{step: 'a', message: 'waiting for locator(\'#x\')'}])).code, 0);
  assert.equal(cli(path.join(dir, 'missing.json')).code, 1, 'no file cannot prove timing');
  assert.equal(cli(write('empty.json', [])).code, 1, 'an unrecorded failure is not timing proof');
  assert.equal(cli(write('malformed.json', {})).code, 1, 'malformed evidence cannot prove timing');
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

// The class: every CI step that runs a red suite once more and writes flaky.json must ask for the proof before passing the job.
test('every rerun step that writes flaky.json runs flaky-proof.mjs on the first try, with pipefail', () => {
  const flows = path.join(fileURLToDir(), '..', '..', '..', '.github', 'workflows');
  const steps = [];
  for (const file of fs.readdirSync(flows).filter(name => name.endsWith('.yml'))) {
    const text = fs.readFileSync(path.join(flows, file), 'utf8');
    for (const [at] of [...text.matchAll(/> "\$first\/flaky\.json"/g)].map(m => [m.index])) {
      const start = text.lastIndexOf('      - name:', at), end = text.indexOf('\n      - ', at);
      steps.push({file, block: text.slice(start, end < 0 ? undefined : end)});
    }
  }
  assert.ok(steps.length >= 2, 'e2e.yml and desktop.yml both rerun a red suite');
  for (const {file, block} of steps) {
    assert.match(block, /node flaky-proof\.mjs "\$first\/suite-failures\.json"/, file);
    assert.match(block, /set -o pipefail/, file);
    assert.match(block, /node flaky-proof\.mjs --grey "\$first\/suite-failures\.json" "\$E2E_ARTIFACTS\/suite-failures\.json"/, file);
    assert.match(block, /::error title=Grey: the runner, not the app::/, file);
  }
});

function fileURLToDir() { return path.dirname(fileURLToPath(import.meta.url)); }

test('a red of the harness\'s own isolation check is the harness\'s: never flaky, never "a wrong value" (6e, 27 Oct 2026: main read like a product bug)', () => {
  const proof = flakyProof('NOT ISOLATED: the extension is not on the stand-in app\'s port 42941 ("47111" stored at 3520: …)');
  assert.equal(proof.flaky, false);
  assert.equal(proof.harness, 'isolation');
  assert.match(proof.why, /^harness: isolation: "NOT ISOLATED/);
  assert.doesNotMatch(proof.why, /wrong value/);
});


test('grey needs two non-empty tries with only timing/environment failures; guards and wrong values stay red', () => {
  const timing = [{step: 'fill', message: 'Timeout 30000ms exceeded'}];
  const environment = [{step: 'load', message: 'socket hang up'}];
  assert.equal(greyProof(timing, environment).grey, true);
  for (const message of ['expected Completed, got Running', 'NOT ISOLATED: Timeout 30000ms exceeded', 'E2E_AI_ANSWER_MISSING: Timeout 30000ms exceeded']) {
    const wrong = [...timing, {step: 'value', message}];
    assert.equal(greyProof(wrong, timing).grey, false);
    assert.equal(greyProof(timing, wrong).grey, false);
  }
  for (const empty of [[], null, {}, [null]]) {
    assert.equal(greyProof(timing, empty).grey, false);
    assert.equal(greyProof(empty, timing).grey, false);
  }
});

test('grey CLI proves both files and fails closed on absent or malformed evidence', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'grey-proof-'));
  try {
    const first = path.join(dir, 'first.json'), second = path.join(dir, 'second.json');
    fs.writeFileSync(first, JSON.stringify([{step: 'fill', message: 'Timeout 30000ms exceeded'}]));
    const cli = () => {
      try { return {code: 0, out: execFileSync(process.execPath, ['flaky-proof.mjs', '--grey', first, second], {cwd: new URL('..', import.meta.url), encoding: 'utf8'})}; }
      catch (error) { return {code: error.status, out: String(error.stdout)}; }
    };
    assert.equal(cli().code, 1);
    fs.writeFileSync(second, JSON.stringify([{step: 'load', message: 'socket hang up'}]));
    assert.equal(cli().code, 0);
    assert.match(cli().out, /fill.*load/);
    for (const value of ['[]', '{}', '{', '[{"message":"wrong value"}]']) {
      fs.writeFileSync(second, value);
      assert.equal(cli().code, 1);
    }
  } finally { fs.rmSync(dir, {recursive: true, force: true}); }
});

// Run the actual journey callback with fixture reads and a fake clock; no browser or app starts.
async function journeyFailure(t, {head, showTab = true, state = null}) {
  t.mock.timers.enable({apis: ['Date', 'setTimeout']});
  let failure;
  const tab = {url: () => REVEAL.url, evaluate: async fn => {
    if (String(fn).includes('window.got')) return {name: 'cv.pdf', size: 10};
    if (String(fn).includes('Object.fromEntries')) return {};
    return state;
  }};
  const ctx = {browser: {context: {pages: () => showTab ? [tab] : []}}, run: async (name, step) => {
    if (!name.startsWith(head)) return;
    stepClock(3000);
    try { await step(); } catch (error) { failure = error; } finally { stepClock(null); }
  }};
  let settled = false;
  const pending = runJourneys(ctx, {page: {evaluate: async () => {}}, forms: {fired: []}, cv: {name: 'cv.pdf', size: 10}, dumpExtension: async () => {}, fail: problems => {
    if (problems.length) throw new Error(problems.join('; '));
  }}).finally(() => { settled = true; });
  for (let tick = 0; !settled && tick < 20; tick++) { await new Promise(setImmediate); t.mock.timers.tick(500); }
  assert.equal(settled, true, 'uses the step cap, not the old 60/90-second inline clock');
  await pending;
  assert.ok(failure, 'the step must report the missing state or wrong value');
  return failure.message;
}

// Exact incident notes are controls: fix their producers without teaching G5 another phrase list.
for (const [head, original, showTab] of [
  ['an upload slot that appears only', "the fill did not finish (state: null); the + slot never received a file; the first name was not filled; Kubernetes years is not the kit's 8", true],
  ['a form drawn after a spinner', 'the late form was never reached. Tabs: ...', false],
]) test(`a stalled journey reports timing without fallout: ${head}`, async t => {
  assert.equal(flakyProof(original).flaky, false, 'the historical note has no proof that its wait expired');
  const message = await journeyFailure(t, {head, showTab});
  assert.equal(flakyProof(message).flaky, true, message);
  assert.match(flakyProof(message).why, /^timing:/);
  assert.doesNotMatch(message, /slot never received|first name was not filled|Kubernetes years/);
  const failures = [{step: head, message}];
  assert.deepEqual(unproved(failures), [], 'a passing retry has timing proof');
  assert.equal(greyProof(failures, failures).grey, true, 'two stalled tries are grey');
});

for (const state of ['done', 'error', 'stopped']) test(`a reported ${state} stays a wrong value on either try`, async t => {
  const message = await journeyFailure(t, {head: 'an upload slot that appears only', state: {state}});
  if (state === 'done') assert.match(message, /the first name was not filled; Kubernetes years is not the kit's 8/);
  else assert.equal(message, `state: {"state":"${state}"}`);
  const failures = [{step: 'filled form', message}];
  assert.equal(flakyProof(message).flaky, false);
  assert.equal(unproved(failures).length, 1);
  assert.equal(greyProof(failures, failures).grey, false);
});
