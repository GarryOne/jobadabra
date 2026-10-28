/* global document, window */
// Work eligibility: once Nationality is added or changed, the zones it does not open are preselected "No, needs sponsorship" (owner, 28 Oct 2026: "once we add/change
// the nationality, initially, can we preselect the visa/work status for each other row?… it should preselect only for the first time… we shouldn't override
// his choices"). A suggestion is a draft the person changes with one click; a zone already answered is never touched (renderer/pages/details-facts.js).
// Owner, 28 Oct 2026, "Save them automatically": only a Nationality the person changes in this session preselects the zones; on open the conclusions are already saved
// (lib/eligibility-settle.js), so opening draws no suggestion and asks no AI.
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {install} from './tiny-dom.js';

const body = install();
const every = setInterval;
globalThis.setInterval = (...args) => every(...args).unref();   // the import chain starts clocks; they must not keep the test process alive
const real = document.getElementById, loose = new Map();
document.getElementById = id => real(id) || (loose.has(id) ? loose.get(id) : loose.set(id, document.createElement('div')).get(id));
window.pilot.state = async () => ({settings: {}});   // renderer/pages/shared.js reads it on import
const {showFacts, factsNow, KEYS} = await import('../renderer/pages/details-facts.js');
const {forgetKept} = await import('../renderer/swr.js');
const {factsDirty} = await import('../renderer/pages/details-drafts.js');

const asked = [], gate = {promise: Promise.resolve(), open: () => {}};
const zone = (label, value = '') => ({label, value, kind: 'per_country'});
async function open(eligibility) {
  body.replaceChildren?.();
  const el = (tag, set) => Object.assign(document.createElement(tag), set);
  for (const key of KEYS) {
    const box = el('div'); box.dataset.facts = key; body.append(box);
    const read = el('div'); read.dataset.factsRead = key; body.append(read);
  }
  for (const id of ['facts-message', 'which-list', 'facts-set-aside', 'setting-which', 'facts-tidied']) body.append(el('div', {id}));
  const sections = {eligibility, availability: [], languages: []};
  window.pilot = {state: async () => ({settings: {}}), detailsFactsNow: async () => ({ok: true, sections, formats: {}}), detailsFacts: async () => ({ok: true, sections, formats: {}, older: []}), questionsRead: async () => ({}), zoneSuggestions: async names => { asked.push(names); await gate.promise; return {eu: 'no, needs sponsorship', uk: 'yes, with a permit', us: 'yes, freely'}; }};
  forgetKept();   // the screen paints its last read first; a test must not see the one before
  await showFacts({redraw: true});   // a refresh never redraws under unsaved edits; an earlier test left some
  return document.querySelector('[data-facts="eligibility"]');
}
const status = label => factsNow().eligibility.find(line => line.label === label)?.value || '';
const nationalityChanged = into => into.listeners.change?.forEach(fn => fn({target: {closest: () => true}}));

test('a British Nationality changed or added: the EU and the US zones are preselected "no, needs sponsorship", the UK "yes, freely"', async () => {
  const into = await open([zone('EU / EEA + Switzerland'), zone('United Kingdom'), zone('United States')]);
  assert.equal(status('United States'), '', 'positive control: with no nationality nothing is preselected');
  Object.defineProperty(into.querySelector('.qa-nationality'), 'value', {get: () => 'United Kingdom'});   // the chips' value is read-only: what adding a nationality leaves
  nationalityChanged(into);
  assert.equal(status('EU / EEA + Switzerland'), 'no, needs sponsorship');
  assert.equal(status('United States'), 'no, needs sponsorship');
  assert.equal(status('United Kingdom'), 'yes, freely');
  assert.match(into.textContent, /Suggested from your nationality/);
});

test('a zone the person already answered is never overridden', async () => {
  const into = await open([{label: 'Nationality', value: 'United Kingdom'}, zone('EU / EEA + Switzerland', 'yes, with a permit'), zone('United Kingdom'), zone('United States')]);
  nationalityChanged(into);
  assert.equal(status('EU / EEA + Switzerland'), 'yes, with a permit');
  assert.equal(status('United States'), 'no, needs sponsorship');
});

test('a suggestion the person clicked is theirs: a later nationality change keeps it', async () => {
  const into = await open([{label: 'Nationality', value: 'United Kingdom'}, zone('EU / EEA + Switzerland'), zone('United Kingdom'), zone('United States')]);
  nationalityChanged(into);
  const us = [...into.querySelectorAll('.country-row.fact-line')].find(line => line.textContent.includes('United States'));
  us.listeners.click?.forEach(fn => fn({target: {closest: () => true}}));
  nationalityChanged(into);
  assert.equal(status('United States'), 'no, needs sponsorship');
  assert.ok(![...into.querySelectorAll('.country-row.fact-line')].find(line => line.textContent.includes('United States')).dataset.suggested, 'no longer a suggestion');
});

