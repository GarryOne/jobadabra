// Known fields first (apply-latency E, owner 11 Oct 2026): without a kit, the fields your details and CV answer are filled at once and Claude's answers
// fill a second pass when they come (as after a kit); a "not eligible" answer then keeps what is filled and the note says so. Source checks on
// extension/flow.js (the service worker cannot be loaded here); the recorded replays and the journey gate run the fill itself.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {test} from 'node:test';

const flow = ['../../extension/flow.js', '../../extension/fill-tab-inputs.js', '../../extension/fill-tab-finish.js']
    .map(file => fs.readFileSync(new URL(file, import.meta.url), 'utf8')).join('\n');
const background = fs.readFileSync(new URL('../../extension/background.js', import.meta.url), 'utf8');

test('without a kit, Claude is asked and the known fields are filled before its answer is awaited', () => {
  const asked = flow.indexOf('pendingAI = askedEarly ?'), firstPass = flow.indexOf('window.__jobPilottoExtensionFill(list, profile, resume, letter, consents)'), awaited = flow.indexOf('ai = answersOrDropped(pendingAI ? await pendingAI');
  assert.ok(asked > 0 && firstPass > asked && awaited > firstPass, 'ask, then fill the known fields, then await the answers');
  assert.match(flow, /later = open;\n    \}\n  \}/, 'the answers fill as a second pass');
  assert.doesNotMatch(flow, /import\('\.\/log\.js'\)/, 'no dynamic import: a service worker refuses import()');
  assert.match(flow, /if \(pendingAI\) decide\('fill', 'first fields filled'/, 'the first fields are logged (the time to first field is measured from it)');
});

test('not eligible after the first pass: what is filled stays, and the note says only your details were filled', () => {
  assert.match(flow, /return \{\.\.\.summary, ineligible: true, partly: true, note: ai\.eligibility_note \|\| '', usd: ai\.usd, \.\.\.verdictFields\(\{ai\}\)\}/);
  assert.match(background, /await ineligibleNote\(tab\.id, result\.note, result\.partly\)/);
});

// The stop after the first pass carries that pass's rows, so the fields it filled are logged ("fields: N filled, M left") as on every other end; before
// (11 Oct 2026) a stop returned no trace and the smoke counted a form with 4 known fields filled as nothing filled.
test('a stop after the first pass logs the fields that pass filled', () => {
  const stops = [...flow.matchAll(/return \{([^}]*)ineligible: true([^}]*)\}/g)];
  for (const [whole] of stops.filter(([whole]) => /partly: true/.test(whole))) assert.match(whole, /^return \{\.\.\.summary, /, `a partly stop without the first pass's rows: ${whole}`);
  assert.ok(stops.some(([whole]) => /partly: true/.test(whole)), 'the partly stop is found');
  const logged = background.indexOf('logFieldsLine(decide, result.trace'), told = background.indexOf("decide('fill', result.ineligible ?");
  assert.ok(told > 0 && logged > told, 'background.js logs the fields after the stop too, from result.trace');
});

test('the second pass carries Claude\'s cover letter when there is no kit (the first pass had none yet)', () => {
  assert.match(flow, /\[extra, withKit \? '' : coverLetter \|\| ai\?\.cover_letter \|\| '', \(me\?\.acceptConsents \?\? config\.acceptConsents\) !== false\]/);
});
