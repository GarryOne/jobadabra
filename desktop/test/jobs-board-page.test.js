// Jobs → Board and saved views, the wiring: the IPC a drop uses, the demo guard, the hook in renderJobs, the ⌘K entries and the markup.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {test} from 'node:test';

const read = path => fs.readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');

test('a drop goes through the app\'s own stage paths (setStatus, setStage → the ledger event), demo-guarded', () => {
  const board = read('renderer/pages/jobs-board.js');
  assert.match(board, /window\.pilot\[move\.call\]\(job\.url, move\.arg\)/);
  assert.doesNotMatch(board, /stores|notion\./i, 'the board writes nothing itself');
  assert.match(read('preload.cjs'), /setStage: call\('setStage'\)/);
  assert.match(read('lib/demo.js'), /'setStage'/);
  const handler = read('lib/apply-handlers.js').match(/ipcMain\.handle\('setStage'[\s\S]*?\n {2}\}\);/)[0];
  assert.match(handler, /BOARD_STAGES\.includes\(to\)/, 'only outcome stages');
  assert.match(handler, /pipeline\.markOutcome\(storage, job, to\)/, 'the same engine step as How did it go?');
  assert.match(handler, /appLog\('outcome'/, 'logged');
});

test('renderJobs narrows by the ticked filters and ends by painting the board', () => {
  const render = read('renderer/pages/jobs-render.js');
  assert.match(render, /inFiltersLoose\(job, filters, now\) : inFilters\(job, filters, now\)/);
  assert.match(render, /paintViews\(\(counted \|\| shared\.allJobs\)\.filter\(job => columnOf\(job\) && \(counted \|\| !onBoard\.length \|\| inFilters\(job, onBoard, now\)\) && matches\(job, text\)\)\);[^\n]*\n\}/);
  assert.match(read('renderer/pages/jobs.js'), /setFilters\(\[next\.filter\]\)/, 'a counter is a selection of the menu');
});

test('the markup: the Show menu button, no chip row, the List | Board toggle, the board above the list and its panel', () => {
  const html = read('renderer/index.html');
  const at = id => html.indexOf(`id="${id}"`);
  assert.ok(at('jobs-views') < 0, 'the chip row is gone');
  assert.match(html, /<button type="button" class="select-button" id="filter-status"/);
  for (const id of ['jobs-mode', 'jobs-board', 'jobs-split']) assert.ok(at(id) > 0, id);
  assert.ok(at('jobs-board') < at('jobs-split'), 'the board is not inside the list and job panel');
  assert.match(html, /data-mode="list"[^>]*>List<\/button><button data-mode="board"[^>]*>Board<\/button>/);
  // 15 columns scroll sideways: the scrollbar is always shown (components.css .shows-scrollbar), or the last column reads as cut off.
  assert.match(html, /class="board shows-scrollbar" id="jobs-board"/);
  assert.match(read('renderer/components.css'), /\.shows-scrollbar::-webkit-scrollbar \{ width: 8px; height: 8px; \}/);
});

test('⌘K lists both modes and every filter of the Show menu', () => {
  const nav = read('renderer/pages/nav.js');
  assert.match(nav, /querySelectorAll\('\[data-mode\]'\)\.forEach/);
  assert.match(nav, /FILTER_OPTIONS\.forEach\(option => add\('Jobs', `Jobs filter: \$\{option\.label\}`/);
});

// The board's jobs and its columns follow one rule (jobs-board-rules.js columnOf): a job marked Applied only on its Job Matches row was dropped by
// a second `job.stage` filter before the columns ever saw it (9 Oct 2026, the UI audit).
test('the jobs the board is given are the ones it has a column for, not only those with a Stage', () => {
  const render = read('renderer/pages/jobs-render.js');
  assert.match(render, /paintViews\(\(counted \|\| shared\.allJobs\)\.filter\(job => columnOf\(job\) && \(counted/);
  assert.doesNotMatch(render, /paintViews\([^)]*job\.stage &&/);
});
