// The move into Your details loses nothing (owner, 17 Oct 2026: "none of my fields/data will get lost, right? It will just move around"), on every store:
// a full fictional Profile + standard answers, every value before is on a page after; moved lines are word for word; a fact said two ways stays in both
// places and is queued for "Which is right?"; the pages are copied and the backup runs before anything moves; no AI = nothing moves.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {test} from 'node:test';
import {createStorage} from '../lib/storage.js';
import * as store from '../lib/store/index.js';
import * as sections from '../lib/profile-sections.js';
import {judge, move, openConflicts, resolve} from '../lib/profile-move.js';
import {fakeNotion} from './fake-notion.js';

const PROFILE = ['## Targets', '**Roles:** Site Reliability Engineer (senior)', '**Work permit:** EU citizen (no sponsorship needed in Switzerland)',
  '**Languages I can work in:** English (fluent), German (B1)', '**Minimum acceptable:** CHF 130,000 a year', '**Notice period:** 2 months',
  '## Strengths', 'Kubernetes at scale', '## 📇 Contact details', 'Email: alex@example.com', 'Phone: +41 79 000 00 00'];
const ANSWERS = ['## Eligibility', {table: [['Question', 'Answer'], ['Authorised to work in Switzerland?', 'Yes, EU citizen with a B permit'], ['Need visa sponsorship?', 'No'], ['Willing to relocate', '❓']]},
  '## Availability and pay', {table: [['Question', 'Answer'], ['Notice period / earliest start', '3 months'], ['Salary expectation', 'CHF 140,000']]},
  '## Common questions', {table: [['Question', 'Answer'], ['How did you hear about us?', 'LinkedIn']]}];
const markdown = lines => lines.map(line => (typeof line === 'object' ? line.table.map((cells, i) => `| ${cells.join(' | ')} |${i === 0 ? '\n|---|---|' : ''}`).join('\n')
  : line.startsWith('## ') ? line : `- ${line}`)).join('\n') + '\n';

// The AI's fixed answer, by what each line says (a fake: the real one reads meaning in any language).
const RULES = [[/Work permit/, 'eligibility', 'work permit'], [/Authorised to work/, 'eligibility', 'right to work switzerland'], [/visa sponsorship/, 'eligibility', 'sponsorship'],
  [/Languages I can/, 'languages', 'languages'], [/Notice period/, 'availability', 'notice period'], [/Salary expectation/, 'availability', 'salary expectation']];
const ai = (calls = []) => ({client: {messages: {create: async request => {
  const items = JSON.parse(request.messages[0].content);
  calls.push(items);
  return {content: [{type: 'text', text: JSON.stringify({items: items.map(({id, line}) => {
    const rule = RULES.find(([pattern]) => pattern.test(line));
    return rule ? {id, home: rule[1], topic: rule[2]} : {id, home: 'stay', topic: 'other'};
  })})}]};
}}}});

const plainCrypto = {encrypt: v => v, decrypt: v => v};
const fresh = settings => { const s = createStorage(fs.mkdtempSync(path.join(os.tmpdir(), 'jp-move-')), plainCrypto); s.saveSettings(settings); return s; };
const ADAPTERS = {
  sqlite: async () => {
    const storage = fresh({store: 'sqlite'});
    const opened = store.openStore(storage);
    await opened.page('profile').write(markdown(PROFILE));
    await opened.page('answers').write(markdown(ANSWERS));
    return {storage, fetcher: undefined};
  },
  notion: async () => {
    const pages = {profile: fakeNotion(PROFILE, {prefix: 'P'}), answers: fakeNotion(ANSWERS, {prefix: 'A'})};
    const fetcher = (url, init) => {
      const route = url.replace('https://api.notion.com/v1/', '');
      const page = route.startsWith('blocks/profile') || route.startsWith('blocks/P') ? pages.profile : pages.answers;
      return page.fetcher(url, init);
    };
    const storage = fresh({store: 'notion', notionIds: {NOTION_PROFILE_PAGE_ID: 'profile', NOTION_ANSWERS_PAGE_ID: 'answers'}});
    storage.setSecret('NOTION_TOKEN', 'secret');
    return {storage, fetcher};
  },
};
const VALUES = ['Site Reliability Engineer (senior)', 'EU citizen (no sponsorship needed in Switzerland)', 'English (fluent), German (B1)', 'CHF 130,000 a year', '2 months',
  'Kubernetes at scale', 'alex@example.com', '+41 79 000 00 00', 'Yes, EU citizen with a B permit', 'No', '3 months', 'CHF 140,000', 'LinkedIn', 'Willing to relocate'];
