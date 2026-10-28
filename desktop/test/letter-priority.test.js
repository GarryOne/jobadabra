// Missing cover letters stay high priority, independently of employer requiredness: one setup action of its own, never a drawer row (owner, 28 Oct 2026).
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

test('the queues derive exactly one HIGH PRIORITY create action, its own card and in neither drawer', async () => {
  const s = storage();
  for (let i = 0; i < 2; i++) {
    const result = await openShown(s, {rows: [], groups: [], ai});
    const letter = result.letter;
    assert.equal(letter?.setup?.kind, 'cover-letter');
    assert.ok(![...result.details, ...result.learned].some(row => row.setup), 'in neither drawer');
    assert.equal(letter.priority, 'HIGH PRIORITY');
    assert.ok(letter.weight > MUST);
    assert.equal(letter.setup.action, 'Create cover letter');
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
