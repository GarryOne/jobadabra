// Guards tools/claim-shape.mjs: two fixer sessions can never hold the same pool row, a dead or expired claim is taken over, only the holder releases.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {claim, claimPart, releasePart, partName, release, list, slug, TTL_MS} from '../../tools/claim-shape.mjs';

const dir = () => fs.mkdtempSync(path.join(os.tmpdir(), 'claims-'));   // never the real claims folder
const NOW = Date.parse('2026-10-11T12:00:00Z');

test('a row is claimed by one session; a second one is told who holds it', () => {
  const d = dir();
  assert.equal(claim('jobs.ch posting whose Apply the extension did not find', 'jobadabra-81', {dir: d, now: NOW}).ok, true);
  const second = claim('jobs.ch posting whose Apply the extension did not find', 'jobadabra-b8', {dir: d, now: NOW + 1000});
  assert.equal(second.ok, false);
  assert.equal(second.holder, 'jobadabra-81');
  assert.equal(claim('jobs.ch posting whose Apply the extension did not find', 'jobadabra-81', {dir: d, now: NOW + 2000}).ok, true, 'the holder may claim again (renews)');
});

test('a claim of an expired or no-longer-listed session is taken over, a live one is not', () => {
  const d = dir();
  claim('Nebius', 'old-session', {dir: d, now: NOW});
  assert.equal(claim('Nebius', 'new', {dir: d, now: NOW + 1000, alive: ['old-session', 'new']}).ok, false, 'listed and fresh: held');
  assert.equal(claim('Nebius', 'new', {dir: d, now: NOW + 1000, alive: ['new']}).ok, true, 'holder gone from ListAgents: taken over');
  claim('Ocado', 'old-session', {dir: d, now: NOW});
  assert.equal(claim('Ocado', 'new', {dir: d, now: NOW + TTL_MS + 1}).ok, true, 'expired: taken over');
});

test('only the holder releases; list shows live claims; two names that slug alike are one row', () => {
  const d = dir();
  claim('Red Badger', 'a', {dir: d, now: NOW});
  assert.equal(release('Red Badger', 'b', {dir: d}).ok, false);
  assert.deepEqual(list({dir: d, now: NOW + 1000}).map(c => [c.name, c.session]), [['Red Badger', 'a']]);
  assert.equal(slug('Red  Badger!'), slug('red badger'));
  assert.equal(release('Red Badger', 'a', {dir: d}).ok, true);
  assert.deepEqual(list({dir: d, now: NOW}), []);
});

test('many sessions claiming at once: exactly one wins', async () => {
  const d = dir();
  const results = await Promise.all(Array.from({length: 12}, (_, i) => Promise.resolve().then(() => claim('Swatch Group careers', `s${i}`, {dir: d, now: NOW}))));
  assert.equal(results.filter(r => r.ok).length, 1);
});

test('a lock with its own short life (the e2e page, 30 min) expires before the 6 h default, and the holder renews it', () => {
  const d = dir(), HALF_HOUR = 30 * 60 * 1000;
  assert.equal(claim('e2e-page', 'a', {dir: d, now: NOW, ttl: HALF_HOUR}).ok, true);
  assert.equal(claim('e2e-page', 'b', {dir: d, now: NOW + HALF_HOUR - 1000}).ok, false);
  assert.equal(claim('e2e-page', 'a', {dir: d, now: NOW + HALF_HOUR - 1000, ttl: HALF_HOUR}).ok, true, 'renewed');
  assert.equal(claim('e2e-page', 'b', {dir: d, now: NOW + 2 * HALF_HOUR}).ok, true, 'expired after the renewed 30 min');
});

// Per-function claims on flow-core files (owner, 11 Oct 2026): two sessions edit different functions of one file at once; a whole-file or whole-core claim blocks all of them.
test('different functions of one file are claimed at once; the same function is not', () => {
  const d = dir(), file = 'extension/ladder/core.js';
  assert.equal(claimPart(file, 'decidePage', 'a', {dir: d, now: NOW}).ok, true);
  assert.equal(claimPart(file, 'pickRoute', 'b', {dir: d, now: NOW}).ok, true, 'another function of the same file');
  const again = claimPart(file, 'decidePage', 'b', {dir: d, now: NOW});
  assert.equal(again.ok, false); assert.equal(again.holder, 'a');
  assert.equal(claimPart(file, 'decidePage', 'a', {dir: d, now: NOW}).ok, true, 'the holder renews');
  assert.equal(claimPart('extension/tabs.js', 'decidePage', 'b', {dir: d, now: NOW}).ok, true, 'the same name in another file is another function');
});

