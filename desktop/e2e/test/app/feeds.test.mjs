// lib/feeds.mjs: the seeded variation of the fixture job feeds.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {test} from 'node:test';
import {varyFeeds, MATCHES, DECOYS} from '../../lib/feeds.mjs';
import {createVariation} from '../../lib/variation.mjs';

const here = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const copy = () => { const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'jp-feeds-')); fs.cpSync(path.join(here, '..', 'fixtures', 'feeds'), dir, {recursive: true}); return dir; };
const titles = (dir, name) => JSON.parse(fs.readFileSync(path.join(dir, name), 'utf8')).jobs.map(job => job.title);

test('no seed: the feeds stay as written (the release gate judges a fixed path)', () => {
  const dir = copy(), before = titles(dir, 'acme.json');
  assert.equal(varyFeeds(dir, createVariation({})), null);
  assert.deepEqual(titles(dir, 'acme.json'), before);
});

test('a seed adds one match and one decoy the suite checks, the same way every time for that seed', () => {
  const one = copy(), two = copy();
  const a = varyFeeds(one, createVariation({E2E_SEED: '42'})), b = varyFeeds(two, createVariation({E2E_SEED: '42'}));
  assert.deepEqual(a, b);
  assert.ok(MATCHES.includes(a.match) && titles(one, 'acme.json').includes(a.match));
  assert.ok(DECOYS.includes(a.decoy) && titles(one, 'beta.json').includes(a.decoy));
  assert.deepEqual(titles(one, 'acme.json'), titles(two, 'acme.json'));
  // Every decoy is a wrong role the jobs suite already rejects; every match is a role it looks for.
  for (const title of DECOYS) assert.match(title, /account executive|product designer|intern/i);
  for (const title of MATCHES) assert.match(title, /reliability|devops|platform/i);
});

test('a seeded run may add a crowd of wrong-role postings, never a matching one', async () => {
  const {varyFeeds: vary, SHAPES, CROWD} = await import('../../lib/feeds.mjs');
  assert.deepEqual(SHAPES, ['plain', 'crowd']);
  let crowded = null;
  for (let seed = 1; seed < 40 && !crowded; seed++) {
    const dir = copy();
    const result = vary(dir, createVariation({E2E_SEED: String(seed)}));
    if (result.shape === 'crowd') crowded = dir;
  }
  assert.ok(crowded, 'some seed picks the crowd');
  const beta = JSON.parse(fs.readFileSync(path.join(crowded, 'beta.json'), 'utf8')).jobs;
  const extra = beta.filter(job => job.id >= 3001);
  assert.equal(extra.length, CROWD);
  assert.ok(extra.every(job => !/reliability|devops|platform/i.test(job.title)));
});
