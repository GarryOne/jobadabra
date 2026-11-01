// The AI explorer, with a fake AI and a fake page: it only does what the probe may press, stops at its limits, hands a bug to a replay that needs no AI, and a bug whose check
// does not hold again is not a finding.
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {CHECKS, allowed, explore, formatObservation, replay, segmentFor, stepWords, tools} from '../../lib/explore.mjs';
import {normalize, issueTitle} from '../../lib/triage.mjs';

const seen = {view: 'jobs', text: 'Jobs\nNo jobs yet', overlays: [], controls: [
  {i: 0, kind: 'button', label: 'Sort by name', disabled: false, cls: '', href: '', type: ''},
  {i: 1, kind: 'button', label: 'Delete all jobs', disabled: false, cls: '', href: '', type: ''},
  {i: 2, kind: 'field', label: 'Search', disabled: false, cls: '', href: '', type: 'text'},
  {i: 3, kind: 'field', label: 'Key', disabled: false, cls: '', href: '', type: 'password'}]};
const reply = (...blocks) => ({content: blocks.map((block, n) => ({type: 'tool_use', id: `t${n}`, ...block})), usage: {input_tokens: 1000, output_tokens: 100}});
const fakeAct = (log = []) => ({observe: async () => seen, click: async i => log.push(['click', i]), type: async (i, text) => log.push(['type', i, text]), press: async key => log.push(['press', key]), go: async view => log.push(['go', view]),
  readText: async () => 'Jobs No jobs yet', errorMark: () => 0, errorsSince: () => [], measure: async () => ({changed: false, calls: 0}), log});

test('what it may press is what the probe may press: no delete, no password field', () => {
  assert.deepEqual(seen.controls.map(allowed), [true, false, true, false]);
  assert.match(formatObservation(seen), /1 · button · Delete all jobs \[not allowed\]/);
  assert.match(formatObservation(seen), /3 · field · Key \[not allowed\]/);
});

test('a refused control is never pressed; an allowed one is; the run ends on done', async () => {
  const act = fakeAct();
  const answers = [reply({name: 'click', input: {control: 1}}), reply({name: 'go', input: {view: 'jobs'}}, {name: 'click', input: {control: 0}}), reply({name: 'done', input: {}})];
  const result = await explore({act, ask: async () => answers.shift(), views: ['jobs'], maxSteps: 10});
  assert.deepEqual(act.log, [['go', 'jobs'], ['click', 0]]);
  assert.equal(result.stopped, 'done');
});

test('it stops at the step limit and at the budget, and counts what it spent', async () => {
  const forever = async () => reply({name: 'press', input: {key: 'Escape'}});
  assert.equal((await explore({act: fakeAct(), ask: forever, views: [], maxSteps: 3})).stopped, 'steps');
  const spent = await explore({act: fakeAct(), ask: forever, cost: () => 0.3, views: [], maxSteps: 10, maxUsd: 0.5});
  assert.match(spent.stopped, /budget/);
  assert.ok(spent.usd >= 0.5 && spent.usd < 1);
});

test('an API refusal ends the run and nothing is trusted from it', async () => {
  const result = await explore({act: fakeAct(), ask: async () => { throw new Error('400 credit balance is too low'); }, views: [], maxSteps: 5});
  assert.match(result.stopped, /^api: 400/);
});

test('a report needs a check a script can verify; its steps start at the latest go', async () => {
  const answers = [reply({name: 'go', input: {view: 'jobs'}}), reply({name: 'click', input: {control: 0}}), reply({name: 'go', input: {view: 'focus'}}), reply({name: 'click', input: {control: 0}}),
    reply({name: 'report_bug', input: {title: 'Sort does nothing', kind: 'functionality', severity: 'high', what: 'x', check: {type: 'vibes'}}}),
    reply({name: 'report_bug', input: {title: 'Sort does nothing', kind: 'functionality', severity: 'high', what: 'x', check: {type: 'dead_control', control: 'Sort by name'}}}), reply({name: 'done', input: {}})];
  const result = await explore({act: fakeAct(), ask: async () => answers.shift(), views: ['jobs', 'focus'], maxSteps: 10});
  assert.equal(result.bugs.length, 1, 'the check "vibes" is refused');
  assert.deepEqual(result.bugs[0].steps.map(step => step.tool), ['go', 'click']);
  assert.equal(result.bugs[0].steps[0].view, 'focus');
  assert.deepEqual(CHECKS, ['text_visible', 'text_missing', 'console_error', 'dead_control']);
  assert.ok(tools(['jobs']).some(tool => tool.name === 'report_bug'));
});

test('a replay needs no AI: each check holds or does not', async () => {
  const bug = check => ({steps: [{tool: 'go', view: 'jobs'}, {tool: 'click', label: 'Sort by name', kind: 'button'}], check});
  assert.equal((await replay({act: fakeAct(), bug: bug({type: 'text_visible', text: 'No jobs yet'})})).reproduced, true);
  assert.equal((await replay({act: fakeAct(), bug: bug({type: 'text_visible', text: 'Something else'})})).reproduced, false);
  assert.equal((await replay({act: fakeAct(), bug: bug({type: 'text_missing', text: 'Something else'})})).reproduced, true);
  assert.equal((await replay({act: fakeAct(), bug: bug({type: 'text_visible', text: '  '})})).reproduced, false, 'an empty text proves nothing');
  assert.equal((await replay({act: fakeAct(), bug: bug({type: 'console_error'})})).reproduced, false);
  assert.equal((await replay({act: fakeAct(), bug: bug({type: 'dead_control', control: 'Sort by name'})})).reproduced, true);
  const gone = await replay({act: fakeAct(), bug: {steps: [{tool: 'click', label: 'Nothing here', kind: 'button'}], check: {type: 'console_error'}}});
  assert.equal(gone.reproduced, false);
  assert.match(gone.why, /not on the page/);
});

test('the steps read as a person would say them', () => {
  assert.equal(stepWords({tool: 'go', view: 'jobs'}), 'Open jobs');
  assert.equal(stepWords({tool: 'click', label: 'Sort'}), 'Press "Sort"');
  assert.equal(segmentFor([{tool: 'go', view: 'a'}, {tool: 'click', label: 'x'}, {tool: 'go', view: 'b'}, {tool: 'click', label: 'y'}], 4).length, 2);
});

test('a proved explorer report becomes a finding with its own source, title and a capped severity', () => {
  const [finding] = normalize({ui: [{view: 'jobs', severity: 'high', kind: 'layout', title: 'Sort button is cut off', detail: 'It is cut off. Replayed without AI.', source: 'explorer'}]});
  assert.equal(finding.source, 'explorer');
  assert.equal(finding.severity, 'medium', 'a layout finding is never high, whatever the AI said');
  assert.match(issueTitle(finding), /layout on jobs: Sort button is cut off/);
  const [wrong] = normalize({ui: [{view: 'jobs', severity: 'high', kind: 'functionality', title: 'Sort does nothing', detail: 'Pressing it changes nothing.', source: 'explorer'}]});
  assert.equal(wrong.severity, 'high');
});
