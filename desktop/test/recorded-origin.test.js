// Every recorded case says where its page came from (desktop/e2e/lib/recorded-origin.mjs): 'captured' from a real page or 'hand-cut'. A new case without it fails here, so the
// replays table can never call a hand-cut page a site (owner, 12 Oct 2026, via jobadabra-cc).
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {test} from 'node:test';
import {fileURLToPath} from 'node:url';
import {ORIGINS} from '../e2e/lib/recorded-origin.mjs';

const RECORDED = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'e2e', 'recorded');

test('every recorded case says its origin: captured from a real page or hand-cut', () => {
  const cases = fs.readdirSync(RECORDED).filter(name => fs.existsSync(path.join(RECORDED, name, 'case.json')));
  assert.ok(cases.length > 50, 'the recorded cases are found');
  const without = cases.filter(name => !ORIGINS.includes(JSON.parse(fs.readFileSync(path.join(RECORDED, name, 'case.json'), 'utf8')).origin));
  assert.deepEqual(without, [], 'add "origin": "captured" (the page came from a real page) or "hand-cut" (written by hand) to these case.json files');
});

test('the replays report reads each case\'s origin from its case.json (the replay itself never reads it)', async () => {
  const {originOfCase} = await import('../e2e/lib/recorded-origin.mjs');
  assert.equal(originOfCase(RECORDED, 'lever-sibling-title-1'), 'captured');
  assert.equal(originOfCase(RECORDED, 'two-apply-routes-1'), 'hand-cut');
  assert.equal(originOfCase(RECORDED, 'no-such-case'), '');
  assert.equal(originOfCase(RECORDED, '../../package'), '', 'a name never leaves the folder');
});
