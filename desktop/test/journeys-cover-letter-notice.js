// The extension panel copy for every cover-letter status, through its production state mapper.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {test} from 'node:test';
import os from 'node:os';
import path from 'node:path';
import * as review from '../lib/review.js';
import {createStorage} from '../lib/storage.js';

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

const FORM = 'https://apply.example/form';   // the same fictional form address as journeys.test.js

// The replay app does not run setup or the review queue: prove their shared missing-letter state through the desktop boundary.
test('scenario: attached CV and complete required fields still leave missing cover-letter setup HIGH PRIORITY', async () => {
  const {openShown} = await import('../lib/question-lists.js');
  const {me} = await import('../lib/server-contact.js');
  const {availableLetter} = await import('../lib/letter-availability.js');
  const storage = createStorage(fs.mkdtempSync(path.join(os.tmpdir(), 'jp-letter-journey-')), {encrypt: v => v, decrypt: v => v});
  fs.writeFileSync(storage.path('cv.pdf'), '%PDF-fictional-CV');
  const queue = await openShown(storage, {rows: [], groups: [], ai: {client: {messages: {create: async () => { throw new Error('This setup state never needs AI'); }}}}});
  assert.equal(queue.letter?.setup?.kind, 'cover-letter', 'its own card (owner, 28 Oct 2026)');
  assert.equal(queue.letter.priority, 'HIGH PRIORITY');
  const details = await me(storage, FORM);
  assert.ok(details.resume, 'the CV is attached/available while the letter is missing');
  assert.equal(details.coverLetterStatus.state, 'missing');
  assert.equal(details.coverLetterFile, null);
  review._reset();
  const sessions = [{id: 'letter-journey', url: FORM, company: 'Example', kind: 'form', status: 'done'}];
  const payload = {session: 'letter-journey', url: FORM, tab: 91, total: 3, left: 0, letterAsked: true, letterGiven: false};
  review.report(sessions, payload);
  const state = review.allStates().find(row => row.id === 'letter-journey');
  assert.equal(availableLetter(storage, FORM, {given: state.letterGiven}).status.ready, false, 'filled required fields cannot stand in for a missing letter');
  review.report(sessions, {...payload, letterGiven: true});
  const written = review.allStates().find(row => row.id === 'letter-journey');
  assert.equal(availableLetter(storage, FORM, {given: written.letterGiven}).status.source, 'form', 'a letter actually supplied satisfies this form without changing fallback consent');
});
