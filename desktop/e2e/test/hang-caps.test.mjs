// Every suite that has hang caps uses the one loader table, so its caps live only in hang-caps.json.
import assert from 'node:assert/strict';
import {test} from 'node:test';

const suites = ['applyflows', 'failureschannels', 'interactions', 'jobs', 'settings'];

test('every suite exports the loader table', async () => {
  const {hangCapsFor} = await import('../lib/hang-caps.mjs');
  for (const suite of suites) {
    const exported = await import(`../suites/${suite}.mjs`);
    assert.equal(exported.hangCaps, hangCapsFor(suite), suite);
  }
});