// Why (28 Oct 2026, owner: "use AI if the nationality is not US or Europe"): a nationality outside the three zones is judged by the AI (asked when the person changes Nationality; on open it is already saved); before its answer the pickers
// are empty (never a guess), after it they are preselected, and an answered zone is still left alone.
test('a Canadian the person enters: the zones are empty until the AI answers, then preselected; Europe and the US never ask it; opening asks nothing', async () => {
  asked.length = 0;
  gate.promise = new Promise(done => { gate.open = done; });
  const into = await open([{label: 'Nationality', value: 'Canada'}, zone('EU / EEA + Switzerland'), zone('United Kingdom', 'yes, freely'), zone('United States')]);
  assert.equal(status('United States'), '', 'positive control: nothing is guessed before the answer');
  assert.deepEqual(asked, [], 'opening never asks the AI: it was asked and saved on open (lib/eligibility-settle.js)');
  nationalityChanged(into);
  gate.open();
  await new Promise(done => setTimeout(done, 0));
  assert.deepEqual(asked, [['Canada']]);
  assert.equal(status('United States'), 'yes, freely');
  assert.equal(status('EU / EEA + Switzerland'), 'no, needs sponsorship');
  assert.equal(status('United Kingdom'), 'yes, freely', 'an answered zone is never overridden');
  assert.match(into.textContent, /Suggested from your nationality/);
  asked.length = 0;
  await open([{label: 'Nationality', value: 'Romania'}, zone('EU / EEA + Switzerland'), zone('United Kingdom'), zone('United States')]);
  assert.deepEqual(asked, []);
});

// Why (28 Oct 2026, #2346 review; owner "Save them automatically"): a suggestion for a Nationality the person changed is a draft of their own edit, not what is saved, so Save is
// offered; opening draws none; a click on the label is no pick; a saved zone still asked stays asked when nothing is suggested.
test('suggestions follow the person\'s own edit only: drafts (not the saved baseline); a label click keeps one; a saved asked zone stays asked', async () => {
  const into = await open([{label: 'Nationality', value: 'United Kingdom'}, zone('EU / EEA + Switzerland'), zone('United Kingdom'), zone('United States')]);
  const labels = lines => lines.eligibility.map(line => line.label);
  assert.ok(!labels(factsNow()).includes('United States'), 'opening draws no suggestion');
  nationalityChanged(into);
  assert.ok(labels(factsNow()).includes('United States'), 'positive control: a Nationality the person changed preselects the zones');
  assert.ok(!labels(factsNow({saved: true})).includes('United States'), 'it is not in the saved baseline');
  const us = [...into.querySelectorAll('.country-row.fact-line')].find(line => line.textContent.includes('United States'));
  us.listeners.click?.forEach(fn => fn({target: {closest: () => null}}));
  assert.ok(us.dataset.suggested, 'a click off the status keeps it a suggestion');
  const asking = await open([zone('EU / EEA + Switzerland', '❓ yes, freely / yes, with a permit / no, needs sponsorship'), zone('United Kingdom'), zone('United States')]);
  assert.match(asking.textContent, /EU \/ EEA/);
  assert.ok(factsNow().eligibility.every(line => !line.value.startsWith('yes') || line.label !== 'EU / EEA + Switzerland'), 'no nationality: nothing suggested over the asked row');
});

// Why (28 Oct 2026, #2346 review): the previous nationality's suggestion is never kept as an answer when the new nationality suggests nothing yet, and an AI ask that
// brought nothing back is asked again at the next change.
test('UK then Canada before the AI answers: the UK suggestions leave; an empty AI answer is asked again', async () => {
  const into = await open([{label: 'Nationality', value: 'United Kingdom'}, zone('EU / EEA + Switzerland'), zone('United Kingdom'), zone('United States')]);
  nationalityChanged(into);
  assert.equal(status('United States'), 'no, needs sponsorship', 'positive control: the UK suggestion is there');
  asked.length = 0;
  const empty = window.pilot.zoneSuggestions;
  window.pilot.zoneSuggestions = async names => { asked.push(names); return {}; };
  Object.defineProperty(into.querySelector('.qa-nationality'), 'value', {get: () => 'Chile', configurable: true});
  nationalityChanged(into);
  assert.equal(status('United States'), '', 'the UK suggestion is not kept as an answer');
  await new Promise(done => setTimeout(done, 0));
  nationalityChanged(into);
  assert.equal(asked.length, 2, 'an empty answer is asked again');
  window.pilot.zoneSuggestions = empty;
});

// Owner, 28 Oct 2026, "Save them automatically": the dialog "Save your changes?" blocked the next click for lines the person never typed. What lib/eligibility-settle.js saved
// (Nationality + zones, opened as the store returns them) is the baseline: no suggestion, nothing dirty, so leaving Profile asks nothing. Red on the draft-on-open screen.
test('a saved Nationality with its zones opens clean: no suggestion drawn, nothing unsaved, nothing asked', async () => {
  asked.length = 0;
  const into = await open([{label: 'Nationality', value: 'Romania'}, zone('EU / EEA + Switzerland', 'yes, freely'), zone('United Kingdom', 'no, needs sponsorship'), zone('United States', 'no, needs sponsorship')]);
  assert.equal(into.querySelectorAll('[data-suggested]').length, 0, 'no zone is a suggestion');
  assert.equal(factsDirty(), false, 'nothing is an unsaved change');
  assert.deepEqual(asked, []);
  nationalityChanged(into);
  assert.equal(factsDirty(), false, 'positive control: re-reading the same Nationality changes nothing either (answered zones stay)');
});

test('the Undo notice says Work eligibility was filled in and saved, not "tidied"', async () => {
  await open([{label: 'Nationality', value: 'Romania'}, zone('EU / EEA + Switzerland', 'yes, freely')]);
  const sections = {eligibility: [{label: 'Nationality', value: 'Romania'}], availability: [], languages: []};
  window.pilot.detailsFacts = async () => ({ok: true, sections, formats: {}, tidied: {changed: 4, eligibility: 4, at: '2026-10-28T10:00:00Z'}});
  forgetKept();
  await showFacts({redraw: true});
  const notice = document.getElementById('facts-tidied').textContent;
  assert.match(notice, /Work eligibility was filled in from your earlier answers and saved/);
  assert.doesNotMatch(notice, /tidied/, 'all four were Work eligibility');
});
