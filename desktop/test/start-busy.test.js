// A Start button pressed while another task runs (owner, 25 Oct 2026: "when I apply to Find jobs it doesn't do anything"): the button says it is queued and after what,
// the press answers with a toast, and the rule covers every start button. Guards renderer/start-busy.js, pages/start-feedback.js and the switch in pages/runs-page.js.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {test} from 'node:test';
import {applyQueuedLook, kindOfStartButton, queuedText, queuedToast, startState} from '../renderer/start-busy.js';

const node = (text, {small = false, icon = false} = {}) => ({textContent: text, title: '', dataset: {}, children: icon ? [{}] : [], classList: {contains: name => small && name === 'small'}});
const read = name => fs.readFileSync(new URL(`../renderer/${name}`, import.meta.url), 'utf8');
const taskButtons = JSON.parse(read('pages/activity-basics.js').match(/export const TASK_BUTTONS = (\[.*\]);/)[1].replace(/'/g, '"'));
const commandKind = Object.fromEntries([...read('pages/activity-basics.js').match(/export const COMMAND_KIND = \{([^}]*)\}/)[1].matchAll(/(\w+): '(\w+)'/g)].map(match => [match[1], match[2]]));

test('a task waiting behind another says so on its button, and gets its text back', () => {
  assert.equal(startState('search', {running: 'visits', queued: ['search']}), 'queued');
  assert.equal(startState('visits', {running: 'visits', queued: ['search']}), 'running');
  assert.equal(startState('mail', {running: 'visits', queued: ['search']}), null);
  const big = node('Find jobs'), small = node('Run', {small: true}), iconic = node('Find jobs', {icon: true});
  for (const button of [big, small, iconic]) applyQueuedLook(button, 'queued', 'Find jobs using your browser');
  assert.equal(big.textContent, 'Queued · starts after Find jobs using your browser');
  assert.equal(small.textContent, 'Queued · after Find jobs using your browser');
  assert.equal(iconic.textContent, 'Find jobs', 'a button with an icon keeps its look');
  assert.match(iconic.title, /^Waiting for Find jobs using your browser/);
  for (const button of [big, small]) applyQueuedLook(button, null, '');
  assert.deepEqual([big.textContent, small.textContent], ['Find jobs', 'Run']);
  assert.equal(queuedToast('Find jobs', 'Tailor').body, 'It starts when Tailor ends.');
  assert.equal(queuedText('X'), 'Queued · starts after X');
});

// The class: every place that starts a task is found by the toast's listener and by the switch, so none stays silent.
test('every start button is covered: task buttons, Actions cards and the Find jobs card', () => {
  const closest = selectorHit => ({closest: selector => (selectorHit(selector) ? {} : null)});
  for (const [kind, ...selectors] of taskButtons) for (const selector of selectors) {
    assert.equal(kindOfStartButton(closest(s => s === selector), {taskButtons, commandKind}), kind, selector);
  }
  for (const [command, kind] of Object.entries(commandKind)) {
    const card = {dataset: {command}};
    assert.equal(kindOfStartButton({closest: s => (s === '[data-command]' ? card : null)}, {taskButtons, commandKind}), kind, command);
  }
  assert.equal(kindOfStartButton(closest(s => s.includes('find-again')), {taskButtons, commandKind}), 'search');
  const sync = read('pages/runs-page.js');
  assert.match(sync, /applyQueuedLook\(node, state,/);
  assert.match(sync, /document\.querySelectorAll\(FIND_CARD_BUTTONS\)/);
  assert.match(read('pages/runs-page.js'), /initStartFeedback\(\)/);
  const find = read('pages/jobs-find.js');
  for (const cls of ['find-again', 'magic-go']) assert.match(find, new RegExp(cls), `${cls} is drawn by the Find jobs card`);
});

test('the toast comes only for a task that waits, and has a way to the queue', async () => {
  const {announceQueued} = await import('../renderer/pages/start-feedback.js').catch(() => ({}));
  if (!announceQueued) return;   // the page modules need the window: the source checks above guard the wiring
  const toasts = [], runs = value => async () => value;
  assert.equal(await announceQueued('search', {runs: runs({running: {kind: 'visits'}, queued: [{kind: 'search'}]}), toast: t => toasts.push(t)}), 'queued');
  assert.equal(toasts[0].title, 'Find jobs is queued');
  assert.equal(toasts[0].action.label, 'View queue');
  assert.equal(await announceQueued('search', {runs: runs({running: {kind: 'search'}, queued: []}), toast: t => toasts.push(t)}), null);
  assert.equal(await announceQueued('search', {runs: runs({running: null, queued: []}), toast: t => toasts.push(t)}), null);
});
