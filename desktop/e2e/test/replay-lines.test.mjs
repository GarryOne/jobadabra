// A failed case's printout shows only its own lines, in a browser shared with other cases (CI run 14 Oct 2026: another case's dropdown under combo-never-opens-late-answers-1).
import test from 'node:test';
import assert from 'node:assert/strict';
import {linesOfCase, saysWord} from '../lib/replay-lines.mjs';

const line = (text, fields = {}, at = text) => ({at, text, fields});
const own = ['jobs.example-a.test'], others = ['careers.example-b.test'];

test('a shared browser prints only the failed case\'s lines under its name', () => {
  const entries = [
    line('fill: filling', {host: 'jobs.example-a.test', tab: 7}),
    line('fill: option list opened', {tab: 7}),                          // no host, but its tab is the case's
    line('fill: option "Work permit" chosen', {host: 'careers.example-b.test', tab: 9}),
    line('fill: option list opened', {tab: 9}),                          // another case's tab
    line('worker: boot', {}),                                            // names nothing
  ];
  const {mine, unplaced} = linesOfCase(entries, {own, others});
  assert.deepEqual(mine.map(entry => entry.text), ['fill: filling', 'fill: option list opened']);
  assert.ok(mine.every(entry => entry.fields.tab === 7), 'a line of another case\'s tab was printed under this case');
  assert.equal(unplaced, 1);
});

test('a line pushed twice prints once', () => {
  const again = line('fill: filling', {host: 'jobs.example-a.test'}, 'same');
  assert.equal(linesOfCase([again, {...again}], {own, others}).mine.length, 1);
});

test('a told word on a line placed on the case\'s own tab is attributed; one on another case\'s tab or on no tab is not', () => {
  const entries = [line('fill: filling', {host: 'jobs.example-a.test', tab: 7}), line('closed a popup', {label: 'No thanks', tab: 7}), line('closed a popup', {label: 'Reject all', tab: 9}), line('fill: filling', {host: 'careers.example-b.test', tab: 9}), line('closed a dialog', {label: 'CANCELAR'})];
  const {mine} = linesOfCase(entries, {own, others});
  assert.ok(saysWord(mine, 'No thanks'));
  assert.ok(!saysWord(mine, 'Reject all'), 'another case\'s tab');
  assert.ok(!saysWord(mine, 'CANCELAR'), 'a line on no tab stays unplaced: it is proven alone');
});

test('the extension\'s decision lines a replay case tells by carry the tab they came from', async () => {
  const fs = await import('node:fs'), path = await import('node:path'), root = path.join(import.meta.dirname, '../../../extension');
  const sites = [['fill-flow-read.js', "'closed a popup'"], ['flow.js', "'typed for real a box that did not take its answer'"], ['flow.js', "'closed a dialog before the fill'"], ['flow.js', "'a menu showed no choice that matched'"], ['consent.js', "'popup: the press left the page, went back'"],
    ['popup-guard.js', "'closed a dialog during the fill'"], ['dialog-after-fill.js', "'closed a dialog opened by the fill'"], ['ladder/rung4-picture.js', '`closer look: ${action}`'], ['ladder/rung4-picture.js', '`closer look: pressed (${result})`'],
    ['ladder/progress.js', '`progress: ${kind}`'], ['ladder/fill-climb.js', '`fill: ${row.verb} on control ${row.n}`']];
  for (const [file, text] of sites) {
    const line = fs.readFileSync(path.join(root, file), 'utf8').split('\n').find(one => one.includes(text));
    assert.ok(line, `${file}: ${text} is gone`);
    assert.match(line, /\btab: (tab\.id|tabId)\b/, `${file}: ${text} has no tab (a told line the replay cannot place on its tab is proven again alone: ~30 s each)`);
  }
});
