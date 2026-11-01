// lib/live-capture.js: the live page-kind request and answer, kept for a pool replay candidate (owner, 11 Oct 2026). Local only; written ONLY under the e2e harness's
// LIVE_CAPTURE_DIR; scrubbed before writing, in the style of recorded-privacy.test.js. This module has no outward path (no network, no Telegram): the twin's list of outward paths needs no entry.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {test} from 'node:test';
import {captureAnswer, captureCall, noteAsk, scrub} from '../lib/live-capture.js';

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'jp-live-capture-'));
const request = {url: 'https://jobs.example.ch/job/42?token=SECRET&utm=1', title: 'Seller (m/f) mail anna.muster@gmail.com', headings: ['Apply, call +41 79 123 45 67'],
  controls: [{tag: 'input', type: 'text', label: 'First name', value: 'Anna'}, {tag: 'a', text: 'Apply now', href: 'https://jobs.example.ch/apply?session=XYZ'}], buttons: ['Apply now'],
  candidates: [{index: 3, label: 'Apply now'}], frameCandidates: [{host: 'job-boards.greenhouse.io', w: 650, h: 2432}], digest: true, fresh: false, cookie: 'abc', password: 'hunter2'};
const answer = {ok: true, kind: 'form', role: 'form', by: 'ai', rung: 2, confidence: 0.9, applyButton: 'Apply now', form_frame: -1};

