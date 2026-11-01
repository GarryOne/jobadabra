// The control level of the one door (extension/ladder/control-door.js; spec fill-ladder 5): a record {level: 'control', rung, signal, reason, tried} logged at dead-end.js's door with its own id,
// fixed values only, and every reader of page stops skips it by its field. next-move adds `resolved` to the same line later.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import {EVIDENCE_KEYS, deadEnd, seenDeadEnd, useReporter} from '../../extension/ladder/dead-end.js';
import {CONTROL_SIGNALS, VERDICT_SIGNAL, controlDoor, repairDoors} from '../../extension/ladder/control-door.js';
import {SIGNALS} from '../../extension/ladder/core.js';

const logger = () => { const lines = []; return {lines, decide: (area, text, fields) => { lines.push({area, text, fields}); return Promise.resolve(); }}; };

test('a control door logs level, rung, signal, reason, tried and its own id, fixed values only', () => {
  const {lines, decide} = logger();
  const door = controlDoor({rung: 0, signal: 'stalled', reason: 'tries', tried: 3, fp: 'a1b2c3d4'}, decide, 'jobs.example');
  assert.ok(door > 0);
  assert.deepEqual(lines, [{area: 'fill', text: 'dead end: stalled', fields: {host: 'jobs.example', door, level: 'control', rung: 0, signal: 'stalled', reason: 'tries', tried: 3, fp: 'a1b2c3d4'}}]);
  const page = logger();
  useReporter(async () => {});
  deadEnd({job: 'j', host: 'h', why: 'other'}, {}, page.decide);
  const pageDoor = seenDeadEnd('silent', 'h', {}, page.decide);
  assert.equal(pageDoor, true);
  assert.notEqual(page.lines[0].fields.door, door, 'a page door and a control door never share an id');
  assert.equal(page.lines[0].fields.door - door, 1, 'one counter, in order');
});

test('page words never reach the record: a label, a value or a long string under any key is dropped', () => {
  const {lines, decide} = logger();
  controlDoor({rung: 3, signal: 'failed', reason: 'First name: Igor Mardari at 12 Rue du Lac', tried: 'many', fp: 'not a fingerprint, with words', label: 'Email', value: 'a@b.c'}, decide);
  assert.deepEqual(Object.keys(lines[0].fields).sort(), ['door', 'host', 'level', 'rung', 'signal']);
  assert.equal(lines[0].fields.level, 'control');
});

test('only the five control signals open a door; four are core.js SIGNALS, refused is the control level own', () => {
  assert.deepEqual(CONTROL_SIGNALS, ['stalled', 'contradicted', 'refused', 'unsure', 'failed']);
  for (const signal of CONTROL_SIGNALS.filter(one => one !== 'refused')) assert.ok(SIGNALS.includes(signal), signal);   // refused: a repair declined or left to the person (no page-level twin)
  const {lines, decide} = logger();
  assert.equal(controlDoor({rung: 0, signal: 'confident'}, decide), 0);
  assert.equal(controlDoor({}, decide), 0);
  assert.deepEqual(lines, []);
  for (const key of ['level', 'tried', 'fp']) assert.ok(EVIDENCE_KEYS.includes(key), key);
});

test('one repair pass: wrong and unreachable verdicts, a repair left to the person, one that failed; a repair that worked opens none', () => {
  const {lines, decide} = logger();
  const sketch = {controls: [{fp: 'aa'}, {fp: 'bb'}, {fp: 'cc'}, {fp: 'dd'}]};
  const doors = repairDoors({sketch, verdicts: [{n: 1, verdict: 'wrong'}, {n: 2, verdict: 'unreachable'}, {n: 3, verdict: 'right'}],
    results: [{n: 1, ok: true}, {n: 2, ok: undefined}, {n: 4, ok: false}]}, decide, 'h');
  assert.equal(doors.length, 4);
  assert.deepEqual(lines.map(line => [line.text, line.fields.rung, line.fields.reason, line.fields.fp]), [
    ['dead end: contradicted', 4, 'verify', 'aa'], ['dead end: failed', 4, 'verify', 'bb'], ['dead end: refused', 3, 'repair left', 'bb'], ['dead end: failed', 3, 'repair failed', 'dd']]);
  assert.deepEqual(VERDICT_SIGNAL, {wrong: 'contradicted', unreachable: 'failed', empty: 'stalled'});
});

test('the climb and the flow call the door; no file logs a control door by hand', () => {
  const read = file => fs.readFileSync(new URL(`../../${file}`, import.meta.url), 'utf8');
  assert.match(read('extension/ladder/fill-climb.js'), /repairDoors\(\{sketch, verdicts: verified\?\.verdicts, results\}, decide\)/);
  assert.match(read('extension/fill-tab-finish.js'), /controlDoor\(\{rung: 0, signal: 'stalled', reason: 'tries', tried: spent\.tries\}, decide\)/);
  assert.doesNotMatch(read('extension/fill-tab-finish.js') + read('extension/ladder/fill-climb.js'), /level: 'control'/);
});
