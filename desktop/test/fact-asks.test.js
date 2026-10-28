// The facts this Mac's forms asked go to the site as fixed ids once a day, the pack's shares come back cleaned, and they order the missing facts after what blocked a fill
// (owner, 18 Oct 2026: "blocked fills > server counts > section order").
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {test} from 'node:test';
import {createStorage} from '../lib/storage.js';
import * as factAsks from '../lib/fact-asks.js';
import * as missing from '../lib/missing-facts.js';

const plainCrypto = {encrypt: v => v, decrypt: v => v};
const fresh = settings => { const s = createStorage(fs.mkdtempSync(path.join(os.tmpdir(), 'jp-factasks-')), plainCrypto); s.saveSettings({store: 'sqlite', telemetry: false, ...settings}); return s; };
const D1 = new Date('2026-10-18T09:00:00Z'), D2 = new Date('2026-10-19T09:00:00Z');

test('only the facts a form asked leave this Mac, as catalogue ids, once a day', () => {
  const storage = fresh({questionVerdicts: {a: {reuse: 'details', fact: 'Notice period', asked: 2}, b: {reuse: 'details', fact: 'Phone', asked: 5}, c: {reuse: 'reusable', fact: 'Salary expectation', asked: 3}, d: {reuse: 'details', fact: 'Languages', asked: 0}}});
  assert.deepEqual(factAsks.due(storage, D1), ['notice'], 'a catalogue fact that was asked; not Phone, not a verdict that is not "details", not an unasked one');
  assert.deepEqual(factAsks.due(storage, D1), [], 'today\'s report is out');
  assert.deepEqual(factAsks.pending(storage, D2), ['notice'], 'tomorrow it is due again');
  assert.deepEqual(fresh({}).settings().questionVerdicts || {}, {});
  assert.deepEqual(factAsks.due(fresh({}), D1), [], 'nothing asked: nothing sent');
});

test('the pack\'s shares are cleaned to the catalogue and a share in (0, 1]', () => {
  assert.deepEqual(factAsks.clean([{fact: 'notice', share: 0.756}, {fact: 'made-up', share: 0.5}, {fact: 'salary', share: 0}, {fact: 'nationality', share: 2}, {fact: 'start', share: 0.2, text: 'x'}]),
    [{fact: 'notice', share: 0.76}, {fact: 'start', share: 0.2}]);
  assert.deepEqual(factAsks.clean(null), []);
});

test('the server share orders the missing facts after the local score and before the catalogue order', () => {
  const storage = fresh({});
  assert.deepEqual(missing.pick(storage, [], {now: D1, shares: {languages: 0.9, salary: 0.5}}).map(item => item.id), ['languages', 'salary', 'nationality']);
  const blocked = fresh({questionVerdicts: {a: {reuse: 'details', fact: 'Notice period', asked: 1, blocked: true}}});
  assert.equal(missing.pick(blocked, [], {now: D1, shares: {languages: 0.9}})[0].id, 'notice', 'a fill blocked here beats the shares');
});

test('shares are read from the pack\'s file, and a missing or broken one is no shares', () => {
  const storage = fresh({});
  assert.deepEqual(factAsks.shares(storage), {});
  storage.writeText(factAsks.FILE, JSON.stringify({at: 1, facts: [{fact: 'notice', share: 0.5}, {fact: 'nope', share: 1}]}));
  assert.deepEqual(factAsks.shares(storage), {notice: 0.5});
  storage.writeText(factAsks.FILE, '{broken');
  assert.deepEqual(factAsks.shares(storage), {});
});
