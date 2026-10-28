// The Actions page by importance: one large card, two medium, the smaller tasks under a collapsed More; every task still reachable and still held off while one runs; the schedule lines.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {test} from 'node:test';
import {fileURLToPath} from 'node:url';
import {scheduleLine} from '../renderer/schedule-line.js';
import {activitySource} from './activity-source.js';

const renderer = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'renderer');
const read = name => fs.readFileSync(path.join(renderer, name), 'utf8');
const html = read('index.html');
const grid = html.slice(html.indexOf('<div class="task-grid">'), html.indexOf('<section class="card runs-card">'));
const zone = (open, close) => grid.slice(grid.indexOf(open), grid.indexOf(close));
const main = zone('<div class="task-main">', '<div class="task-pair">'), pair = zone('<div class="task-pair">', '<!-- More'), rows = grid.slice(grid.indexOf('id="actions-more-list"'));
const titles = part => [...part.matchAll(/<div class="task-words"><b>([^<]+)<\/b>/g)].map(m => m[1].replace('&amp;', '&'));

test('importance: Find jobs large, Tailor CVs and Check Gmail medium, the smaller ones under More', () => {
  assert.deepEqual(titles(main), ['Find jobs']);
  assert.match(main, /task-card is-large/);
  assert.deepEqual(titles(pair), ['Tailor CV + cover letter for top matches', 'Check Gmail & Calendar']);
  assert.equal((pair.match(/task-card is-medium/g) || []).length, 2);
  assert.match(pair, /id="tailor-top-n"/);   // Tailor keeps its number field
  assert.deepEqual(titles(rows), ['Find jobs using your browser']);   // + Read this board, added by actions-board.js; Tune and Analyze left for Focus and ⌘K (28 Oct 2026)
  assert.match(read('pages/actions-board.js'), /\$\('actions-more-list'\) \|\| /);
});

test('More starts closed, its state is remembered, and its count is the rows in it', () => {
  assert.match(grid, /id="actions-more-head" aria-expanded="false"/);
  assert.match(grid, /id="actions-more-list" hidden>/);
  const layout = read('pages/actions-layout.js');
  assert.match(layout, /key: 'jp\.actions\.more'/);
  assert.match(layout, /#actions-more-list > \.task-card/);
  assert.match(layout, /more\?\.draw\(smallRows\(\)\)/);
});

test('every Run button is reachable and kept off while a task runs: tracked commands or the TASK_BUTTONS ids', () => {
  const basics = activitySource();
  const kinds = basics.match(/export const COMMAND_KIND = \{([^}]*)\}/)[1];
  const tracked = basics.match(/export const TASK_BUTTONS = (\[\[.*\]\]);/)[1];
  const buttons = [...grid.matchAll(/<button[^>]*class="[^"]*\baction\b[^"]*"[^>]*>/g)].map(m => m[0]);
  assert.equal(buttons.length, 4);
  for (const button of buttons) {
    const command = button.match(/data-command="(\w+)"/)?.[1], id = button.match(/id="([\w-]+)"/)?.[1];
    if (command) assert.match(kinds, new RegExp(`\\b${command}:`), `${command} is held off while its task runs (COMMAND_KIND)`);
    else assert.ok(tracked.includes(`#${id}`), `${id} is held off while a task runs (TASK_BUTTONS)`);
  }
  assert.match(tracked, /#board-run/);   // the dynamic one too
});

test('every task keeps its ⌘K entry: the buttons keep their data-command / data-palette', () => {
  for (const id of ['visits-run', 'tailor-top']) assert.match(grid, new RegExp(`id="${id}"[^>]*data-palette="`), id);
  for (const command of ['run', 'mail']) assert.match(grid, new RegExp(`data-command="${command}"`), command);
  assert.match(read('pages/actions-board.js'), /dataset\.palette = 'board'/);
});

test('the schedule lines come from the real schedule and the next run', () => {
  const now = new Date(2026, 9, 17, 3, 0);
  assert.equal(scheduleLine(4, new Date(2026, 9, 17, 5, 29), now), 'runs every 4 h · next today 05:29');
  assert.equal(scheduleLine('daily', new Date(2026, 9, 18, 5, 29), now), 'runs daily · next tomorrow 05:29');
  assert.equal(scheduleLine(3, null, now), 'runs every 3 h');
  assert.equal(scheduleLine('0', new Date(2026, 9, 18, 5, 29), now), 'Runs on demand');
  assert.equal(scheduleLine(undefined, undefined, now), '');   // no saved frequency: no line
  assert.match(grid, /data-task-schedule="search"/);
  assert.match(grid, /data-task-schedule="mail"/);
});
