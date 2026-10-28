// Every kind of unclear Your details field is a review item on every store (owner, 18 Oct 2026; two drawers since 28 Oct 2026, superseding "One queue for
// all"): it shows in its drawer's one list (lib/question-lists.js openShown: Fill your details, or What we learned for a line of the Profile or answers page),
// which its Jobs card, the drawer and its Profile tab count, and its answer goes to its home. The class, not the case: one fixture per kind in KINDS; a kind added without one fails here. The AI is a fake (no spend).
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {test} from 'node:test';
import {createStorage} from '../lib/storage.js';
import * as store from '../lib/store/index.js';
import * as sections from '../lib/profile-sections.js';
import * as contactDetails from '../lib/contact.js';
import {hashOf} from '../lib/cv-check.js';
import * as review from '../lib/details-review.js';
import {openShown} from '../lib/question-lists.js';

import {fakeNotion} from './fake-notion.js';

const PROFILE = ['## Preferences', 'Relocation: open to moving within the EU', 'Industries to prefer / avoid: ❓', 'Need visa sponsorship?: ❓', 'Notice period: 2 months', 'Role types: SRE; ❓ DevOps?',
  '## 💶 Availability & compensation', 'Target: 10k CHF or so [salary]', '## 🛂 Work eligibility', 'Work permit / visa: ❓ your citizenship and status',
  '## ❓ Possible CV gaps', 'Prometheus: ❓ Have you used it?'];
const ANSWERS = ['## Availability and pay', {table: [['Question', 'Answer'], ['Notice period / earliest start', '3 months'], ['Years of experience with Kubernetes', 'maybe 3?']]},
  '## ❓ Questions to answer', 'Do you have a driving licence?: ❓ (asked by Acme)',
  '## Learned from forms', 'Willing to travel: Yes, up to 20% (new)', 'Contract type: Permanent (two answers: Freelance)'];   // lib/learnings.js wrote them (PR B2)
const markdown = lines => lines.map(line => (typeof line === 'object' ? line.table.map((cells, i) => `| ${cells.join(' | ')} |${i === 0 ? '\n|---|---|' : ''}`).join('\n')
  : line.startsWith('## ') ? line : `- ${line}`)).join('\n') + '\n';

const CONFLICT = {home: 'availability', topic: 'notice period', choices: [{label: 'Notice period', value: '2 months', page: 'profile'}, {label: 'Notice period / earliest start', value: '3 months', page: 'answers'}]};
const UNSURE = {page: 'profile', label: 'Relocation', value: 'open to moving within the EU'};
// The AI's word on one answer, as judgeNew keeps it (lib/answer-clarity.js): a guess.
const SETTINGS = {profileMovedAt: '2026-10-18T00:00:00.000Z', profileUnsureAt: '2026-10-18T00:00:00.000Z', profileConflicts: [CONFLICT], profileUnsure: [UNSURE],
  answerClarity: {'years of experience with kubernetes\nmaybe 3?': 'guess'}};

// The home picker's fixed answer, by what the line says (the real one reads meaning in any language).
const ai = {client: {messages: {create: async request => {
  const items = JSON.parse(request.messages[0].content);
  return {content: [{type: 'text', text: JSON.stringify({items: items.map(({id, line}) => (/sponsorship/.test(line) ? {id, home: 'eligibility', topic: 'sponsorship'} : {id, home: 'stay', topic: 'other'}))})}]};
}}}};

const plainCrypto = {encrypt: v => v, decrypt: v => v};
const fresh = settings => { const s = createStorage(fs.mkdtempSync(path.join(os.tmpdir(), 'jp-review-')), plainCrypto); s.saveSettings(settings); return s; };
// A CV read for a base fact, kept as the read keeps it (lib/cv-queue.js): the queue shows it as a "check it" item without an AI call.
const seedCv = storage => {
  fs.writeFileSync(storage.path('cv.pdf'), 'fake cv');
  fs.mkdirSync(path.dirname(storage.path('cv/fact-proposals.json')), {recursive: true});
  storage.writeText('cv/fact-proposals.json', JSON.stringify({cv: hashOf(storage), proposals: [{id: 'languages', value: 'Romanian (native), English', how: 'inferred', reason: 'Written in Romanian'}]}));
  return storage;
};
const ADAPTERS = {
  sqlite: async () => {
    const storage = seedCv(fresh({store: 'sqlite', telemetry: false, ...SETTINGS}));
    const opened = store.openStore(storage);
    await opened.page('profile').write(markdown(PROFILE));
    await opened.page('answers').write(markdown(ANSWERS));
    return {storage, fetcher: undefined};
  },
  notion: async () => {
    const pages = {profile: fakeNotion(PROFILE, {prefix: 'P'}), answers: fakeNotion(ANSWERS, {prefix: 'A'})};
    const fetcher = (url, init) => (url.includes('blocks/profile') || url.includes('blocks/P') ? pages.profile : pages.answers).fetcher(url, init);
    const storage = fresh({store: 'notion', telemetry: false, notionIds: {NOTION_PROFILE_PAGE_ID: 'profile', NOTION_ANSWERS_PAGE_ID: 'answers'}, ...SETTINGS});
    storage.setSecret('NOTION_TOKEN', 'secret');
    seedCv(storage);
    return {storage, fetcher};
  },
};
const profileText = ({storage, fetcher}) => store.openStore(storage, {fetcher}).page('profile').text();