test('scrub: no query string, no email but example, no phone, no typed value, no secrets', () => {
  const text = JSON.stringify(scrub(request));
  assert.ok(!/\?[a-z]+=/i.test(text), 'a URL query string');
  assert.ok(!/gmail|anna\.muster/i.test(text), 'an email');
  assert.ok(!/\+41|123 45 67/.test(text), 'a phone number');
  assert.ok(!/"value":/.test(text) && !/Anna"/.test(text), 'a typed value');
  assert.ok(!/SECRET|XYZ|hunter2|"cookie"|"password"/.test(text), 'a secret');
  assert.deepEqual(scrub(request).candidates, request.candidates);   // the structure the fixture needs is kept
  assert.deepEqual(scrub(request).frameCandidates, request.frameCandidates);
  assert.equal(scrub(request).digest, true);
});

test('no LIVE_CAPTURE_DIR, no code path: nothing is written anywhere', () => {
  const places = [process.cwd(), os.tmpdir(), os.homedir()], seen = () => places.map(place => fs.existsSync(path.join(place, 'ai-calls.json')));
  const before = seen();
  assert.equal(captureCall({route: '/extension/page-kind', request, answer}, {env: {}}), false);
  assert.equal(captureCall({route: '/extension/page-kind', request, answer}, {env: {LIVE_CAPTURE_DIR: ''}}), false);
  assert.deepEqual(seen(), before);   // no ai-calls.json appeared in the working folder, the temp folder or home
});

test('with LIVE_CAPTURE_DIR the calls are appended, scrubbed, as [{route, at, request, answer}]', () => {
  const dir = tmp(), env = {LIVE_CAPTURE_DIR: dir};
  assert.equal(captureCall({route: '/extension/page-kind', request, answer}, {env, now: () => 1}), true);
  assert.equal(captureCall({route: '/extension/page-kind', request: {...request, digest: false}, answer: {...answer, kind: 'posting'}}, {env, now: () => 2}), true);
  const calls = JSON.parse(fs.readFileSync(path.join(dir, 'ai-calls.json'), 'utf8'));
  assert.deepEqual(calls.map(call => [call.route, call.at, call.answer.kind]), [['/extension/page-kind', 1, 'form'], ['/extension/page-kind', 2, 'posting']]);
  const text = fs.readFileSync(path.join(dir, 'ai-calls.json'), 'utf8');
  assert.ok(!/SECRET|XYZ|hunter2|gmail|\+41|"value":/.test(text), 'the written file holds a private value');
  assert.deepEqual(fs.readdirSync(dir), ['ai-calls.json']);
});

test('it never throws and never writes outside the folder it was given (a failing disk, an odd body)', () => {
  const env = {LIVE_CAPTURE_DIR: path.join(tmp(), 'not', 'a', 'dir', '\0bad')};
  assert.doesNotThrow(() => captureCall({route: '/x', request: undefined, answer: undefined}, {env}));
  assert.equal(captureCall({route: '/x', request, answer}, {env}), false);
});

test('it never writes into the real data folder of the app', () => {
  const real = path.join(os.homedir(), 'Library', 'Application Support');
  assert.equal(captureCall({route: '/x', request, answer}, {env: {LIVE_CAPTURE_DIR: path.join(real, 'Jobadabra', 'x')}}), false);
});

test('the shipped app source calls it in one place per kept route (page-kind, form judge) and only through captureCall', () => {
  const source = fs.readFileSync(new URL('../lib/server-pages.js', import.meta.url), 'utf8');
  assert.equal((source.match(/captureCall\(/g) || []).length, 2);
  for (const route of ['/extension/page-kind', '/extension/account-judge']) assert.equal((source.match(new RegExp(`captureCall\\(\\{route: '${route}'`, 'g')) || []).length, 1, route);
  assert.ok(!/LIVE_CAPTURE_DIR/.test(source), 'the env var is read only inside lib/live-capture.js');
});

// The form-answer call too (owner, 11 Oct 2026, Datadog round 2: the evidence held only page-kind calls, so it could not show that the attestation was
// never asked). Which fields were asked (id, label, type, required) and, per answer, its category and use: never a value, never the page text.
test('the answer call is kept as the fields asked and each answer\'s kind, never a value or the page text', () => {
  const dir = tmp(), env = {LIVE_CAPTURE_DIR: dir};
  const fields = [{field: 'question_1', label: 'Website', type: 'text', required: false, options: []},
    {field: 'question_2', label: 'How did you hear about us? Mail anna.muster@gmail.com', type: 'combobox', required: true}];
  const answers = [{field: 'question_2', value: 'A friend told me', confidence: 'low', note: 'guess', category: 'normal', use: 'propose'}];
  assert.equal(captureAnswer({url: 'https://forms.example.com/apply?token=SECRET', fields, page_text: 'Anna Muster, Zurich', answers}, {env, now: () => 3}), true);
  const [call] = JSON.parse(fs.readFileSync(path.join(dir, 'ai-calls.json'), 'utf8'));
  assert.deepEqual(call, {route: '/extension/answer', at: 3, request: {url: 'https://forms.example.com/apply', fields: [
    {field: 'question_1', label: 'Website', type: 'text', required: false}, {field: 'question_2', label: 'How did you hear about us? Mail test.candidate@example.com', type: 'combobox', required: true}]},
    answer: {answers: [{field: 'question_2', category: 'normal', use: 'propose'}]}});
  assert.ok(!/A friend|Anna Muster|SECRET|guess/.test(JSON.stringify(call)), 'no value, page text, note or query');
  assert.equal(captureAnswer({url: 'x', fields, answers}, {env: {}}), false);   // outside the harness: nothing
});

test('the app hands each answer call to captureAnswer in one place, and never reads LIVE_CAPTURE_DIR itself', () => {
  const source = fs.readFileSync(new URL('../lib/server-env.js', import.meta.url), 'utf8');
  assert.equal((source.match(/captureAnswer\(/g) || []).length, 1);
  assert.ok(!/LIVE_CAPTURE_DIR/.test(source));
});

test('the app\'s own env writes the answer call into ai-calls.json under the harness (the last layer the evidence reaches)', async () => {
  const server = await import('../lib/server.js');
  const dir = tmp(), data = tmp(), before = process.env.LIVE_CAPTURE_DIR;
  process.env.LIVE_CAPTURE_DIR = dir;
  try {
    const storage = {settings: () => ({}), secret: () => 't', setSecret: () => {}, path: (...p) => path.join(data, ...p), readText: () => ''};
    await server.localEnv(storage).onAnswerCall({url: 'https://forms.example.com/apply', fields: [{field: 'q1', label: 'Website', type: 'text', required: false}],
      answers: [{field: 'q1', value: 'https://example.com', category: 'contact', use: 'fill'}]});
    const calls = JSON.parse(fs.readFileSync(path.join(dir, 'ai-calls.json'), 'utf8'));
    assert.deepEqual(calls.map(call => [call.route, call.request.fields.map(f => f.field), call.answer.answers]), [['/extension/answer', ['q1'], [{field: 'q1', category: 'contact', use: 'fill'}]]]);
  } finally { if (before === undefined) delete process.env.LIVE_CAPTURE_DIR; else process.env.LIVE_CAPTURE_DIR = before; }
});

test('an ask is noted the moment it arrives, before the AI answers (asks.jsonl: the address and the time, scrubbed); outside the harness nothing', () => {
  const dir = tmp();
  assert.equal(noteAsk('https://jobs.example.ch/job/42?token=SECRET', {env: {LIVE_CAPTURE_DIR: dir}, now: () => 7}), true);
  assert.deepEqual(fs.readFileSync(path.join(dir, 'asks.jsonl'), 'utf8').trim().split('\n').map(line => JSON.parse(line)), [{url: 'https://jobs.example.ch/job/42', at: 7, route: '/extension/page-kind'}]);
  assert.equal(noteAsk('https://jobs.example.ch/job/42', {env: {LIVE_CAPTURE_DIR: dir}, now: () => 9, route: '/extension/account-judge'}), true);
  assert.equal(JSON.parse(fs.readFileSync(path.join(dir, 'asks.jsonl'), 'utf8').trim().split('\n')[1]).route, '/extension/account-judge', 'the form judge\'s ask is noted too (the page as it saw it)');
  assert.equal(noteAsk('https://x.example/', {env: {}}), false);
  const source = fs.readFileSync(new URL('../lib/server-pages.js', import.meta.url), 'utf8');
  assert.ok(source.indexOf('noteAsk(') > 0 && source.indexOf('noteAsk(') < source.indexOf('await decide('), 'the page-kind route notes the ask before it asks the AI');
  assert.ok(source.indexOf("noteAsk(body?.sketch?.url, {route: '/extension/account-judge'})") > source.indexOf('export async function decideAccountJudge'), 'the form judge route notes its ask too');
});
