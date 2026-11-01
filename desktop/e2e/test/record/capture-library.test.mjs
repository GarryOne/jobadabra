// The captures library (lib/capture-library.mjs): every live visit kept, in the format npm run row reads, with its app log, build and result.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {test} from 'node:test';
import {buildStamp, keepCapture, pruneCaptures, runSettings} from '../../lib/capture-library.mjs';
import {rowFiles} from '../../lib/row-replay.mjs';

const here = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const fakeCapture = () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'jp-capture-'));
  fs.mkdirSync(path.join(dir, 'pages'));
  fs.writeFileSync(path.join(dir, 'pages', '1.html'), '<form><input name="a"></form>');
  fs.writeFileSync(path.join(dir, 'journey.json'), JSON.stringify([{url: 'https://jobs.example.org/a', file: 'pages/1.html', at: 1000, state: 0}]));
  return dir;
};
const appLog = '2026-10-13T06:00:02.500Z [extension] page kind: form {"by":"ai"}\n';

test('a PASSING row is kept too, readable by npm run row, with its app log, build and live result', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'jp-captures-'));
  const result = {url: 'https://jobs.example.org/a', reached: 'ready', filled: 6, left: 0};
  const folder = keepCapture({root, day: '2026-10-13', shape: 'Lever: single page', result, captureDir: fakeCapture(), appLog, build: {commit: 'abc', extension: '0.9.300'}, settings: runSettings({JP_APPLICANT: 'grown', CI: '1'}), at: '2026-10-13T06:00:00.000Z'});
  assert.ok(folder, 'a row that passed still keeps its capture');
  assert.equal(fs.readFileSync(path.join(folder, 'app.log'), 'utf8'), appLog);
  const meta = JSON.parse(fs.readFileSync(path.join(folder, 'capture.json'), 'utf8'));
  assert.deepEqual(meta, {row: 'Lever: single page', at: '2026-10-13T06:00:00.000Z', build: {commit: 'abc', extension: '0.9.300'}, settings: {applicant: 'grown', model: 'default', engine: 'api', store: 'sqlite'}, result});
  assert.equal(rowFiles(folder).start.url, 'https://jobs.example.org/a');   // the same format the row replay reads: no second reader
});

test('two visits of one row on one day keep both', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'jp-captures-'));
  const keep = at => keepCapture({root, day: '2026-10-13', shape: 'Lever: single page', result: {url: 'https://jobs.example.org/a', reached: 'form'}, captureDir: fakeCapture(), build: {}, at});
  assert.notEqual(keep('2026-10-13T06:00:00.000Z'), keep('2026-10-13T09:30:00.000Z'));
  assert.equal(fs.readdirSync(path.join(root, '2026-10-13')).length, 2);
});

test('a run that kept no page keeps nothing', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'jp-captures-')), empty = fs.mkdtempSync(path.join(os.tmpdir(), 'jp-capture-'));
  assert.equal(keepCapture({root, day: '2026-10-13', shape: 'x', result: {reached: 'none'}, captureDir: empty, build: {}}), null);
});

test('days older than 30 are pruned, newer ones and other folders stay', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'jp-captures-'));
  for (const name of ['2026-09-12', '2026-09-14', '2026-10-13', 'notes']) fs.mkdirSync(path.join(root, name));
  assert.deepEqual(pruneCaptures(root, {today: '2026-10-13'}), ['2026-09-12']);
  assert.deepEqual(fs.readdirSync(root).sort(), ['2026-09-14', '2026-10-13', 'notes']);
});

test('the build stamp names a commit and the extension version', () => {
  const build = buildStamp();
  assert.match(build.commit, /^[0-9a-f]{40}$/);
  assert.match(build.extension, /^\d+\.\d+/);   // a shallow CI checkout stamps the manifest's own "0.9"
});

// The class: every live runner keeps its capture (a new runner without it fails here).
test('every live runner keeps its capture in the library', () => {
  for (const file of ['record-sites.mjs', 'live.mjs']) assert.match(fs.readFileSync(path.join(here, '..', file), 'utf8'), /keepCapture\(/, `${file} keeps no capture`);
  assert.match(fs.readFileSync(path.join(here, '../../../.github/workflows/record-sites.yml'), 'utf8'), /RECORD_CAPTURES[\s\S]*name: pool-captures-\$\{\{ github\.run_id \}\}[\s\S]*retention-days: 30/, 'CI uploads the captures for 30 days');
});

test('a pulled CI artifact merges into the library once; a capture already there stays as it is', async () => {
  const {mergePulled} = await import('../../lib/capture-library.mjs');
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'jp-captures-')), from = fs.mkdtempSync(path.join(os.tmpdir(), 'jp-pulled-'));
  for (const name of ['lever-060000', 'no-meta']) fs.mkdirSync(path.join(from, '2026-10-13', name), {recursive: true});
  fs.writeFileSync(path.join(from, '2026-10-13', 'lever-060000', 'capture.json'), '{"row":"Lever"}');
  assert.deepEqual(mergePulled(from, root), ['2026-10-13/lever-060000']);
  fs.writeFileSync(path.join(root, '2026-10-13', 'lever-060000', 'capture.json'), '{"row":"mine"}');
  assert.deepEqual(mergePulled(from, root), []);
  assert.equal(fs.readFileSync(path.join(root, '2026-10-13', 'lever-060000', 'capture.json'), 'utf8'), '{"row":"mine"}');
});
