// A job whose form tab is still open keeps ONE tab: every opener of a job's form reuses it (focus + the tab refills), never a second tab with the same
// session's mark (22 Oct 2026, beta run 8: Fill in Chrome pressed twice, two tabs flipped as the session's tab in review.js and the fill stalled).
// Openers: apply.js applyOne (Fill in Chrome, Ready card), start ("Apply to N jobs"), openOne with reuse (Reopen); openOne without it is the
// confirmation link, a different address on purpose.
import assert from 'node:assert/strict';
import {test} from 'node:test';
import * as apply from '../lib/apply.js';
import * as review from '../lib/review.js';
import * as terminals from '../lib/terminals.js';

const JOB = 'https://forms.example/a/1';
const harness = () => {
  terminals._reset(); review._reset();
  const opened = [], focused = [];
  const open = (...args) => { opened.push(args); return {unref() {}}; };
  const focus = async arg => { focused.push(arg.id); return 'tab'; };
  return {opened, focused, open, focus};
};
// The extension's report that tab 5 (browser run b1) is open and carries session `id`.
const tabIsOpen = id => review.noteTabs({ids: [5], boot: 'b1', sessions: {5: id}}, new Set([id]));

const openers = {
  'Fill in Chrome (applyOne)': async (h, id) => apply.applyOne({}, JOB, {company: 'A'}, {open: h.open, focus: h.focus, run: async () => {}, id: () => id}),
  'Apply to N jobs (start)': async h => {
    const jobs = [{url: JOB, title: 'T', company: 'A', kit: true, status: 'saved', score: 90}];
    return apply.start({settings: () => ({}), path: () => '', dir: ''}, {n: 1, mode: 'tabs'}, h.open, async () => ({jobs}), undefined, () => [JOB], null, () => {}, {focus: h.focus});
  },
  'Reopen (openOne with reuse)': async (h, id) => apply.openOne(JOB, {session: id, open: h.open, focus: h.focus, reuse: true}),
};

for (const [name, press] of Object.entries(openers)) {
  test(`${name}: a second press with the first tab open opens no second tab; it focuses and refills the open one`, async () => {
    const h = harness();
    const first = await press(h, 'f1');
    assert.equal(h.opened.length, 1, 'the first press opens the tab');
    const id = terminals.list()[0]?.id || first.session?.id || 'f1';
    tabIsOpen(id);
    await press(h, id);
    assert.equal(h.opened.length, 1, 'no second browser tab');
    assert.deepEqual(h.focused, [id], 'the open tab comes to the front');
    const due = review.report([{id, url: JOB, kind: 'form'}], {url: JOB + '#jobpilotto-fill=' + id, session: id, tab: 5, boot: 'b1', total: 9, left: 0}).commands;
    assert.ok(due.some(command => command.reload), 'the open tab is told to reload, so its mark starts the fill again');
  });
  test(`${name}: with no open tab the press opens one`, async () => {
    const h = harness();
    await press(h, 'f1'); await press(h, 'f1');
    assert.equal(h.opened.length, 2);
  });
}

test('the confirmation link (openOne without reuse) still opens its own address, whatever tab is open', () => {
  const h = harness();
  tabIsOpen('s9');
  apply.openOne('https://forms.example/confirm?t=1', {session: 's9', open: h.open, focus: h.focus});
  assert.equal(h.opened.length, 1);
});
