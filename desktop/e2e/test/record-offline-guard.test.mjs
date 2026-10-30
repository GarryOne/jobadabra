// Record plans reject offline AI suites by name before launching any suite or spending AI credit.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {test} from 'node:test';
import {planRun} from '../plan-run.mjs';

const plan = (mode, only = 'offline', extra = {}) => planRun({
  env: {EVENT: 'workflow_dispatch', REPO: 'o/r', SHA: 'a'.repeat(40), ONLY: only, AI_ANSWERS: mode, ...extra},
  gh: () => '[]', all: ['offline', 'live'], offlineAi: ['offline'], backbone: ['offline'], minutes: () => 15,
});

test('record mode rejects the selected suite that declares offlineAi with recovery instructions', async () => {
  await assert.rejects(plan('record'), {
    message: 'suite offline declares offlineAi, so it cannot record: record from a branch where it does not declare it, then declare it',
  });
});

test('the same offline suite still plans in backbone mode', async () => {
  const out = await plan('backbone');
  assert.equal(out.suites, 'offline');
  assert.equal(JSON.parse(out.matrix).include[0].aiAnswers, 'backbone');
});

test('a suite without offlineAi still plans in record mode, even when another suite is offline', async () => {
  const out = await plan('record', 'live');
  assert.equal(out.suites, 'live');
  assert.equal(out.count, '1');
});

test('burn-in legs still use backbone even when the dispatch requests record', async () => {
  const out = await plan('record', 'offline', {PR_SUITES: 'offline', PR_STEPS: '{"(burn-in)":["offline"]}'});
  assert.equal(out.count, '5');
  assert.ok(JSON.parse(out.matrix).include.every(leg => leg.burnIn));
});

test('the workflow supplies the planner only the first manual dispatch record request', () => {
  const workflow = fs.readFileSync(new URL('../../../.github/workflows/e2e.yml', import.meta.url), 'utf8');
  const planner = workflow.split('      - name: What to run (suites, commit, AI review, release to promote)')[1].split('        shell:')[0];
  assert.match(planner, /AI_ANSWERS: \$\{\{ github\.event_name == 'workflow_dispatch' && github\.run_attempt == 1 && inputs\.ai_answers == 'record' && 'record' \|\| 'off' \}\}/);
});
