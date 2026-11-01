// Archiving pool rows (lib/pool-archive.mjs) and the recorder's skip of archived rows (record-sites.mjs); the upload carries the stage (lib/applying-report.mjs poolRows).
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {test} from 'node:test';
import {fileURLToPath} from 'node:url';
import {poolRows} from '../../lib/applying-report.mjs';
import {archiveRows} from '../../lib/pool-archive.mjs';

const here = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const pool = () => ({shapes: [{shape: 'Fixed row', urls: ['https://a.example/1']}, {shape: 'Gone row', urls: ['https://b.example/1']}, {shape: 'Watched', urls: ['https://c.example/1'], stage: 'watch'}, {shape: 'Failing', urls: ['https://d.example/1']}, {shape: 'Done', urls: ['https://e.example/1'], stage: 'archived', stageWhy: 'fixed'}]});

test('only rows the page says may be archived are, with their reason; a watched or archived row is left alone; nothing is removed', () => {
  const list = pool(), items = [{shape: 'Fixed row', archivable: 'fixed'}, {shape: 'Gone row', archivable: 'posting-gone'}, {shape: 'Watched', archivable: 'fixed'}, {shape: 'Failing', archivable: null}, {shape: 'Done', archivable: 'fixed'}, {shape: 'Unknown', archivable: 'fixed'}, {shape: 'Failing', archivable: 'because'}];
  assert.deepEqual(archiveRows(list, items, {day: '2026-10-17'}), [{shape: 'Fixed row', why: 'fixed'}, {shape: 'Gone row', why: 'posting-gone'}]);
  assert.equal(list.shapes.length, 5, 'nothing is deleted');
  assert.deepEqual(list.shapes[0], {shape: 'Fixed row', urls: ['https://a.example/1'], stage: 'archived', stageWhy: 'fixed', archivedAt: '2026-10-17'});
  assert.equal(list.shapes[2].stage, 'watch');
  assert.deepEqual(archiveRows(pool(), [{shape: 'Gone row', archivable: 'posting-gone'}, {shape: 'Fixed row', archivable: 'fixed'}], {only: ['fixed']}).map(item => item.shape), ['Fixed row'], '--only narrows by reason');
});

test('the pool upload carries the stage and its reason, nothing else', () => {
  const rows = poolRows([{shape: 'A', urls: ['https://a.example/1'], stage: 'archived', stageWhy: 'posting-gone', archivedAt: '2026-10-17'}, {shape: 'B', urls: ['https://b.example/1'], stage: 'watch', stageWhy: 'x'}, {shape: 'C', urls: ['https://c.example/1'], stage: 'odd'}]);
  assert.deepEqual(rows, [{name: 'A', start_host: 'a.example', stage: 'archived', stage_why: 'posting-gone'}, {name: 'B', start_host: 'b.example', stage: 'watch'}, {name: 'C', start_host: 'c.example'}]);
});

test('the recorder skips archived rows in every list or share and says so; only --only names one', () => {
  const source = fs.readFileSync(path.join(here, '..', 'record-sites.mjs'), 'utf8');
  assert.match(source, /selectRows\(shapes, only\)\.filter\(item => only \|\| item\.stage !== 'archived'\)/);
  assert.match(source, /archived row\(s\) not run/);
  // the pool the repo holds keeps working: no archived row without a reason
  const list = JSON.parse(fs.readFileSync(path.join(here, '..', 'smoke-sites.json'), 'utf8')).shapes;
  for (const row of list.filter(item => item.stage === 'archived')) assert.ok(['fixed', 'working', 'posting-gone'].includes(row.stageWhy), `${row.shape}: an archived row says why`);
});
