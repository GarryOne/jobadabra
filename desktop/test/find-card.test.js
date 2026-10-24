// The Find jobs card on top of Jobs: its five states, the running step, the counts. The page code (pages/jobs-find.js) only draws this.
import test from 'node:test';
import assert from 'node:assert/strict';
import {runCounts, findCard, stepChips, employersRead, addedSoFar, addedWords} from '../renderer/find-card-model.js';

const run = log => ({kind: 'search', log});

test('an empty first run offers the big button; a later visit shows nothing', () => {
  assert.equal(findCard({lastSearchAt: '', listed: 0}).state, 'empty');
  assert.equal(findCard({lastSearchAt: '2026-10-16T10:00:00Z', listed: 12}).state, 'none');
});

test('a running search shows its steps, last lines in words and the counts; the list grows below', () => {
  const log = ['Finding your first jobs…', 'First jobs: reading 15 of 212 employer sites first', 'First jobs: 9 found', 'Scored 1 of 3 job(s)'];
  const card = findCard({running: run([...log, 'Run counts: looked=612 matches=9 scored=1']), listed: 300});
  assert.equal(card.state, 'searching');
  assert.deepEqual(card.chips.map(c => c.state), ['active', 'pending', 'pending', 'pending']);
  assert.equal(card.chips[0].label, 'First jobs');
  assert.ok(card.lines.some(line => /9 jobs found in the first sites/.test(line)), card.lines.join('|'));
  assert.deepEqual([card.looked, card.matches, card.scored], [612, 9, 1], 'this search only, never the list');
});

test('the steps move on: first jobs, then every employer, then the job boards, then more employers', () => {
  const at = line => stepChips(['Finding your first jobs…', line]).map(c => c.state).join(',');
  assert.equal(at('Searching job boards…'), 'done,done,active,pending');
  assert.equal(at('Growing your sources: finding more employers…'), 'done,done,done,active');
  assert.equal(stepChips(['Searching job boards…', 'Checking employer career pages…']).map(c => c.label).join('|'), 'Job boards|Employer sites|More employers');
});

test('a search that ended here is done, or failed with its reason; a failure on an empty list stays', () => {
  assert.equal(findCard({last: {ok: true, new: 4}, lastSearchAt: 'x', listed: 4, finishedHere: true}).state, 'done');
  const failed = findCard({last: {ok: false, problem: 'Claude Code is not answering'}, lastSearchAt: 'x', listed: 0});
  assert.deepEqual([failed.state, failed.problem], ['failed', 'Claude Code is not answering']);
  assert.equal(findCard({last: {ok: false}, lastSearchAt: 'x', listed: 30}).state, 'none', 'an old failure never covers a full list');
});

test('every state of the card is drawn by jobs-find.js and nothing else offers Refresh jobs', async () => {
  const fs = await import('node:fs');
  const draw = fs.readFileSync(new URL('../renderer/pages/jobs-find.js', import.meta.url), 'utf8');
  for (const state of ['empty', 'searching', 'done', 'failed']) assert.match(draw, new RegExp(`model.state === '${state}'`));
  const html = fs.readFileSync(new URL('../renderer/index.html', import.meta.url), 'utf8');
  assert.ok(!/<span>Refresh jobs<\/span>/.test(html));
});

// The class (owner, 16 Oct 2026: one action "Find jobs"): no screen, palette entry, run name, notification or message the app draws still names the two old
// actions. Comments may tell the history; strings may not. A new surface that copies the old words fails here.
test('no label the app shows still says Refresh jobs or Find new employers', async () => {
  const fs = await import('node:fs');
  const path = await import('node:path');
  const root = path.resolve(import.meta.dirname, '..');
  const files = [];
  const walk = dir => { for (const entry of fs.readdirSync(dir, {withFileTypes: true})) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) { if (!['node_modules', 'demo'].includes(entry.name)) walk(full); } else if (/\.(js|html)$/.test(entry.name)) files.push(full);
  } };
  walk(path.join(root, 'renderer')); walk(path.join(root, 'lib'));
  const hits = [];
  for (const file of files) {
    const code = fs.readFileSync(file, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/<!--[\s\S]*?-->/g, '').split('\n').map(line => line.replace(/(^|\s)\/\/.*$/, '$1'));
    code.forEach((line, i) => { if (/Find new employers|Refresh jobs|Refreshing jobs/.test(line)) hits.push(`${path.relative(root, file)}:${i + 1}`); });
  }
  assert.deepEqual(hits, []);
});

