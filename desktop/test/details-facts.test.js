// Your details' fact sections reach the screen (owner, 17 Oct 2026): each section has its panel (⌘K lists it), the screen saves them with Contact through
// the one bar, the handlers read, save and resolve through lib/profile-sections.js and lib/profile-move.js, and the move runs once, never twice.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {test} from 'node:test';
import {createStorage} from '../lib/storage.js';
import {registerDetailsFactsHandlers} from '../lib/details-facts-handlers.js';
import * as sections from '../lib/profile-sections.js';
import * as store from '../lib/store/index.js';
import {openShown} from '../lib/question-lists.js';
import {keyOf} from '../renderer/question-filter.js';

const read = file => fs.readFileSync(new URL(`../${file}`, import.meta.url), 'utf8');

test('every section has its own panel on Your details, and the screen draws exactly those', async () => {
  const html = read('renderer/index.html');
  const keys = JSON.parse(read('renderer/pages/details-facts.js').match(/KEYS = (\[[^\]]+\])/)[1].replace(/'/g, '"'));
  assert.deepEqual(keys, Object.keys(sections.SECTIONS));
  for (const key of keys) assert.match(html, new RegExp(`id="setting-${key}" data-profile-panel="details"[\\s\\S]*?data-facts="${key}"`), key);
  assert.match(html, /id="setting-which" data-profile-panel="details" data-wanted="0" hidden/);
});

test('one Save bar: Contact, then the fact sections; Discard redraws them', () => {
  // Since 18 Oct 2026 the Profile page's one bar (pages/details-drafts.js): Contact and the fact sections are two sources; Discard redraws the facts.
  const drafts = read('renderer/pages/details-drafts.js');
  assert.match(drafts, /window\.pilot\.saveDetailsFacts\(factsNow\(\)\)/);
  assert.match(drafts, /showFacts\(\{redraw: true\}\)/);
});

function harness(settings = {store: 'sqlite'}) {
  const storage = createStorage(fs.mkdtempSync(path.join(os.tmpdir(), 'jp-facts-')), {encrypt: v => v, decrypt: v => v});
  storage.saveSettings(settings);
  const handlers = {}, logged = [];
  registerDetailsFactsHandlers({ipcMain: {handle: (name, fn) => { handlers[name] = (...args) => fn(null, ...args); }}, storage, DEMO: false,
    connected: () => true, needsNotion: () => null, log: (...line) => logged.push(line)});
  return {storage, handlers, logged};
}

test('handlers: saved lines read back; with no AI nothing moves and the move is tried again next time', async () => {
  const {storage, handlers} = harness();
  await store.openStore(storage).page('profile').write('## Targets\n- **Notice period:** 2 months\n');
  assert.deepEqual((await handlers.saveDetailsFacts({languages: [{label: 'English', value: 'native'}, {label: 'German', value: ''}]})), {ok: true});
  const got = await handlers.detailsFacts();
  assert.equal(got.ok, true);
  assert.deepEqual(got.sections.languages, [{label: 'English', value: 'native'}]);
  assert.equal(storage.settings().profileMovedAt, undefined, 'no AI: not marked moved');
  assert.match(await store.openStore(storage).page('profile').text(), /Notice period/);
  assert.deepEqual(await handlers.resolveDetailsConflict('nothing open', 0), {ok: false, error: 'That choice is no longer open'});
});

test('handlers: once the move ran, opening Your details never moves again for the same lines', async () => {
  const {handlers, logged} = harness({store: 'sqlite', profileMovedAt: '2026-10-17T10:00:00Z', factsWaiting: 'notice period', factsMovedFor: 'notice period'});
  await handlers.detailsFacts();
  assert.equal(logged.length, 0);
});

// PR B2c (owner 28 Oct 2026, What we learned: "nothing deleted", fact lines go to their home): an answer saved after the first move and judged a Your
// details fact (lib/question-lists.js factsWaiting) is moved on the next open, by the same move; then that set is done.
test('a fact answer saved after the move: What we learned reads it, Your details\' next open moves it word for word, once', async () => {
  const calls = [];
  const ai = () => ({client: {messages: {create: async request => {
    const items = JSON.parse(request.messages[0].content);
    if (Array.isArray(items)) calls.push(items.length);   // the move's calls (the answers check asks its own)
    return {content: [{type: 'text', text: JSON.stringify({items: items.map(({id, line}) => ({id, home: /notice/i.test(line) ? 'availability' : 'stay', topic: 'x', clarity: 'clear'}))})}]};
  }}}});
  const storage = createStorage(fs.mkdtempSync(path.join(os.tmpdir(), 'jp-facts-')), {encrypt: v => v, decrypt: v => v});
  // The AI's verdict on the saved answer (lib/question-verdicts.js, its own call): a Your details fact.
  storage.saveSettings({store: 'sqlite', profileMovedAt: '2026-10-17T10:00:00Z', questionVerdicts: {[keyOf('Notice period')]: {reuse: 'details', fact: 'Notice period', question: 'Notice period', asked: 0}}});
  const handlers = {}, logged = [];
  registerDetailsFactsHandlers({ipcMain: {handle: (name, fn) => { handlers[name] = (...args) => fn(null, ...args); }}, storage, DEMO: false,
    connected: () => true, needsNotion: () => null, log: (...line) => logged.push(line), ai, copy: async () => ({dir: 'copy'})});
  await store.openStore(storage).page('answers').write('## Common questions\n| Question | Answer |\n|---|---|\n| Notice period | 3 months |\n| How did you hear about us? | LinkedIn |\n');
  await openShown(storage, {ai: {}});   // What we learned reads the answers: the fact waits for the move (Gitar on #2340: the producer, not a seeded setting)
  assert.equal(storage.settings().factsWaiting, keyOf('Notice period'));
  const got = await handlers.detailsFacts();
  assert.deepEqual(got.sections.availability, [{label: 'Notice period', value: '3 months'}]);
  const answers = await store.openStore(storage).page('answers').text();
  assert.doesNotMatch(answers, /Notice period/, 'moved, not copied');
  assert.match(answers, /LinkedIn/, 'a learning stays');
  assert.equal(storage.settings().factsMovedFor, 'notice period');
  const before = calls.length;
  await handlers.detailsFacts();
  assert.equal(calls.length, before, 'the same lines are not judged again');
});

test('two overlapping opens of Your details move once: the second waits for the first and never rolls its lines back (owner log 17 Oct 2026, 22:28 + 22:29)', async () => {
  const storage = createStorage(fs.mkdtempSync(path.join(os.tmpdir(), 'jp-facts-')), {encrypt: v => v, decrypt: v => v});
  storage.saveSettings({store: 'sqlite', profileMovedAt: '2026-10-17T10:00:00Z'});
  const page = store.openStore(storage).page('profile');
  await page.insertAfter(await page.appendHeading('Application form answers — voluntary demographic surveys'), ['Gender identity: Man (or Male when that is the equivalent option).', 'Identifies as transgender: No.']);
  const asked = [], logged = [];
  const slow = {client: {messages: {create: async request => {
    asked.push(request.system.slice(0, 40));
    await new Promise(done => setTimeout(done, 60));
    return {content: [{type: 'text', text: JSON.stringify({items: [
      {id: '0', kind: 'answer', question: 'gender', option: 'Man', note: 'or Male when that is the equivalent option'}, {id: '1', kind: 'answer', question: 'transgender', option: 'No', note: ''}]})}]};
  }}}};
  const handlers = {};
  registerDetailsFactsHandlers({ipcMain: {handle: (name, fn) => { handlers[name] = (...args) => fn(null, ...args); }}, storage, DEMO: false,
    connected: () => true, needsNotion: () => null, log: (...line) => logged.push(line), ai: () => slow, copy: async () => ({dir: 'd'})});
  const [first, second] = await Promise.all([handlers.detailsFacts(), handlers.detailsFacts()]);
  assert.equal(first.ok, true, first.error);
  assert.equal(second.ok, true, second.error);
  assert.equal(logged.filter(line => /survey move stopped/.test(line[1])).length, 0);
  const lines = (await page.outline()).filter(block => /pick one/.test(block.text || '')).length;
  assert.equal(lines, 2, 'both survey lines stay moved');
  assert.equal(asked.filter(text => /voluntary demographic|Each item is one line/.test(text)).length >= 1, true);
});

test('every one-time move of Your details runs inside the one shared open, so a new move cannot skip the guard', () => {
  const source = read('lib/details-facts-handlers.js').replace(/\/\/.*$/gm, '');
  const start = source.indexOf('const open = async'), end = source.indexOf("ipcMain.handle('detailsFacts'");
  const moves = [...source.matchAll(/await (move|\w+\.(?:tidy|split|migrate))\(storage/g)];
  assert.ok(moves.length >= 4, `expected the facts move, kinds tidy, notes split and survey move, found ${moves.map(each => each[1])}`);
  for (const each of moves) assert.ok(each.index > start && each.index < end, `${each[1]} runs outside the shared open`);
  assert.match(source, /ipcMain\.handle\('detailsFacts', \(\) => opening \|\|= open\(\)/);
});

test('the first read never waits on an AI call: detailsFactsNow answers with the saved lines while the moves are still running; detailsFacts settles them and says how many changed', async () => {
  const storage = createStorage(fs.mkdtempSync(path.join(os.tmpdir(), 'jp-facts-')), {encrypt: v => v, decrypt: v => v});
  storage.saveSettings({store: 'sqlite', profileMovedAt: '2026-10-17T10:00:00Z'});
  const page = store.openStore(storage).page('profile');
  await page.insertAfter(await page.appendHeading('Application form answers — voluntary demographic surveys'), ['Identifies as transgender: No.']);
  let release, asked = 0;
  const gate = new Promise(done => { release = done; });
  const slow = {client: {messages: {create: async () => { asked++; await gate; return {content: [{type: 'text', text: JSON.stringify({items: [{id: '0', kind: 'answer', question: 'transgender', option: 'No', note: ''}]})}]}; }}}};
  const handlers = {};
  registerDetailsFactsHandlers({ipcMain: {handle: (name, fn) => { handlers[name] = (...args) => fn(null, ...args); }}, storage, DEMO: false,
    connected: () => true, needsNotion: () => null, log: () => {}, ai: () => slow, copy: async () => ({dir: 'd'})});
  const settling = handlers.detailsFacts();
  const now = await Promise.race([handlers.detailsFactsNow(), new Promise(done => setTimeout(() => done('waited'), 2000))]);
  assert.notEqual(now, 'waited', 'the quick read waited on the AI');
  assert.equal(now.ok, true);
  assert.equal(now.settling, true);
  release();
  const settled = await settling;
  assert.equal(settled.ok, true, settled.error);
  assert.ok(settled.changed >= 1, 'the settled answer counts what the moves changed');
  assert.ok(asked >= 1);
});

test('the screen paints the quick read first, waits for the settled one after it, and the survey card redraws when it is done', () => {
  const facts = read('renderer/pages/details-facts.js'), card = read('renderer/pages/experience-profile.js');
  const show = facts.slice(facts.indexOf('export async function showFacts'));
  assert.ok(show.indexOf('detailsFactsNow') < show.indexOf('window.pilot.detailsFacts()'), 'quick read first');
  assert.match(show, /details-sorting/);
  assert.match(card, /'details-sorting'[\s\S]*reread\('details'\)/);
  assert.match(read('preload.cjs'), /detailsFactsNow: call\('detailsFactsNow'\)/);
});

// Why (28 Oct 2026, owner, #2322: "we can deduce any of them, once we know the answer for the 3 above"; never delete a saved value silently): the owner's
// path through the handlers. Opening reads the older lines once, backs up, folds and saves them (owner, 28 Oct 2026, below); Undo puts them back. Fictional values.
// Owner, 28 Oct 2026 ("Save them automatically", reversing #2322's draft): the older eligibility lines the AI read are folded and saved on open, a backup first, Undo after
// (the full state is in test/details-eligibility-autosave.test.js).
test('handlers: older eligibility lines are concluded and saved on open, backed up first, and Undo restores them', async () => {
  const storage = createStorage(fs.mkdtempSync(path.join(os.tmpdir(), 'jp-facts-')), {encrypt: v => v, decrypt: v => v});
  storage.saveSettings({store: 'sqlite', profileMovedAt: '2026-10-17T10:00:00Z'});
  const OLD = [{label: 'Work permit / visa', value: 'EU citizen (Romania)'}, {label: 'Remote from your base for a foreign employer?', value: 'Yes'}];
  await sections.save(storage, 'eligibility', OLD);
  const reading = {lines: [{id: '0', about: 'eligibility', nationality: ['RO'], rows: []}, {id: '1', about: 'other', nationality: [], rows: []}]};
  const client = {messages: {create: async request => ({content: [{type: 'text', text: JSON.stringify(/right to work/.test(request.system) ? reading : {})}]})}};
  const handlers = {}, copies = [];
  registerDetailsFactsHandlers({ipcMain: {handle: (name, fn) => { handlers[name] = (...args) => fn(null, ...args); }}, storage, DEMO: false, connected: () => true,
    needsNotion: () => null, log: () => {}, ai: () => ({client}), copy: async () => { copies.push(1); }});
  const opened = await handlers.detailsFacts();
  assert.equal(opened.older, undefined, 'nothing is left for the screen to propose');
  assert.equal(copies.length, 1, 'both pages are copied before a line leaves');
  const lines = (await sections.read(storage)).eligibility;
  assert.equal(lines.find(line => line.label === 'Nationality')?.value, 'Romania');
  assert.equal(lines.some(line => line.label === OLD[0].label), false, 'the folded line is gone');
  assert.equal(lines.some(line => line.label === OLD[1].label), true, 'a line the AI read as other stays');
  assert.equal(opened.tidied.changed >= 1, true, 'the conclusion is offered with Undo');
  assert.deepEqual(await handlers.undoDetailsTidy(), {ok: true});
  assert.deepEqual((await sections.read(storage)).eligibility.map(line => line.label), OLD.map(line => line.label));
});

// The class (mac-27 on #2340, CLAUDE.md Safety "cut it off and assert it"): a test that reaches the move without its own copy target is refused before any
// page changes, whoever the caller (lib/backup.js folder refuses the real folder under the test runner); before, it reached this Mac's iCloud backup folder.
test('a move with no copy target under the test runner is refused: no real backup folder, nothing moved', async () => {
  const {move} = await import('../lib/profile-move.js');
  const storage = createStorage(fs.mkdtempSync(path.join(os.tmpdir(), 'jp-facts-')), {encrypt: v => v, decrypt: v => v});
  storage.saveSettings({store: 'sqlite'});
  await store.openStore(storage).page('answers').write('## Common questions\n| Question | Answer |\n|---|---|\n| Notice period | 3 months |\n');
  const ai = {client: {messages: {create: async request => ({content: [{type: 'text', text: JSON.stringify({items: JSON.parse(request.messages[0].content)
    .map(({id}) => ({id, home: 'availability', topic: 'x', clarity: 'clear'}))})}]})}}};
  await assert.rejects(move(storage, {ai}), /real backup folder/);
  assert.match(await store.openStore(storage).page('answers').text(), /Notice period \| 3 months/, 'nothing moved');
});

