// A value whose kind does not fit the question is never typed (13 Oct 2026, a pool row on a careers form: a phone number in a yes/no question about
// "mobile (iOS/Android)" builds, a LinkedIn address in "Useful links (e.g. GitHub)"; both counted as filled). The class: a contact pattern read inside a
// QUESTION, a link the AI types that no saved link of that kind backs, and a check that never asked whether the kind fits. Guards:
// extension/page/fill-labels.js asksQuestion, fill-read.js, worker/src/answer-facts.js floorLinkKind, extension/form-ready.js wantsFillCheck.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { FILL_FILES } from '../../extension/page-files.js';
import { floorLinkKind } from '../src/answer-facts.js';

const read = path => fs.readFileSync(new URL(`../../${path}`, import.meta.url), 'utf8');
const profile = {first_name: 'Ada', last_name: 'T', full_name: 'Ada T', email: 'a@b.c', phone: '+41 79 555 01 23', linkedin: 'https://www.linkedin.com/in/ada-tester',
  github: 'https://github.com/ada', website: 'https://ada.dev', location: 'Zurich'};

const entriesFor = rows => {
  const window = {}, context = vm.createContext({window, document: {}});
  vm.runInContext(read('extension/page/radios.js'), context);
  for (const file of FILL_FILES) vm.runInContext(read(`extension/${file}`), context);
  return JSON.parse(JSON.stringify(window.__jobPilottoProfileEntries(rows, profile)));
};

// Every contact detail's own pattern, planted inside a sentence that asks about something else: none is typed. Looped over the details, so a new one is covered.
const QUESTIONS = {
  phone: 'Have you automated mobile (iOS/Android) or desktop build and publication workflows?',
  email: 'Do you check your e-mail for build failures every morning?',
  linkedin: 'Would you share your LinkedIn network with us if we asked for it?',
  github: 'Have you contributed to a GitHub repository with more than ten maintainers?',
  website: 'Have you built a portfolio website for a client before?',
  first_name: 'Is your first name the one on your passport?',
  location: 'Is your current location within commuting distance of an office?',
};
test('a question that merely names a contact detail is not that detail\'s box', () => {
  for (const [key, label] of Object.entries(QUESTIONS)) {
    assert.deepEqual(entriesFor([{field: `q_${key}`, label, type: 'text', filled: false}]), [], `${key}: ${label}`);
  }
});

test('the real contact labels are still placed', () => {
  const rows = [{field: 'p', label: 'Phone', type: 'tel', filled: false}, {field: 'm', label: 'Mobile number', type: 'text', filled: false},
    {field: 'l', label: 'Linkedin profile *', type: 'text', filled: false}, {field: 'e', label: 'Email address', type: 'email', filled: false},
    {field: 'w', label: 'What is your phone number?', type: 'text', filled: false}];
  assert.deepEqual(entriesFor(rows).map(entry => entry.field), ['p', 'm', 'l', 'e']);   // a real question about the number goes to the AI, which has the profile
});

// The AI types a link only when a saved link backs it for THIS field: the saved link's own line or address shares a word with the field's label.
const given = 'LinkedIn: https://www.linkedin.com/in/ada-tester\nWebsite: https://ada.dev';
test('a link the AI typed that no saved link of the field\'s kind backs is proposed, never typed', () => {
  const typed = value => ({use: 'fill', fact: 'links', category: 'normal', value});
  assert.equal(floorLinkKind(typed('https://www.linkedin.com/in/ada-tester'), 'Useful links (e.g. GitHub)', given).use, 'propose');
  assert.equal(floorLinkKind(typed('https://www.linkedin.com/in/ada-tester'), 'Linkedin profile', given).use, 'fill');
  assert.equal(floorLinkKind(typed('https://ada.dev'), 'Personal website', given).use, 'fill');
  assert.equal(floorLinkKind(typed('https://ada.dev'), 'Link to your GitHub', given).use, 'propose');
  assert.equal(floorLinkKind({...typed('Yes'), fact: 'none'}, 'Anything?', given).use, 'fill');   // not a link: left to the other floors
  assert.equal(floorLinkKind({...typed('https://ada.dev'), use: 'propose'}, 'Link to your GitHub', given).use, 'propose');
});

test('the fill check is asked when a contact-kind value sits in a question', async () => {
  const {wantsFillCheck} = await import('../../extension/form-ready.js');
  const phoneInQuestion = {label: 'Have you automated mobile (iOS/Android) or desktop build and publication workflows?', match: 'yes', answer: 'phone'};
  assert.equal(wantsFillCheck({controls: [phoneInQuestion]}, {answer: 'needs_person'}), true);
  assert.equal(wantsFillCheck({controls: [{label: 'Phone', match: 'yes', answer: 'phone'}]}, {answer: 'ready'}), false);
});

// The AI's reading of a link box (answer-facts.js LINK_RULE; owner, 27 Oct 2026: "'Website / Portfolio' gets the GitHub link, 'Personal website' stays empty"): a saved link the AI
// read as a page of the person's work is typed though no word matches; its own_site / other reading keeps the word rule; a link nobody saved is never typed, whatever the reading.
test('link_box work_page: a saved GitHub link goes into "Website / Portfolio"; "Personal website" (own_site) and an unsaved link stay proposals', () => {
  const saved = 'GitHub: https://github.com/ada-tester\nLinkedIn: https://www.linkedin.com/in/ada-tester';
  const typed = (value, link_box) => ({use: 'fill', fact: 'contact', category: 'contact', value, link_box});
  assert.equal(floorLinkKind(typed('https://github.com/ada-tester', 'work_page'), 'Website / Portfolio', saved).use, 'fill');
  assert.equal(floorLinkKind(typed('https://github.com/ada-tester', 'own_site'), 'Personal website', saved).use, 'propose');
  assert.equal(floorLinkKind(typed('https://github.com/ada-tester', 'other'), 'Website / Portfolio', saved).use, 'propose', 'control: without the AI\'s work_page reading, today\'s word rule');
  assert.equal(floorLinkKind(typed('https://github.com/someone-else', 'work_page'), 'Website / Portfolio', saved).use, 'propose', 'a link that is not saved is never typed');
});

test('the answers ask carries the link_box reading: in the schema (every answer) and its rule in the prompt', async () => {
  const { ANSWER_SCHEMA_FOR_TESTS: schema } = await import('../src/extension.js');
  const { LINK_RULE } = await import('../src/answer-facts.js');
  const item = schema.properties.answers.items;
  assert.ok(item.required.includes('link_box'));
  assert.deepEqual(item.properties.link_box.enum, ['work_page', 'own_site', 'other', 'none']);
  const src = (await import('node:fs')).readFileSync(new URL('../src/extension.js', import.meta.url), 'utf8');
  assert.match(src, /\$\{FACT_RULE\}\n\$\{LINK_RULE\}/);
  for (const word of ['work_page', 'own_site', 'never a profile on a social or job network']) assert.ok(LINK_RULE.includes(word), word);
});
