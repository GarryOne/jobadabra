// The replay candidates the nightly smoke saves for a failing shape (lib/replay-candidate.mjs).
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {test} from 'node:test';
import {dropCandidate, livePresses, saveCandidate, slug, worthSaving} from '../../lib/replay-candidate.mjs';

test('a failure is worth keeping; a pass, a documented hold and a posting that is gone are not', () => {
  assert.equal(worthSaving({reached: 'form', filled: 4, left: 8, short: {done: 4, total: 12}}), true);   // 4 of 13 showed blue
  assert.equal(worthSaving({reached: 'posting'}), true);
  assert.equal(worthSaving({reached: 'account'}), true);
  assert.equal(worthSaving({reached: 'form', filled: 6, left: 6, short: null}), false);
  assert.equal(worthSaving({reached: 'ready', filled: 5, left: 0}), false);
  assert.equal(worthSaving({reached: 'code/bot'}), false);   // never past a bot check: not a bug
  assert.equal(worthSaving({reached: 'none', note: 'posting gone (HTTP 404)'}), false);
  assert.equal(worthSaving(null), false);
});

test('a candidate is a folder with the page and a case.json that says what the run saw, with no query string in the address', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'jp-candidates-'));
  const result = {url: 'https://jobs.example.com/o/role?token=abc#x', reached: 'form', filled: 4, left: 8, short: {done: 4, total: 12}, path: [{kind: 'form', host: 'jobs.example.com'}], fieldList: [{outcome: 'left', type: 'text', label: 'City', required: true, reason: 'no answer known'}]};
  const folder = saveCandidate({dir, day: '2026-10-10', shape: 'Recruitee form', result, html: '<!doctype html><p>form</p>', output: 'x\n  log [extension] fill: page kind: form {"by":"ai"}\nz'});
  assert.equal(folder, path.join(dir, '2026-10-10', 'recruitee-form'));
  const item = JSON.parse(fs.readFileSync(path.join(folder, 'case.json'), 'utf8'));
  assert.equal(item.pages[0].url, 'https://jobs.example.com/o/role');   // never the query or fragment
  assert.equal(item.sample, 'jobs.example.com');
  assert.equal(item.run.fields[0].label, 'City');
  assert.equal(item.evidence.pageKinds.length, 1);
  assert.deepEqual(item.ai, {});   // the AI's answers are the fixer's to take from the evidence, never invented here
  assert.equal(fs.readFileSync(path.join(folder, 'page.html'), 'utf8'), '<!doctype html><p>form</p>');
  dropCandidate({dir, day: '2026-10-10', shape: 'Recruitee form'});
  assert.equal(fs.existsSync(folder), false);
});

test('no page or no failure saves nothing', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'jp-candidates-'));
  assert.equal(saveCandidate({dir, day: 'd', shape: 's', result: {reached: 'form', short: {done: 1, total: 4}}, html: ''}), null);
  assert.equal(saveCandidate({dir, day: 'd', shape: 's', result: {reached: 'ready'}, html: '<p/>'}), null);
  assert.equal(slug('H&M careers (career.hm.com)'), 'h-m-careers-career-hm-com');
});

test('the live AI calls of the run (ai-calls.json from the app, desktop/lib/live-capture.js) are kept next to the page; none, none kept', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'jp-candidates-'));
  const result = {url: 'https://jobs.example.com/o/role', reached: 'posting'};
  const calls = JSON.stringify([{route: '/extension/page-kind', at: 1, request: {url: 'https://jobs.example.com/o/role', candidates: []}, answer: {kind: 'posting'}}]);
  const withCalls = saveCandidate({dir, day: '2026-10-11', shape: 'With calls', result, html: '<p>x</p>', aiCalls: calls});
  assert.deepEqual(JSON.parse(fs.readFileSync(path.join(withCalls, 'ai-calls.json'), 'utf8'))[0].answer, {kind: 'posting'});
  const without = saveCandidate({dir, day: '2026-10-11', shape: 'No calls', result, html: '<p>x</p>'});
  assert.equal(fs.existsSync(path.join(without, 'ai-calls.json')), false);
  const broken = saveCandidate({dir, day: '2026-10-11', shape: 'Broken calls', result, html: '<p>x</p>', aiCalls: 'not json'});
  assert.equal(fs.existsSync(path.join(broken, 'ai-calls.json')), false);   // never a file nobody can read
});

test('a run that kept its journey saves every page under its own address, the posting first, with its frames, sheets and model answers', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'jp-candidates-')), capture = fs.mkdtempSync(path.join(os.tmpdir(), 'jp-capture-'));
  fs.mkdirSync(path.join(capture, 'pages'));
  const pages = [{url: 'https://careers.example.com/job/1', file: 'pages/1.html'}, {url: 'https://boards.example.net/embed/job_app', file: 'pages/2.html', frameOf: 'https://careers.example.com/job/1'}];
  fs.writeFileSync(path.join(capture, 'pages', '1.html'), '<p>posting</p>');
  fs.writeFileSync(path.join(capture, 'pages', '2.html'), '<form>frame</form>');
  fs.writeFileSync(path.join(capture, 'journey.json'), JSON.stringify(pages));
  fs.writeFileSync(path.join(capture, 'styles.har.json'), '{"log":{"entries":[]}}');
  fs.writeFileSync(path.join(capture, 'model-memo.json'), '{"k":{"content":[]}}');
  const result = {url: 'https://careers.example.com/job/1?src=mail', reached: 'posting'};
  const folder = saveCandidate({dir, day: '2026-10-11', shape: 'Datadog careers', result, html: '<p>last page</p>', captureDir: capture});
  const item = JSON.parse(fs.readFileSync(path.join(folder, 'case.json'), 'utf8'));
  assert.deepEqual(item.pages, pages);
  assert.equal(fs.readFileSync(path.join(folder, 'pages', '2.html'), 'utf8'), '<form>frame</form>');
  assert.ok(fs.existsSync(path.join(folder, 'styles.har.json')) && fs.existsSync(path.join(folder, 'model-memo.json')));
  assert.ok(!fs.existsSync(path.join(folder, 'page.html')), 'the last page is one of the journey\'s pages, never filed under the posting\'s address');
});

