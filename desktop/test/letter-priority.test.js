// Missing cover letters stay high priority in the real question queue, independently of employer requiredness.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {test} from 'node:test';
import {createStorage} from '../lib/storage.js';
import {openShown} from '../lib/question-lists.js';
import {MUST} from '../renderer/question-filter.js';

const storage = () => createStorage(fs.mkdtempSync(path.join(os.tmpdir(), 'letter-priority-')), {encrypt: v => v, decrypt: v => v});
const ai = {client: {messages: {create: async () => { throw new Error('No generation or classification is needed for a setup action'); }}}};

test('the queue derives exactly one HIGH PRIORITY create action, ahead of blocked form questions', async () => {
  const s = storage();
  for (let i = 0; i < 2; i++) {
    const result = await openShown(s, {rows: [], groups: [], ai});
    const letters = result.list.filter(row => row.setup?.kind === 'cover-letter');
    assert.equal(letters.length, 1);
    assert.equal(result.list[0], letters[0]);
    assert.equal(letters[0].priority, 'HIGH PRIORITY');
    assert.ok(letters[0].weight > MUST);
    assert.equal(letters[0].setup.action, 'Create cover letter');
  }
});


test('delivery failure is the shared actionable state until a letter is observed on the form', async () => {
  const {availableLetter} = await import('../lib/letter-availability.js');
  const s = storage();
  const failed = availableLetter(s, '', {failed: true}).status;
  assert.equal(failed.state, 'delivery-failed');
  assert.equal(failed.ready, false);
  assert.match(failed.reason, /form/);
  assert.equal(availableLetter(s, '', {given: true, failed: true}).status.ready, true);
});