test('a whole-file claim blocks every function of the file, and a function claim blocks the whole file', () => {
  const d = dir(), file = 'extension/ladder/core.js';
  assert.equal(claimPart(file, '', 'a', {dir: d, now: NOW}).ok, true);
  assert.equal(claimPart(file, 'pickRoute', 'b', {dir: d, now: NOW}).ok, false, 'a function of a file someone holds whole');
  assert.equal(claimPart('extension/tabs.js', 'x', 'b', {dir: d, now: NOW}).ok, true, 'another file is free');
  assert.equal(claimPart('extension/tabs.js', '', 'a', {dir: d, now: NOW}).ok, false, 'b holds a function of tabs.js');
  assert.equal(list({dir: d, now: NOW}).filter(held => held.session === 'b').length, 1, 'a refused claim leaves nothing behind');
});

test('the whole flow core is a claim too: it blocks every part, and every part blocks it', () => {
  const d = dir();
  assert.equal(claimPart('', '', 'a', {dir: d, now: NOW}).ok, true);
  assert.equal(claimPart('extension/tabs.js', 'x', 'b', {dir: d, now: NOW}).ok, false);
  assert.equal(releasePart('', '', 'a', {dir: d}).ok, true);
  assert.equal(claimPart('extension/tabs.js', 'x', 'b', {dir: d, now: NOW}).ok, true);
  assert.equal(claimPart('', '', 'a', {dir: d, now: NOW}).ok, false);
});

test('a part claim of a dead or expired session is taken over, and only the holder releases it', () => {
  const d = dir();
  claimPart('extension/tabs.js', 'x', 'a', {dir: d, now: NOW});
  assert.equal(claimPart('extension/tabs.js', 'x', 'b', {dir: d, now: NOW, alive: ['b']}).ok, true, 'a is gone');
  assert.equal(releasePart('extension/tabs.js', 'x', 'a', {dir: d}).ok, false);
  assert.equal(releasePart('extension/tabs.js', 'x', 'b', {dir: d}).ok, true);
  assert.deepEqual(list({dir: d, now: NOW}), []);
  assert.equal(partName('extension/tabs.js', 'x'), 'flow-core: extension/tabs.js#x');
});

test('many sessions claiming the same function at once: exactly one wins', async () => {
  const d = dir();
  const results = await Promise.all(['a', 'b', 'c', 'd'].map(async who => claimPart('extension/tabs.js', 'x', who, {dir: d, now: NOW})));
  assert.equal(results.filter(result => result.ok).length, 1);
});

test('part claims are not pool rows (the Fixed tab lists only rows)', async () => {
  const {claimRows} = await import('../e2e/lib/fix-ledger.mjs');
  const d = dir();
  claimPart('extension/tabs.js', 'x', 'a', {dir: d, now: NOW}); claimPart('', '', 'a', {dir: d, now: NOW}); claim('Some pool row', 'a', {dir: d, now: NOW});
  assert.deepEqual(claimRows(list({dir: d, now: NOW})).map(row => row.name), ['Some pool row']);
});

test('a claim names a pool row: a slug is refused before any claim is written, with the row it means (11 Oct 2026)', async () => {
  const {execFileSync} = await import('node:child_process'), {fileURLToPath} = await import('node:url');
  const pool = path.join(dir(), 'pool.json');
  fs.writeFileSync(pool, JSON.stringify({shapes: [{shape: 'Acme jobs, French', urls: []}]}));   // this Mac's own list, so the pool is complete
  let out = '';
  try { execFileSync(process.execPath, [fileURLToPath(new URL('../../tools/claim-shape.mjs', import.meta.url)), 'claim', 'acme-jobs-french', '--session', 't'], {env: {...process.env, RECORD_SITES: pool}, encoding: 'utf8', stdio: 'pipe'}); } catch (error) { out = `${error.status} ${error.stderr}`; }
  assert.match(out, /^2 not claimed: "acme-jobs-french" is not a row name of the pool.*did you mean "Acme jobs, French"/);
});
