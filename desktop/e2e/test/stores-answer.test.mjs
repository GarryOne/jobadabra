// Execute the stores Remember step with real file persistence and a fixed classification, without a browser.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {test} from 'node:test';
import {run} from '../suites/stores.mjs';
import {createStorage} from '../../lib/storage.js';
import * as questions from '../../lib/questions.js';
import * as sections from '../../lib/profile-sections.js';

test('stores checks the remembered answer in its returned availability home and restores its AI stub', async t => {
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'jp-stores-answer-'));
  t.after(() => fs.rmSync(profile, {recursive: true, force: true}));
  const storage = createStorage(profile, {encrypt: value => value, decrypt: value => value});
  storage.saveSettings({store: 'sqlite'});
  const prior = () => { throw new Error('unexpected AI call'); };
  let canned = prior, classified = 0, fixed = 0, ran = 0;
  const ai = {client: {messages: {create: async request => {
    classified++;
    if (canned !== prior) fixed++;
    // The original step had no fixed classifier; reproduce the broker's intended routing there.
    const text = canned === prior ? JSON.stringify({items: [{id: 'q', home: 'availability', topic: 'notice period', clarity: 'clear'}]}) : await canned(request);
    return {content: [{type: 'text', text}]};
  }}}};
  const before = globalThis.window;
  globalThis.window = {pilot: {
    rememberAnswer: (question, value) => questions.remember(storage, question, value, undefined, {ai}),
    detailsFactsNow: async () => ({ok: true, sections: await sections.read(storage)}),
  }};
  t.after(() => { if (before === undefined) delete globalThis.window; else globalThis.window = before; });
  await run({profile, page: {evaluate: fn => fn()}, withApi: fn => fn(),
    proxy: {canned: () => canned, setCanned: fn => { canned = fn; }},
    run: async (name, fn) => { if (name.startsWith('a remembered answer')) { ran++; await fn(); } },
  });
  assert.equal(ran, 1);
  assert.equal(classified, 1);
  assert.equal(fixed, 1, 'the backbone supplies the classification instead of asking AI');
  assert.deepEqual((await sections.read(storage)).availability, [{label: 'What is your notice period?', value: 'Three months, negotiable'}]);
  assert.equal(canned, prior);
});
