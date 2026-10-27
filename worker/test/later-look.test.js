// A later page-kind look that says "form" makes the page the form (extension/later-look.js; Greenhouse, 27 Oct 2026: first "other" + bot check, the look after the
// press "form" 0.95, the page handed to the person as "stuck"). And the cases where it must not: unsure, a check in front, still drawing, already a form.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { laterLookIsForm } from '../../extension/later-look.js';

const first = { role: 'no-form', kind: 'other', confidence: 0.8, botCheck: true };

test('the Greenhouse sequence: other + bot check, then form 0.95 → the form', () => {
  assert.equal(laterLookIsForm(first, { role: 'form', kind: 'form', confidence: 0.95 }), true);
});

test('controls: a weaker, still-drawing or failed later look changes nothing', () => {
  assert.equal(laterLookIsForm(first, { role: 'form', confidence: 0.6 }), false);
  assert.equal(laterLookIsForm(first, { role: 'form', confidence: 0.95, botCheck: true }), true, 'a form that also names a check is still the form (as the live 0.95 look did)');
  assert.equal(laterLookIsForm(first, { role: 'form', confidence: 0.95, stillDrawing: true }), false);
  assert.equal(laterLookIsForm(first, { role: 'no-form', confidence: 0.99 }), false);
  assert.equal(laterLookIsForm(first, null), false);
  assert.equal(laterLookIsForm({ role: 'form', confidence: 0.9 }, { role: 'form', confidence: 0.95 }), false);
  assert.equal(laterLookIsForm(null, { role: 'form', confidence: 0.9 }), true, 'no first answer: the later one decides');
});

test('fill-flow uses it on the look after the press, before the bot-check hand-over', () => {
  const flow = fs.readFileSync(new URL('../../extension/fill-flow.js', import.meta.url), 'utf8');
  const use = flow.indexOf('laterLookIsForm(kind, lookAfterPress)'), handover = flow.indexOf('a bot check in front of the page: handed to the person');
  assert.ok(use > 0 && handover > use);
});
