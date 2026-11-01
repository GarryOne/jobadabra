// A text field whose question sits in a sibling block (not a <label for>, not aria): the reader names it by that block, not by the field's
// name ("cards[…][field0"), so the question is read, not "question on the page not read" (pool cause "unread", 11 Oct 2026).
// Every layout below is the same shape: title block + control in one entry; the "✱" mark is a required mark too.
import test from 'node:test';
import assert from 'node:assert/strict';
import { loadJsdom, openPage } from './helpers/page.js';

const JSDOM = await loadJsdom();
const Q = 'Would you now or at any time require employer sponsorship?';
const LAYOUTS = {
  'a div.text in .application-label': `<li class="application-question"><div class="application-label"><div class="text">${Q}<span class="required">✱</span></div></div><div class="application-field"><textarea name="cards[1][field0]" required></textarea></div></li>`,
  'a plain star after a title block': `<div class="question"><div class="question-title">${Q} *</div><div><input type="text" name="q_77" required></div></div>`,
  'a heavy star before the control': `<div class="row"><p class="field-label">${Q}✱</p><textarea name="x[9]" required></textarea></div>`,
};

for (const [name, html] of Object.entries(LAYOUTS)) {
  test(`${name}: the field is read by the question, and nothing is listed unread`, { skip: !JSDOM }, async () => {
    const window = openPage(JSDOM, `<form>${html}</form>`);
    const summary = await window.__jobadabraExtensionFill([], {}, null, '', false);
    const rows = Array.from(summary.trace);
    const row = rows.find(r => /textarea|text/.test(r.type) && r.type !== '');
    assert.equal(row.label, Q);
    assert.equal(row.required, true);
    assert.deepEqual(rows.filter(r => /not read/.test(r.reason || '')), []);
  });
}

test('the required mark knows the heavy asterisk', { skip: !JSDOM }, () => {
  const mark = openPage(JSDOM, '<form></form>').__jobadabraRequired;
  for (const t of ['Notice period✱', 'Notice period ✱', '✱ Notice period', 'Notice ✳']) assert.equal(mark.has(t), true, t);
  assert.equal(mark.clean('Notice period✱'), 'Notice period');
});
