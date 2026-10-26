// "Flaky" needs proof (gate G5): lib/flaky-proof.mjs, flaky-proof.mjs, triage's closing rule and every CI rerun step.
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {test} from 'node:test';
import {fileURLToPath} from 'node:url';
import {INTERMITTENT, flakyProof, intermittentComment, labelRerun, unproved} from '../lib/flaky-proof.mjs';
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
  assert.equal(cli(path.join(dir, 'missing.json')).code, 0, 'no file: nothing to judge, said');
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
  }
});

function fileURLToDir() { return path.dirname(fileURLToPath(import.meta.url)); }
