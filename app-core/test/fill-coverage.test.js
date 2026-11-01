// Signal 1, coverage at fill time (extension/page/coverage.js): a question the page marks required that the form reader did
// not read is listed, counted and traced as "question on the page not read" (reported with its HTML, counted per board as
// "unread"), whatever its layout. Before it, such a question passed silently (Colonist on Ashby, 5 Oct 2026).
import test from 'node:test';
import assert from 'node:assert/strict';
import { loadJsdom, openPage } from './helpers/page.js';
import { sanitize } from '../src/report.js';
import { leftReason } from '../../desktop/lib/question-labels.js';

const JSDOM = await loadJsdom();
// A layout the reader doesn't know: a title div marked by a "required" class, options as pressable divs with no input.
const UNKNOWN = `<form>
  <label for="name">Full name *</label><input id="name" required>
  <div class="entry"><div class="question-title is-required">How many players at most?</div>
    <div class="choices"><div tabindex="0" class="choice">4</div><div tabindex="0" class="choice">6</div></div>
    <input type="text" class="other-answer"></div>
  <h3>About you</h3><p>Some text</p>
</form>`;

test('a required question the reader did not read is traced, listed and counted', { skip: !JSDOM }, async () => {
  const window = openPage(JSDOM, UNKNOWN);
  const summary = await window.__jobPilottoExtensionFill([{ field: 'name', value: 'Ada Tester', source: 'kit' }], {}, null, '', false);
  const rows = Array.from(summary.trace).filter((r) => r.reason === 'question on the page not read');
  assert.deepEqual(rows.map((r) => r.label), ['How many players at most?']);
  assert.equal(rows[0].required, true);
  assert.ok(Array.from(summary.todo).some((t) => t.includes('How many players at most?')));
  assert.equal(summary.unfilledRequired, 1);
  assert.equal(sanitize({ site: 'forms.example.com', fields: [{ label: rows[0].label, reason: rows[0].reason }] }).fields.length, 1);
  assert.equal(leftReason(rows[0].reason), 'unread');
  // Its HTML for the report: the area the fill marked.
  const snaps = window.__jobPilottoSnapshots([{ label: rows[0].label, field: '' }], []);
  assert.ok(snaps['How many players at most?'], 'a snapshot of the unread question');
});

test('a form whose required questions are all read reports nothing unread', { skip: !JSDOM }, async () => {
  const window = openPage(JSDOM, `<form><label for="a">Email *</label><input id="a" type="email" required>
    <fieldset><legend>Do you need a visa? *</legend><input type="radio" id="y" name="v"><label for="y">Yes</label>
    <input type="radio" id="n" name="v"><label for="n">No</label></fieldset></form>`);
  const summary = await window.__jobPilottoExtensionFill([], {}, null, '', false);
  assert.equal(Array.from(summary.trace).filter((r) => r.reason === 'question on the page not read').length, 0);
});
