/* global document, window */
// Work eligibility: once Nationality is added or changed, the zones it does not open are preselected "No, needs sponsorship" (owner, 28 Oct 2026: "once we add/change
// the nationality, initially, can we preselect the visa/work status for each other row?… it should preselect only for the first time… we shouldn't override
// his choices"). A suggestion is a draft the person changes with one click; a zone already answered is never touched (renderer/pages/details-facts.js).
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
  window.pilot = {state: async () => ({settings: {}}), detailsFactsNow: async () => ({ok: true, sections, formats: {}}), detailsFacts: async () => ({ok: true, sections, formats: {}, older: []}), questionsRead: async () => ({})};
  await showFacts();
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
  us.listeners.click?.forEach(fn => fn({}));
  nationalityChanged(into);
  assert.equal(status('United States'), 'no, needs sponsorship');
  assert.ok(![...into.querySelectorAll('.country-row.fact-line')].find(line => line.textContent.includes('United States')).dataset.suggested, 'no longer a suggestion');
});
