// block-check.mjs --no-ai: the beta's gate keeps the deterministic layout findings and ignores an AI review's findings (owner, 1 Nov 2026).
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {blocking} from '../../block-check.mjs';
import {normalize} from '../../lib/triage.mjs';

const aiFinding = {view: 'settings', severity: 'high', kind: 'functionality', title: 'Save does nothing', detail: 'Clicking Save leaves the form as it was'};
const layoutFinding = {view: 'jobs', severity: 'severe', kind: 'overflow', detail: 'the page scrolls sideways'};   // a suite's own layout check: 'severe' is high

function artifacts() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'block-check-'));
  fs.mkdirSync(path.join(dir, 'e2e-artifacts-jobs'));
  fs.mkdirSync(path.join(dir, 'e2e-artifacts-review'));
  fs.writeFileSync(path.join(dir, 'e2e-artifacts-jobs', 'ui-findings.json'), JSON.stringify([layoutFinding]));
  fs.writeFileSync(path.join(dir, 'e2e-artifacts-review', 'ai-findings.json'), JSON.stringify({findings: [aiFinding]}));
  return dir;
}

test('--no-ai: a layout-check finding still blocks, an AI finding that is a confirmed open issue no longer does', () => {
  const dir = artifacts();
  const [ai] = normalize({ai: [aiFinding]});
  const confirmed = {number: 7, state: 'OPEN', title: '[auto-ui] settings: Save does nothing', body: '**HIGH** · functionality · found by the AI screenshot review',
    labels: [{name: 'auto-ui'}, {name: `fp:${ai.id}`}, {name: 'confirmed'}], comments: []};
  const withAi = blocking({artifacts: dir, issues: [confirmed]});
  assert.deepEqual(withAi.map(item => item.source).sort(), ['ai-review', 'layout-check'], 'positive control: with AI findings both block');
  const withoutAi = blocking({artifacts: dir, issues: [confirmed], ai: false});
  assert.deepEqual(withoutAi.map(item => item.source), ['layout-check']);
});