// One fixture per kind: which item it is, the answer the person gives, and what must hold afterwards.
const FIXTURES = {
  which: {match: /notice period/i, answer: () => '3 months', after: async env => {
    assert.ok((await sections.read(env.storage, env.fetcher)).availability.some(line => line.value === '3 months'));
    assert.deepEqual(env.storage.settings().setAside?.map(each => each.value), ['2 months'], 'the other value is set aside, with Undo');
  }},
  check: {match: /^Target/, answer: () => '10000 CHF/month gross', after: async env => {
    const line = (await sections.read(env.storage, env.fetcher)).availability.find(each => each.label === 'Target');
    assert.equal(line.value, '10000 CHF/month gross');
    assert.equal(line.kind, 'salary');
  }},
  open: {match: /Industries to prefer/, answer: () => 'Fintech; no gambling', after: async env => {
    assert.match(await profileText(env), /Industries to prefer \/ avoid: Fintech; no gambling/, 'a Profile fact is answered on its own line');
    assert.doesNotMatch(await profileText(env), /Industries to prefer \/ avoid: ❓/);
  }},
  unclear: {match: /Years of experience with Kubernetes/, answer: () => '3 years', after: async env => {
    const answers = await store.openStore(env.storage, {fetcher: env.fetcher}).page('answers').text();
    assert.match(answers, /Years of experience with Kubernetes \| 3 years/, 'the new value replaces the guess on its own line');
    assert.doesNotMatch(answers, /maybe 3\?/);
  }},
  contact: {match: /^First name/, answer: () => 'Ana Maria', after: async env => {
    assert.equal((await contactDetails.read(env.storage, env.fetcher)).first_name, 'Ana Maria', 'the answer goes to its Contact details field');
  }},
  cvcheck: {match: /^Languages$/, answer: () => 'Romanian (native), English (fluent)', after: async env => {
    assert.ok((await sections.read(env.storage, env.fetcher)).languages.some(line => line.label === 'Languages' && /fluent/.test(line.value)), 'the confirmed fact goes to its section');
  }},
  // PR B2: a learning a form fill wrote is confirmed as it is, or picked from its two answers; either way it is written without its state.
  taught: {match: /^Willing to travel/, answer: () => 'Yes, up to 20%', after: async env => {
    const answers = await store.openStore(env.storage, {fetcher: env.fetcher}).page('answers').text();
    assert.match(answers, /Willing to travel: Yes, up to 20%/);
    assert.doesNotMatch(answers, /\(new\)/, 'confirmed: no state left');
  }},
  conflict: {match: /^Contract type/, answer: () => 'Freelance', after: async env => {
    const answers = await store.openStore(env.storage, {fetcher: env.fetcher}).page('answers').text();
    assert.match(answers, /Contract type: Freelance/);
    assert.doesNotMatch(answers, /two answers/, 'the one picked is kept, confirmed');
  }},
  missing: {match: /^Earliest start date/, answer: () => '1 December 2026', after: async env => {
    assert.ok((await sections.read(env.storage, env.fetcher)).availability.some(line => line.label === 'Earliest start date' && line.value === '1 December 2026'), 'a fact nobody had given goes to its section');
  }},
};

test('every kind of unclear field has a fixture here (a new kind must join the queue and this test)', () => {
  assert.deepEqual(Object.keys(FIXTURES).sort(), [...review.KINDS].sort());
});

for (const [name, setup] of Object.entries(ADAPTERS)) {
  for (const kind of review.KINDS) {
    test(`${name} · ${kind}: in its drawer, counted by its Jobs card, the drawer and its Profile tab, answered into its home`, async () => {
      const env = await setup();
      const {storage, fetcher} = env;
      const items = await review.pending(storage, {fetcher});
      const item = items.find(each => each.details.kind === kind && FIXTURES[kind].match.test(each.question));
      assert.ok(item, `a ${kind} item: ${JSON.stringify(items.map(each => [each.details.kind, each.question]))}`);
      assert.ok(item.key.startsWith(review.PREFIX));
      // Each drawer is one list its card, its tab and its header count (owner, 28 Oct 2026): a Your details item is in Fill your details; a saved answer of the
      // Profile or the answers page is in What we learned (lib/question-lists.js openShown).
      const {details, learned} = await openShown(storage, {fetcher, ai: {}});
      const page = /"page":/.test(item.key);
      assert.ok((page ? learned : details).some(each => each.key === item.key), `the ${page ? 'What we learned' : 'Fill your details'} drawer walks it`);
      assert.ok(!(page ? details : learned).some(each => each.key === item.key), 'and only that drawer');
      const result = await review.answer(storage, item.key, FIXTURES[kind].answer(), {fetcher, ai});
      assert.equal(result.ok, true, result.error);
      await FIXTURES[kind].after(env);
      assert.ok(!(await review.pending(storage, {fetcher})).some(each => each.key === item.key), 'answered: it leaves the queue');
    });
  }
}

