// One anonymous record per fill (extension/fill-card.js): the finer causes of an empty required field, and nothing personal.
import test from 'node:test';
import assert from 'node:assert/strict';
import { CAUSES, causeOf, cleanCard, fillCard } from '../../extension/fill-card.js';

const NO = 'no answer in the kit, Profile or your details';
const trace = [
  { label: 'Email', required: true, type: 'email', outcome: 'filled', reason: '', source: 'your details' },
  { label: 'Notice period', required: true, type: 'text', outcome: 'left', reason: NO },          // asked, no answer
  { label: 'Salary', required: true, type: 'text', outcome: 'left', reason: NO },                 // asked, low confidence
  { label: 'Visa', required: true, type: 'radio', outcome: 'left', reason: NO },                  // never asked
  { label: 'Speed?', required: true, type: 'radio', outcome: 'left', reason: 'question on the page not read' },
  { label: 'Country', required: true, type: 'combobox', outcome: 'left', reason: 'dropdown clicked, but no option matched' },
  { label: 'Consent', required: true, type: 'checkbox', outcome: 'left', reason: 'legal/consent: always your choice' },
  { label: 'CV', required: true, type: 'file', outcome: 'filled', reason: '' },
  { label: 'Blog', required: false, type: 'url', outcome: 'filled', reason: '' },
];
const form = [{ field: 'notice', label: 'Notice period' }, { field: 'salary', label: 'Salary' }, { field: 'visa', label: 'Visa' }];
const ai = { answers: [{ field: 'salary', value: '', confidence: 'low' }] };

test('each empty required field gets one cause; consents and files are not the fill\'s to count', () => {
  const card = fillCard({ id: 'abc12345-x', trace, form, sent: ['notice', 'salary'], ai, version: '0.8.97', kit: true,
    startedAt: '2026-10-06T10:00:00Z', endedAt: new Date('2026-10-06T10:00:42Z') });
  assert.deepEqual(card.causes, { ai_declined: 1, ai_unsure: 1, no_data: 1, unread: 1, no_option: 1 });
  assert.deepEqual([card.required, card.filled, card.left, card.unread, card.optional, card.optionalFilled, card.seconds, card.ai, card.kit], [6, 1, 5, 1, 1, 1, 42, 'used', true]);
  assert.deepEqual(card.kinds, { text: 2, radio: 2, combobox: 1 });
  assert.ok(!/Notice|Salary|Visa|Speed|Country|Email/.test(JSON.stringify(card)), 'no question wording');
});

test('without Claude: off, or the call failed', () => {
  const row = { field: 'notice', reason: NO };
  assert.equal(causeOf(row, { sent: new Set(['notice']), ai: null, aiError: 'budget' }), 'ai_error');
  assert.equal(causeOf(row, { sent: new Set(), useAI: false }), 'ai_off');
  assert.equal(causeOf({ reason: 'something new' }), 'other');
});

test('the site keeps only the known fields, each bounded', () => {
  const clean = cleanCard({ id: 'abc12345-x', v: '0.8.97', required: 5, causes: { unread: 2, evil: 9 }, kinds: { 'a b': 1, text: 1 }, ai: 'hack', note: 'drop me' });
  assert.deepEqual([clean.causes, clean.kinds, clean.ai, 'note' in clean], [{ unread: 2 }, { text: 1 }, 'none', false]);
  assert.equal(cleanCard({ id: 'x' }), null);
  assert.ok(CAUSES.includes('ai_unsure'));
});

// 9 Oct 2026: the AI proposes a likely answer (shown to confirm, never typed). The fill card counted these as "other" (the digest's
// biggest weakness could never move); now they are their own outcome, apart from the truly missing.
test('a field the AI proposed an answer for is "proposed", not a loss', () => {
  assert.equal(causeOf({ field: 'sms', reason: 'proposed for you to confirm' }), 'proposed');
  const card = fillCard({ id: 'fill-0001-abc', trace: [
    { label: 'SMS', field: 'sms', type: 'combobox', required: true, outcome: 'left', reason: 'proposed for you to confirm' },
    { label: 'Notice', field: 'n', type: 'text', required: true, outcome: 'left', reason: 'no answer in the kit, Profile or your details' },
    { label: 'Email', field: 'e', type: 'text', required: true, outcome: 'filled', reason: '' },
  ], sent: ['n'], ai: { answers: [] } });
  assert.deepEqual(card.causes, { proposed: 1, ai_declined: 1 });
  assert.deepEqual(cleanCard(card).causes, { proposed: 1, ai_declined: 1 });   // the site keeps it
});

test('a required box answered no and left unchecked counts as filled, not as a loss', () => {
  const card = fillCard({ id: 'abc12345-y', trace: [
    { label: 'Email', required: true, type: 'email', outcome: 'filled', reason: '', source: 'your details' },
    { label: 'Employee of the group', required: true, type: 'checkbox', outcome: 'left', reason: 'answered no: left unchecked', source: 'Claude (on the page)' },
  ], form: [], sent: [], version: '0.9.500', startedAt: '2026-10-15T10:00:00Z', endedAt: new Date('2026-10-15T10:00:10Z') });
  assert.deepEqual([card.required, card.filled, card.left], [2, 2, 0]);
  assert.deepEqual(card.causes, {});
});
