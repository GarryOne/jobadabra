// "Didn't fill: <reason>" (extension/background.js ineligibleNote): the app's reply may carry no note (an error path); the extension must still show the note, not crash on an undefined script argument
// (10 Oct 2026, the Aldi replay: "Value is unserializable"). Source check, since the service worker cannot be loaded here; the recorded replays exercise it.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

test('an ineligible reply without a note still gets a note: the script argument is never undefined', () => {
  const background = fs.readFileSync(new URL('../../extension/background.js', import.meta.url), 'utf8');
  assert.match(background, /async function ineligibleNote\(tabId, reason, partly = false\) \{[^\n]*\n(?:  if \(await tellPanel\([^\n]*\n)?  await chrome\.scripting\.executeScript\(\{target: \{tabId\}, args: \[String\(reason \|\| 'not eligible'\), !!partly\]/);
  assert.match(background, /partly \? `Jobadabra filled only your details on this form: \$\{text\}` : `Jobadabra didn't fill this form: \$\{text\}`/, 'the note says what was filled');
  const flow = ['../../extension/fill-tab-inputs.js', '../../extension/fill-tab-finish.js']
    .map(file => fs.readFileSync(new URL(file, import.meta.url), 'utf8')).join('\n');
  assert.equal([...flow.matchAll(/note: ai\.eligibility_note,/g)].length, 0, 'every ineligible return has a fallback for the note');
});