for (const [name, setup] of Object.entries(ADAPTERS)) {
  test(`${name}: a ❓ inside a Your details section is answered on that section's line`, async () => {
    const env = await setup();
    const item = (await review.pending(env.storage, {fetcher: env.fetcher})).find(each => /Work permit/.test(each.question));
    assert.equal(item.details.kind, 'open');
    assert.equal((await review.answer(env.storage, item.key, 'EU citizen', {fetcher: env.fetcher, ai})).ok, true);
    const lines = (await sections.read(env.storage, env.fetcher)).eligibility.filter(line => line.label === 'Work permit / visa');
    assert.deepEqual(lines.map(line => line.value), ['EU citizen']);
  });

  test(`${name}: a ❓ on the Profile whose fact is Your details' goes to its section, and the ❓ line leaves the Profile`, async () => {
    const env = await setup();
    const item = (await review.pending(env.storage, {fetcher: env.fetcher})).find(each => /visa sponsorship/.test(each.question));
    const result = await review.answer(env.storage, item.key, 'No', {fetcher: env.fetcher, ai});
    assert.equal(result.ok, true, result.error);
    assert.match(result.homeName, /Work eligibility/);
    assert.ok((await sections.read(env.storage, env.fetcher)).eligibility.some(line => line.label === 'Need visa sponsorship?' && line.value === 'No'));
    assert.doesNotMatch(await profileText(env), /Need visa sponsorship\?: ❓/);
  });

  test(`${name}: "Keep on the Profile" closes a where item and leaves the line where it is`, async () => {
    const env = await setup();
    const item = {key: `details:where:${JSON.stringify(UNSURE)}`};   // a drawer cached by an older app
    assert.equal((await review.answer(env.storage, item.key, review.KEEP, {fetcher: env.fetcher, ai})).ok, true);
    assert.match(await profileText(env), /Relocation: open to moving within the EU/);
    assert.deepEqual(env.storage.settings().profileUnsure, []);
  });
}

test('a ❓ is asked only where it stands for the answer, and never in a part with its own screen (the owner\'s CV gaps, 18 Oct 2026)', async () => {
  for (const setup of Object.values(ADAPTERS)) {
    const env = await setup();
    const asked = (await review.pending(env.storage, {fetcher: env.fetcher})).map(each => each.question);
    assert.ok(!asked.some(question => /Role types/.test(question)), 'a ❓ inside an answer is a note, not the question');
    assert.ok(!asked.some(question => /Prometheus/.test(question)), 'CV gaps are answered on their own screen (✓ / ✕)');
  }
});

test('a value to make exact is not taken while it still needs a check', async () => {
  const env = await ADAPTERS.sqlite();
  const item = (await review.pending(env.storage)).find(each => each.details.kind === 'check');
  assert.equal((await review.answer(env.storage, item.key, '10k CHF or so')).ok, false);
  assert.equal((await sections.read(env.storage)).availability.find(line => line.label === 'Target').value, '10k CHF or so');
});

test('a where item whose line is gone from its page drops out (nothing stale is asked)', async () => {
  const env = await ADAPTERS.sqlite();
  env.storage.saveSettings({profileUnsure: [{page: 'profile', label: 'Gone', value: 'not on the page'}]});
  assert.ok(!(await review.pending(env.storage)).some(each => each.details.kind === 'where'));
});

// Why (28 Oct 2026, owner, #2322 review: "ask as less as possible"): the template writes ❓ on every zone; a ❓ zone is no answer, so it waits for Nationality
// and leaves once Nationality opens it. A fictional Romanian: EU concluded, the UK and the US asked.
test('the template\'s ❓ zones: none asked before Nationality; with Nationality Romania, only the UK and the US', async () => {
  const storage = fresh({store: 'sqlite', telemetry: false, profileMovedAt: '2026-10-18T00:00:00.000Z'});
  const zones = ['EU / EEA + Switzerland', 'United Kingdom', 'United States'].map(zone => `${zone}: ❓ yes, freely / yes, with a permit / no, needs sponsorship [per country]`);
  const page = nationality => markdown(['## 🛂 Work eligibility', `Nationality: ${nationality}`, ...zones]);
  await store.openStore(storage).page('profile').write(page('❓ your citizenships'));
  const zonesAsked = async () => (await review.pending(storage)).map(each => each.question).filter(question => /EU \/ EEA|United Kingdom|United States/.test(question));
  assert.deepEqual(await zonesAsked(), []);
  await store.openStore(storage).page('profile').write(page('Romania'));
  assert.deepEqual((await zonesAsked()).sort(), ['United Kingdom', 'United States']);
});
