// Rung 0 of the fill ladder: a text box that did not take its answer is listed (extension/page/fill-verify.js) and typed again for real, key by key (extension/fill-verify.js),
// then read back. Only plain typable boxes are listed; no control character or Enter is ever sent; the count of taken boxes is what the page holds afterwards.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {keysFor, typeNotTakenForReal} from '../../extension/fill-verify.js';

function page(boxes) {
  const window = {};
  const code = fs.readFileSync(new URL('../../extension/page/fill-verify.js', import.meta.url), 'utf8');
  vm.runInNewContext(code, {window, document: {querySelectorAll: () => boxes}, getComputedStyle: () => ({visibility: 'visible'})});
  return window;
}
function box(id, {type = 'text', readOnly = false, disabled = false, role = null, value = ''} = {}) {
  const attrs = {};
  return {id, name: id, type, readOnly, disabled, value, scrolled: false, blurred: 0,
    matches: selector => selector.split(',').some(part => part.trim() === `input[type=${type}]` || (type === 'textarea' && part.trim() === 'textarea')),
    getAttribute: name => (name === 'role' ? role : attrs[name] ?? null), setAttribute: (name, v) => { attrs[name] = v; }, removeAttribute: name => { delete attrs[name]; }, hasAttribute: name => name in attrs, attrs,
    getClientRects: () => [1], getBoundingClientRect: () => ({left: 10, top: 20, width: 200, height: 30}), scrollIntoView() { this.scrolled = true; }, blur() { this.blurred += 1; }};
}

test('only plain typable boxes that do not hold their answer are listed, at most 8', () => {
  const boxes = [box('city'), box('pw', {type: 'password'}), box('ro', {readOnly: true}), box('off', {disabled: true}), box('combo', {role: 'combobox'}), box('done', {value: 'Zurich'})];
  const window = page(boxes);
  for (const one of boxes) window.__jobPilottoNoteNotTaken(one.id, 'Zurich');
  assert.deepEqual([...window.__jobPilottoNotTakenSpots().map(spot => spot.field)], ['city']);
  assert.ok(boxes[0].scrolled);
  const many = Array.from({length: 12}, (_, i) => box(`b${i}`));
  const w2 = page(many);
  for (const one of many) w2.__jobPilottoNoteNotTaken(one.id, 'x');
  assert.equal(w2.__jobPilottoNotTakenSpots().length, 8);
});

test('a box read back with its answer is marked as filled and no longer listed', () => {
  const city = box('city');
  const window = page([city]);
  window.__jobPilottoNoteNotTaken('city', 'Zürich');
  assert.equal(window.__jobPilottoTakenNow('city'), false);
  city.value = 'Zürich';
  assert.equal(window.__jobPilottoTakenNow('city'), true);
  assert.equal(city.attrs['data-jobpilotto-filled'], '');
  assert.ok(city.blurred >= 2);
  assert.equal(window.__jobPilottoNotTakenSpots().length, 0);
});

test('a character becomes a real key down and up; a control character or a newline is never typed', () => {
  assert.deepEqual(keysFor('Z'), [{type: 'keyDown', key: 'Z', text: 'Z', unmodifiedText: 'Z'}, {type: 'keyUp', key: 'Z'}]);
  for (const char of ['\n', '\r', '\t', '\u0000', '']) assert.deepEqual(keysFor(char), []);
});

test('each listed box gets a click, select-all and its characters as key events; only what the page then holds counts as taken', async () => {
  const sent = [];
  const typed = {city: '', zip: ''};
  const spots = [{field: 'city', x: 50, y: 35, text: 'Zug'}, {field: 'zip', x: 50, y: 80, text: '8001'}];
  let focus = '';
  const page = async (func, args = []) => vm.runInNewContext(`(${func.toString()})(...args)`, {
    args, window: {__jobPilottoNotTakenSpots: () => spots, __jobPilottoTakenNow: field => field === 'city'},
    document: {activeElement: {id: focus, tagName: 'INPUT', type: 'text', value: typed[focus] || '', selectionStart: 0, selectionEnd: 0,
      select() { this.selectionEnd = this.value.length; }}},
  });   // the zip box keeps rejecting its answer on read-back; selection still succeeds
  const send = async (method, params) => {
    sent.push([method, params.type, params.key || params.text || '']);
    if (method === 'Input.dispatchMouseEvent' && params.type === 'mousePressed') focus = params.y === 35 ? 'city' : 'zip';
    if (method === 'Input.dispatchKeyEvent' && params.type === 'keyDown') typed[focus] += params.text;
  };
  const result = await typeNotTakenForReal({page, send});
  assert.deepEqual(result, {tried: 2, taken: 1});
  assert.equal(typed.city, 'Zug');
  assert.equal(typed.zip, '8001');
  assert.ok(!sent.some(([method, type, key]) => method === 'Input.dispatchKeyEvent' && /Enter|Tab/.test(key)), 'never Enter or Tab');
});

test('no box listed: nothing is sent', async () => {
  const sent = [];
  assert.deepEqual(await typeNotTakenForReal({page: async () => [], send: async (...call) => sent.push(call)}), {tried: 0, taken: 0});
  assert.equal(sent.length, 0);
});

test('a box the fill answered and the page did not take is marked, with no value, so the judges\' match says no; a box read back with its answer loses the mark', () => {
  const city = box('city'), date = box('start');
  const window = page([city, date]);
  window.__jobPilottoNoteNotTaken('city', 'Zürich');
  window.__jobPilottoNoteNotTaken('start', '2026-11-02');
  assert.equal(city.attrs['data-jobpilotto-nottaken'], '');
  assert.equal(date.attrs['data-jobpilotto-nottaken'], '');
  assert.ok(!JSON.stringify(city.attrs).includes('Zürich'));
  city.value = 'Zürich';
  assert.equal(window.__jobPilottoTakenNow('city'), true);
  assert.ok(!('data-jobpilotto-nottaken' in city.attrs));
});

test('a point the press floor refuses (markAt false) is never clicked or typed into', async () => {
  const sent = [];
  const page = async (func, args = []) => (args.length === 2 ? false : args.length ? true : [{field: 'x', x: 5, y: 5, text: 'Go'}]);
  assert.deepEqual(await typeNotTakenForReal({page, send: async (...call) => sent.push(call)}), {tried: 1, taken: 0});
  assert.equal(sent.length, 0);
});
