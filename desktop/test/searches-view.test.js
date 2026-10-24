// Reports → Searches (renderer/searches-view.js, lib/searches-handlers.js): which runs are searches, the list row, and the report of one run for
// each kind of run: a full local run, a cloud run with a problem, a run from before the details were kept, a stopped run, and no runs at all.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {test} from 'node:test';
import {fileURLToPath} from 'node:url';
import {KEPT, SEARCH_MODES, listLine, listRow, report, searchRuns} from '../renderer/searches-view.js';
import {search, searches} from '../lib/searches-handlers.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const demo = JSON.parse(fs.readFileSync(path.join(here, '../demo/searches.json'), 'utf8'));

test('only search runs are listed, newest first, at most 50', () => {
  const rows = [{id: 'a', mode: 'mail', started_at: '2026-10-25'}, ...Array.from({length: 60}, (_, i) => ({id: `r${i}`, mode: SEARCH_MODES[i % 5], started_at: `2026-09-${String(i % 28 + 1).padStart(2, '0')}`}))];
  const listed = searchRuns(rows);
  assert.equal(listed.length, KEPT);
  assert.ok(listed.every(row => SEARCH_MODES.includes(row.mode)));
  assert.deepEqual(listed.map(row => row.started_at), [...listed.map(row => row.started_at)].sort().reverse());
});

test('a list row names the search, where it ran and how it went', () => {
  const [mac, cloud, old, stopped] = demo.map(listRow);
  assert.deepEqual([mac.name, mac.where, mac.added, mac.outcome, mac.kept], ['Find jobs', 'This Mac', 0, 'OK', true]);
  assert.deepEqual([cloud.where, cloud.added, cloud.tone], ['In the cloud', 11, 'warn']);
  assert.equal(old.kept, false);
  assert.equal(stopped.tone, 'bad');
  assert.equal(listLine([]), '');
});

test('every kind of run draws a report: widgets only for what the run measured', () => {
  const [mac, cloud, old, stopped] = demo;
  const ids = row => report(row).cards.map(card => card.id);
  assert.deepEqual(ids(mac), ['steps', 'jobs', 'employers', 'boards', 'ai', 'scoring', 'problems', 'log']);
  assert.equal(report(cloud).cards.find(card => card.id === 'problems').lines[0].includes('Fabrikam'), true);
  assert.deepEqual(ids(old).slice(0, 1), ['note']);            // says plainly that the details were not kept
  assert.ok(ids(old).includes('totals'));
  assert.deepEqual(ids(stopped), ['steps', 'ai', 'problems', 'log']);   // a stopped run: the steps until the stop, and why
});

test('the figures are tiles with an icon and a tone; the funnel is bars sized against the postings seen', () => {
  const {tiles, cards} = report(demo[0]);
  assert.deepEqual(tiles.slice(0, 4).map(tile => [tile.label, tile.value, tile.tone]),
    [['Added to your list', '0', 'neutral'], ['Postings seen', '3,412', 'info'], ['In your places', '388', 'teal'], ['Match your roles', '41', 'signal']]);
  assert.ok(tiles.every(tile => tile.icon));
  const jobs = cards.find(card => card.id === 'jobs');
  assert.deepEqual(jobs.bars.map(bar => bar.share), [100, 11, 2, 0].slice(0, jobs.bars.length));   // 388/3412 = 11 %; 41 is under 2 % and still drawn at 2
  assert.deepEqual(jobs.chips.map(chip => [chip.label, chip.detail]), [['Dropped by “senior”', '14'], ['Dropped by “lead”', '9']]);
  assert.equal(report(demo[1]).tiles[0].tone, 'good');            // jobs added: green
});

test('steps are bars sized by their seconds', () => {
  const steps = report(demo[0]).cards.find(card => card.id === 'steps').steps;
  assert.deepEqual(steps.map(step => step.share), [2, 1, 1].map((_, i) => steps[i].share));
  assert.ok(steps[0].share > steps[1].share && steps[1].share > steps[2].share);
});

test('scoring only in its folded card; none of it in the plain ones', () => {
  for (const row of demo) {
    const {cards} = report(row);
    assert.equal(cards.find(card => card.id === 'scoring')?.kind ?? 'fold', 'fold');
    for (const card of cards.filter(card => !['scoring', 'log'].includes(card.id))) assert.doesNotMatch(JSON.stringify(card), /scor/i, card.id);
  }
});

test('the handler lists search runs without their report and log, and reads one whole', async () => {
  const calls = [];
  const call = async (_s, entity, method, kwargs) => { calls.push([entity, method]); return method === 'list' ? [...demo, {id: 'm', mode: 'mail', started_at: '2026-10-25'}] : demo[0]; };
  const rows = await searches({}, {call, now: Date.parse('2026-10-25T00:00:00Z')});
  assert.equal(rows.length, 4);
  assert.ok(rows.every(row => !('log' in row) && !('report' in row)));
  assert.equal((await search({}, 'r5', {call})).log.length > 0, true);
  assert.deepEqual(calls, [['cron_runs', 'list'], ['cron_runs', 'get']]);
});

test('every finished search run of the store has a Full report link; live runs and other kinds have none', async () => {
  const {hasFullReport, REPORT_KINDS} = await import('../renderer/searches-view.js');
  for (const kind of REPORT_KINDS) {
    assert.equal(hasFullReport({kind, pageId: 'r1'}), true, kind);
    assert.equal(hasFullReport({kind, pageId: 'r1', live: true}), false, `${kind} while it runs`);
    assert.equal(hasFullReport({kind}), false, `${kind} without a record`);
  }
  for (const kind of ['mail', 'insight', 'weekly', 'kits', 'tailor', 'today']) assert.equal(hasFullReport({kind, pageId: 'r1'}), false, kind);
});

test('the link is on the Jobs find card, the Recent activity header and the Actions result card, and opens the report through one helper', () => {
  const read = name => fs.readFileSync(path.join(here, '../renderer', name), 'utf8');
  assert.match(read('pages/jobs-find.js'), /Full report →/);
  assert.match(read('index.html'), /id="activity-report"[^>]*>Full report →/);
  assert.match(read('pages/activity.js'), /showFullReport\(run\.pageId/);
  assert.match(read('pages/activity-results.js'), /hasFullReport\(\{\.\.\.run, kind: kindOf\(run\)\}\)[\s\S]*Full report →/);   // the Actions page's result card too
  assert.match(read('pages/full-report.js'), /openView\('reports'\);\s*return openSearchReport\(runId\)/);
});
