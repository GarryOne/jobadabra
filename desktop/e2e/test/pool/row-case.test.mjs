// lib/row-case.mjs: a pool row's capture becomes a case folder (npm run row-to-case): scrubbed again, shrunk, its model answers and presses scrubbed, its baseline taken from the live run, and refused
// (nothing written) when a privacy or size gate fails. The browser step is injected here (its own test: row-case-shrink.test.mjs).
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {test} from 'node:test';
import {buildCase, stripQueries} from '../../lib/row-case.mjs';
import {FAKE} from '../../lib/capture-page.mjs';

const tmp = prefix => fs.mkdtempSync(path.join(os.tmpdir(), prefix));
const write = (file, text) => { fs.mkdirSync(path.dirname(file), {recursive: true}); fs.writeFileSync(file, typeof text === 'string' ? text : JSON.stringify(text)); };
const noShrink = async (chromium, pages) => ({pages, sheets: new Map([['https://jobs.example.test/__case/styles.css', '.a{color:red}']])});

function row(extra = {}) {
  const dir = tmp('jp-row-src-');
  write(path.join(dir, 'pages/1.html'), extra.page || '<h1>Seller</h1><p>mail anna.muster@gmail.com</p>');
  write(path.join(dir, 'pages/2.html'), '<h1>Seller</h1><dialog open>x</dialog>');
  write(path.join(dir, 'case.json'), {seed: 'abc123def456', shape: 'a start dialog', why: 'auto-saved', sample: 'jobs.example.test', ai: {}, expect: {},
    pages: [{url: 'https://jobs.example.test/o/1', file: 'pages/1.html', at: 100, state: 0, ask: true, view: {width: 1200, height: 818, doc: 5}}, {url: 'https://jobs.example.test/o/1', file: 'pages/2.html', at: 200, state: 1, answerAsk: true}],
    run: {day: '2026-10-11', reached: 'posting', filled: null, short: null, path: [{kind: 'posting', host: 'jobs.example.test'}], fields: []},
    evidence: {pageKinds: ['log 14:33:13.748Z [extension] page kind: posting {"by":"ai"}', '14:33:13 [extension] page kind: posting {"by":"ai"}']}});
  write(path.join(dir, 'presses.json'), [{at: 150, what: 'pressed the Apply button', label: 'Apply for anna.muster@gmail.com'}]);
  write(path.join(dir, 'model-memo.json'), {abc: {content: [{type: 'text', text: '{"apply_email":"anna.muster@gmail.com"}'}]}, 'abc#parts': {model: '0123456789ab'}});
  write(path.join(dir, 'styles.har.json'), {log: {entries: [{request: {url: 'https://cdn.example.net/t.css'}, response: {content: {mimeType: 'text/css', text: '.a{color:red}'}}}]}});
  write(path.join(dir, 'ai-calls.json'), [{route: '/extension/answer', request: {fields: []}}]);
  return dir;
}

test('a row becomes a case: pages scrubbed and shrunk, answers and presses scrubbed, a baseline from the live run, the replay marker, no ai-calls', async () => {
  const out = tmp('jp-cases-'), result = await buildCase({rowDir: row(), name: 'start-dialog-1', outDir: out, shrink: noShrink});
  const dir = path.join(out, 'start-dialog-1'), item = JSON.parse(fs.readFileSync(path.join(dir, 'case.json'), 'utf8'));
  assert.equal(result.dir, dir);
  assert.equal(item.replay, 'row');
  assert.equal(item.seed, 'abc123def456', 'the capture\'s applicant seed travels with the case');
  assert.deepEqual(item.pages.map(page => [page.file, page.state, !!page.ask, !!page.answerAsk]), [['pages/1.html', 0, true, false], ['pages/2.html', 1, false, true]]);
  assert.ok(!fs.readFileSync(path.join(dir, 'pages/1.html'), 'utf8').includes('gmail'), 'the page is scrubbed');
  assert.ok(fs.readFileSync(path.join(dir, 'pages/1.html'), 'utf8').includes(FAKE.email));
  assert.ok(!fs.readFileSync(path.join(dir, 'model-memo.json'), 'utf8').includes('gmail'));
  assert.ok(!fs.readFileSync(path.join(dir, 'presses.json'), 'utf8').includes('gmail'));
  assert.ok(fs.readFileSync(path.join(dir, 'model-memo.json'), 'utf8').includes('abc#parts'), 'the memo keeps its parts');
  assert.ok(!fs.existsSync(path.join(dir, 'ai-calls.json')), 'the run\'s ai-calls are not copied');
  assert.deepEqual(item.baseline.pageKinds, ['page kind: posting {"by":"ai"}'], 'the live run\'s evidence without its times; duplicate wording once');
  assert.equal(item.baseline.reached, 'posting');
  assert.deepEqual(item.baseline.pressed, ['pressed the Apply button']);
  assert.deepEqual(item.baseline.fields, []);
  assert.deepEqual(item.expect, {}, 'expect is filled by the proof, never here');
  const har = JSON.parse(fs.readFileSync(path.join(dir, 'styles.har.json'), 'utf8')).log.entries;
  assert.deepEqual(har.map(entry => entry.request.url), ['https://jobs.example.test/__case/styles.css']);
});

