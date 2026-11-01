// The quality suite's fact judge sees what the scoring saw: the Profile only, never the CV (#350: CV-only skills made true "not in your profile" gaps look invented).
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {test} from 'node:test';

test('the score-text judge is given the Profile the scorer read, not the CV text', () => {
  const source = fs.readFileSync(new URL('../../suites/qualityai.mjs', import.meta.url), 'utf8');
  const step = source.slice(source.indexOf("ctx.run('the score reasons say nothing invented"), source.indexOf('summary.invented ='));
  const line = /const profile = (.+);/.exec(step)?.[1] || '';
  assert.match(line, /THE PROFILE/);
  assert.doesNotMatch(line, /\bcandidate\b/, 'the CV text (candidate.txt) is in the judge\'s profile again');
  assert.match(fs.readFileSync(new URL('../../../../src/ai/score.py', import.meta.url), 'utf8'), /using only the profile and the posting/,
    'the scorer no longer reads only the Profile: give the judge what it reads now');
});

// Run 12 (24 Oct 2026): "Geneva is a preferred place" and "Bern is acceptable, not preferred" were judged invented ("the profile's preferences are blank"): the scorer is told the search's places (c1f98e7), the judge was not.
test('the score-text judge is given the places the scorer was told', async () => {
  const {placesNote} = await import('../../lib/quality-places.mjs');
  const note = placesNote({top_tier: ['zurich', 'geneva'], country_wide: ['switzerland', 'basel', 'bern'], abroad: []});
  for (const word of ['zurich', 'geneva', 'switzerland', 'basel', 'bern']) assert.ok(note.includes(word), `${word} is missing from the judge's places`);
  assert.equal(placesNote({}), '', 'no places set: nothing to say');
  const source = fs.readFileSync(new URL('../../suites/qualityai.mjs', import.meta.url), 'utf8');
  const step = source.slice(source.indexOf("ctx.run('the score reasons say nothing invented"), source.indexOf('summary.invented ='));
  assert.match(step, /placesNote\(/, 'the judge\'s candidate text no longer carries the places');
});
