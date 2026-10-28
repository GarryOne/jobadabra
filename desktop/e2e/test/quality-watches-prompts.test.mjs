// A PR that changes a prompt quality's app run asks must run quality, so its new answers are recorded for main (quality replays strictly there). Owner's beta f37850d, 28 Oct 2026:
// "the gate asked the AI nothing new: 1 AI question(s) had no recorded answer" (the question-reuse call); #2337 reworded its prompt and ran no e2e suite, because quality
// watched only src/ai/ and a few files. Same class as #2234 (place_triage.py). Pure: reads the suite's source.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {test} from 'node:test';
import {watches} from '../suites/quality.mjs';

const source = fs.readFileSync(new URL('../suites/quality.mjs', import.meta.url), 'utf8');

test('every app module quality imports is watched: a change to it must run quality', () => {
  const imported = [...source.matchAll(/(?:from\s+|import\s*\(\s*)['"]\.\.\/\.\.\/(lib\/[^'"]+)['"]/g)].map(match => `desktop/${match[1]}`);
  assert.ok(imported.length >= 1, 'positive control: the suite imports app modules');
  for (const file of imported) assert.ok(watches.includes(file), `${file} is not in quality's watches`);
});

test('the prompt files the app asks during quality are watched: the question-reuse call (the miss of 28 Oct 2026)', () => {
  for (const file of ['desktop/lib/question-reuse.js', 'desktop/lib/match-check.js']) assert.ok(watches.includes(file), `${file} is not in quality's watches`);
});
