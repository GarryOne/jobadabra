// Environment failures (#266) are retried once and never filed; one problem told twice in a run (#270, #271) is one issue.
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {isEnvironment} from '../../lib/environment.mjs';
import {createRunner} from '../../lib/runner.mjs';
import {mergeSameRun, normalize} from '../../lib/triage.mjs';
import {failureRecords} from '../../lib/artifacts.mjs';

process.env.E2E_RETRY_WAIT_MS = '0';

test('an HTML error page or a dropped connection is the environment; a product failure or an injected AI refusal is not', () => {
  assert.ok(isEnvironment(`Unexpected token '<', "<!DOCTYPE "... is not valid JSON`));
  assert.ok(isEnvironment('fetch failed'));
  assert.ok(isEnvironment('Notion answered 502 Bad gateway'));
  assert.ok(!isEnvironment('the list says "Completed" and the panel "Failed"'));
  assert.ok(!isEnvironment('raw API words are shown: "rate_limit_error"'));
});

test('a step that failed on the environment is tried once more; failing twice it is marked, never retried for a product failure', async () => {
  const runner = createRunner(() => null);
  let tries = 0;
  await runner.run('flaky setup', async () => { if (++tries === 1) throw new Error('fetch failed'); });
  assert.equal(tries, 2);
  assert.equal(runner.results[0].status, 'passed');
  assert.match(runner.results[0].retried, /fetch failed/);
  let product = 0;
  await assert.rejects(runner.run('wrong count', async () => { product++; throw new Error('expected 3, saw 2'); }));
  assert.equal(product, 1, 'a product failure is not retried');
  await assert.rejects(runner.run('notion down', async () => { throw new Error("Unexpected token '<'"); }));
  const records = failureRecords('focus', runner.results);
  assert.deepEqual(records.map(item => [item.step, !!item.environment]), [['wrong count', false], ['notion down', true]]);
});

test('two AI findings of one page and kind in one run become one issue, the others listed in its detail', () => {
  const ai = [
    {view: 'app-chrome', kind: 'layout', severity: 'medium', title: 'Sidebar navigation clipped at small window', detail: 'a'},
    {view: 'app-chrome', kind: 'layout', severity: 'medium', title: 'Sidebar nav item cut off at small window', detail: 'b'},
    {view: 'jobs', kind: 'layout', severity: 'high', title: 'Row covered', detail: 'c', workaround: 'they must scroll sideways to read every row'},
  ];
  const out = normalize({ai});
  assert.equal(out.length, 2);
  assert.match(out.find(item => item.view === 'app-chrome').detail, /Also told on this page in the same run: "Sidebar nav item cut off at small window"/);
  const kept = mergeSameRun([{view: 'x', kind: 'text', severity: 'medium', title: 'm', detail: ''}, {view: 'x', kind: 'text', severity: 'high', title: 'h', detail: ''}]);
  assert.deepEqual(kept.map(item => item.title), ['h'], 'the most severe stays');
});
