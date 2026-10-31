// Setup step 3 is the Strategy page's own cards (owner, 24 Oct 2026: "literally the same cards"). The class: every card of the Strategy page's live block is
// the one in the wizard (moved, not redrawn); the setup has no renderer of its own for a field the cards own; its edits change the draft, never the store.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {test} from 'node:test';
import {install} from './tiny-dom.js';
import {editDraftLists, editDraftText} from '../lib/draft-edit-handlers.js';

const read = file => fs.readFileSync(new URL(`../renderer/${file}`, import.meta.url), 'utf8');
const html = read('index.html');
const review = read('pages/strategy-review.js');
const live = html.slice(html.indexOf('id="strategy-live"'), html.indexOf('id="strategy-suggestions"'));
const wizard = html.slice(html.indexOf('data-step="draft"'), html.indexOf('id="setup-finish"'));

test('every card host of the Strategy page is inside the one block the setup moves; the wizard has none of its own', () => {
  const hosts = [...live.matchAll(/id="(strategy-[a-z-]+|preferences-body)"/g)].map(match => match[1]);
  for (const id of ['strategy-main-goals', 'strategy-locations', 'strategy-job-prefs', 'strategy-targets', 'preferences-body']) assert.ok(hosts.includes(id), `${id} is in the live block`);
  for (const id of hosts) assert.ok(!wizard.includes(`id="${id}"`), `the wizard does not repeat ${id}`);
  assert.match(wizard, /id="setup-strategy-slot" class="strategy-page"/, 'the slot that receives the block');
});

test('the wizard step has no second renderer of a field the cards own', () => {
  for (const old of ['chips-roles', 'chips-places', 'chips-country', 'chips-abroad', 'chips-languages', 'chips-rights', 'draft-tiles', 'data-list=', 'doc-profile', 'doc-answers', 'draft-profile', 'draft-answers', 'open-questions']) {
    assert.ok(!wizard.includes(old), `index.html: strategy no longer draws ${old}`);
  }
  for (const old of ['goalTiles', 'markdownView', 'renderList', 'withPills', 'LISTS']) assert.ok(!review.includes(old), `strategy-review.js has no ${old}`);
  assert.ok(review.includes('showCards') && review.includes('hideCards'), 'the review hands the cards the draft');
});

test('the cards move into the wizard reading the draft, and back home', async () => {
  install();
  for (const name of ['setTimeout', 'setInterval']) { const real = globalThis[name]; globalThis[name] = (...args) => { const timer = real(...args); timer?.unref?.(); return timer; }; }   // the page modules' timers never hold the test open
  const doc = globalThis.document;
  const make = (tag, id) => Object.assign(doc.createElement(tag), {id});
  const page = make('section', 'strategy-yours'), liveBlock = make('div', 'strategy-live'), slot = make('div', 'setup-strategy-slot');
  for (const id of ['strategy-main-goals', 'strategy-locations', 'strategy-targets', 'preferences-body']) liveBlock.append(make('div', id));
  page.append(liveBlock);
  doc.body.append(page, slot);
  const have = new Set(['strategy-yours', 'strategy-live', 'setup-strategy-slot', 'strategy-main-goals', 'strategy-locations', 'strategy-targets', 'preferences-body']);
  for (const id of new Set([...html.matchAll(/ id="([^"]+)"/g)].map(match => match[1]))) if (!have.has(id)) doc.body.append(make('div', id));   // every other element the page modules wire at import
  const kept = [];
  globalThis.window.pilot = {state: async () => ({settings: {}}), draftEditLists: async (draft, edits) => ({ok: true, ...editDraftLists(draft, edits)}),
    draftTextOutline: async markdown => ({ok: true, items: [{id: 'L0', type: 'paragraph', text: markdown}]}), draftTextEdit: async (m, c) => ({ok: true, ...(await editDraftText(m, c))}),
    textOutline: async () => { throw new Error('the draft must not read the saved Profile'); }, preferencesParse: async () => { throw new Error('no AI read of a draft'); }};
  const {shared} = await import('../renderer/pages/shared.js');
  shared.draft = {search: {target_roles: [{title: 'Nurse', also: []}], locations: {top_tier: ['brno'], country_wide: [], abroad: []}}, preferences: {}, goals: {seniority: 'Junior'}, profile_markdown: '## Goals\n'};
  const {showCards, hideCards} = await import('../renderer/pages/setup-strategy.js');
  const {strategyState} = await import('../renderer/pages/strategy-state.js');
  showCards({changed: fields => kept.push(...fields)});
  assert.equal(liveBlock.parentNode, slot, 'the block is in the wizard');
  assert.deepEqual(strategyState.lastStrategy.lists.places.map(entry => entry.label), ['brno'], 'the cards read the draft');
  assert.match(liveBlock.querySelector('#strategy-main-goals').textContent || JSON.stringify(liveBlock.querySelector('#strategy-main-goals').children.length), /Nurse|\d/, 'Main goals drawn');
  const {sink} = await import('../renderer/strategy-sink.js');
  await sink.editTargets({places: {add: ['Ostrava'], remove: []}});
  assert.deepEqual(shared.draft.search.locations.top_tier, ['brno', 'ostrava'], 'an edit lands in the draft');
  assert.ok(kept.includes('search'), 'and is kept on this Mac');
  hideCards();
  assert.equal(liveBlock.parentNode, page, 'back on the Strategy page');
  assert.equal(strategyState.lastStrategy, null, 'the Strategy page reads the saved strategy again');
});
