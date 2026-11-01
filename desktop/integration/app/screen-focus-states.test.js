/* global document, window */
// Focus, layer 2: the two states of the e2e `focus` suite that start from other records than its dummy search: rows edited by hand, and a fresh account.
// Same path as screen-focus.test.js: a seeded SQLite store, the engine's payload, the app's window on it.
import assert from 'node:assert/strict';
import {after, before, test} from 'node:test';
import {HAND_EDITS, compareNumbers, expectedNumbers, scenario} from '../../e2e/lib/focus-data.mjs';
import {focusKit} from './screen-focus-kit.js';
import {needsElectron} from '../../test/needs-electron.js';
import {newStore, seed} from './screen-store.js';
import {probeWindow} from './window-probe.js';

const NOW = new Date();
const ERROR_WORDS = /\b(undefined|null|NaN|\[object|TypeError|Traceback|ENOENT|ECONN|could not load|stack)\b/i;
const live = {skip: needsElectron.skip};
let hand, fresh;

// What the window shows for a payload, after the page has drawn it once more (a refresh) with the window's errors watched.
const readScript = async kit => {
  const errors = [];
  window.addEventListener('error', event => errors.push(event.message));
  window.addEventListener('unhandledrejection', event => errors.push(String(event.reason)));
  await kit.until(() => document.querySelector('.nav[data-view=focus]:not([hidden])'), 'the menu');
  await kit.open();
  await kit.refresh();
  kit.showAll();
  const text = document.querySelector('.view[data-view="focus"]').innerText;
  return {errors, text, severe: kit.severe('focus'), numbers: kit.numbers(), upNext: kit.upNext(), suggested: kit.suggested(), all: kit.all(),
    page: {skeleton: !!document.querySelector('.view[data-view="focus"] .skeleton'), funnel: !document.querySelector('#focus-funnel').hidden, inbound: !document.querySelector('#focus-inbound').hidden,
      funnelEmpty: document.querySelector('#focus-funnel').classList.contains('is-empty'), funnelHint: document.querySelector('#funnel-empty').hidden ? '' : document.querySelector('#funnel-empty').textContent.trim(),
      insight: [...document.querySelectorAll('#focus-suggestions-list [data-suggestion]')].some(li => !kit.DRAWERS.includes(li.dataset.suggestion)),
      empty: !document.querySelector('#focus-empty').hidden, summary: document.querySelector('#focus-summary').textContent.trim()}};
};

before(() => {
  const handStore = newStore(), freshStore = newStore();
  try {
    // The Focus suite's dummy search, then what people type into the tracker by hand (5 Oct 2026): a stage the app has no word for, an empty title, a 2,000-character note, other scripts.
    seed(handStore, scenario(NOW));
    for (const {stage, ...job} of HAND_EDITS) handStore.call('applications', 'create', {job, stage});
    const handRows = handStore.call('applications', 'list', {}), handEvents = handStore.call('events', 'list', {});
    const handPayload = handStore.engine('src.focus'), freshPayload = freshStore.engine('src.focus');
    hand = {rows: handRows, events: handEvents};
    if (needsElectron.skip) return;
    hand.read = probeWindow({use: [focusKit], settings: {store: 'sqlite'}, files: {'focus.json': handPayload}, script: readScript});
    fresh = {read: probeWindow({use: [focusKit], settings: {store: 'sqlite'}, files: {'focus.json': freshPayload}, script: readScript})};
  } finally { handStore.remove(); freshStore.remove(); }
});
after(() => {});

test('rows edited by hand (an unknown stage, an empty title, a very long note, other scripts) leave Focus working and its numbers right', live, () => {
  assert.equal(hand.rows.length, 12, 'the store holds the dummy search and the two hand-edited rows');
  const {result} = hand.read;
  assert.deepEqual(result.severe, [], 'Focus shows technical text or breaks its layout after the hand edits');
  assert.deepEqual(result.errors, [], 'the window threw after the hand edits');
  assert.equal(ERROR_WORDS.test(result.text), false, 'error-like text on Focus after the hand edits');
  assert.deepEqual(compareNumbers(result.numbers, expectedNumbers(hand.rows, hand.events, {now: NOW, target: 5})), []);
});

test('a fresh account gets a helpful Focus: nothing urgent, one suggested next step, zeros, a funnel that says it fills in later, no insight, no raw errors', live, () => {
  const {result} = fresh.read;
  assert.deepEqual(result.upNext, [], 'a fresh account has nothing that can\'t wait');
  assert.equal(result.suggested.length, 1, `exactly one suggested next step, it sees: ${result.suggested.map(item => item.headline).join(' | ') || 'nothing'}`);
  const [step] = result.suggested;
  assert.ok(step.headline.startsWith('Apply to your next role'), step.headline);
  assert.match(step.meta, /Prepare kits from your best matches/);
  assert.ok(step.buttons.includes('Browse jobs'));
  assert.equal(result.page.skeleton, false, 'a skeleton is still showing');
  assert.equal(result.page.inbound, false, 'an Inbound funnel is drawn although nothing found this account');
  assert.deepEqual([result.page.funnel, result.page.funnelEmpty, result.page.funnelHint], [true, true, 'Fills in as you prepare and send applications.']);
  assert.equal(result.page.insight, false, 'Suggestions show an insight with nothing to say');
  assert.equal(result.page.empty, true, 'Up next is empty but does not say "Nothing waits for you right now"');
  assert.equal(ERROR_WORDS.test(result.text), false);
  assert.ok(result.page.summary, 'the focus summary is empty on a fresh account');
  assert.deepEqual(compareNumbers(result.numbers, expectedNumbers([], [], {now: NOW, target: 5})), []);
  assert.deepEqual(result.errors, []);
});

test('Focus renders without layout problems, without data', live, () => {
  assert.deepEqual(fresh.read.result.severe, []);
});
