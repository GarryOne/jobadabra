// Saved Profile organization journey, registered by journeys.test.js so the shared scenario file stays within its size limit.
import assert from 'node:assert/strict';
import {test} from 'node:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {createStorage} from '../lib/storage.js';

// The owner must never classify imported writing instructions: real saved pages feed the canonical letter section before the queue is read.
test('scenario: saved writing rules organize automatically, survive restart, and never become technical home questions', async () => {
  const {openStore} = await import('../lib/store/index.js');
  const {itemsOf} = await import('../lib/profile-move.js');
  const {judgeNew} = await import('../lib/details-review.js');
  const {openShown} = await import('../lib/question-lists.js');
  const storage = createStorage(fs.mkdtempSync(path.join(os.tmpdir(), 'jp-profile-journey-')), {encrypt: v => v, decrypt: v => v});
  storage.saveSettings({store: 'sqlite', telemetry: false, profileMovedAt: '2026-10-27', profileUnsureAt: '2026-10-27'});
  const opened = openStore(storage);
  await opened.page('profile').write('## Imported notes\n- Never mention: unrelated experience\n- Tone: direct\n');
  await opened.page('answers').write('## Imported answers\n- Never mention: unrelated experience\n');
  const lines = (await Promise.all(['profile', 'answers'].map(async page => itemsOf(await opened.page(page).outline(), page)))).flat();
  storage.saveSettings({profileUnsure: lines.map(({page, label, value}) => ({page, label, value}))});
  let calls = 0;
  const ai = {client: {messages: {create: async request => {
    calls++;
    const {items} = JSON.parse(request.messages[0].content);
    return {content: [{type: 'text', text: JSON.stringify({items: items.map(({id}) => ({id, home: 'writing', topic: 'writing rule', clarity: 'clear'}))})}]};
  }}}};
  await judgeNew(storage, {ai, copy: async () => ({})});
  const answers = await opened.page('answers').text();
  assert.match(answers, /Cover letter style[\s\S]*Never mention: unrelated experience/);
  assert.match(answers, /Tone: direct/);
  assert.equal((answers.match(/Never mention/g) || []).length, 1);
  assert.doesNotMatch(await opened.page('profile').text(), /Never mention|Tone: direct/);
  await judgeNew(storage, {ai});
  const restarted = createStorage(storage.dir, {encrypt: v => v, decrypt: v => v});
  const queues = await openShown(restarted, {ai: {}});
  assert.ok(![...queues.details, ...queues.learned].some(row => row.details?.kind === 'where'));
  assert.equal(await openStore(restarted).page('answers').text(), answers);
  assert.equal(calls, 1, 'repeated reads do not multiply or rejudge unchanged sources');
});
