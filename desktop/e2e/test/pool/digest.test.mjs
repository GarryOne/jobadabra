import assert from 'node:assert/strict';
import {test} from 'node:test';
import {digestTitles} from '../../lib/digest.mjs';

const MESSAGE = `✈️ Jobadabra · 🆕 2 new · top 2 of 2
2 open · 2 📍 · 5 applied · 2 filtered
🆕 New since last run
1. Senior Zebra Wrangler, Data (https://boards.e2e.test/job/3005)
   E2E Zebra · Lugano
2. Staff Zebra Wrangler (https://boards.e2e.test/job/3101?utm_source=x)
   E2E Initech · Lugano
Tap a job number to mark it applied, save or dismiss it.`;

test('the titles a digest lists, in order, without the link, from every digest in the log text', () => {
  const log = `line\n<<<message\n${MESSAGE}\nmessage>>>\nmore\n<<<message\n1. Giraffe Keeper (https://x.test/9)\nmessage>>>`;
  assert.deepEqual(digestTitles(log), ['Senior Zebra Wrangler, Data', 'Staff Zebra Wrangler', 'Giraffe Keeper']);
});

test('no digest, an empty digest or other numbered lines in the log give nothing', () => {
  assert.deepEqual(digestTitles(''), []);
  assert.deepEqual(digestTitles('1. Not a digest (https://x.test/1)\n<<<message\nnothing new\nmessage>>>'), []);
  assert.deepEqual(digestTitles(undefined), []);
});
