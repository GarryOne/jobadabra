// tools/fill-fixture.mjs makes fixtures a replay can run from a fill-failure issue alone: a stand-in answer and what to expect, the radio group a
// container marks, and a reason (record the site) when the snapshot cannot show the field. Why: on 20 Oct 2026, 15 of 17 fixtures made from the
// private issues could not run as made (no answer, no expectation, a dropdown whose choices load from the site).
import test from 'node:test';
import assert from 'node:assert/strict';
import { fromFields, standIn, whyNoFixture } from '../../tools/fill-fixture.mjs';

const SITE = 'boards.example.com';
const dropdown = (html) => ({ label: 'Gender', type: 'combobox', reason: 'dropdown not clicked: the click failed', snapshot: html });

test('a dropdown whose choices are drawn gets the first real one as its stand-in; one with none says to record the site', () => {
  const drawn = '<div class="jp-snapshot"><input role="combobox" data-jp-field id="g"><div role="option">Select…</div><div role="option">Female</div><div role="option">Male</div></div>';
  assert.deepEqual(standIn(dropdown(drawn), drawn), { answer: 'Female', expect: { picked: 'Female' } });
  const empty = '<div class="jp-snapshot"><input role="combobox" data-jp-field id="c"></div>';
  assert.equal(fromFields(SITE, [dropdown(empty)]).length, 0);
  assert.match(whyNoFixture(dropdown(empty)), /record the site/);
});

test('a radio group marked on its container is named by its radios, answered with a choice, not with its question', () => {
  const html = '<div class="jp-snapshot"><label id="q">Profile visible to :</label><div role="radiogroup" aria-labelledby="q" data-jp-field>'
    + '<input type="radio" name="vis" aria-label="All recruiters" value="1"><label>All recruiters</label><input type="radio" name="vis" value="2"><label>Only this job</label></div></div>';
  const [fixture] = fromFields(SITE, [{ label: 'Profile visible to :', type: '', required: true, reason: 'question on the page not read', snapshot: html }]);
  assert.equal(fixture.spec.field, 'radio:vis');
  assert.equal(fixture.spec.answer, 'All recruiters');
  assert.deepEqual(fixture.spec.expect, { read: true, required: true });
});

test('a text box gets a stand-in value; a checkbox says to write it by hand', () => {
  const html = '<div class="jp-snapshot"><input type="text" name="where" data-jp-field></div>';
  assert.deepEqual(fromFields(SITE, [{ label: 'Where', type: 'text', reason: 'answer given, but the field did not take it', snapshot: html }])[0].spec.expect, { value: 'Example answer' });
  const box = { label: 'Alerts', type: 'checkbox', reason: 'answer given, but the field did not take it', snapshot: '<div class="jp-snapshot"><input type="checkbox" data-jp-field></div>' };
  assert.equal(fromFields(SITE, [box]).length, 0);
  assert.match(whyNoFixture(box), /by hand/);
});
