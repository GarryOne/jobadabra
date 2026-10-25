// Notion later: "connected" has one definition, and every gate answers with one result shape and a sentence per reason.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {test} from 'node:test';
import * as gate from '../lib/notion-gate.js';
import {createStorage} from '../lib/storage.js';

const fakeCrypto = {encrypt: v => Buffer.from(v).toString('base64'), decrypt: s => Buffer.from(s, 'base64').toString()};
const make = ({token = false, profile = false} = {}) => {
  const storage = createStorage(fs.mkdtempSync(path.join(os.tmpdir(), 'pilot-')), fakeCrypto);
  if (token) storage.setSecret('NOTION_TOKEN', 'ntn_x');
  if (profile) storage.saveSettings({notionIds: {NOTION_PROFILE_PAGE_ID: 'profile'}});
  return storage;
};

test('connected needs both the token and the Profile page', () => {
  assert.equal(gate.connected(make()), false);
  assert.equal(gate.connected(make({token: true})), false);
  assert.equal(gate.connected(make({profile: true})), false);
  assert.equal(gate.connected(make({token: true, profile: true})), true);
});

test('needs() has one shape and a sentence for every reason', () => {
  for (const reason of Object.keys(gate.REASONS)) {
    const result = gate.needs(reason);
    assert.equal(result.ok, false);
    assert.equal(result.needsNotion, true);
    assert.equal(result.reason, reason);
    assert.equal(result.text, `Connect Notion ${gate.REASONS[reason]}.`);
    assert.equal(result.error, result.text);  // callers that read .error show the same sentence
  }
  for (const key of ['save', 'dismiss', 'prepare', 'apply', 'applied', 'add', 'lead', 'log', 'interviews', 'focus', 'cloud', 'telegram', 'gmail', 'profile']) {
    assert.ok(gate.REASONS[key], key);
  }
});

test('statusReason maps a job status to the reason shown', () => {
  assert.equal(gate.statusReason('saved'), 'save');
  assert.equal(gate.statusReason('dismissed'), 'dismiss');
  assert.equal(gate.statusReason('applied'), 'applied');
  assert.equal(gate.statusReason('new'), null);  // not a Notion stage: no gate
});

test('check() gives null when connected or in demo mode, else the result', () => {
  assert.equal(gate.check(make({token: true, profile: true}), 'save'), null);
  assert.equal(gate.check(make(), 'save', {demo: true}), null);
  assert.deepEqual(gate.check(make(), 'save'), gate.needs('save'));
});

// Store adapters (9 Oct 2026): with the data on this Mac nothing asks for Notion, except what runs off the Mac (moved first).
test('data on this Mac: every gate opens, except the ones that run off the Mac, which ask to move the data first', () => {
  const storage = make();
  storage.saveSettings({store: 'sqlite'});
  for (const reason of Object.keys(gate.REASONS).filter(reason => !gate.OFF_MAC.has(reason))) assert.equal(gate.check(storage, reason), null, reason);
  for (const reason of gate.OFF_MAC) {
    const answer = gate.check(storage, reason);
    assert.equal(answer.needsMove, true, reason);
    assert.equal(answer.needsNotion, undefined, reason);   // not the connect dialog: Notion may be connected, the data is not there
    assert.equal(answer.text, `Move your data to Notion ${gate.REASONS[reason]}.`);
  }
  assert.equal(gate.tracking(storage), true);
  assert.equal(gate.notionInUse(storage), false);
});

test('store unset or Notion: the gates answer as before', () => {
  for (const store of [undefined, 'notion']) {
    const off = make(), on = make({token: true, profile: true});
    if (store) { off.saveSettings({store}); on.saveSettings({store}); }
    assert.equal(gate.check(off, 'save').needsNotion, true);
    assert.equal(gate.check(on, 'save'), null);
    assert.equal(gate.check(on, 'cloud'), null);
    assert.equal(gate.tracking(off), false);
    assert.equal(gate.notionInUse(on), true);
  }
});

test('every reason the code passes to a gate has its sentence (no "Connect Notion undefined.")', () => {
  const dir = path.join(import.meta.dirname, '..');
  const files = [path.join(dir, 'main.js'), ...fs.readdirSync(path.join(dir, 'lib')).filter(f => f.endsWith('.js')).map(f => path.join(dir, 'lib', f))];
  const used = new Set();
  for (const file of files) for (const match of fs.readFileSync(file, 'utf8').matchAll(/needsNotion\('([A-Za-z]+)'\)/g)) used.add(match[1]);
  assert.ok(used.size > 10);
  for (const reason of used) assert.ok(gate.REASONS[reason], reason);
});
