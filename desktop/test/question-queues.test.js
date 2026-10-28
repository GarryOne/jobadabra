// The two drawers (owner, 28 Oct 2026, superseding 18 Oct "One queue for all"; spec docs/superpowers/specs/2026-10-28-what-we-learned-design.md):
// the owner's 21-item Needs review of 27 Oct (its wordings; fictional places and values) goes through lib/question-lists.js openShown, and each drawer
// holds exactly what the spec says: Fill your details = Your details facts only, ranked (name and email first); What we learned = one row per topic,
// never a per-company question, never the cover letter; the letter is its own item.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {test} from 'node:test';
import * as lists from '../lib/question-lists.js';
import {createStorage} from '../lib/storage.js';
import {MUST, BLOCKED} from '../renderer/question-filter.js';

const storage = () => createStorage(path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'jp-')), 'x'), {encrypt: v => v, decrypt: v => v});
const text = {kind: 'text', control: 'text', options: []};
const item = (kind, ref, question, where, extra = {}) => ({key: `details:${kind}:${JSON.stringify(ref)}`, question, company: '', hint: '', format: text,
  details: {kind, source: '', where, fact: question, ...extra}});

// The answers page's "Common questions" with no answer: what forms asked (lib/questions.js list).
const FORM = ['How did you hear about us?', 'Demographic / EEO questions', 'Pronouns', 'Willing to relocate'].map(question => ({question}));
// lib/details-review.js pending(): the Profile's own ❓ lines (no Your details home), then the Your details items.
const PROFILE = ['How did you hear about us?', 'Previously worked for / applied to this company?', 'Demographic / EEO questions', 'Pronouns', 'Willing to relocate',
  'Consent to keep data for future roles'].map(label => item('open', {page: 'profile', label}, label, 'Profile'));
const DETAILS = [
  item('contact', {field: 'salutation'}, 'What is your salutation?', 'Your details → Contact details', {weight: 1}),
  item('contact', {field: 'birthDate'}, 'What is your date of birth?', 'Your details → Contact details', {weight: 1}),
  item('contact', {field: 'linkedin'}, 'What is your LinkedIn profile URL?', 'Your details → Contact details', {weight: BLOCKED - 500}),
  item('missing', {id: 'permit'}, 'Work permit / visa', 'Your details → Work eligibility'),
  item('open', {home: 'eligibility', label: 'Authorised to work in the EU?'}, 'Authorised to work in the EU?', 'Your details → Work eligibility'),
  item('open', {home: 'eligibility', label: 'Remote from your base for a foreign employer?'}, 'Remote from your base for a foreign employer?', 'Your details → Work eligibility'),
  item('missing', {id: 'languages'}, 'What languages do you speak?', 'Your details → Languages'),
  item('missing', {id: 'notice'}, 'What is your current notice period?', 'Your details → Availability & compensation'),
  item('missing', {id: 'start'}, 'What is your earliest available start date?', 'Your details → Availability & compensation'),
  item('missing', {id: 'salary'}, 'What is your salary expectation?', 'Your details → Availability & compensation'),
];
// What the AI answers after the 28 Oct prompt fix (lib/question-reuse.js): a question about this employer is one job's; one topic per meaning.
const VERDICTS = [
  ['How did you hear about us?', 'one_job', 'how heard'], ['Previously worked for / applied to this company?', 'one_job', 'worked here before'],
  ['Demographic / EEO questions', 'reusable', 'demographic survey'], ['Pronouns', 'reusable', 'pronouns'], ['Willing to relocate', 'reusable', 'relocation'],
  ['Consent to keep data for future roles', 'consent', 'data retention consent'],
].map(([label, verdict, topic]) => ({label, verdict, topic, covered_by: '', value: '', fact: ''}));
const ai = {client: {messages: {create: async () => ({content: [{type: 'text', text: JSON.stringify({verdicts: VERDICTS, formats: []})}]})}}};
const groups = [{category: 'Common questions', items: FORM.map(row => ({question: row.question, answer: '', open: true}))}];
const read = (details = [...PROFILE, ...DETAILS]) => lists.openShown(storage(), {rows: FORM, groups, details, ai});

test('the owner\'s 21 items: drawer 1 holds exactly the Your details facts, drawer 2 one row per topic, the letter apart', async () => {
  const queues = await read();
  assert.deepEqual(queues.details.map(row => row.question).sort(), DETAILS.map(row => row.question).sort());
  assert.deepEqual(queues.learned.map(row => row.question), ['Demographic / EEO questions', 'Pronouns', 'Willing to relocate']);
  assert.equal(queues.letter?.setup?.kind, 'cover-letter');
  assert.ok(![...queues.details, ...queues.learned].some(row => row.setup), 'the cover letter is in neither drawer');
});

