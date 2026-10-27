// A written answer the AI drafted from the person's facts (owner, 16 Oct 2026): typed, marked draft until read, traced "drafted", listed to review. Its "• Add:" reminders are
// never typed (owner, 27 Oct 2026: "Never type them"): they stay on the box for the panel; a value that is only reminders types nothing. Guards extension/page/fill.js, fill-marks.js markDraft and categories.js.
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {fakeFillPage} from './fake-fill-page.js';

const rows = [
  {field: 'why', label: 'Describe cloud infrastructure you have built.', type: 'textarea', required: true, filled: true, value: 'I built our Kubernetes platform at Acme.'},
  {field: 'inc', label: 'Describe a production incident you personally root-caused.', type: 'textarea', required: true, filled: true, value: 'I root-caused a failing rollout at Acme.'}];

test('a drafted written answer is traced "drafted", marked draft on its box and listed to review; an outline is traced as one', async () => {
  const {elements, fill} = fakeFillPage(rows);
  const summary = await fill([
    {field: 'why', value: rows[0].value, category: 'written', use: 'fill', draft: 'draft', confidence: 'medium', source: 'Claude (on the page)'},
    {field: 'inc', value: rows[1].value, category: 'written', use: 'fill', draft: 'outline', confidence: 'low', remind: ['the root cause'], source: 'Claude (on the page)'}]);
  assert.equal(elements.inc.dataset.jobpilottoRemind, JSON.stringify(['the root cause']), 'the reminders stay on the box for the panel');
  assert.equal(elements.why.dataset.jobpilottoDraft, 'draft');
  assert.equal(elements.inc.dataset.jobpilottoDraft, 'outline');
  assert.equal(elements.why.dataset.jobpilottoCategory, 'written');
  assert.deepEqual(summary.trace.filter(row => row.type === 'textarea').map(row => row.reason), ['drafted: review it', 'outline: add your own details']);
  assert.ok(summary.todo.some(item => /^Review: Describe cloud infrastructure.*\(drafted for you\)$/.test(item)), JSON.stringify(summary.todo));
  assert.ok(summary.todo.some(item => /^Complete: Describe a production incident/.test(item)));
});

test('an answer that is not a draft is not marked (a typed fact stays an ordinary answer)', async () => {
  const {elements, fill} = fakeFillPage(rows.slice(0, 1));
  await fill([{field: 'why', value: rows[0].value, category: 'normal', use: 'fill', source: 'Claude (on the page)'}]);
  assert.equal(elements.why.dataset.jobpilottoDraft, undefined);
});

test('a "• Add:" line is never typed, from any producer: the rest is typed as an outline, a value of reminders only types nothing (owner, 27 Oct 2026)', async () => {
  const two = [{...rows[0], filled: false, value: ''}, {...rows[1], filled: false, value: ''}];
  const {window, elements, fill} = fakeFillPage(two);
  const typed = {};
  window.__jobPilottoFillKnownFields = entries => { for (const entry of entries) { typed[entry.field] = entry.value; elements[entry.field].value = entry.value; } return {filled: entries.map(entry => entry.field)}; };
  await fill([
    {field: 'why', value: 'I built our Kubernetes platform at Acme.\n• Add: how many teams used it', category: 'written', use: 'fill', draft: 'draft', confidence: 'medium', source: 'Claude (on the page)'},
    {field: 'inc', value: '• Add: which incident and its cause', category: 'written', use: 'fill', draft: 'outline', confidence: 'low', source: 'Claude (on the page)'}]);
  assert.deepEqual(typed, {why: 'I built our Kubernetes platform at Acme.'}, 'only the finished sentence is typed; the reminder-only box gets nothing');
  assert.equal(elements.why.dataset.jobpilottoDraft, 'outline');
  assert.equal(elements.inc.dataset.jobpilottoRemind, JSON.stringify(['which incident and its cause']));
  assert.equal(elements.inc.dataset.jobpilottoCategory, 'written');
});
