// The cap's note names the quiet time and the last extension line (lib/stall-note.mjs).
import assert from 'node:assert/strict';
import test from 'node:test';
import {stallNote} from '../../lib/stall-note.mjs';

const log = [
  '2026-10-17T00:15:45.146Z [fill] Claude answered 11 of 12 question(s) {"fields":12}',
  '2026-10-17T00:16:13.398Z [extension] fill: dead end fallback (shadow) {"door":1}',
  '2026-10-17T00:16:14.000Z [store] applications.get {"exit":0}',
].join('\n');

test('names the last extension line and how long the log has been quiet', () => {
  assert.equal(stallNote(log, Date.parse('2026-10-17T00:19:50Z')), 'stalled 217 s after "fill: dead end fallback (shadow)"');
});
test('says nothing for a short quiet or a log with no extension line', () => {
  assert.equal(stallNote(log, Date.parse('2026-10-17T00:16:20Z')), '');
  assert.equal(stallNote('', 1), '');
});
