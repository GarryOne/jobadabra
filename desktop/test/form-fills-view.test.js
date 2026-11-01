// Reports → Form fills, its reading of one agent run (renderer/form-fills-view.js), fed by each producer's OWN writer: the extension's
// runRecord (shared/app-core/extension.js) and an Apply with Claude session's numbers (lib/session-stats.js plain). A shape change on either
// side fails here, so both paths keep the screen's features (the field table, Left for you, steps / timeline, numbers, outcome).
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {shortDay} from '../renderer/date.js';
import * as stats from '../lib/session-stats.js';
import {runRecord} from '../shared/app-core/extension.js';
import {agentOf, fieldRows, filterRuns, learnings, leftForYou, listLine, outcomeTone, sessionNumbers, steps, summary, timeline} from '../renderer/form-fills-view.js';

const fill = {url: 'https://boards.greenhouse.io/acme/jobs/1', started: '2026-10-09T10:00:00Z', ended: '2026-10-09T10:03:00Z', fields: 2, unfilled: 1, kit: true,
  todo: ['Portfolio'], trace: [{label: 'Email', required: true, source: 'your details', outcome: 'filled', reason: 'typed'},
    {label: 'Portfolio', required: true, source: '', outcome: 'skipped', reason: 'no answer', low: 'low confidence'}],
  debug: {steps: [{step: 'read form', ms: 1500}]}};
const fromExtension = {id: 'r1', ...runRecord(fill, {title: 'Engineer', company: 'Acme'})};
const session = {url: 'https://acme.example/apply', outcome: 'submitted', startedAt: '2026-10-09T10:00:00.000Z', decidedAt: '2026-10-09T10:20:00.000Z',
  events: [{at: '2026-10-09T10:00:00.000Z', status: 'working'}, {at: '2026-10-09T10:15:00.000Z', status: 'ready'}]};
const {outcome, ...numbers} = stats.plain(session, {now: Date.parse('2026-10-09T10:20:00Z')});
const fromSession = {id: 'r2', url: session.url, ats: 'Claude', outcome, learnings: '', fields: {...numbers, agent: 'Claude', job: 'Lead', company: 'Acme'}};

test('an extension fill: outcome, field table with source and low confidence, Left for you, steps, learnings', () => {
  const s = summary(fromExtension);
  assert.deepEqual([s.title, s.company, s.agent, s.outcome, s.tone, s.fields, s.left], ['Engineer', 'Acme', 'Extension', 'Needs input', 'warn', 2, 1]);
  assert.deepEqual(fieldRows(fromExtension).map(row => [row.label, row.required, row.source, row.result, row.low]),
    [['Email', 'yes', 'your details', 'filled', false], ['Portfolio', 'yes', '—', 'left', true]]);
  assert.deepEqual(leftForYou(fromExtension), ['Portfolio']);
  assert.deepEqual(steps(fromExtension), [{step: 'read form', seconds: 1.5}]);
  assert.ok(learnings(fromExtension)[0].startsWith('1 left'));
  assert.deepEqual(timeline(fromExtension), []);
});

test('an Apply with Claude session: outcome, its numbers and its status timeline; no field table needed', () => {
  const s = summary(fromSession);
  assert.equal(s.agent, 'Claude session');
  assert.equal(s.outcome, 'Submitted');
  assert.equal(s.tone, 'good');
  assert.deepEqual(timeline(fromSession), ['10:00:00 working', '10:15:00 ready']);
  const labels = sessionNumbers(fromSession).map(([label]) => label);
  assert.ok(labels.includes('Working') && labels.includes('Times asked'), labels.join());
  assert.deepEqual(fieldRows(fromSession), []);
});

test('the list filter and the tones', () => {
  assert.deepEqual(filterRuns([fromExtension, fromSession], {text: 'session'}).map(run => run.id), ['r2']);
  assert.deepEqual(filterRuns([fromExtension, fromSession], {outcome: 'Needs input'}).map(run => run.id), ['r1']);
  assert.equal(outcomeTone('Ready'), 'good');
  assert.equal(outcomeTone('Cancelled'), 'neutral');
  assert.equal(agentOf({ats: 'Claude', fields: {}}), 'Claude session');
  assert.equal(summary({url: 'https://www.acme.example/x', fields: {}}).title, 'acme.example');   // a fill of an untracked job
});

test('the tab\'s meta line: how many, how many wait for you, the latest day; "N of M" while filtered', () => {
  const runs = [{outcome: 'Ready', created_at: '2026-10-09T11:12:00Z'}, {outcome: 'Needs input', created_at: '2026-10-08T17:40:00Z'},
    {outcome: 'Submitted', created_at: '2026-10-07T13:02:00Z'}];
  assert.equal(listLine(runs), `3 form fills · 1 needs input · latest ${shortDay('2026-10-09T11:12:00Z')}`);
  assert.equal(listLine(runs, runs.slice(0, 1)), `1 of 3 form fills · 1 needs input · latest ${shortDay('2026-10-09T11:12:00Z')}`);
  assert.equal(listLine([]), '0 form fills');
});

test('withTimeout: a quick answer passes, a read that never answers becomes an error', async () => {
  const {withTimeout} = await import('../renderer/form-fills-view.js');
  assert.deepEqual(await withTimeout(Promise.resolve({runs: []}), 50), {runs: []});
  assert.deepEqual(await withTimeout(new Promise(() => {}), 20), {error: 'no answer after 0.02 s'});
});
