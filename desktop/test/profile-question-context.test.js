// Repeated Profile reads retain every distinct saved line and expose exact copies once with their source context in the review UI.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {test} from 'node:test';
import {createStorage} from '../lib/storage.js';
import {openStore} from '../lib/store/index.js';
import {itemsOf, keepUnsure, move} from '../lib/profile-move.js';
import * as review from '../lib/details-review.js';
import {openShown} from '../lib/question-lists.js';
import {fakeNotion} from './fake-notion.js';
import {install} from './tiny-dom.js';

const PROFILE = ['## Preferences', 'Relocation: EU only', 'Relocation: EU only', 'Relocation: Canada only', 'A saved line without a label'];
const ANSWERS = ['## Saved details', 'Relocation: EU only'];
const crypto = {encrypt: value => value, decrypt: value => value};
const markdown = lines => lines.map(line => line.startsWith('##') ? line : `- ${line}`).join('\n');
const ai = {client: {messages: {create: async request => ({content: [{type: 'text', text: JSON.stringify({items: JSON.parse(request.messages[0].content).map(({id}) => ({id, home: 'unsure', topic: 'relocation', clarity: 'clear'}))})}]})}}};
async function setup(adapter) {
  const storage = createStorage(fs.mkdtempSync(path.join(os.tmpdir(), 'jp-question-context-')), crypto);
  storage.saveSettings({store: adapter, telemetry: false});
  let fetcher;
  if (adapter === 'notion') {
    storage.setSecret('NOTION_TOKEN', 'fictional');
    storage.saveSettings({notionIds: {NOTION_PROFILE_PAGE_ID: 'profile', NOTION_ANSWERS_PAGE_ID: 'answers'}});
    const pages = {profile: fakeNotion(PROFILE, {prefix: 'P'}), answers: fakeNotion(ANSWERS, {prefix: 'A'})};
    fetcher = (url, init) => (url.includes('blocks/profile') || url.includes('blocks/P') ? pages.profile : pages.answers).fetcher(url, init);
  } else {
    await openStore(storage).page('profile').write(markdown(PROFILE));
    await openStore(storage).page('answers').write(markdown(ANSWERS));
  }
  const read = async () => (await Promise.all(['profile', 'answers'].map(async page => itemsOf(await openStore(storage, {fetcher}).page(page).outline(), page)))).flat();
  return {storage, fetcher, read};
}
const queued = async env => Object.values(await openShown(env.storage, {fetcher: env.fetcher, ai: {}})).filter(Array.isArray).flat().filter(item => item.details?.kind === 'where');
const legacy = (value = 'EU only') => ({key: `details:where:${JSON.stringify({pages: ['answers', 'profile'], label: 'Relocation', value})}`});

