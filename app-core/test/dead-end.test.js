// The one door every give-up goes through (extension/ladder/dead-end.js; spec 2026-10-12-one-next-move.md phase 2 box 1): a stuck() call anywhere else in the extension fails here,
// the report sent is today's, and the evidence logged beside it keeps our own facts only, never the page's words.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import {fileURLToPath} from 'node:url';
import {EVIDENCE_KEYS, SEEN_REASONS, deadEnd, evidenceOf, seenDeadEnd, useReporter} from '../../extension/ladder/dead-end.js';
import {restartSilence, silenceOf, silenceTab} from '../../extension/ladder/silence.js';

const EXTENSION = path.join(path.dirname(fileURLToPath(import.meta.url)), '../../extension');
const jsFiles = dir => fs.readdirSync(dir, {withFileTypes: true}).flatMap(entry => (entry.isDirectory() ? jsFiles(path.join(dir, entry.name)) : entry.name.endsWith('.js') ? [path.join(dir, entry.name)] : []));

test('no file reports a give-up but through the door: stuck() is called nowhere, only handed to deadEnd once', () => {
  const calls = [];
  for (const file of jsFiles(EXTENSION)) {
    const code = fs.readFileSync(file, 'utf8').split('\n').map(line => line.replace(/\/\/.*$/, '')).join('\n');   // comments may name it
    for (const found of code.matchAll(/(?<![\w.])stuck\s*\(/g)) {
      const before = code.slice(Math.max(0, found.index - 30), found.index);
      if (/export async function\s*$/.test(before)) continue;   // its definition (fill-flow.js)
      calls.push(`${path.relative(EXTENSION, file)}: ${code.slice(found.index, found.index + 60).split('\n')[0]}`);
    }
  }
  assert.deepEqual(calls, [], 'report a give-up with deadEnd (extension/ladder/dead-end.js), never stuck() directly');
  const flow = fs.readFileSync(path.join(EXTENSION, 'fill-flow.js'), 'utf8');
  assert.equal((flow.match(/useReporter\(stuck\)/g) || []).length, 1, 'fill-flow.js hands stuck to the door once');
});

test('the door sends today\'s report unchanged, names the ending in the log, and an unknown reason claims nothing (other, never no-form)', async () => {
  const sent = [], logged = [];
  useReporter(async (...args) => { sent.push(args); });
  const decide = (area, what, data) => logged.push({area, what, data});
  await deadEnd({job: 'https://jobs.example/1', host: 'jobs.example', why: 'site_broken', tabId: 3, page: 'https://jobs.example/1#m', needs: 'This posting is gone: the site answered 404'}, {kind: 'gone', status: 404}, decide);
  await deadEnd({job: 'https://jobs.example/2', host: 'jobs.example', why: 'account', tabId: 3, page: 'https://jobs.example/2', needs: '', accountStep: 'sign_in'}, {reason: 'no way forward on this page'}, decide);
  await deadEnd({job: 'https://jobs.example/3', host: 'jobs.example', why: 'something new', tabId: 3, page: 'https://jobs.example/3'}, {}, decide);
  assert.deepEqual(sent, [
    ['https://jobs.example/1', 'jobs.example', 'site_broken', 3, 'https://jobs.example/1#m', 'This posting is gone: the site answered 404', ''],
    ['https://jobs.example/2', 'jobs.example', 'account', 3, 'https://jobs.example/2', '', 'sign_in'],
    ['https://jobs.example/3', 'jobs.example', 'other', 3, 'https://jobs.example/3', '', '']]);
  assert.deepEqual(logged.map(line => line.what), ['dead end: site_broken', 'dead end: account', 'dead end: other']);
  assert.deepEqual(logged.map(line => line.data.ending), ['site_broken', 'unresolved', 'unresolved']);
  const {door, ...data} = logged[0].data;
  assert.deepEqual(data, {host: 'jobs.example', ending: 'site_broken', named: true, kind: 'gone', status: 404});
  assert.deepEqual(logged.map(line => line.data.door), [door, door + 1, door + 2], 'each stop has its own id: the shadow question joins it (ladder/fallback.js)');
  assert.equal(logged[1].data.named, false);
});

test('evidence keeps numbers, booleans and short words of ours; page text, addresses and long strings never', () => {
  assert.deepEqual(evidenceOf({role: 'no-form', rung: 2, signal: 'confident', botCheck: true, left: 3, missing: undefined, nope: null}), {role: 'no-form', rung: 2, signal: 'confident', botCheck: true, left: 3});
  const dropped = evidenceOf({need: 'Send your CV to jane@company.example', url: 'https://jobs.example/1?x=1', long: 'x'.repeat(41), list: ['a'], 'bad-key': 1, nan: Number.NaN, quote: 'Bitte "bewerben" Sie sich'});
  assert.deepEqual(dropped, {});
});

test('evidence keys are a fixed list: a key outside it never reaches the log, and text only under the keys that hold our own words', () => {
  assert.deepEqual(evidenceOf({label: 'First name', field: 'Email', host: 'jobs.example', rung: 2}), {rung: 2}, 'a page word under a new key is dropped');
  assert.deepEqual(evidenceOf({left: 'three', status: 'gone', filled: 2, reason: 'no saved password'}), {filled: 2, reason: 'no saved password'}, 'text under a number key is dropped');
});

// The class (owner rule: a fix covers every sibling): every caller's evidence keys are on the list, so a dropped key is never a silent loss.
test('every evidence key a caller passes is listed', () => {
  const read = file => fs.readFileSync(path.join(EXTENSION, file), 'utf8');
  const keysOf = object => [...object.matchAll(/(?:^|[{,])\s*([A-Za-z]+)\s*(?=[:,}])/g)].map(found => found[1]);
  const passed = new Set();
  for (const [, object] of ['fill-flow.js', 'fill-flow-read.js', 'fill-flow-steps.js'].map(read).join('\n').matchAll(/\b(?:deadEndHere|noteProgress)\([^;]*?(\{[^{}]*\})\)/g)) keysOf(object).forEach(key => passed.add(key));
  for (const [, object] of read('account-step.js').matchAll(/\bdeadEnd\(\{[^{}]*\}, (\{[^{}]*\})/g)) keysOf(object).forEach(key => passed.add(key));
  for (const [, object] of read('ladder/silence.js').matchAll(/\bnotice\(clock\.host, (\{[^{}]*\})(?:, clock\.tab)?\)/g)) keysOf(object).forEach(key => passed.add(key));   // the silent rule's notice
  assert.ok(passed.has('role') && passed.has('status') && passed.has('reason') && passed.has('fields') && passed.has('silentMs'), [...passed].join(', '));
  assert.deepEqual([...passed].filter(key => !EVIDENCE_KEYS.includes(key)), [], 'add the key to EVIDENCE_KEYS (extension/ladder/dead-end.js), numbers or our own words only');
});

test('a dead end seen in shadow (the silent rule) is logged at the door with its shadow field and never reported; the door ends the application\'s silence clock', async () => {
  const sent = [], logged = [];
  useReporter(async (...args) => { sent.push(args); });
  const decide = (area, what, data) => logged.push({area, what, data});
  assert.deepEqual(SEEN_REASONS, ['silent']);
  assert.equal(seenDeadEnd('silent', 'jobs.example', {kind: 'navigated', silentMs: 31000, label: 'First name'}, decide), true);
  assert.equal(seenDeadEnd('no-form', 'jobs.example', {}, decide), false, 'only a seen reason: a stop goes through deadEnd');
  assert.equal(logged.length, 1);
  assert.deepEqual({...logged[0].data, door: undefined}, {host: 'jobs.example', shadow: true, ending: 'unresolved', kind: 'navigated', silentMs: 31000, door: undefined});
  assert.ok(Number.isInteger(logged[0].data.door), 'a seen stop has its door id: the shadow question joins by it (pool-shadow.mjs)');
  assert.equal(logged[0].what, 'dead end: silent');
  assert.deepEqual(sent, [], 'nothing is reported: nothing changes for the person');
  silenceTab(7, 'https://jobs.example/7');
  restartSilence(7, 'navigated', {now: 0});
  await deadEnd({job: 'https://jobs.example/7', host: 'jobs.example', why: 'no-form', tabId: 7, page: 'https://jobs.example/7'}, {}, decide);
  assert.equal(silenceOf(7).ended, true);
});
