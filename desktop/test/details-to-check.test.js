/* global document, window */
// Your details → "To check" (owner, 28 Oct 2026: "this should be at the top in this tab… slightly better UI"): the card is the first part of the tab, its count and the one
// primary Review sit in the header, and what the app concluded for the person and each set-aside value are divided rows with a solid Undo (renderer/pages/details-to-check.js).
// Every state of the card is drawn: review only, review + notice, notice only, set-aside only, nothing (hidden).
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {test} from 'node:test';
import {install} from './tiny-dom.js';

const body = install();
const every = setInterval;
globalThis.setInterval = (...args) => every(...args).unref();   // the import chain starts clocks; they must not keep the test process alive
window.pilot = {state: async () => ({settings: {}})};   // renderer/pages/shared.js reads it on import
const {drawToCheck} = await import('../renderer/pages/details-to-check.js');
const html = fs.readFileSync(new URL('../renderer/index.html', import.meta.url), 'utf8');

const make = (tag, set = {}) => Object.assign(document.createElement(tag), set);
function page() {
  body.replaceChildren?.();
  const card = make('div', {id: 'setting-which'});
  card.dataset.profilePanel = 'details';
  const words = make('div', {className: 'card-words'}), lead = make('p', {textContent: 'Review wording'});
  words.append(make('h3'), lead);
  card.append(words);
  body.append(card);
  for (const id of ['which-count', 'which-list', 'facts-tidied', 'facts-set-aside']) body.append(make('div', {id}));
  return {card, lead};
}
const calls = [];
const hooks = {onReview: () => calls.push('review'), onUndoTidy: undo => calls.push(`undo-tidy:${undo.tagName}`), onChange: () => calls.push('change'), showError: () => {}};
const say = n => `${n} missing`;
const text = id => document.getElementById(id).textContent;

test('the card is the first part of the Your details tab', () => {
  const details = [...html.matchAll(/<div class="setting panel roomy[^"]*" id="([^"]+)" data-profile-panel="details"/g)].map(match => match[1]);
  assert.equal(details[0], 'setting-which');
  assert.match(html, /id="setting-which" data-profile-panel="details" data-wanted="0" hidden/, 'starts hidden: showOnTab shows it on its own tab only');
});

test('review: the count is a pill in the title, Review is the one primary in the header, a warn edge marks the card', () => {
  const {card} = page();
  drawToCheck({count: 7, aside: [], tidied: null}, hooks, say);
  assert.equal(text('which-count'), '7 missing');
  const review = document.getElementById('details-review-go');
  assert.equal(review.className, 'primary small-btn');
  review.click();
  assert.deepEqual(calls.splice(0), ['review']);
  assert.match(card.className, /needs-you/);
  assert.equal(document.getElementById('facts-tidied').children.length, 0);
});

test('the auto-fill notice is one row with a solid Undo, said once', () => {
  page();
  drawToCheck({count: 7, aside: [], tidied: {changed: 1, eligibility: 1}}, hooks, say);
  const row = document.getElementById('facts-tidied').children[0];
  assert.match(row.className, /to-check-row/);
  assert.match(row.textContent, /Work eligibility was filled in from your earlier answers and saved/);
  assert.match(row.textContent, /copy from before is backed up/);
  const undo = row.querySelector('button');
  assert.match(undo.className, /\bsecondary\b/, 'solid, never text-only');
  assert.doesNotMatch(undo.className, /\b(link|ghost)\b/);
  undo.click();
  assert.deepEqual(calls.splice(0), ['undo-tidy:BUTTON']);
});

test('notice only (nothing to review): no count, no Review, the lead says nothing waits; the review wording comes back', () => {
  const {card, lead} = page();
  drawToCheck({count: 0, aside: [], tidied: {changed: 3, eligibility: 0}}, hooks, say);
  assert.equal(text('which-count'), '');
  assert.equal(document.getElementById('details-review-go'), null);
  assert.match(lead.textContent, /Nothing waits for you/);
  assert.doesNotMatch(card.className, /needs-you/);
  assert.match(text('facts-tidied'), /3 of your details were tidied/);
  drawToCheck({count: 2, aside: [], tidied: null}, hooks, say);
  assert.equal(lead.textContent, 'Review wording');
});

test('set-aside values: one row each with a solid Undo that puts the value back', async () => {
  page();
  const undone = [];
  window.pilot = {undoSetAside: async id => { undone.push(id); return {ok: true}; }};
  drawToCheck({count: 0, aside: [{id: 'a1', title: 'Notice period', value: '2 months'}, {id: 'a2', title: 'Languages', value: 'German · B1'}], tidied: null}, hooks, say);
  const rows = document.getElementById('facts-set-aside').children;
  assert.equal(rows.length, 2);
  assert.match(rows[0].textContent, /Notice period: 2 months/);
  assert.match(rows[0].querySelector('button').className, /\bsecondary\b/);
  rows[1].querySelector('button').click();
  await new Promise(resolve => setTimeout(resolve, 0));
  assert.deepEqual(undone, ['a2']);
  assert.deepEqual(calls.splice(0), ['change']);
});

test('nothing at all: the card is hidden', () => {
  const {card} = page();
  drawToCheck({count: 0, aside: [], tidied: null}, hooks, say);
  assert.equal(card.dataset.wanted, '0');
  assert.equal(card.hidden, true);
});
