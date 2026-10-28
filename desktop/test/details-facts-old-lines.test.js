// Your details' Work eligibility editor never draws the old lines still asked (owner, 28 Oct 2026: "let's remove these 3 fields"): the owner's three, as
// fictional asked lines, are read into the editor and absent from its rows and from what Save would write (renderer/pages/details-facts.js).
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {install} from './tiny-dom.js';

const body = install();
// Why (28 Oct 2026, #2341 review): the page's import chain looks up many ids at load; a missing one is a detached element, so the editor itself is what runs.
const every = setInterval;
globalThis.setInterval = (...args) => every(...args).unref();   // the import chain starts clocks; they must not keep the test process alive
const real = document.getElementById, loose = new Map();
document.getElementById = id => real(id) || (loose.has(id) ? loose.get(id) : loose.set(id, document.createElement('div')).get(id));
window.pilot.state = async () => ({settings: {}});   // renderer/pages/shared.js reads it on import
const {showFacts, factsNow, KEYS} = await import('../renderer/pages/details-facts.js');

const OLD = ['Work permit / visa', 'Authorised to work in Oslo, Norway?', 'Remote from your base for a foreign employer?'];
const sections = {eligibility: [{label: 'Nationality', value: 'United Kingdom'}, ...OLD.map(label => ({label, value: '❓ your citizenship and status'}))], availability: [], languages: []};

test('the editor draws no old asked eligibility line and Save would not write one', async () => {
  const el = (tag, set) => Object.assign(document.createElement(tag), set);
  for (const key of KEYS) {
    const box = el('div'); box.dataset.facts = key; body.append(box);
    const read = el('div'); read.dataset.factsRead = key; body.append(read);
  }
  for (const id of ['facts-message', 'which-list', 'facts-set-aside', 'setting-which', 'facts-tidied']) body.append(el('div', {id}));
  window.pilot = {detailsFactsNow: async () => ({ok: true, sections, formats: {}}), detailsFacts: async () => ({ok: true, sections, formats: {}, older: []}), questionsRead: async () => ({})};
  await showFacts();
  const drawn = document.querySelector('[data-facts="eligibility"]').textContent;
  assert.match(drawn, /Nationality/, 'positive control: the editor drew');
  for (const label of OLD) assert.ok(!drawn.includes(label), `${label} is drawn`);
  assert.deepEqual(factsNow().eligibility.map(line => line.label).filter(label => OLD.includes(label)), []);
});
