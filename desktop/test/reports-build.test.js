// Fill reports name the extension build and come back on each newer build that still fails (desktop/lib/reports.js).
// Why: on 20 Oct 2026 the triage of 40 private issues found no report since 16 Oct named a build ("0.9": a development copy), and a field
// reported once was never heard of again, so a fixed field and an untried one looked the same.
import test from 'node:test';
import assert from 'node:assert/strict';
import {buildOf, build, newer} from '../lib/reports.js';
import {newer as workerNewer} from '../../app-core/src/report.js';

const run = version => ({url: 'https://boards.example.com/jobs/1', debug: {version, form: [{label: 'Country', type: 'combobox', options: []}]},
  trace: [{label: 'Country', required: true, reason: 'dropdown not clicked: the click failed'}]});

test('a development copy names the stamped build of the checkout it runs, marked -dev', () => {
  assert.equal(buildOf('0.9', '0.9.460'), '0.9.460-dev');
  assert.equal(buildOf('0.9.452', '0.9.460'), '0.9.452');   // a stamped copy says its own
  assert.equal(buildOf('0.9', ''), '0.9');                  // nothing better known
  assert.equal(build(run('0.9'), {}, {latest: '0.9.460'}).version, '0.9.460-dev');
});

test('a field reported before is reported again only from a newer build', () => {
  const reported = {'boards.example.com': ['country', 'country @0.9.448']};
  assert.equal(build(run('0.9.448'), reported), null);
  assert.equal(build(run('0.9.440'), reported), null);
  assert.deepEqual(build(run('0.9.460'), reported).fields.map(f => f.label), ['Country']);
  assert.ok(build(run('0.9.1'), {'boards.example.com': ['country']}), 'reported before builds were kept: a stamped build is news once');
});

test('the app and the Worker compare builds the same way', () => {
  const pairs = [['0.9.460', '0.9.448'], ['0.10.0', '0.9.999'], ['0.9.448', '0.9.448'], ['0.9', '0.9.448'], ['0.9.461-dev', '0.9.460'], ['0.9.1', ''], ['', '0.9.1'], ['1.0', '0.9.9']];
  for (const [a, b] of pairs) assert.equal(newer(a, b), workerNewer(a, b), `${a} vs ${b}`);
});
