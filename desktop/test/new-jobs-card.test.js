// A search with new jobs and no digest still shows a result card (the owner's 17 Oct run showed only its header line), and the failure note is said once.
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {newJobItems, newJobsCard} from '../renderer/new-jobs-card.js';
import {readableLog} from '../renderer/human-log.js';
import {activitySource} from './activity-source.js';

const LINES = ['Added 2 new job(s): Paris 2', 'New job: Site Reliability Engineer | Acme | https://x.test/1', 'New job: Platform | Pipe | Co | https://x.test/2'];

test('the new jobs are read from the log: title, company, link, never scored', () => {
  assert.deepEqual(newJobItems(LINES).map(i => [i.title, i.company, i.url, i.fit, i.section]), [
    ['Site Reliability Engineer', 'Acme', 'https://x.test/1', null, 'new'], ['Platform | Pipe', 'Co', 'https://x.test/2', null, 'new']]);
});

test('a run that has the scores (Always on) puts the fit after the address, and a title with a bar still reads right', () => {
  const lines = ['New job: Staff SRE | Acme | https://x.test/1 | 87', 'New job: Platform | Pipe | Co | https://x.test/2 | 64', 'New job: No score | Co | https://x.test/3'];
  assert.deepEqual(newJobItems(lines).map(i => [i.title, i.company, i.url, i.fit]), [
    ['Staff SRE', 'Acme', 'https://x.test/1', 87], ['Platform | Pipe', 'Co', 'https://x.test/2', 64], ['No score', 'Co', 'https://x.test/3', null]]);
});

test('every state of a finished search with new jobs and no digest draws a card; others do not', () => {
  const ok = {ok: true, new: 8};
  assert.equal(newJobsCard(ok, LINES).fresh, 8);
  assert.equal(newJobsCard(ok, LINES).items.length, 2);
  assert.deepEqual(newJobsCard(ok, []).items, [], 'an older run: its count, no rows');
  assert.equal(newJobsCard(ok, []).kind, 'digest');
  for (const run of [{ok: true, new: 0}, {ok: true}, {ok: false, new: 8}, {ok: true, new: 8, live: true}, null]) assert.equal(newJobsCard(run, LINES), null);
});

// Owner, 25 Oct 2026: inside one run, only that run's jobs. The run's own "New job:" lines win over a digest (whose new section can hold earlier runs' jobs).
test('the renderer lists a search run\'s own new jobs first, a digest when it has none, and the partial note is said once (a search on its step row, test/run-result-card.test.js; any other kind under its card)', () => {
  const source = activitySource();
  assert.match(source, /const own = kindOf\(run\) === 'search' \? newJobsCard\(run, lines\) : null;\n\s+const card = \(own\?\.items\.length \? own : null\) \|\| \(shownText \? parseRunMessage\(shownText\) : null\) \|\| own;/);
  assert.match(source, /stepNote\(stepWarnings\)/);
  assert.doesNotMatch(source, /stepNote\(detailWarnings\)/);
  assert.match(source, /const stepWarnings = partial \|\| onStep \? split\.rest : detailWarnings;/);
});

test('the readable log names a new job in words', () => {
  assert.deepEqual(readableLog(['New job: SRE | Acme | https://x.test/1']), ['➕ SRE · Acme']);
});
