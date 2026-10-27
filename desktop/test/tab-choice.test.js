// A tab picked while Settings → Profile waits for the app state stays; the late default only applies when nothing was picked (renderer/tab-choice.js).
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {test} from 'node:test';
import {pick, startDefault} from '../renderer/tab-choice.js';

test('a default that waited is dropped when a tab was picked meanwhile, kept otherwise', async () => {
  const slowState = () => new Promise(resolve => setTimeout(resolve, 20));
  let shown = 'details';
  const open = async (clickDuring) => {
    const stillDefault = startDefault();
    const loading = slowState();
    if (clickDuring) { pick(); shown = 'answers'; }
    await loading;
    if (stillDefault()) shown = 'details';
    return shown;
  };
  assert.equal(await open(true), 'answers', 'the click made while the state was loading stays');
  assert.equal(await open(false), 'details', 'nothing picked: the default applies');
});

test('the Profile page uses it: its default call is marked, every other profileTab call is a pick', () => {
  const read = path => fs.readFileSync(new URL(path, import.meta.url), 'utf8');
  assert.match(read('../renderer/pages/settings.js'), /const stillDefault = startDefault\(\);[\s\S]*?await window\.pilot\.state\(\);[\s\S]*?if \(stillDefault\(\)\) profileTab\(remembered\('profileTab'\) \|\| 'cv', \{byDefault: true\}\);/);   // Reload restores the tab; fresh windows still default to CV.
  assert.match(read('../renderer/pages/profile.js'), /export function profileTab\(name, \{byDefault = false\} = \{\}\) \{\n  if \(!byDefault\) pick\(\);/);
  const calls = [...read('../renderer/pages/settings.js').matchAll(/profileTab\('[^']+'(?:, \{byDefault: true\})?\)/g)].map(match => match[0]);
  assert.deepEqual(calls.filter(call => !call.includes('byDefault')), [], 'a profileTab call in settings.js that is not the marked default would count as a pick');
});
