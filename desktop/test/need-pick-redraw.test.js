// A pick made in a "Needs your attention" row survives the page's redraws until Use (applyflows run 40526061842, 27 Oct 2026: "2 months" picked,
// a redraw built a new box from the empty proposal, Use read "" and the row said "Write an answer first"). Plays pick → redraw → Use on the real row.
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {install} from './tiny-dom.js';
import {rowPicks} from '../renderer/proposal-pick.js';

const body = install();
for (const id of ['job-drawer-backdrop', 'ss-loading', 'ss-empty', 'ss-grid', 'ss-refreshing', 'ss-title', 'ss-role', 'ss-status', 'ss-more']) { const node = globalThis.document.createElement('div'); node.id = id; body.append(node); }   // elements the page's modules look up when imported
for (const name of ['setInterval', 'setTimeout']) { const real = globalThis[name]; globalThis[name] = (...args) => real(...args).unref(); }   // timers the page starts (usage-signals.js on import, Use's 5 s check) must not hold the test open
const filled = [];
globalThis.window.pilot = new Proxy({sessionFillField: async (id, label, value) => { filled.push([id, label, value]); return {ok: true}; }}, {get: (all, key) => all[key] || (async () => ({ok: true}))});
const {proposedRow} = await import('../renderer/pages/need-proposal.js');

const item = {id: 's1'}, label = 'Notice period';
const proposal = {value: '', options: ['Immediately', '1 month', '2 months'], from: 'None of this form\'s choices means "3 months": pick one', source: 'fill_tried', original: '3 months'};
const useOf = row => row.querySelectorAll('button').find(button => button.textContent === 'Use');

test('a redraw between the pick and Use keeps the pick: Use fills "2 months", not "Write an answer first"', async () => {
  filled.length = 0;
  const first = proposedRow(item, label, proposal);
  const menu = first.querySelector('select');
  menu.value = '2 months'; menu.dispatch('change');            // the person picks
  const redrawn = proposedRow(item, label, {...proposal});     // the page redraws before Use (late proposals, contact, choice lookup)
  assert.equal(redrawn.querySelector('select').value, '2 months');
  useOf(redrawn).click();
  await new Promise(resolve => setImmediate(resolve));
  assert.deepEqual(filled, [['s1', label, '2 months']]);
  assert.equal(proposedRow(item, label, {...proposal}).querySelector('select').value, '2 months');   // Use done: the form's value now comes from the `used` record
});

test('a typed answer in a text box survives a redraw too', () => {
  const first = proposedRow(item, 'Phone', {value: '', key: 'phone', from: 'x', source: 'empty'});
  const box = first.querySelector('input'); box.value = '+41 79 1'; box.dispatch('input');
  assert.equal(proposedRow(item, 'Phone', {value: '', key: 'phone', from: 'x', source: 'empty'}).querySelector('input').value, '+41 79 1');
});

test('rowPicks: start from the fallback until the person picks; forget returns to it', () => {
  const picks = rowPicks();
  assert.equal(picks.start('k', 'a'), 'a');
  picks.note('k', 'b'); assert.equal(picks.start('k', 'a'), 'b');
  picks.forget('k'); assert.equal(picks.start('k', 'a'), 'a');
});