test('a capture with no presses.json (a run that pressed nothing) and no model memo still builds: an empty presses list, an empty memo', async () => {
  const dir = row(); fs.rmSync(path.join(dir, 'presses.json')); fs.rmSync(path.join(dir, 'model-memo.json'));
  const out = tmp('jp-cases-'), result = await buildCase({rowDir: dir, name: 'no-presses-1', outDir: out, shrink: noShrink});
  assert.deepEqual(JSON.parse(fs.readFileSync(path.join(result.dir, 'presses.json'), 'utf8')), []);
  assert.deepEqual(JSON.parse(fs.readFileSync(path.join(result.dir, 'case.json'), 'utf8')).baseline.pressed, []);
});

test('a case that fails a gate is refused and nothing is written: a typed value the scrub does not remove, or a size over the limit', async () => {
  const out = tmp('jp-cases-');
  await assert.rejects(buildCase({rowDir: row({page: '<input type="text" value="Anna">'}), name: 'x-1', outDir: out, shrink: noShrink}), /privacy gate.*a typed value/);
  const query = await buildCase({rowDir: row({page: '<a href="https://x.example/p?token=1">x</a>'}), name: 'x-q', outDir: out, shrink: noShrink});   // a query is cut by the tool, so the gate passes
  assert.ok(!fs.readFileSync(path.join(query.dir, 'pages/1.html'), 'utf8').includes('token'));
  fs.rmSync(query.dir, {recursive: true});
  const phone = await buildCase({rowDir: row({page: '<p>Hotline 044 123 45 67</p>'}), name: 'x-p', outDir: out, shrink: noShrink});   // a phone number IS scrubbed by the tool, so the gate passes
  assert.ok(!fs.readFileSync(path.join(phone.dir, 'pages/1.html'), 'utf8').includes('044 123'));
  fs.rmSync(phone.dir, {recursive: true});
  assert.deepEqual(fs.readdirSync(out), []);
  const big = async (chromium, pages) => ({pages: pages.map(page => ({...page, html: page.html + 'x'.repeat(310 * 1024)})), sheets: new Map()});
  await assert.rejects(buildCase({rowDir: row(), name: 'x-2', outDir: out, shrink: big}), /size gate.*over 300 KB \(pages \d+ KB, styles \d+ KB, the biggest page pages\/1\.html \d+ KB.*--stub-page <n>.*hand/);
  assert.deepEqual(fs.readdirSync(out), []);
  await assert.rejects(buildCase({rowDir: row(), name: 'x-3', outDir: null, shrink: noShrink}), /no cases folder/);
});

test('a name that is not a plain case name is refused (no path out of the cases folder)', async () => {
  await assert.rejects(buildCase({rowDir: row(), name: '../escape', outDir: tmp('jp-cases-'), shrink: noShrink}), /case name/);
});

test('an address in the page\'s prose loses its tracking query and fragment (the memo key ignores them too); the address itself stays', async () => {
  assert.equal(stripQueries('see https://www.busuu.com/fr/p/start?utm_medium=cpc&amp;utm_source=google#x and https://a.example/b.'), 'see https://www.busuu.com/fr/p/start and https://a.example/b.');
  const out = tmp('jp-cases-'), result = await buildCase({rowDir: row({page: '<p>Jobs https://www.google.com/search?q=x&amp;ei=1 here</p>'}), name: 'prose-1', outDir: out, shrink: noShrink});
  assert.ok(fs.readFileSync(path.join(result.dir, 'pages/1.html'), 'utf8').includes('<p>Jobs https://www.google.com/search here</p>'));
});

test('the baseline\'s presses leave out a popup the live run closed before its first kept page, as the replay does', async () => {
  const dir = row(); fs.writeFileSync(path.join(dir, 'presses.json'), JSON.stringify([{at: 50, what: 'closed a popup', label: 'Decline all'}, {at: 150, what: 'pressed the Apply button', label: 'Apply'}]));
  const result = await buildCase({rowDir: dir, name: 'popup-1', outDir: tmp('jp-cases-'), shrink: noShrink});
  assert.deepEqual(JSON.parse(fs.readFileSync(path.join(result.dir, 'case.json'), 'utf8')).baseline.pressed, ['pressed the Apply button']);
});
