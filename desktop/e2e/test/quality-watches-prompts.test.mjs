// Both quality journeys watch the app prompts and imported app modules.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {test} from 'node:test';
import * as quality from '../suites/quality.mjs';
import * as qualityai from '../suites/qualityai.mjs';

const suites = [quality, qualityai];

test('every app module either quality journey imports is watched by both suites', () => {
  const imported = new Set(suites.flatMap(suite => {
    const source = fs.readFileSync(new URL(`../suites/${suite.name}.mjs`, import.meta.url), 'utf8');
    return [...source.matchAll(/(?:from\s+|import\s*\(\s*)['"]\.\.\/\.\.\/(lib\/[^'"]+)['"]/g)].map(match => `desktop/${match[1]}`);
  }));
  assert.ok(imported.size >= 1, 'positive control: the live suite imports app modules');
  for (const suite of suites) for (const file of imported) assert.ok(suite.watches.includes(file), `${file} is not in ${suite.name}'s watches`);
});

for (const suite of suites) test(`the prompt files asked during ${suite.name} are watched`, () => {
  for (const file of ['src/ai/score.py', 'src/ai/enrich.py', 'desktop/lib/pipeline.js', 'desktop/lib/question-reuse.js', 'desktop/lib/match-check.js']) {
    assert.ok(suite.watches.includes(file), `${file} is not in ${suite.name}'s watches`);
  }
});