for (const adapter of ['sqlite', 'notion']) {
  test(`${adapter}: repeated import/re-read and restarted queue preserve distinct lines, ask once per exact content`, async () => {
    const env = await setup(adapter), before = await env.read();
    await move(env.storage, {fetcher: env.fetcher, ai});
    assert.equal(env.storage.settings().profileUnsure.length, 4, 'same-source duplicate in one producer batch is queued once');
    assert.equal(keepUnsure(env.storage, before), 0, 'reconciliation of an existing source adds nothing');
    await move(env.storage, {fetcher: env.fetcher, ai});
    const first = await queued(env);
    assert.equal(first.length, 0, 'the applicant never chooses a technical home, including while AI is unavailable');
    const restarted = {...env, storage: createStorage(env.storage.dir, crypto)};
    assert.deepEqual((await queued(restarted)).map(item => item.key).sort(), first.map(item => item.key).sort(), 'persisted queue reload keeps stable identities');
    assert.deepEqual(await env.read(), before, 'no source facts moved or removed by deduplication');
    // Older installs may already have repeated queue metadata. Reconcile it without losing any source content.
    env.storage.saveSettings({profileUnsure: [...env.storage.settings().profileUnsure, ...env.storage.settings().profileUnsure]});
    assert.equal((await queued(env)).length, 0, 'legacy repeated queue entries cannot become home-picker questions');
    keepUnsure(env.storage, before);
    assert.equal(env.storage.settings().profileUnsure.length, 4, 'producer persists a deduplicated queue');
  });

  test(`${adapter}: choosing a home moves all exact source copies once and leaves the other value intact`, async () => {
    const env = await setup(adapter);
    await move(env.storage, {fetcher: env.fetcher, ai});
    const item = legacy();
    const result = await review.answer(env.storage, item.key, '🛂 Work eligibility', {fetcher: env.fetcher});
    assert.equal(result.ok, true, result.error);
    const lines = await env.read();
    assert.equal(lines.filter(line => line.label === 'Relocation' && line.value === 'EU only').length, 1, 'all exact sources become one verified home line');
    assert.ok(lines.some(line => line.label === 'Relocation' && line.value === 'Canada only'));
    assert.ok(lines.some(line => line.value === 'A saved line without a label'));
    assert.equal(env.storage.settings().profileUnsure.length, 2);
  });

  test(`${adapter}: routing two different saved values of one label to the same home preserves both`, async () => {
    const env = await setup(adapter);
    await move(env.storage, {fetcher: env.fetcher, ai});
    for (const value of ['EU only', 'Canada only']) {
      const item = legacy(value);
      const result = await review.answer(env.storage, item.key, '🛂 Work eligibility', {fetcher: env.fetcher});
      assert.equal(result.ok, true, result.error);
    }
    assert.deepEqual((await env.read()).filter(line => line.home === 'eligibility' && line.label === 'Relocation').map(line => line.value).sort(), ['Canada only', 'EU only']);
  });

  test(`${adapter}: failed destination read-back preserves all sources and their pending review`, async () => {
    const env = await setup(adapter), before = await env.read();
    await move(env.storage, {fetcher: env.fetcher, ai});
    const item = legacy();
    const result = await review.answer(env.storage, item.key, '🛂 Work eligibility', {fetcher: env.fetcher, save: async () => {}});
    assert.equal(result.ok, false);
    assert.deepEqual(await env.read(), before);
    assert.ok(env.storage.settings().profileUnsure.some(each => each.label === 'Relocation' && each.value === 'EU only'));
  });

  test(`${adapter}: a legacy cached single-page key and keep choice remain reviewable`, async () => {
    const env = await setup(adapter), before = await env.read();
    await move(env.storage, {fetcher: env.fetcher, ai});
    const key = `details:where:${JSON.stringify({page: 'profile', label: 'Relocation', value: 'EU only'})}`;
    assert.equal((await review.answer(env.storage, key, 'Keep on the Profile', {fetcher: env.fetcher})).ok, true);
    assert.deepEqual(await env.read(), before);
    const remaining = env.storage.settings().profileUnsure.filter(each => each.value === 'EU only');
    assert.deepEqual(remaining.map(each => each.page), ['answers'], 'the old action only applied to the source it named');
  });

  test(`${adapter}: keeping an exact copied line closes all its review copies and preserves every source line`, async () => {
    const env = await setup(adapter), before = await env.read();
    await move(env.storage, {fetcher: env.fetcher, ai});
    const item = legacy();
    assert.equal((await review.answer(env.storage, item.key, review.KEEP, {fetcher: env.fetcher})).ok, true);
    assert.deepEqual(await env.read(), before);
    assert.equal((await queued(env)).filter(item => item.details.line === 'Relocation: EU only').length, 0);
    assert.equal(env.storage.settings().profileUnsure.length, 2, 'other values remain for the automatic organizer');
  });
}

test('a stale cached home picker cannot reappear when the store is offline; original saved answers remain visible', async () => {
  const env = await setup('sqlite');
  await move(env.storage, {ai});
  const body = install();
  for (const id of ['answers-body', 'questions', 'questions-count', 'questions-details', 'questions-error', 'questions-retry', 'questions-review', 'questions-manage']) {
    const node = globalThis.document.createElement('div'); node.id = id; body.append(node);
  }
  const cached = [{...legacy(), question: 'Where does this line go?', details: {kind: 'where', line: 'Relocation: EU only'}}];
  globalThis.localStorage = {getItem: key => key === 'questionsCache' ? JSON.stringify(cached) : null, setItem: () => {}};   // the one-list cache of before 28 Oct 2026: never read
  globalThis.window.pilot = new Proxy({
    textOutline: async name => ({ok: true, items: name === 'answers' ? await openStore(env.storage).page('answers').outline() : [], store: 'sqlite', link: null}),
    openQuestions: async () => ({error: 'fictional offline store'}),
  }, {get: (all, key) => all[key] || (() => null)});
  const answers = await import('../renderer/pages/application-answers.js');
  const jobs = await import('../renderer/pages/jobs-questions.js');
  await jobs.loadQuestions({force: true});
  assert.equal(jobs.questionsNow().details.length + jobs.questionsNow().learned.length, 0);
  await answers.loadApplicationAnswers();
  assert.match(globalThis.document.getElementById('answers-body').textContent, /Relocation/);
  assert.ok(!globalThis.document.getElementById('answers-body').textContent.includes('Where does this line go?'));
});