test('a passing row is kept only when asked (always: RECORD_KEEP_CANDIDATES=1, for a row replay\'s trust check)', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'jp-cand-'));
  const passed = {reached: 'form', filled: 6, left: 0, url: 'https://jobs.example.org/a'};
  assert.equal(saveCandidate({dir, day: '2026-10-11', shape: 'x', result: passed, html: '<p>x</p>'}), null);
  assert.ok(saveCandidate({dir, day: '2026-10-11', shape: 'x', result: passed, html: '<p>x</p>', always: true}));
});

test('the live run\'s presses come with the row (presses.json): time, what and label, from the app log, in order', () => {
  const log = ['2026-10-11T06:00:01.000Z [extension] fill: closed a popup {"label":"Ok","version":"0.9.199"}',
    '2026-10-11T06:00:02.500Z [extension] page kind: posting {"by":"ai"}',
    '2026-10-11T06:00:03.000Z [extension] fill: pressed the Apply button {"aimed":"","host":"www.jobs.ch","label":"Easy apply","tag":"button"}',
    '2026-10-11T06:00:09.000Z [extension] fill: pressed the start route: manual {"host":"www.jobs.ch","label":"Continue without an account","route":"manual"}'].join('\n');
  assert.deepEqual(livePresses(log), [
    {at: Date.parse('2026-10-11T06:00:01.000Z'), what: 'closed a popup', label: 'Ok'},
    {at: Date.parse('2026-10-11T06:00:03.000Z'), what: 'pressed the Apply button', label: 'Easy apply'},
    {at: Date.parse('2026-10-11T06:00:09.000Z'), what: 'pressed the start route', label: 'Continue without an account'}]);
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'jp-cand-'));
  const folder = saveCandidate({dir, day: '2026-10-11', shape: 'x', result: {reached: 'posting', url: 'https://a.example/x'}, html: '<p>x</p>', appLog: log});
  assert.equal(JSON.parse(fs.readFileSync(path.join(folder, 'presses.json'), 'utf8')).length, 3);
});

test('a capture again of a row starts from an empty folder: a page, presses and answers of an older run never stay beside the new ones', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'jp-candidates-'));
  const old = path.join(dir, '2026-10-11', 'lever-form');
  fs.mkdirSync(path.join(old, 'pages'), {recursive: true});
  for (const name of ['pages/4.html', 'presses.json', 'ai-calls.json', 'model-memo.json']) fs.writeFileSync(path.join(old, name), 'older run');
  const capture = fs.mkdtempSync(path.join(os.tmpdir(), 'jp-capture-'));
  fs.mkdirSync(path.join(capture, 'pages'));
  fs.writeFileSync(path.join(capture, 'pages/1.html'), '<p>new</p>');
  fs.writeFileSync(path.join(capture, 'journey.json'), JSON.stringify([{url: 'https://jobs.example.com/o/role', file: 'pages/1.html', at: 1, state: 0}]));
  const folder = saveCandidate({dir, day: '2026-10-11', shape: 'Lever form', result: {url: 'https://jobs.example.com/o/role', reached: 'form', filled: 1, left: 2, short: {done: 1, total: 3}}, captureDir: capture});
  assert.equal(folder, old);
  assert.deepEqual(fs.readdirSync(path.join(folder, 'pages')), ['1.html']);
  for (const name of ['presses.json', 'ai-calls.json', 'model-memo.json']) assert.equal(fs.existsSync(path.join(folder, name)), false, `${name} of the older run is gone`);
});

// Owner, 11 Oct 2026: a capture keeps the live run's end picture, so a replay's end-replay.png can be set beside it. Local QA folder only; a tripwire hit has already deleted the capture folder.
test('a saved capture keeps the live end.png; a run with none keeps none', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'jp-cand-')), capture = fs.mkdtempSync(path.join(os.tmpdir(), 'jp-cap-')), result = {url: 'https://example.org/job/1', reached: 'posting'};
  fs.writeFileSync(path.join(capture, 'end.png'), 'png');
  const kept = saveCandidate({dir, day: '2026-10-11', shape: 'With picture', result, html: '<p>x</p>', captureDir: capture});
  assert.ok(fs.existsSync(path.join(kept, 'end.png')));
  const none = saveCandidate({dir, day: '2026-10-11', shape: 'No picture', result, html: '<p>x</p>', captureDir: fs.mkdtempSync(path.join(os.tmpdir(), 'jp-cap-'))});
  assert.ok(!fs.existsSync(path.join(none, 'end.png')));
});
