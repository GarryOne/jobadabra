// Jobs' "Your Profile is empty" notice (#2759) comes from the jobs read, never from Strategy's: strategyData runs the whole strategy pipeline (queued behind crawls) and can write the search level.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {test} from 'node:test';

const read = name => fs.readFileSync(new URL(`../renderer/${name}`, import.meta.url), 'utf8');

test('Jobs never calls strategyData and draws the notice from the jobs payload', () => {
  for (const file of ['pages/jobs.js', 'profile-empty.js']) assert.doesNotMatch(read(file), /strategyData/, `${file} must not run the strategy read`);
  assert.match(read('pages/jobs.js'), /if \('profile_empty' in data\) showProfileEmpty\(!!data\.profile_empty\)/);
  assert.match(read('pages/jobs.js'), /showJobsData\(withoutProfileVerdict\(saved\.result\)\)/, 'a saved list never says it: a rebuilt Profile would flash the notice back');
});

test('the Jobs notice is a copy of Strategy\'s block: one source of words, one Rebuild from CV', () => {
  assert.doesNotMatch(read('index.html').match(/id="jobs-profile-empty"[^>]*>[^<]*<\/div>/)?.[0] || '', /fit scores are paused/, 'no second copy of the words in the page');
  assert.match(read('profile-empty.js'), /source\.cloneNode\(true\)/);
  assert.match(read('profile-empty.js'), /getElementById\('strategy-redo'\)\.click\(\)/);
});
