// The AI decides what is unclear (owner, 18 Oct 2026: "an automatic/intelligent way to put them on the queue"; "Every answered line, all 3 pages",
// "Once now + each save", "Keep as is" = "Never ask again for it"): lib/details-review.js judgeNew asks the move's judge for a fixed clarity word per
// answered line, once per value (lib/answer-clarity.js); guess / vague / off_topic become queue items. The AI is a fake that counts its calls (no spend).
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {test} from 'node:test';
import {createStorage} from '../lib/storage.js';
import * as store from '../lib/store/index.js';
import * as review from '../lib/details-review.js';
import {BATCH, move} from '../lib/profile-move.js';
import {fakeNotion} from './fake-notion.js';

const PROFILE = ['## Preferences', 'Relocation: open to moving within the EU', 'Industries to prefer / avoid: ❓', 'Ideal team size: depends',
  '## 💶 Availability & compensation', 'Target: 10000 CHF/month gross [salary]', '## 🛂 Work eligibility', 'Work permit / visa: ❓ your citizenship and status',
  '## ❓ Possible CV gaps', 'Prometheus: ✓ used it at work'];
const ANSWERS = ['## Availability and pay', {table: [['Question', 'Answer'], ['Years of experience with Kubernetes', 'maybe 3?'], ['Why do you want to join us?', 'Yes']]}];
const markdown = lines => lines.map(line => (typeof line === 'object' ? line.table.map((cells, i) => `| ${cells.join(' | ')} |${i === 0 ? '\n|---|---|' : ''}`).join('\n')
  : line.startsWith('## ') ? line : `- ${line}`)).join('\n') + '\n';
const MOVED = {profileMovedAt: '2026-10-18T00:00:00.000Z'};

// The judge's fixed answer, by what the line says (the real one reads meaning in any language). calls: the lines of each call.
function fakeJudge({unsure = /^$/, skip = /^$/} = {}) {
  const calls = [];
  const clarity = line => (/maybe/.test(line) ? 'guess' : /depends/.test(line) ? 'vague' : /join us\?: Yes/.test(line) ? 'off_topic' : 'clear');
  const ai = {client: {messages: {create: async request => {
    const parsed = JSON.parse(request.messages[0].content), items = Array.isArray(parsed) ? parsed : parsed.items;
    calls.push(items.map(each => each.line));
    return {content: [{type: 'text', text: JSON.stringify({items: items.map(({id, line}) => ({id, home: unsure.test(line) ? 'unsure' : 'stay', topic: 'a fact',
      ...(skip.test(line) ? {} : {clarity: clarity(line)})}))})}]};
  }}}};
  return {ai, calls};
}

const plainCrypto = {encrypt: v => v, decrypt: v => v};
const fresh = settings => { const s = createStorage(fs.mkdtempSync(path.join(os.tmpdir(), 'jp-unclear-')), plainCrypto); s.saveSettings(settings); return s; };
const ADAPTERS = {
  sqlite: async (settings = MOVED) => {
    const storage = fresh({store: 'sqlite', telemetry: false, ...settings});
    const opened = store.openStore(storage);
    await opened.page('profile').write(markdown(PROFILE));
    await opened.page('answers').write(markdown(ANSWERS));
    return {storage, fetcher: undefined};
  },
  notion: async (settings = MOVED) => {
    const pages = {profile: fakeNotion(PROFILE, {prefix: 'P'}), answers: fakeNotion(ANSWERS, {prefix: 'A'})};
    const fetcher = (url, init) => (url.includes('blocks/profile') || url.includes('blocks/P') ? pages.profile : pages.answers).fetcher(url, init);
    const storage = fresh({store: 'notion', telemetry: false, notionIds: {NOTION_PROFILE_PAGE_ID: 'profile', NOTION_ANSWERS_PAGE_ID: 'answers'}, ...settings});
    storage.setSecret('NOTION_TOKEN', 'secret');
    return {storage, fetcher};
  },
};
const unclearOf = async env => (await review.pending(env.storage, {fetcher: env.fetcher})).filter(each => each.details.kind === 'unclear');

for (const [name, setup] of Object.entries(ADAPTERS)) {
  test(`${name}: every answered line of the 3 pages is judged once; guess, vague and off-topic are queued with their reason`, async () => {
    const env = await setup();
    const {ai, calls} = fakeJudge();
    const first = await review.judgeNew(env.storage, {fetcher: env.fetcher, ai});
    assert.equal(calls.length, 1, 'one call');
    const lines = calls[0].join('\n');
    for (const line of ['Relocation', 'Ideal team size', 'Target: 10000 CHF', 'Years of experience with Kubernetes', 'Why do you want to join us']) assert.match(lines, new RegExp(line), `${line} is judged`);
    assert.doesNotMatch(lines, /❓/, 'a ❓ is asked already, not judged');
    assert.doesNotMatch(lines, /Prometheus/, 'CV gaps have their own screen');
    assert.equal(first.unclear, 3);
    const items = await unclearOf(env);
    assert.deepEqual(items.map(each => [each.question, each.details.source]).sort(), [
      ['Ideal team size', 'Too vague to use'], ['Why do you want to join us?', 'Does not answer the question'], ['Years of experience with Kubernetes', 'Looks like a guess']]);
    assert.equal(items.find(each => /Kubernetes/.test(each.question)).value, 'maybe 3?', 'the saved value is shown to change');
    await review.judgeNew(env.storage, {fetcher: env.fetcher, ai});
    assert.equal(calls.length, 1, 'judged once: no call when nothing new was saved');
  });
}

