// One question is one control (extension/page/option-groups.js; flow-checks' rule from #569, NICE's Greenhouse form, pool run 38325149096: a required fieldset of checkboxes with their own ids and a
// []-name read as 1 + every option, 16 against the panel's 8). The panel (review.js) and the replay's truth reader (desktop/e2e/lib/replay-truth.mjs) both take their groups from this one function.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { loadJsdom, openPage } from './helpers/page.js';
import { readPanel } from './helpers/panel.js';

const JSDOM = await loadJsdom();
const page = html => { const window = openPage(JSDOM, html); return { window, doc: window.document, groups: window.__jobPilottoOptionGroups }; };
const q = (doc, selector) => doc.querySelector(selector);

test('options join by the box that holds only options: a fieldset, an ARIA group', { skip: !JSDOM }, () => {
  const { doc, groups } = page(`<fieldset id="f"><legend>Which of these apply? *</legend>
    <input type="checkbox" id="a" name="q[]"><label for="a">One</label><input type="checkbox" id="b" name="q[]"><label for="b">Two</label></fieldset>
    <div role="radiogroup" id="r"><input type="radio" id="y" name="yn"><input type="radio" id="n" name="yn"></div>`);
  const first = groups.groupOf(q(doc, '#a'));
  assert.equal(first.key, q(doc, '#f'));
  assert.equal(groups.groupOf(q(doc, '#b')).key, q(doc, '#f'), 'every option of the fieldset is the same key');
  assert.equal(first.title, 'Which of these apply? *');
  assert.equal(groups.groupOf(q(doc, '#y')).key, q(doc, '#r'));
});

test('a fieldset-less []-name checkbox group joins by its shared name; a lone box is no group', { skip: !JSDOM }, () => {
  const { doc, groups } = page(`<div><label>Ethnicity *</label><input type="checkbox" id="a" name="question_9547509101[]"><input type="checkbox" id="b" name="question_9547509101[]"><input type="checkbox" id="c" name="question_9547509101[]"></div>
    <input type="checkbox" id="terms" name="terms">`);
  const group = groups.groupOf(q(doc, '#b'));
  assert.equal(group.key, 'options:question_9547509101[]');
  assert.equal(group.options.length, 3);
  assert.equal(groups.groupOf(q(doc, '#a')).key, group.key);
  assert.equal(groups.groupOf(q(doc, '#terms')), null, 'a lone checkbox is one control on its own');
});

test('radios with no name join by the container that holds only them; a lone nameless radio is no group', { skip: !JSDOM }, () => {
  const { doc, groups } = page(`<div id="d"><input type="radio" id="p4"><label for="p4">4</label><input type="radio" id="p6"><label for="p6">6</label></div><div><input type="radio" id="lone"></div>`);
  assert.equal(groups.groupOf(q(doc, '#p4')).key, q(doc, '#d'));
  assert.equal(groups.groupOf(q(doc, '#p6')).key, q(doc, '#d'));
  assert.equal(groups.groupOf(q(doc, '#lone')), null);
});

test('a fieldset (or group) that also holds text boxes is not a box of options: a form wrapped in a fieldset never merges its checkboxes', { skip: !JSDOM }, () => {
  const { doc, groups } = page(`<fieldset id="whole"><input id="name" name="name"><input type="checkbox" id="a" name="x"><input type="checkbox" id="b" name="y"></fieldset>`);
  assert.equal(groups.groupOf(q(doc, '#a')), null);
  assert.equal(groups.groupOf(q(doc, '#b')), null);
  const hiddenOk = page(`<fieldset id="s"><input type="hidden" name="csrf"><input type="checkbox" id="a"><input type="checkbox" id="b"></fieldset>`);
  assert.equal(hiddenOk.groups.groupOf(q(hiddenOk.doc, '#a')).key, q(hiddenOk.doc, '#s'), 'hidden inputs are ignored');
});

test('an option-role element that wraps a hidden native radio joins its radiogroup (each segment is not its own group)', { skip: !JSDOM }, () => {
  const { doc, groups } = page(`<div role="radiogroup" id="g"><div role="radio" id="s1"><input type="radio" id="r1" name="seg" hidden></div><div role="radio" id="s2"><input type="radio" id="r2" name="seg" hidden></div></div>`);
  const key = q(doc, '#g');
  assert.equal(groups.groupOf(q(doc, '#s1')).key, key);
  assert.equal(groups.groupOf(q(doc, '#s2')).key, key);
  assert.equal(groups.groupOf(q(doc, '#r1')).key, key, 'the native path and the role path dedupe against each other');
});

test('answered: any option checked, or the box itself or something inside it holds the ARIA state (Workable sets aria-checked on the wrapper)', { skip: !JSDOM }, () => {
  const { doc, groups } = page(`<fieldset id="f"><input type="checkbox" id="a" name="q[]"><input type="checkbox" id="b" name="q[]"></fieldset>
    <div role="radiogroup" id="g" aria-checked="true"><div role="radio" id="s1"></div></div>
    <div role="group" id="h"><div role="checkbox" id="c1" aria-checked="false"></div><div role="checkbox" id="c2" aria-checked="true"></div></div>`);
  const field = groups.groupOf(q(doc, '#a'));
  assert.equal(groups.answered(field), false);
  q(doc, '#b').checked = true;
  assert.equal(groups.answered(groups.groupOf(q(doc, '#a'))), true);
  assert.equal(groups.answered(groups.groupOf(q(doc, '#s1'))), true, 'the wrapper carries the state');
  assert.equal(groups.answered(groups.groupOf(q(doc, '#c1'))), true, 'something inside the box is selected');
});

test('review.js and the replay truth reader take their groups from this one function (never a copy of the rule)', () => {
  const read = file => fs.readFileSync(new URL(`../../${file}`, import.meta.url), 'utf8');
  assert.match(readPanel(), /__jobPilottoOptionGroups/);
  assert.match(read('desktop/e2e/lib/replay-truth.mjs'), /option-groups\.js/);
  for (const list of ['extension/page-files.js', 'extension/background.js']) assert.match(read(list), /page\/option-groups\.js/, `${list} loads it`);
});
