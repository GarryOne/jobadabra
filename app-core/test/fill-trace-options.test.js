// A fill's trace row carries the form's own choices (owner, 17 Oct 2026: a dropdown question was kept as a text box): the app keeps the question's kind and
// options from it (desktop/lib/question-formats.js). Choices only, never a value; a text field carries none.
import test from 'node:test';
import assert from 'node:assert/strict';
import { loadJsdom, openPage } from './helpers/page.js';

const JSDOM = await loadJsdom();
const skip = JSDOM ? false : 'jsdom is not installed here (run npm install in worker/)';

const FORM = `<form>
  <label for="title">Title *</label><select id="title" required><option value="">Please select</option><option>Mr</option><option>Mrs</option><option>Ms</option></select>
  <fieldset><legend>Do you have a valid permission to work in Switzerland? *</legend>
    <label><input type="radio" name="permit" value="yes" required> Yes</label><label><input type="radio" name="permit" value="no"> No</label></fieldset>
  <label for="notice">Notice period *</label><input id="notice" type="text" required>
</form>`;

test('trace rows carry a menu\'s and a radio group\'s own choices, a text field none', { skip }, async () => {
  const window = openPage(JSDOM, FORM, { url: 'https://careers.example.test/apply' });
  const summary = await window.__jobadabraExtensionFill([], {}, null, '', false);
  const row = (label) => (summary.trace || []).find((each) => each.label === label);
  assert.deepEqual([...row('Title').options], ['Mr', 'Mrs', 'Ms'], 'the placeholder (empty value) is not a choice');   // copied out of the page's own realm
  assert.equal(row('Title').type, 'select');
  const permit = (summary.trace || []).find((each) => /permission to work/.test(each.label));
  assert.ok(permit, 'the radio group is traced by its question');
  assert.deepEqual([...permit.options], ['Yes', 'No']);
  assert.equal(row('Notice period').options, undefined);
});
