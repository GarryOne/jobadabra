// A control pressed with no effect is not pressed again, and the AI's next look is told so (extension/no-effect.js; Hornbach 0.9.189: one dead link pressed three times).
// Guards the whole class: every press site in fill-flow.js notes and passes it, and both AI rungs drop an answer that names it.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {test} from 'node:test';
import {forgetNoEffect, noEffectOf, noteNoEffect, sameControl} from '../../extension/no-effect.js';
import {SKETCH_FIELDS, noEffectLine, pageSketch, pressedBefore} from '../lib/ladder/rung2-sketch.js';
import {digestMessage, validateDigest} from '../lib/ladder/rung3-digest.js';

const read = name => fs.readFileSync(new URL(`../../extension/${name}`, import.meta.url), 'utf8');

test('the memory is per tab and page, ignores case and spacing, and is forgotten with the tab', () => {
  noteNoEffect('7 a.example/x', 'Jetzt bewerben  (ohne Anmeldung)');
  noteNoEffect('7 a.example/x', 'jetzt bewerben (ohne anmeldung)');
  assert.deepEqual(noEffectOf('7 a.example/x'), ['Jetzt bewerben (ohne Anmeldung)']);
  assert.deepEqual(noEffectOf('7 a.example/y'), []);
  assert.equal(sameControl('Apply', ' apply '), true);
  assert.equal(sameControl('', ''), false);
  forgetNoEffect(7);
  assert.deepEqual(noEffectOf('7 a.example/x'), []);
});

test('every press site notes a press that changed nothing and passes the memory to the floor', () => {
  const flow = ['fill-flow.js', 'fill-flow-read.js', 'fill-flow-steps.js'].map(read).join('\n');
  assert.equal((flow.match(/pressApply\(/g) || []).length, (flow.match(/pressApply\([^;]*noEffectOf\(key\)\)/g) || []).length, 'every pressApply call passes the no-effect list');
  assert.equal((flow.match(/noteNoEffect\(key,/g) || []).length, 3, 'the Apply press, the start route and the digest press each note a dead press');
  assert.match(flow, /noEffect: noEffectOf\(fillKey\(tab\.id, tab\.url\)\)/, 'every ask of the page kind (route, digest) carries it');
  assert.match(flow, /forgetNoEffect\(tabId\)/, 'a new tab or a reload may press again');
  assert.match(read('apply-press.js'), /noEffect = \[\]\)/);
});

test('the sketch field is on the shared list and reaches the app capped', () => {
  assert.ok(SKETCH_FIELDS.includes('noEffect'));
  assert.deepEqual(pageSketch({noEffect: ['A', '', 'B'.repeat(80), 'c', 'd', 'e', 'f']}).noEffect, ['A', 'B'.repeat(40), 'c', 'd', 'e']);
  assert.deepEqual(pageSketch({}).noEffect, []);
});

test('both AI rungs are told, only when there is something to tell, and the line is one text', () => {
  const none = pageSketch({buttons: ['Apply']});
  const some = pageSketch({buttons: ['Apply'], noEffect: ['Jetzt bewerben (ohne Anmeldung)']});
  assert.equal(noEffectLine([]), '');
  assert.equal(digestMessage(none, []).includes('Pressed already'), false, 'no list, no new line: other pages keep their fingerprints');
  assert.ok(digestMessage(some, []).includes(noEffectLine(some.noEffect)), 'the digest sees the same words as rung 2');
});

test('the digest and rung 2 refuse a control already pressed with no effect, whatever the AI says', () => {
  assert.equal(pressedBefore(['Jetzt bewerben (ohne Anmeldung)'], ' jetzt bewerben (ohne anmeldung) '), true);
  assert.equal(pressedBefore(['Jetzt bewerben (ohne Anmeldung)'], 'Jetzt bewerben (mit Anmeldung)'), false);
  assert.equal(pressedBefore([], 'Apply'), false);
  const candidates = [{n: 4, kind: 'link', text: 'Jetzt bewerben (mit Anmeldung)'}, {n: 5, kind: 'button', text: 'Jetzt bewerben (ohne Anmeldung)'}];
  const said = validateDigest({outcome: 'form', verb: 'press', numbers: [5], press_kind: 'apply', confidence: 0.9}, candidates);
  assert.equal(said.chosen[0].text, 'Jetzt bewerben (ohne Anmeldung)');
  assert.equal(pressedBefore(['Jetzt bewerben (ohne Anmeldung)'], said.chosen[0].text), true, 'the floor in digestKind compares the chosen text');
});
