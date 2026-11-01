// A radio group laid out as a form row (cells or divs) is read by the row's question, not by its first option ("Frau"): a "*" sign in its own
// element must not become the title, and a plain title block with no label-like class is still the title (pool cause "unread", 11 Oct 2026).
import test from 'node:test';
import assert from 'node:assert/strict';
import { loadJsdom, openPage } from './helpers/page.js';

const JSDOM = await loadJsdom();
const opt = (id, name, text) => `<span><label for="${id}"><input id="${id}" name="${name}" type="radio"><span>${text}</span></label></span>`;
const LAYOUTS = {
  'a div row, the "*" in its own span': `<div class="form_content_row"><div class="form_content_left_boundary"><div class="form_content_left">Anrede<span class="form_content_label_mustsign">*</span>:</div></div><div class="form_content_right_boundary"><div class="form_content_right">${opt('a', 'g1', 'Frau')}${opt('b', 'g1', 'Herr')}</div></div></div>`,
  'a table row, plain first cell': `<table><tr class="r"><td>Anrede *</td><td>${opt('a', 'g1', 'Frau')}${opt('b', 'g1', 'Herr')}</td></tr></table>`,
  'a table row, the "*" cell first': `<table><tr><td><b>*</b></td><td>Anrede</td><td>${opt('a', 'g1', 'Frau')}${opt('b', 'g1', 'Herr')}</td></tr></table>`,
};

for (const [name, html] of Object.entries(LAYOUTS)) {
  test(`${name}: the radio group is named by its question`, { skip: !JSDOM }, async () => {
    const window = openPage(JSDOM, `<form>${html}</form>`);
    const rows = await window.__jobadabraDescribeForm();
    const row = rows.find(r => r.type === 'radio');
    assert.equal(row.label, 'Anrede');
    assert.deepEqual([...row.options],['Frau', 'Herr']);
  });
}

// A row nested inside another row: the nearest row match is an option's own <li>, the question sits in the OUTER row (Lever's age range, pool row
// "Lever: single page, no account", 11 Oct 2026). Walk up the rows; a row that holds another group's controls is a whole form, not this question.
const NESTED = {
  'options in a list inside the question item': `<ul><li class="application-question"><div class="application-label"><div class="text">What is your age range?</div></div><div class="application-field"><ul>
    <li><label><input type="radio" name="age"><span>18-20</span></label></li><li><label><input type="radio" name="age"><span>21-29</span></label></li></ul></div></li></ul>`,
};
for (const [name, html] of Object.entries(NESTED)) {
  test(`${name}: named by its question, not its first option`, { skip: !JSDOM }, async () => {
    const window = openPage(JSDOM, `<form>${html}</form>`);
    const row = (await window.__jobadabraDescribeForm()).find(r => r.type === 'radio');
    assert.equal(row.label, 'What is your age range?');
    assert.deepEqual([...row.options], ['18-20', '21-29']);
  });
}
test('a wrapper row around two questions names neither by the other', { skip: !JSDOM }, async () => {
  const q = (n, t) => `<li class="question"><div>${t}</div><ul><li><label><input type="radio" name="${n}"><span>x${n}</span></label></li><li><label><input type="radio" name="${n}"><span>y${n}</span></label></li></ul></li>`;
  const window = openPage(JSDOM, `<form><div class="field"><ul>${q('a', 'First question')}${q('b', 'Second question')}</ul></div></form>`);
  const labels = (await window.__jobadabraDescribeForm()).filter(r => r.type === 'radio').map(r => r.label);
  assert.deepEqual(Array.from(labels), ['First question', 'Second question']);
});
