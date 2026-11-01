// A radio group whose question the page doesn't name where fill.js looks reads as one of its own choices: nothing can
// answer it, and it used to be logged as a data gap ("no answer in the kit") that never reached a fill-failure report.
// It is a mechanical failure now: reported, with a snapshot, so the next site with this shape gets a fixture and a fix.
import test from 'node:test';
import assert from 'node:assert/strict';
import { loadJsdom, openPage } from './helpers/page.js';
import { sanitize } from '../src/report.js';

const JSDOM = await loadJsdom();
const UNTITLED = `<form><div><div class="q">Which plan?</div>
  <div><input type="radio" id="p0" name="plan" required><label for="p0">Basic</label></div>
  <div><input type="radio" id="p1" name="plan" required><label for="p1">Pro</label></div></div></form>`;

test('a radio group read as one of its own choices is "question text not found", which the Worker keeps', { skip: !JSDOM }, async () => {
  const window = openPage(JSDOM, UNTITLED);
  const summary = await window.__jobPilottoExtensionFill([], {}, null, '', false);
  const row = Array.from(summary.trace).find((r) => r.type === 'radio');
  assert.equal(row.label, 'Basic');
  assert.equal(row.reason, 'question text not found on the page');
  assert.equal(row.required, true);
  const kept = sanitize({ site: 'forms.example.com', fields: [{ label: row.label, type: row.type, required: true, reason: row.reason }] });
  assert.equal(kept.fields.length, 1);
});
