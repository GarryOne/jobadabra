// "View jobs" on a site that read more than one new job (13 Oct 2026): every place that lists a read site (the result card's rows and the step card's rows) uses the one helper.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {test} from 'node:test';

const page = name => fs.readFileSync(new URL(`../renderer/pages/${name}`, import.meta.url), 'utf8');

test('every list of read sites offers View jobs through viewJobsButton, with the run start as its filter', () => {
  assert.match(page('activity-visits.js'), /viewJobsButton\(site, site\.detail, card\.since\)/, 'the result card row');
  assert.match(page('activity-basics.js'), /viewJobsButton\(site, site\.words, since\)/, 'the step card row');
  assert.match(page('activity-render.js'), /siteRow\(site, !!run\.live, run\.startedAt\)/);
  assert.match(page('activity-result-bottom.js'), /since: run\.startedAt/);
  assert.match(page('activity-basics.js'), /since: run\?\.startedAt/);
});

test('the button needs 2 or more new jobs and opens Jobs filtered through showJobsIn', () => {
  const source = page('activity-visits.js');
  assert.match(source, /if \(fresh < 2\) return null/);
  assert.match(source, /showJobsIn\(`New from \$\{site\.name\}`, urls, 'activity'\)/);
});
