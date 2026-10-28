// What we learned's evidence chips (renderer/learning-evidence.js; owner, 28 Oct 2026: by meaning): a learning's Form fills are the fills whose labels the
// learnings writer tied to it, newest first, one chip per fill. Fictional fills.
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {evidenceFor, shortDay} from '../renderer/learning-evidence.js';

const fill = (id, company, day, labels) => ({id, fields: {company, started: `${day}T09:00:00Z`, data: {fields: labels.map(label => ({label}))}}});
const RUNS = [fill('r1', 'Acme', '2026-10-24', ['Travel?', 'First name']), fill('r2', 'Northwind', '2026-10-26', ['Are you willing to travel?', 'Reisebereitschaft']),
  fill('r3', 'Bluefin', '2026-10-21', ['Notice period'])];
const LEARNED = {'travel': 'Willing to travel', 'are you willing to travel': 'Willing to travel', 'reisebereitschaft': 'Willing to travel'};

test('a learning lists the fills whose labels fed it, newest first, one per fill whatever the wording', () => {
  const found = evidenceFor(RUNS, LEARNED);
  assert.deepEqual(found.get('willing to travel'), [{id: 'r2', company: 'Northwind', day: '2026-10-26'}, {id: 'r1', company: 'Acme', day: '2026-10-24'}]);
  assert.equal(found.size, 1, 'a label no learning took (Notice period) is no evidence');
});

test('no fills or no learned labels: no evidence; the date reads as on the chip', () => {
  assert.equal(evidenceFor(null, LEARNED).size, 0);
  assert.equal(evidenceFor(RUNS, {}).size, 0);
  assert.equal(shortDay('2026-10-26'), '26 Oct');
  assert.equal(shortDay(''), '');
});
