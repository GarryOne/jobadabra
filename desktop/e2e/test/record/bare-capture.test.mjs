// lib/bare-capture.mjs: a live capture folder (journey, pages, ai-calls, app log; no case.json) becomes a replay candidate the row tools take.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {test} from 'node:test';
import {candidateFromCapture, isBareCapture} from '../../lib/bare-capture.mjs';
import {findRow} from '../../lib/row-replay.mjs';

const live = () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'jp-live-capture-')), write = (file, text) => { fs.mkdirSync(path.dirname(path.join(dir, file)), {recursive: true}); fs.writeFileSync(path.join(dir, file), text); };
  write('pages/1.html', '<html><body><button>Apply</button></body></html>');
  write('journey.json', JSON.stringify([{url: 'https://jobs.example.test/o/1', file: 'pages/1.html', at: 1000, state: 0, ask: true}]));
  write('ai-calls.json', JSON.stringify([{route: '/extension/page-kind', at: 1500, request: {url: 'https://jobs.example.test/o/1'}, answer: {kind: 'posting'}}]));
  write('app.log', '2026-10-11T18:50:01.760Z [extension] fill: closed a popup {"label":"deny"}\n2026-10-11T18:50:08.689Z [extension] page kind: posting {"by":"ai"}\n');
  return dir;
};

test('a folder with a journey and no case.json is a bare capture; one with a case.json, or none, is not', () => {
  const dir = live();
  assert.equal(isBareCapture(dir), true);
  fs.writeFileSync(path.join(dir, 'case.json'), '{}');
  assert.equal(isBareCapture(dir), false);
  assert.equal(isBareCapture(path.join(dir, 'nope')), false);
});

test('the candidate has the pages, the presses read from the app log, the kept answers and the page kinds as evidence; findRow takes it', () => {
  const made = candidateFromCapture(live());
  try {
    const item = JSON.parse(fs.readFileSync(path.join(made.dir, 'case.json'), 'utf8'));
    assert.equal(item.pages[0].url, 'https://jobs.example.test/o/1');
    assert.equal(fs.existsSync(path.join(made.dir, 'pages/1.html')), true);
    assert.deepEqual(JSON.parse(fs.readFileSync(path.join(made.dir, 'presses.json'), 'utf8')).map(press => [press.what, press.label]), [['closed a popup', 'deny']]);
    assert.equal(JSON.parse(fs.readFileSync(path.join(made.dir, 'ai-calls.json'), 'utf8'))[0].route, '/extension/page-kind');
    assert.match(item.evidence.pageKinds[0], /page kind: posting/);
    assert.equal(findRow(made.dir, os.tmpdir()), path.resolve(made.dir));
  } finally { made.cleanup(); }
  assert.equal(fs.existsSync(made.dir), false);
});

test('a journey with no pages is refused with the folder named', () => {
  const dir = live();
  fs.writeFileSync(path.join(dir, 'journey.json'), '[]');
  assert.throws(() => candidateFromCapture(dir), /journey\.json holds no pages/);
});
