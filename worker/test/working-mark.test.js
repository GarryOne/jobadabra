// No verdict while the extension still works (extension/working-mark.js; owner, 27 Oct 2026: "That's a very big bug. Please, don't show a verdict" ... "IF the extension didn't stop
// thinking"): on a Greenhouse form the panel said "This page shows no application" + "Fill again", then filled it seconds later. The class: every mark markOf can give.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { END_MARKS, holdVerdict, showsFields, workingMark } from '../../extension/working-mark.js';
import { markOf } from '../../extension/tab-pages.js';

const ROLES = ['no-form', 'form', 'account', 'signing', 'reading', 'signing-in', 'signing-up', ''];
const KINDS = ['', 'other', 'posting', 'closed', 'form', 'account', 'account-form'];

test('a working mark is never an end verdict, for every role, kind, step and press', () => {
  const seen = new Set();
  for (const role of ROLES) for (const kind of KINDS) for (const step of ['', 'sign_in', 'sign_up']) for (const pressed of [false, true]) {
    const mark = markOf(role, pressed, step, kind);
    seen.add(mark);
    assert.ok(!END_MARKS.includes(workingMark(mark)), `${role}/${kind}/${step}/${pressed} → ${mark}`);
    if (!END_MARKS.includes(mark)) assert.equal(workingMark(mark), mark, 'progress marks stay as they are');
  }
  for (const end of END_MARKS) assert.ok(seen.has(end), `END_MARKS names a mark markOf really gives: ${end}`);
});

test('the Greenhouse sequence: a no-form answer on a page with a form\'s fields is held once, then may be said', () => {
  const counts = { fields: 14, textareas: 2, files: 2 };
  assert.equal(holdVerdict({ role: 'no-form', counts }), true, 'first read: no verdict, look again');
  assert.equal(holdVerdict({ role: 'no-form', counts, lookedAgain: true }), false, 'after the one more look: the verdict may show');
});

test('controls: a page with no fields (a real check, an error page) is told at once; a form is never held', () => {
  assert.equal(holdVerdict({ role: 'no-form', counts: { fields: 1 } }), false);
  assert.equal(holdVerdict({ role: 'no-form', counts: null }), false);
  assert.equal(holdVerdict({ role: 'form', counts: { fields: 9 } }), false);
  assert.equal(showsFields({ fields: 1, files: 1 }), true);
});

test('fill-flow: the marks set while the read goes on are working marks; the verdict comes only after the hold', () => {
  const flow = fs.readFileSync(new URL('../../extension/fill-flow.js', import.meta.url), 'utf8');
  const marks = [...flow.matchAll(/await markPage\(tab\.id, role, [^)]*\)/g)].map((m) => m[0]);
  const hold = flow.indexOf('holdVerdict({role, counts'), verdict = flow.indexOf('await markPage(tab.id, role, pressed, kind);   // stopped and sure');
  assert.ok(hold > 0 && verdict > hold, 'the verdict mark comes after the hold');
  for (const mark of marks.filter((m) => !m.endsWith('kind)') || flow.indexOf(m) < hold)) assert.match(mark, /working: true/, mark);
});
