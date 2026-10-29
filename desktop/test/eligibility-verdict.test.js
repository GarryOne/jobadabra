// The fill's log line tells "the AI judged eligible" from "eligibility was skipped" (extension/eligibility-verdict.js): it carries the AI's own verdict and
// why a "not eligible" did not stop the fill. 11 Oct 2026: "filled the form {ineligible:false}" after a kit was read as an eligible verdict.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {test} from 'node:test';
import {verdictFields} from '../../extension/eligibility-verdict.js';

const flow = ['../../extension/flow.js', '../../extension/fill-tab-inputs.js', '../../extension/fill-tab-finish.js']
    .map(file => fs.readFileSync(new URL(file, import.meta.url), 'utf8')).join('\n');
const background = fs.readFileSync(new URL('../../extension/background.js', import.meta.url), 'utf8');

test('a kit-forced fill says the AI judged not eligible and the kit decided', () => {
  assert.deepEqual(verdictFields({ai: {eligible: false}, kit: true}), {aiEligible: false, forced: 'kit'});
});

test('each way past a "not eligible", and the plain verdicts', () => {
  assert.deepEqual(verdictFields({ai: {eligible: false}, askedAnyway: true, kit: true}), {aiEligible: false, forced: 'fill anyway'}, 'the person\'s press is named first');
  assert.deepEqual(verdictFields({ai: {eligible: false}, checkOff: true}), {aiEligible: false, forced: 'check off'});
  assert.deepEqual(verdictFields({ai: {eligible: true}, kit: true}), {aiEligible: true, forced: ''}, 'eligible: nothing was overridden');
  assert.deepEqual(verdictFields({ai: null, kit: true}), {aiEligible: null, forced: ''}, 'no AI answer (a kit covered every field): no verdict');
  assert.deepEqual(verdictFields({ai: {eligible: false}}), {aiEligible: false, forced: ''});
});

test('the fill returns the verdict fields, from the press as asked (before a kit sets force), and the log line carries them', () => {
  const asked = flow.indexOf('const askedAnyway = force;'), kitForce = flow.indexOf('if (kitSkips) force = true;');
  assert.ok(asked > 0 && asked < kitForce, 'the person\'s "Fill anyway" is kept before a kit turns force on');
  assert.match(flow, /return \{\.\.\.summary, usd: ai\?\.usd, aiError, coverLetter: ai\?\.cover_letter, \.\.\.verdictFields\(\{ai, askedAnyway, kit: withKit \|\| kitSkips, checkOff: config\.checkEligibility === false\}\)\};/);
  assert.match(background, /\{url: page, ineligible: !!result\.ineligible, aiEligible: result\.aiEligible \?\? null, forced: result\.forced \|\| ''\}/);
});

// A stop carries the verdict too, so its line says aiEligible:false, never null (11 Oct 2026: the partly stop's line said null after df9f592).
test('every eligibility stop returns the AI\'s verdict', () => {
  const stops = [...flow.matchAll(/return \{[^;]*ineligible: true[^;]*;/g)].map(([whole]) => whole);
  assert.ok(stops.length >= 2, `both stops are found (${stops.length})`);
  for (const stop of stops) assert.match(stop, /\.\.\.verdictFields\(\{ai\}\)\};$/, `a stop without the AI's verdict: ${stop}`);
});
