// Automatic organization uses real source pages and the existing AI seam, preserving distinct facts without asking applicants to pick a technical home.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {test} from 'node:test';
import {createStorage} from '../lib/storage.js';
import {openStore} from '../lib/store/index.js';
import {itemsOf, move} from '../lib/profile-move.js';
import {contexts} from '../lib/profile-destinations.js';
import {sigOf} from '../lib/answer-clarity.js';
import * as review from '../lib/details-review.js';
import {openShown} from '../lib/question-lists.js';
import {fakeNotion} from './fake-notion.js';
import {install} from './tiny-dom.js';

const PROFILE = ['## Imported notes', 'Rule Q: avoid slogans', 'Règle Z: rester sobre', 'Notice period: 1 month', 'Notice period: 2 months', 'Evidence: maintained a fictional service', 'Opaque saved line'];
const ANSWERS = ['## Imported answers', 'Rule Q: avoid slogans'];
const crypto = {encrypt: value => value, decrypt: value => value};
const markdown = lines => lines.map(line => line.startsWith('#') ? line : `- ${line}`).join('\n');
async function setup(adapter, {profile = PROFILE, answers = ANSWERS} = {}) {
  const storage = createStorage(fs.mkdtempSync(path.join(os.tmpdir(), 'jp-auto-home-')), crypto);
  storage.saveSettings({store: adapter, telemetry: false, profileMovedAt: '2026-10-21T00:00:00Z', profileUnsureAt: '2026-10-21T00:00:00Z'});
  let fetcher;
  if (adapter === 'notion') {
    storage.setSecret('NOTION_TOKEN', 'fictional');
    storage.saveSettings({notionIds: {NOTION_PROFILE_PAGE_ID: 'profile', NOTION_ANSWERS_PAGE_ID: 'answers'}});
    const pages = {profile: fakeNotion(profile, {prefix: 'P'}), answers: fakeNotion(answers, {prefix: 'A'})};
    fetcher = (url, init) => (url.includes('blocks/profile') || url.includes('blocks/P') ? pages.profile : pages.answers).fetcher(url, init);
  } else {
    await openStore(storage).page('profile').write(markdown(profile));
    await openStore(storage).page('answers').write(markdown(answers));
  }
  const read = async () => (await Promise.all(['profile', 'answers'].map(async page => itemsOf(await openStore(storage, {fetcher}).page(page).outline(), page)))).flat();
  const sources = await read();
  storage.saveSettings({profileUnsure: sources.map(({page, label, value}) => ({page, label, value})), answerClarity: Object.fromEntries(sources.map(line => [sigOf(line), 'clear']))});
  const copies = [], copy = async () => { copies.push(await texts({storage, fetcher})); return {dir: 'fictional-copy', file: 'fictional-backup'}; };
  return {storage, fetcher, read, copies, copy};
}
const texts = async ({storage, fetcher}) => Promise.all(['profile', 'answers'].map(page => openStore(storage, {fetcher}).page(page).text()));
const says = new Map([
  ['Rule Q: avoid slogans', 'writing'], ['Règle Z: rester sobre', 'writing'], ['Notice period: 1 month', 'availability'],
  ['Notice period: 2 months', 'availability'], ['Evidence: maintained a fictional service', 'part:strengths'], ['Opaque saved line', 'unsure'],
]);
function fakeAi({before = async () => {}, choose = line => says.get(line)} = {}) {
  const requests = [];
  return {requests, client: {messages: {create: async request => {
    requests.push(request);
    const parsed = JSON.parse(request.messages[0].content), input = Array.isArray(parsed) ? parsed : parsed.items;
    await before(input);
    return {content: [{type: 'text', text: JSON.stringify({items: input.map(({id, line}) => ({id, home: choose(line) || 'unsure', topic: 'fictional source', clarity: 'clear'}))})}]};
  }}}};
}
for (const adapter of ['sqlite', 'notion']) {
  test(`${adapter}: a missing destination on an H1 template is found by the returned heading identity`, async () => {
    const env = await setup(adapter, {answers: ['# Fictional application template', 'Rule Q: avoid slogans']});
    await review.judgeNew(env.storage, {...env, ai: fakeAi()});
    const [profile] = await texts(env);
    const outline = await openStore(env.storage, {fetcher: env.fetcher}).page('answers').outline();
    const headings = outline.filter(each => each.type?.startsWith('heading_') && each.text === 'Cover letter style');
    assert.equal(headings.length, 1, 'later writing lines reuse the same newly created destination');
    const paths = contexts(outline);
    const routed = itemsOf(outline, 'answers').filter(line => ['Rule Q: avoid slogans', 'Règle Z: rester sobre'].includes(`${line.label}: ${line.value}`));
    assert.equal(routed.length, 2);
    for (const line of routed) assert.deepEqual(paths.get(line.id.slice('answers:'.length)), ['Fictional application template', 'Cover letter style']);
    assert.ok(!profile.includes('Rule Q: avoid slogans'));
    assert.deepEqual(env.storage.settings().profileUnsure.map(line => line.value), ['Opaque saved line']);
  });

  test(`${adapter}: legacy lines organize automatically into real UI homes; copies consolidate and different values survive`, async () => {
    const env = await setup(adapter), before = await texts(env), ai = fakeAi();
    await review.judgeNew(env.storage, {...env, ai});
    const [profile, answers] = await texts(env);
    assert.match(answers, /Cover letter style[\s\S]*Rule Q: avoid slogans/);
    assert.match(answers, /Règle Z: rester sobre/);
    assert.equal((`${profile}\n${answers}`.match(/Rule Q: avoid slogans/g) || []).length, 1, 'exact copies only at their verified destination');
    assert.match(profile, /🛂|💶/);
    const facts = await env.read();
    assert.deepEqual(facts.filter(line => line.home === 'availability' && line.label === 'Notice period').map(line => line.value).sort(), ['1 month', '2 months']);
    assert.match(profile, /Strengths[\s\S]*Evidence: maintained a fictional service/);
    assert.match(profile, /Opaque saved line/, 'unknown content remains intact');
    assert.equal(env.copies.length, 1, 'backup before any store write');
    assert.deepEqual(env.copies[0], before);
    assert.deepEqual(env.storage.settings().profileUnsure.map(line => line.value), ['Opaque saved line'], 'only the unresolved source remains for a quiet retry');
    const queue = await openShown(env.storage, {fetcher: env.fetcher, ai: {}});
    assert.ok(![...queue.details, ...queue.learned].some(item => item.details?.kind === 'where'), 'no technical home selection for the applicant (either drawer)');
    const request = ai.requests[0], input = JSON.parse(request.messages[0].content).items;
    assert.ok(input.every(item => item.context?.length), 'AI sees actual source section context');
    assert.ok(request.output_config.format.schema.properties.items.items.properties.home.enum.includes('writing'));
    const restarted = createStorage(env.storage.dir, crypto), again = fakeAi();
    await review.judgeNew(restarted, {fetcher: env.fetcher, ai: again, copy: env.copy, now: new Date()});
    assert.equal(again.requests.length, 0, 'same unplaced value is not re-asked repeatedly during one day');
    assert.deepEqual(await texts(env), [profile, answers]);
  });

  test(`${adapter}: routed writing rules appear in the actual Writing preferences component`, async () => {
    const env = await setup(adapter);
    await review.judgeNew(env.storage, {...env, ai: fakeAi()});
    const body = install(), node = globalThis.document.createElement('div');
    node.id = 'letter-style-body'; body.append(node);
    globalThis.window.pilot = new Proxy({textOutline: async page => ({ok: true, items: await openStore(env.storage, {fetcher: env.fetcher}).page(page).outline()})}, {get: (all, key) => all[key] || (() => null)});
    await (await import('../renderer/pages/letter-style.js')).loadLetterStyle();
    assert.match(node.querySelector('.card-read').textContent, /avoid slogans/);
    assert.match(node.querySelector('.card-read').textContent, /rester sobre/);
    assert.ok(!node.textContent.includes('Where does this line go?'));
  });

  test(`${adapter}: same content in distinct source contexts receives distinct homes, with concurrent reads joined`, async () => {
    const env = await setup(adapter), page = openStore(env.storage, {fetcher: env.fetcher}).page('profile');
    await page.appendHeading('Fictional scope A'); await page.append(['Same label: Same value']);
    await page.appendHeading('Fictional scope B'); await page.append(['Same label: Same value']);
    env.storage.saveSettings({profileUnsure: [...env.storage.settings().profileUnsure, {page: 'profile', label: 'Same label', value: 'Same value'}]});
    const ai = fakeAi();
    ai.client.messages.create = async request => {
      ai.requests.push(request);
      const {items} = JSON.parse(request.messages[0].content);
      return {content: [{type: 'text', text: JSON.stringify({items: items.map(({id, line, context}) => ({id, home: line === 'Same label: Same value' ? context.includes('Fictional scope A') ? 'writing' : 'part:strengths' : says.get(line) || 'unsure', topic: 'fictional', clarity: 'clear'}))})}]};
    };
    await Promise.all([review.judgeNew(env.storage, {...env, ai}), review.judgeNew(env.storage, {...env, ai})]);
    const [profile, answers] = await texts(env);
    assert.match(profile, /Strengths[\s\S]*Same label: Same value/);
    assert.match(answers, /Cover letter style[\s\S]*Same label: Same value/);
    assert.equal(ai.requests.length, 1);
  });

  test(`${adapter}: an actual Contact heading is a readable destination even though its fields have a separate editor`, async () => {
    const env = await setup(adapter), page = openStore(env.storage, {fetcher: env.fetcher}).page('profile');
    await page.appendHeading('📇 Contact details');
    const ai = fakeAi();
    ai.client.messages.create = async request => {
      const {items, destinations} = JSON.parse(request.messages[0].content);
      const contact = destinations.find(each => each.heading === '📇 Contact details');
      return {content: [{type: 'text', text: JSON.stringify({items: items.map(({id, line}) => ({id, home: line === 'Opaque saved line' ? contact.id : 'stay', topic: 'fictional', clarity: 'clear'}))})}]};
    };
    await review.judgeNew(env.storage, {...env, ai});
    const outline = await page.outline(), heading = outline.findIndex(each => each.text === '📇 Contact details');
    assert.equal(outline[heading + 1].text, 'Opaque saved line');
    assert.equal(outline.filter(each => each.text === 'Opaque saved line').length, 1);
  });

  test(`${adapter}: newly saved instructions are automatically organized without legacy pending metadata or repeated moves`, async () => {
    const env = await setup(adapter);
    await review.judgeNew(env.storage, {...env, ai: fakeAi()});
    env.storage.saveSettings({profileUnsure: []});
    const page = openStore(env.storage, {fetcher: env.fetcher}).page('answers');
    await page.appendHeading('Fresh import');
    await page.append(['New instruction: keep the original voice']);
    const ai = fakeAi({choose: line => line === 'New instruction: keep the original voice' ? 'writing' : 'stay'});
    await review.judgeNew(env.storage, {...env, ai});
    const outline = await page.outline(), style = outline.findIndex(item => item.text === 'Cover letter style'), imported = outline.findIndex(item => item.text === 'Fresh import');
    const placed = outline.findIndex(item => item.text === 'New instruction: keep the original voice');
    assert.ok(placed > style && placed < imported, 'new saved line reaches its real section automatically');
    assert.equal(outline.filter(item => item.text === 'New instruction: keep the original voice').length, 1);
    const after = await texts(env);
    await review.judgeNew(env.storage, {...env, ai});
    assert.equal(ai.requests.length, 1, 'subsequent reads do not rejudge or multiply the saved line');
    assert.deepEqual(await texts(env), after);
  });

  test(`${adapter}: first-run details migration does not mark unrouted writing rules as already organized`, async () => {
    const env = await setup(adapter);
    env.storage.saveSettings({profileMovedAt: '', profileUnsureAt: '', profileUnsure: [], answerClarity: {}});
    const legacy = {client: {messages: {create: async request => ({content: [{type: 'text', text: JSON.stringify({items: JSON.parse(request.messages[0].content).map(({id}) => ({id, home: 'stay', topic: 'fictional source', clarity: 'clear'}))})}]})}}};
    await move(env.storage, {...env, ai: legacy});
    const ai = fakeAi();
    await review.judgeNew(env.storage, {...env, ai});
    assert.match((await texts(env))[1], /Cover letter style[\s\S]*Rule Q: avoid slogans/);
    assert.equal(ai.requests.length, 1, 'one context-aware judgment, not a repeated import loop');
    await review.judgeNew(env.storage, {...env, ai});
    assert.equal(ai.requests.length, 1);
  });

  test(`${adapter}: no AI or invalid destination preserves originals and never asks the applicant to classify them`, async () => {
    const env = await setup(adapter), before = await texts(env);
    await review.judgeNew(env.storage, {...env, ai: {}});
    assert.deepEqual(await texts(env), before);
    const ai = fakeAi({choose: () => 'not-a-real-home'});
    await review.judgeNew(env.storage, {...env, ai});
    assert.deepEqual(await texts(env), before);
    assert.equal(env.copies.length, 0);
    assert.equal(env.storage.settings().profileUnsure.length, 7);
    assert.ok(!(await review.pending(env.storage, {fetcher: env.fetcher})).some(item => item.details?.kind === 'where'));
  });

  test(`${adapter}: failed destination write/read-back never removes a source or its pending metadata`, async () => {
    const env = await setup(adapter), before = await texts(env), pending = env.storage.settings().profileUnsure;
    const fetcher = env.fetcher;
    // A store-shaped failure: every read works; every attempted page mutation is refused.
    const refusing = adapter === 'notion' ? (url, init) => init?.method && init.method !== 'GET' ? Promise.reject(Error('fictional write refused')) : fetcher(url, init) : undefined;
    const realWrite = env.storage.writeText;
    if (adapter === 'sqlite') env.storage.writeText = () => { throw Error('fictional write refused'); };
    await assert.rejects(review.judgeNew(env.storage, {...env, fetcher: refusing, ai: fakeAi()}), /fictional write refused/);
    env.storage.writeText = realWrite;
    assert.deepEqual(await texts(env), before);
    assert.deepEqual(env.storage.settings().profileUnsure, pending);
  });

  test(`${adapter}: an edit during destination IO rolls back only the stale new copy`, async () => {
    const env = await setup(adapter), realWrite = env.storage.writeText;
    let changed = false;
    const edit = async () => {
      const page = openStore(env.storage, {fetcher: env.fetcher}).page('profile');
      const line = (await page.outline()).find(item => item.text === 'Règle Z: rester sobre');
      if (line) await page.setText(line, 'Règle Z: instruction edited during destination write');
    };
    let fetcher = env.fetcher;
    if (adapter === 'notion') {
      fetcher = async (url, init) => {
        if (!changed && init?.method === 'PATCH' && init.body?.includes('Règle Z: rester sobre')) { changed = true; await edit(); }
        return env.fetcher(url, init);
      };
    } else {
      env.storage.writeText = (file, text) => {
        if (!changed && file === 'answers.md' && text.includes('Règle Z: rester sobre')) {
          changed = true;
          realWrite('profile.md', env.storage.readText('profile.md').replace('Règle Z: rester sobre', 'Règle Z: instruction edited during destination write'));
        }
        return realWrite(file, text);
      };
    }
    await review.judgeNew(env.storage, {...env, fetcher, ai: fakeAi()});
    env.storage.writeText = realWrite;
    assert.equal(changed, true, 'the edit actually interleaved with the destination write');
    const both = (await texts(env)).join('\n');
    assert.match(both, /instruction edited during destination write/);
    assert.ok(!both.includes('Règle Z: rester sobre'));
  });

  test(`${adapter}: an edit during backup is preserved without restoring the old value at the destination`, async () => {
    const env = await setup(adapter);
    const copy = async () => {
      await env.copy();
      const page = openStore(env.storage, {fetcher: env.fetcher}).page('profile');
      const line = (await page.outline()).find(item => item.text === 'Règle Z: rester sobre');
      await page.setText(line, 'Règle Z: instruction edited during backup');
    };
    await review.judgeNew(env.storage, {...env, copy, ai: fakeAi()});
    const both = (await texts(env)).join('\n');
    assert.match(both, /instruction edited during backup/);
    assert.ok(!both.includes('Règle Z: rester sobre'), 'backup IO cannot resurrect a stale source');
  });

  test(`${adapter}: source edited while AI decides is not resurrected or removed from a stale result`, async () => {
    const env = await setup(adapter);
    const ai = fakeAi({before: async () => {
      const page = openStore(env.storage, {fetcher: env.fetcher}).page('profile');
      const line = (await page.outline()).find(item => item.text === 'Règle Z: rester sobre');
      if (line) await page.setText(line, 'Règle Z: instruction edited by the person');
    }});
    await review.judgeNew(env.storage, {...env, ai});
    const both = (await texts(env)).join('\n');
    assert.match(both, /instruction edited by the person/);
    assert.ok(!both.includes('Règle Z: rester sobre'), 'stale AI answer cannot restore the previous value');
  });
}