test('the last Run counts line wins; a log without one counts 0; the done card keeps the run\'s numbers', () => {
  assert.deepEqual(runCounts(['Run counts: looked=5 matches=1 scored=0', 'Scored 1 of 1 job(s)', 'Run counts: looked=9 matches=2 scored=1']), {looked: 9, matches: 2, scored: 1, good: 0});
  assert.deepEqual(runCounts(['Scored 1 of 3 job(s)']), {looked: 0, matches: 0, scored: 0, good: 0});
  const done = findCard({last: {ok: true, new: 4, log: ['Run counts: looked=612 matches=14 scored=9']}, lastSearchAt: 'x', listed: 351, finishedHere: true});
  assert.deepEqual([done.state, done.looked, done.matches, done.scored], ['done', 612, 14, 9]);
});

test('the Run counts line is not shown as a log line', async () => {
  const {readableLog} = await import('../renderer/human-log.js');
  assert.deepEqual(readableLog(['Run counts: looked=1 matches=0 scored=0']), []);
});

test('matches rise during the employer read, good fits are 70+, employers read are progress, listings are one small number', () => {
  const read = n => `⏳ Reading employer job sites: ${n} of 2251 · 131,825 jobs listed · under a minute left`;
  const at = (n, counts) => findCard({running: run(['Searching job boards…', read(n), counts]), listed: 0});
  const early = at(900, 'Run counts: looked=60000 matches=12 scored=0 good=0');
  const later = at(1953, 'Run counts: looked=135769 matches=31 scored=4 good=2');
  assert.deepEqual([early.matches, later.matches, later.scored, later.good], [12, 31, 4, 2]);
  assert.ok(later.matches >= early.matches, 'never goes down during the read');
  assert.deepEqual(later.employers, {done: 1953, total: 2251});
  assert.equal(later.looked, 135769);
  assert.deepEqual(employersRead(['Reading employer job sites: 5 of 9', read(7)]), {done: 7, total: 2251});
  assert.equal(employersRead(['Scored 1 of 3 job(s)']), null);
  assert.equal(runCounts(['Run counts: looked=5 matches=1 scored=0']).good, 0, 'an older line has no good fits');
});

test('the done card shows the same three numbers as the searching card', () => {
  const done = findCard({last: {ok: true, new: 4, log: ['Run counts: looked=612 matches=14 scored=9 good=3']}, lastSearchAt: 'x', listed: 351, finishedHere: true});
  assert.deepEqual([done.state, done.matches, done.scored, done.good, done.looked], ['done', 14, 9, 3, 612]);
});

test('a search result shows one number: jobs added to the list; no scoring words (owner, 24 Oct 2026)', async () => {
  assert.equal(addedSoFar(['Added 3 new job(s): Zurich 3', 'Added 2 new job(s): Bern 2', 'Scored 1 of 3 job(s)']), 5, 'a running search adds its Added lines up');
  assert.equal(addedSoFar([]), 0);
  assert.equal(addedWords(1), '1 job added to your list');
  assert.equal(addedWords(0), 'No jobs added to your list');
  const done = findCard({last: {ok: true, new: 4, log: ['Run counts: looked=9 matches=2566 scored=30 good=4']}, lastSearchAt: 'x', listed: 1, finishedHere: true});
  assert.equal(done.added, 4, "the run's own record wins");
  const fs = await import('node:fs');
  for (const file of ['pages/jobs-find.js', 'pages/activity-run-card.js']) {
    const src = fs.readFileSync(new URL(`../renderer/${file}`, import.meta.url), 'utf8');
    assert.doesNotMatch(src, /Strong matches|waiting for a score|Waiting for a score|'Scored'| scored`/, `${file} shows no scoring words`);
  }
});