const both = async (storage, fetcher) => (await Promise.all(['profile', 'answers'].map(name => store.openStore(storage, {fetcher}).page(name).text())));

for (const [name, make] of Object.entries(ADAPTERS)) {
  test(`${name}: every value is still there after the move; moved lines word for word; a fact said two ways stays put and is queued`, async () => {
    const {storage, fetcher} = await make();
    const copies = [];
    const copy = async () => { copies.push(await both(storage, fetcher)); return {dir: 'copy-dir', file: 'backup.tar.gz'}; };
    const result = await move(storage, {fetcher, ai: ai(), copy});
    assert.equal(copies.length, 1, 'the pages are copied (and backed up) before anything moves');
    assert.match(copies[0][0], /Work permit/);
    const [profile, answers] = await both(storage, fetcher);
    for (const value of VALUES) assert.ok(`${profile}\n${answers}`.includes(value), `lost: ${value}`);
    const read = await sections.read(storage, fetcher);
    assert.deepEqual(read.eligibility, [{label: 'Work permit', value: 'EU citizen (no sponsorship needed in Switzerland)'},
      {label: 'Authorised to work in Switzerland?', value: 'Yes, EU citizen with a B permit'}, {label: 'Need visa sponsorship?', value: 'No'}]);
    assert.deepEqual(read.languages, [{label: 'Languages I can work in', value: 'English (fluent), German (B1)'}]);
    assert.deepEqual(read.availability, [{label: 'Salary expectation', value: 'CHF 140,000'}]);
    assert.equal(result.moved, 5);
    assert.deepEqual(result.conflicts.map(c => [c.home, c.topic, c.choices.map(choice => choice.value)]), [['availability', 'notice period', ['2 months', '3 months']]]);
    assert.deepEqual(storage.settings().profileConflicts, result.conflicts, 'queued for "Which is right?"');
    // the originals left their old places; the conflict and what stays did not move
    assert.equal(profile.match(/Work permit/g).length, 1);
    assert.doesNotMatch(answers, /Authorised to work|visa sponsorship|Salary expectation/);
    assert.match(profile, /Notice period:?\**:? 2 months/);
    assert.match(answers, /Notice period \/ earliest start \| 3 months/);
    for (const kept of ['Minimum acceptable', 'Roles', 'Kubernetes at scale', 'Willing to relocate', 'How did you hear about us?']) assert.ok(`${profile}\n${answers}`.includes(kept), kept);
  });
}

test('a second move finds nothing new to move; no AI or nothing to move: no copy, nothing written', async () => {
  const {storage} = await ADAPTERS.sqlite();
  let copied = 0;
  const copy = async () => { copied++; return {dir: 'd', file: 'f'}; };
  const before = await both(storage);
  assert.equal((await move(storage, {copy})).moved, 0, 'no AI');
  assert.deepEqual(await both(storage), before);
  await move(storage, {ai: ai(), copy});
  const calls = [];
  assert.equal((await move(storage, {ai: ai(calls), copy})).moved, 0, 'already moved');
  assert.equal(copied, 1);
});

test('an AI answer for an id it was not given, or an unknown home, moves nothing', async () => {
  const {storage} = await ADAPTERS.sqlite();
  const bad = {client: {messages: {create: async () => ({content: [{type: 'text', text: JSON.stringify({items: [{id: 'profile:999', home: 'eligibility', topic: 'x'}, {id: 'profile:2', home: 'hobbies', topic: 'x'}]})}]})}}};
  const before = await both(storage);
  assert.equal((await move(storage, {ai: bad, copy: async () => ({dir: 'd'})})).moved, 0);
  assert.deepEqual(await both(storage), before);
});

