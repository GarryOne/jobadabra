// The fit score's tooltip (renderer/jobs-view.js fitTooltip) states the same bands as the scoring prompt (src/ai/score_bands.py, part of score.py's prompt), and every
// place that draws a fit score uses it (the Jobs ring, a run card's score). Owner, 9 Oct 2026: "explain the rubric, very shortly".
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {test} from 'node:test';
import {FIT_BANDS, fitTooltip} from '../renderer/jobs-view.js';

test('the tooltip bands are the scoring prompt\'s bands', () => {
  const prompt = fs.readFileSync(new URL('../../src/ai/score_bands.py', import.meta.url), 'utf8');   // the bands moved out of score.py (27 Oct 2026)
  const promptBands = [...prompt.matchAll(/^\s*'?\s*"?\s*(\d+)-(\d+):/gm)].map(m => Number(m[1]));
  assert.deepEqual(FIT_BANDS.map(([from]) => from), promptBands);
  for (const [, words] of FIT_BANDS) assert.ok(words.split(' ').length <= 3, `a few words: "${words}"`);
});

test('the tooltip leads with this job\'s score and label, then every band', () => {
  const text = fitTooltip(64, 'Click to see why').split('\n');
  assert.equal(text[0], 'Fit 64: Good match');
  assert.equal(text[1], '85–100  Everything matches');
  assert.equal(text[5], '0–29  Unrelated');
  assert.equal(text.at(-1), 'Click to see why');
});

test('every place that draws a fit score uses it', () => {
  for (const file of ['pages/jobs-render.js', 'pages/activity-run-card.js']) {
    assert.match(fs.readFileSync(new URL(`../renderer/${file}`, import.meta.url), 'utf8'), /fitTooltip\(/, file);
  }
});
