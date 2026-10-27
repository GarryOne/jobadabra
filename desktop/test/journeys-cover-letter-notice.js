// The extension panel copy for every cover-letter status, through its production state mapper.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {test} from 'node:test';

const source = fs.readFileSync(new URL('../../extension/letter-notice.js', import.meta.url), 'utf8');
const window = {};
vm.runInNewContext(source, {window});
const notice = window.__jobPilottoCoverLetterNotice;

test('cover-letter notice copy names the right next step for each status', () => {
  assert.deepEqual({...notice({state: 'missing'})}, {
    title: 'Cover letter needed', reason: 'Create and review a cover letter before applying.', action: 'Create in Profile',
  });
  assert.deepEqual({...notice({state: 'draft', reason: 'Draft status from the app.'})}, {
    title: 'Cover letter needs review', reason: 'Review and approve your draft before applying.', action: 'Review in Profile',
  });
  assert.deepEqual({...notice({state: 'invalid', reason: 'The draft has no usable content.'})}, {
    title: 'Cover letter needs attention', reason: 'The draft has no usable content.', action: 'Complete in Profile',
  });
  for (const state of ['unavailable', 'disabled', 'withheld']) {
    assert.deepEqual({...notice({state, reason: 'The approved letter is unavailable.'})}, {
      title: 'Cover letter needs attention', reason: 'The approved letter is unavailable.', action: 'Open Profile',
    });
  }
});

test('delivery failure keeps manual recovery copy and never claims the letter was saved', () => {
  const rejected = notice({state: 'ready', reason: 'A letter exists'}, true);
  assert.deepEqual({...rejected}, {
    title: 'Cover letter wasn’t kept',
    reason: 'Paste or attach it manually, then check again.',
    action: 'Show on form',
  });
});
