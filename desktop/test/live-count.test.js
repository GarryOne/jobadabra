// The Jobs list is read again while a refresh runs when a line says the list changed (owner, 7 Oct 2026: the 2,971 should drop live).
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {test} from 'node:test';

test('closing and the Notion writes so far reload the list; other lines do not', () => {
  const source = fs.readFileSync(new URL('../renderer/pages/jobs.js', import.meta.url), 'utf8');
  const LIST_CHANGED = eval(source.match(/export const LIST_CHANGED = (\/.+\/);/)[1]);
  assert.ok(LIST_CHANGED.test('Closed 2630 job(s) outside your places'));
  assert.ok(LIST_CHANGED.test('First jobs: 3 found on the job boards'), 'the late board jobs of a first press (src/first_jobs.py) show in the list');
  assert.ok(LIST_CHANGED.test('Closed 4 job(s) not seen for 7 days'));
  assert.ok(LIST_CHANGED.test('Job Matches: 10 created, 0 updated (so far)'));
  assert.ok(!LIST_CHANGED.test('Closed 0 job(s) not seen for 7 days'), 'nothing closed, nothing to read');
  assert.ok(LIST_CHANGED.test('Scored 3 of 12 job(s)'), 'each score moves the count');
  assert.ok(!LIST_CHANGED.test('Scored 12 of 12 job(s) with claude-sonnet-5-5; 0 failed'), 'the summary line is not a new score');
  assert.ok(!LIST_CHANGED.test('⏳ Scoring jobs against your Profile: 3 of 10'));
  assert.match(source, /if \(LIST_CHANGED\.test\(line\)\) reloadQuietly\(\);/);
});