test('each save: only a line whose value changed is judged again, and a clear new value leaves the queue', async () => {
  const env = await ADAPTERS.sqlite();
  const {ai, calls} = fakeJudge();
  await review.judgeNew(env.storage, {ai});
  const item = (await unclearOf(env)).find(each => /Kubernetes/.test(each.question));
  assert.equal((await review.answer(env.storage, item.key, '3 years')).ok, true);
  await review.judgeNew(env.storage, {ai});
  assert.deepEqual(calls[1], ['Years of experience with Kubernetes: 3 years'], 'only the saved line');
  assert.ok(!(await unclearOf(env)).some(each => /Kubernetes/.test(each.question)));
});

test('"Keep as is" is never asked again for that value; a new value is judged afresh', async () => {
  const env = await ADAPTERS.sqlite();
  const {ai, calls} = fakeJudge();
  await review.judgeNew(env.storage, {ai});
  const item = (await unclearOf(env)).find(each => /team size/.test(each.question));
  assert.equal((await review.answer(env.storage, item.key, review.KEEP_AS_IS)).ok, true);
  assert.match(await store.openStore(env.storage).page('profile').text(), /Ideal team size: depends/, 'nothing is written');
  await review.judgeNew(env.storage, {ai});
  assert.equal(calls.length, 1);
  assert.ok(!(await unclearOf(env)).some(each => /team size/.test(each.question)), 'kept: not asked again');
  await store.openStore(env.storage).page('profile').write(markdown(PROFILE.map(line => line.replace('depends', 'depends on the project'))));
  await review.judgeNew(env.storage, {ai});
  assert.deepEqual(calls[1], ['Ideal team size: depends on the project'], 'the changed value is judged');
  assert.ok((await unclearOf(env)).some(each => /team size/.test(each.question)));
});

test('an unclear Your details line is answered on its section line (a value not exact is asked as "make it exact" first)', async () => {
  const env = await ADAPTERS.sqlite();
  const {ai} = fakeJudge();
  await store.openStore(env.storage).page('profile').write(markdown(PROFILE.map(line => line.replace('❓ your citizenship and status', 'maybe a B permit, I think'))));
  await review.judgeNew(env.storage, {ai});
  const item = (await unclearOf(env)).find(each => /^Work permit/.test(each.question));
  assert.match(item.details.where, /Work eligibility/);
  assert.equal((await review.answer(env.storage, item.key, 'B permit (Switzerland)')).ok, true);
  assert.match(await store.openStore(env.storage).page('profile').text(), /Work permit \/ visa: B permit \(Switzerland\)/);
  assert.ok(!(await unclearOf(env)).some(each => /^Work permit/.test(each.question)));
});

test('a line the AI gave no clarity is not kept as sure: asked again a day later, not before', async () => {
  const env = await ADAPTERS.sqlite();
  const {ai, calls} = fakeJudge({skip: /Relocation/});
  const now = new Date('2026-10-18T10:00:00Z');
  await review.judgeNew(env.storage, {ai, now});
  await review.judgeNew(env.storage, {ai, now: new Date('2026-10-18T12:00:00Z')});
  assert.equal(calls.length, 1, 'not before a day');
  await review.judgeNew(env.storage, {ai, now: new Date('2026-10-19T11:00:00Z')});
  assert.deepEqual(calls[1].map(line => line.split(':')[0]), ['Relocation']);
});

test('an uncertain line stays intact for automatic retry, never asks the applicant to choose its home', async () => {
  const env = await ADAPTERS.sqlite();
  const {ai} = fakeJudge({unsure: /Relocation/});
  const before = await store.openStore(env.storage).page('profile').text();
  assert.equal((await review.judgeNew(env.storage, {ai})).queued, 0);
  assert.equal(await store.openStore(env.storage).page('profile').text(), before, 'nothing moves');
  assert.deepEqual(env.storage.settings().profileUnsure.map(each => each.label), ['Relocation']);
  assert.ok(!(await review.pending(env.storage)).some(each => each.details.kind === 'where'), 'technical uncertainty is the organizer’s job');
  assert.ok(!(await unclearOf(env)).some(each => /Relocation/.test(each.question)), 'one question per line');
});

test('no AI: nothing is judged or spent, and it is tried again later', async () => {
  const env = await ADAPTERS.sqlite();
  assert.deepEqual(await review.judgeNew(env.storage, {ai: {}}), {judged: 0, queued: 0, unclear: 0});
  assert.equal(env.storage.settings().answerClarity, undefined);
});

test('the narrow details move leaves other lines for one context-aware organization pass', async () => {
  const env = await ADAPTERS.sqlite({});
  const {ai, calls} = fakeJudge();
  await move(env.storage, {ai, copy: async () => ({dir: ''})});
  assert.equal(calls.length, 1);
  await review.judgeNew(env.storage, {ai});
  assert.equal(calls.length, 2, 'outside Your details, the actual destination is judged once with context');
  await review.judgeNew(env.storage, {ai});
  assert.equal(calls.length, 2, 'no repeat after organization');
  assert.ok((await unclearOf(env)).some(each => /Kubernetes/.test(each.question)));
});

test(`a long Profile is judged in calls of ${BATCH} lines (the answer stays under its token limit)`, async () => {
  const env = await ADAPTERS.sqlite();
  await store.openStore(env.storage).page('profile').write(markdown(['## Preferences', ...Array.from({length: BATCH + 5}, (_, i) => `Fact ${i}: value ${i}`)]));
  const {ai, calls} = fakeJudge();
  await review.judgeNew(env.storage, {ai});
  assert.deepEqual(calls.map(each => each.length).sort((a, b) => b - a), [BATCH, 7]);
});
