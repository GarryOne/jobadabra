// Auto-capture of the pool run's replay candidates (e2e/lib/ladder-candidates.mjs): a candidate that FAILED (the run did not reach the form) becomes a ladder fixture whose expectation is `pending`
// (a human or the coordinator confirms it); the ratchet ignores pending fixtures and ladder-score lists them as "to confirm". Pure parts here; the browser part is in e2e/test/filling/ladder-capture-candidates.test.mjs.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {test} from 'node:test';
import {candidateFixture, failedCandidate, readCandidates, selectCandidates} from '../e2e/lib/ladder-candidates.mjs';
import {compareToBaseline} from '../e2e/lib/ladder-baseline.mjs';
import {scoreFixtures, summarize} from '../e2e/lib/ladder-score.mjs';
import {noEmail, noPhone, stripQuery} from '../e2e/lib/ladder-scrub.mjs';

const make = (name, run, extra = {}) => ({shape: `${name}: shape`, why: 'auto-saved by the smoke run of 2026-10-10', sample: 'www.example.org', pages: [{url: 'https://www.example.org/jobs/1?token=abc#x', file: 'page.html'}], ai: {}, expect: {}, run: {day: '2026-10-10', path: [{kind: 'posting', host: 'www.example.org'}], ...run}, ...extra});
const sketch = {title: 'Job', headings: ['Job'], controls: [], buttons: ['Apply'], frames: [], mails: ['mailto:jane.doe@acme.example.org']};

test('failed = the run did not reach the form; a form with fields left is the fill mechanism\'s, not a page decision', () => {
  assert.equal(failedCandidate(make('a', {reached: 'posting'})), true);
  assert.equal(failedCandidate(make('b', {reached: 'account'})), true);
  assert.equal(failedCandidate(make('c', {reached: 'form', filled: 6, left: 6})), false);
  assert.equal(failedCandidate(make('d', {})), true);   // no outcome recorded: not a pass
});

test('a candidate directory is read, newest day first, and --only forces a passed one in', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ladder-cand-'));
  for (const [day, name, run] of [['2026-10-09', 'old-one', {reached: 'posting'}], ['2026-10-10', 'stuck-one', {reached: 'posting'}], ['2026-10-10', 'form-one', {reached: 'form', left: 3}]]) {
    const dir = path.join(root, day, name); fs.mkdirSync(dir, {recursive: true});
    fs.writeFileSync(path.join(dir, 'case.json'), JSON.stringify(make(name, run))); fs.writeFileSync(path.join(dir, 'page.html'), '<p>x</p>');
  }
  const all = readCandidates(root);
  assert.deepEqual(all.map(item => `${item.day}/${item.name}`).sort(), ['2026-10-10/form-one', '2026-10-10/stuck-one']);   // the newest day only
  assert.deepEqual(selectCandidates(all, {}).map(item => item.name), ['stuck-one']);
  assert.deepEqual(selectCandidates(all, {only: 'form-one'}).map(item => item.name), ['form-one']);
  assert.deepEqual(readCandidates(root, {day: '2026-10-09'}).map(item => item.name), ['old-one']);
  assert.deepEqual(readCandidates(path.join(root, 'missing')), []);
});

test('the fixture: source captured, expectation pending, a scrubbed sketch, no query string, what the run saw in a note', () => {
  const fixture = candidateFixture({name: 'jobs-ch-posting', day: '2026-10-10', caseJson: make('jobs-ch', {reached: 'posting', path: [{kind: 'posting', host: 'www.jobs.ch'}]}), sketch, candidates: [{n: 1, kind: 'email', text: 'Write to jane.doe@acme.example.org or +41 44 555 66 77', position: 'main'}], lang: 'de'});
  assert.deepEqual([fixture.id, fixture.source, fixture.lang, fixture.schemaVersion], ['cand-jobs-ch-posting', 'captured', 'de', 1]);
  assert.deepEqual(fixture.expect, {outcome: 'pending'});
  assert.equal(fixture.sketch.url, 'https://www.example.org/jobs/1');
  assert.deepEqual(fixture.sketch.mails, ['mailto:contact@example.com']);
  assert.equal(fixture.candidates[0].text, 'Write to contact@example.com or (phone)');
  assert.match(fixture.note, /reached posting/);
  assert.match(fixture.why, /auto-captured from the pool run of 2026-10-10/);
  assert.deepEqual(fixture.capture, {from: 'replay-candidates/2026-10-10/jobs-ch-posting'});
  assert.ok(!/jane\.doe|555|token=/.test(JSON.stringify(fixture)));
});

test('the scrub helpers: emails to example.com, phones out, queries dropped', () => {
  assert.equal(noEmail('a@b.org and c@example.com'), 'contact@example.com and c@example.com');
  assert.equal(noPhone('Call 044 555 66 77 or 12345'), 'Call (phone) or 12345');
  assert.equal(stripQuery('https://x.example/a/b?t=1#f'), 'https://x.example/a/b');
});

test('pending fixtures are listed "to confirm", never scored, never in a rate, never in the ratchet', async () => {
  const pending = {id: 'cand-x', source: 'captured', lang: 'en', sketch: {url: 'https://x.example/j', title: 'Job', headings: ['Job'], controls: [], buttons: ['Apply'], frames: [], mails: []}, expect: {outcome: 'pending'},
    answer: {kind: 'posting', confidence: 0.9, apply_button: '', apply_button_kind: '', apply_route: '', apply_by: 'form', apply_email: '', account_step: '', register_control: '', signin_control: '', account_button: '', bot_check: false}};
  const rows = await scoreFixtures([pending]);
  assert.deepEqual([rows[0].status, rows[0].outcome], ['pending', 'posting']);   // what rung 2 says is shown to the person who confirms
  const summary = summarize(rows);
  assert.deepEqual(summary.bySource, {});
  assert.deepEqual(summary.pending.map(row => row.id), ['cand-x']);
  assert.deepEqual(compareToBaseline(rows, {fixtures: {}}), {worse: [], better: [], added: [], removed: [], changedExpectation: []});
});
