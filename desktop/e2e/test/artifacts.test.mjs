// What a suite leaves for the nightly loop even when it stops early: its layout findings so far (C) and the steps that failed (B).
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {test} from 'node:test';
import {annotationLines, codeLine, failureRecords, writeFindings, writeSuiteFailures} from '../lib/artifacts.mjs';

const dir = () => fs.mkdtempSync(path.join(os.tmpdir(), 'artifacts-'));
const results = [{name: 'a step that passed', status: 'passed'}, {name: 'a step that failed', status: 'failed', note: 'x'.repeat(900)}, {name: 'a skipped step', status: 'skipped'}];

test('only failed steps become records, with a message cut to a readable length', () => {
  const records = failureRecords('activity', results);
  assert.equal(records.length, 1);
  assert.deepEqual([records[0].suite, records[0].step], ['activity', 'a step that failed']);
  assert.equal(records[0].message.length, 600);
});

test('the findings so far are written even when the suite never reached its last step', () => {
  const ARTIFACTS = dir();
  writeFindings({ARTIFACTS, findings: [{view: 'actions', severity: 'warning', kind: 'clipped-text', detail: 'cut off'}]});
  assert.equal(JSON.parse(fs.readFileSync(path.join(ARTIFACTS, 'ui-findings.json'), 'utf8')).length, 1);
});

test('suite-failures.json is written every run: the failed steps, or an empty list', () => {
  const failed = dir(), clean = dir();
  writeSuiteFailures(failed, 'activity', results);
  writeSuiteFailures(clean, 'activity', results.filter(result => result.status !== 'failed'));
  assert.equal(JSON.parse(fs.readFileSync(path.join(failed, 'suite-failures.json'), 'utf8')).length, 1);
  assert.deepEqual(JSON.parse(fs.readFileSync(path.join(clean, 'suite-failures.json'), 'utf8')), []);
});

test('each failed step is a GitHub annotation "<suite> · <step>" with its first line, escaped, at most 3; only on GitHub', () => {
  const records = [{suite: 'quality', step: 'golden: a, b', message: '3 AI question(s) had no recorded answer: 50%\nsecond line'}, ...['x', 'y', 'z'].map(step => ({suite: 's', step, message: ''}))];
  const lines = annotationLines(records);
  assert.equal(lines.length, 3);
  assert.equal(lines[0], '::error title=quality · golden%3A a%2C b::3 AI question(s) had no recorded answer: 50%25');
  assert.equal(lines[1], '::error title=s · x::failed');
  const printed = [], log = console.log;
  console.log = line => printed.push(line);
  try {
    writeSuiteFailures(dir(), 'quality', [{name: 'a step that failed', status: 'failed', note: 'why'}], {});
    assert.deepEqual(printed, [], 'not on GitHub: no annotation');
    writeSuiteFailures(dir(), 'quality', [{name: 'a step that failed', status: 'failed', note: 'why'}], {GITHUB_ACTIONS: 'true'});
    assert.deepEqual(printed, ['::error title=quality · a step that failed::why']);
  } finally { console.log = log; }
});

test('an unexpected error names its first line in our code, and the failure record carries it (#2266: "Unexpected end of JSON input" with no file)', () => {
  let thrown;
  try { JSON.parse(''); } catch (error) { thrown = error; }
  assert.match(codeLine(thrown), /^desktop\/e2e\/test\/artifacts\.test\.mjs:\d+:\d+$/);
  assert.equal(codeLine(new Error('the step\'s own check failed')), '', 'a step\'s own message needs no line');
  assert.equal(codeLine('not an error'), '');
  const [record] = failureRecords('apply', [{name: 'a step', status: 'failed', note: 'Unexpected end of JSON input', where: 'desktop/e2e/lib/x.mjs:3:9'}]);
  assert.equal(record.where, 'desktop/e2e/lib/x.mjs:3:9');
  assert.equal('where' in failureRecords('apply', [{name: 'a step', status: 'failed', note: 'why'}])[0], false);
});