test('drawer 2: no per-company question, no consent, no topic twice (the Profile copy is not a second row)', async () => {
  const {learned, hidden} = await read();
  const words = learned.flatMap(row => [row, ...(row.also || [])]).map(row => row.question);
  for (const company of ['How did you hear about us?', 'Previously worked for / applied to this company?', 'Consent to keep data for future roles']) {
    assert.ok(!words.includes(company), `${company} is answered per job, never in a drawer`);
    assert.ok(hidden.some(row => row.question === company), `${company} stays set aside, never deleted`);
  }
  assert.equal(new Set(learned.map(row => row.question)).size, learned.length);
  assert.ok(!learned.some(row => (row.also || []).some(each => each.details)), 'a Profile line is never answered as another wording of a form question');
});

test('drawer 1: ranked by the queue score, name and email before everything else', async () => {
  const name = item('contact', {field: 'firstName'}, 'What is your first name?', 'Your details → Contact details', {weight: MUST});
  const email = item('contact', {field: 'email'}, 'What is your email address?', 'Your details → Contact details', {weight: MUST});
  const {details} = await read([...PROFILE, ...DETAILS, name, email]);
  assert.deepEqual(details.slice(0, 2).map(row => row.question), ['What is your first name?', 'What is your email address?']);
  assert.equal(details[2].question, 'What is your LinkedIn profile URL?', 'then a detail most forms need');
});

// Spec AC2 (mac-27 on the 28 Oct preview: the tab listed eligibility and notice as Confirmed): the saved answers get the same AI verdict in the same call;
// a Your details fact, one job's or consent is named in notLearned (the tab leaves it out; PR B moves it home), a stance stays a learning.
test('saved answers judged a Your details fact or one job\'s are no learning; a stance is, all in one AI call', async () => {
  // The AI's verdict enum has no "details": a known fact named in `fact` makes it one (lib/question-reuse.js classify).
  const saved = [['Authorised to work in Switzerland?', 'Yes, B permit', 'reusable', 'Work permit / visa'], ['Need visa sponsorship?', 'No', 'reusable', 'Need visa sponsorship?'],
    ['Notice period / earliest start', '3 months', 'reusable', 'Notice period'], ['Previously worked for / applied to this company?', 'Answered per job', 'one_job', ''],
    ['Remote from your base for a foreign employer?', 'Yes', 'reusable', '']];
  const said = [...VERDICTS, ...saved.map(([label, , verdict, fact]) => ({label, verdict, topic: label.toLowerCase(), covered_by: '', value: '', fact}))];
  let calls = 0;
  const judge = {client: {messages: {create: async request => (calls += JSON.stringify(request).includes('<saved_answers>') ? 1 : 0, {content: [{type: 'text', text: JSON.stringify({verdicts: said, formats: []})}]})}}};
  const withSaved = [{category: 'Common questions', items: [...groups[0].items, ...saved.map(([question, answer]) => ({question, answer}))]}];
  const {notLearned} = await lists.openShown(storage(), {rows: FORM, groups: withSaved, details: [...PROFILE, ...DETAILS], ai: judge});
  assert.deepEqual(notLearned, saved.slice(0, 4).map(([question]) => question));
  assert.equal(calls, 1, 'the saved answers are judged in the open questions\' call, not a second one');
});

// PR A review (28 Oct 2026): an unclear saved line went to What we learned unjudged, so a guessed notice period showed there as a learning.
test('an unclear saved line the AI judges a Your details fact is filled in drawer 1; one job\'s is set aside; never in What we learned', async () => {
  const notice = item('unclear', {page: 'answers', label: 'Notice period / earliest start', value: '3 months (guess)'}, 'Notice period / earliest start', 'What we learned');
  const hear = item('unclear', {page: 'answers', label: 'How did you hear about us?', value: 'not sure'}, 'How did you hear about us?', 'What we learned');
  const said = [...VERDICTS, {label: 'Notice period / earliest start', verdict: 'reusable', topic: 'notice period', covered_by: '', value: '', fact: 'Notice period'}];
  const judge = {client: {messages: {create: async () => ({content: [{type: 'text', text: JSON.stringify({verdicts: said, formats: []})}]})}}};
  const {details, learned, hidden} = await lists.openShown(storage(), {rows: FORM, groups, details: [...DETAILS, notice, hear], ai: judge});
  assert.ok(details.some(row => row.key === notice.key), 'a fact to check is Fill your details\'');
  assert.ok(hidden.some(row => row.key === hear.key), 'one job\'s is set aside, never deleted');
  assert.ok(!learned.some(row => row.key === notice.key || row.key === hear.key));
});

test('a saved answer the AI found unclear on the answers page is a learning to check, not a Your details item', async () => {
  const unclear = item('unclear', {page: 'answers', label: 'Travel', value: 'sometimes'}, 'Travel', 'What we learned');
  const {details, learned} = await read([...DETAILS, unclear]);
  assert.ok(learned.some(row => row.key === unclear.key));
  assert.ok(!details.some(row => row.key === unclear.key));
});
