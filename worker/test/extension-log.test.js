// The log boundary (worker/src/extension-log.js): the extension's own log lines may carry scalars, the fill's field rows and COUNT MAPS; a cut says which key it cut (13 Oct 2026: the
// attempt log's "tries per control" arrived with byTries and worked as "", so the cap could not be measured and nothing said why).
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {test} from 'node:test';
import {cleanFields} from '../src/extension-log.js';

test('a count map (digit keys, number values) arrives as a short string; the tries line of the attempt log is whole', () => {
  const tries = {byTries: {1: 3, 2: 1}, gaveUp: 0, worked: {1: 3}};   // what extension/page/attempts.js summary() sends (flow.js "tries per control")
  assert.deepEqual(cleanFields(tries), {byTries: '1:3,2:1', gaveUp: 0, worked: '1:3'});
});

test('anything else that is not a scalar is cut and named, never silently: no value and no label crosses', () => {
  const clean = cleanFields({host: 'jobs.example.com', labels: ['First name', 'Email'], byLabel: {'First name': 1}, nothing: null, mixed: {1: 'x'}, ms: 12});
  assert.deepEqual(clean, {host: 'jobs.example.com', labels: '', byLabel: '', nothing: '', mixed: '', ms: 12, dropped: 'labels,byLabel,nothing,mixed'});
  assert.ok(!JSON.stringify(clean).includes('First name'));
  assert.deepEqual(cleanFields({a: 1, b: 2, c: 3, d: 4, e: 5, f: 6, g: 7, h: 8, i: 9, j: 10}).dropped, 'i,j', 'keys past the 8th are named too');
  assert.deepEqual(cleanFields(undefined), {});
});

test('the fill\'s field rows still go through fieldRows (labels as short strings, required kept)', () => {
  const clean = cleanFields({fields: [{label: 'Email', type: 'email', outcome: 'filled', required: true, value: 'secret@example.com'}]});
  assert.deepEqual(clean.fields, [{label: 'Email', type: 'email', outcome: 'filled', source: '', reason: '', required: true}]);
  assert.equal(clean.dropped, undefined);
});

test('every object-valued field the extension\'s decide lines send is a count map or is named when cut (the class, not one field)', () => {
  // The extension's decide('fill'|..., text, {fields}) payloads with a non-scalar value (found by reading the calls; a new one fails here until it is a count map, flat, or accepted as dropped).
  const SENT_OBJECTS = {'tries per control': {byTries: {1: 2}, worked: {1: 2}}, 'fill: fields': {fields: []}};
  for (const [line, payload] of Object.entries(SENT_OBJECTS)) {
    const clean = cleanFields(payload);
    assert.equal(clean.dropped, undefined, `${line}: ${clean.dropped} was cut`);
  }
  const flow = fs.readFileSync(new URL('../../extension/fill-tab-finish.js', import.meta.url), 'utf8');
  assert.match(flow, /decide\('fill', 'tries per control', tries\)/, 'the tries line is the one this test names');
});