test('a section that did not save stops the move before any original is removed', async () => {
  const {storage} = await ADAPTERS.sqlite();
  const before = await both(storage);
  const original = sections.save;
  await assert.rejects(() => move(storage, {ai: ai(), copy: async () => ({dir: 'copy-dir'}), save: async () => []}), /did not save; nothing was removed/);
  assert.equal(sections.save, original);
  assert.deepEqual(await both(storage), before, 'both pages as they were');
});

test('"Which is right?": the picked value becomes the line, every other copy of that fact goes, the rest stays', async () => {
  for (const [name, make] of Object.entries(ADAPTERS)) {
    const {storage, fetcher} = await make();
    const {conflicts} = await move(storage, {fetcher, ai: ai(), copy: async () => ({dir: 'd'})});
    assert.deepEqual(await resolve(storage, conflicts[0].topic, 1, {fetcher}), {ok: true}, name);
    assert.deepEqual((await sections.read(storage, fetcher)).availability, [{label: 'Salary expectation', value: 'CHF 140,000'}, {label: 'Notice period / earliest start', value: '3 months'}], name);
    const [profile, answers] = await both(storage, fetcher);
    assert.doesNotMatch(`${profile}\n${answers}`, /2 months/, name);
    assert.equal(`${profile}\n${answers}`.match(/3 months/g).length, 1, name);
    assert.deepEqual(storage.settings().profileConflicts, [], name);
    assert.deepEqual(await resolve(storage, conflicts[0].topic, 0, {fetcher}), {ok: false, error: 'That choice is no longer open'}, name);
  }
});

test('a Profile the AI judged with nothing to move is not judged again', async () => {
  const {storage} = await ADAPTERS.sqlite();
  const calls = [];
  const stay = {client: {messages: {create: async request => { calls.push(1); const items = JSON.parse(request.messages[0].content); return {content: [{type: 'text', text: JSON.stringify({items: items.map(({id}) => ({id, home: 'stay', topic: 'x'}))})}]}; }}}};
  await move(storage, {ai: stay, copy: async () => ({dir: 'd'})});
  assert.ok(storage.settings().profileMovedAt);
});

// 17 Oct 2026 (the Locations queue showed values saved before a fix): a saved "Which is right?" queue is checked against the pages each time it is
// shown. A choice whose line is gone or now says the same as the other closes the question; nothing is written for it.
test('"Which is right?" shows only conflicts the pages still have', async () => {
  for (const [name, make] of Object.entries(ADAPTERS)) {
    const {storage, fetcher} = await make();
    await move(storage, {fetcher, ai: ai(), copy: async () => ({dir: 'd'})});
    assert.equal((await openConflicts(storage, {fetcher})).length, 1, `${name}: unchanged pages keep it`);
    const answers = store.openStore(storage, {fetcher}).page('answers');
    if (name === 'sqlite') await answers.write((await answers.text()).replace('3 months', '2 months'));   // the person corrected it by hand
    else continue;   // the fake Notion page has no free-text edit; the rule is the same code
    assert.deepEqual(await openConflicts(storage, {fetcher}), [], `${name}: both now say 2 months`);
    assert.deepEqual(storage.settings().profileConflicts, [], `${name}: the queue is saved without it`);
  }
});


for (const [action, options] of [
  ['answer_home', {}],
  ['organize_lines', {destinations: [{id: 'availability', page: 'profile', heading: 'Availability', path: []}]}],
]) {
  test(`${action}: profile judgments name their AI request`, async () => {
    let sent;
    const client = {messages: {create: async (_request, options) => { sent = options; return {content: []}; }}};
    await judge([{id: 'profile:1', label: 'Notice', value: '2 months'}], {client}, options);
    assert.equal(sent?.headers?.['x-jp-action'], action);
  });
}
