// Box 6 remainder of spec 2026-10-12-one-next-move.md: the picture is checked against the sketch. The picture's answer counts the buttons and links it shows; more shown than the sketch lists is a PARTIAL VIEW
// (a perception gap, flagged in the closer-look line as fixed numbers, never page words), so blind spots are counted as data for universal perception fixes (e2e/lib/picture-asks.mjs).
import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import {viewOf, PARTIAL_BY} from '../../extension/ladder/picture-view.js';

const read = file => fs.readFileSync(new URL(`../../${file}`, import.meta.url), 'utf8');

test('a picture that shows several more controls than the sketch lists is a partial view', () => {
  assert.deepEqual(viewOf({shown: 9, listed: 4}), {shown: 9, listed: 4, partial: true});
  assert.deepEqual(viewOf({shown: 4 + PARTIAL_BY, listed: 4}), {shown: 4 + PARTIAL_BY, listed: 4, partial: true});
  assert.equal(viewOf({shown: 4 + PARTIAL_BY - 1, listed: 4}).partial, false, 'a count off by a little is noise, not a gap');
});

test('no picture, or no count in the answer, is not measured: never a partial view', () => {
  assert.deepEqual(viewOf({}), {shown: -1, listed: -1, partial: false});
  assert.deepEqual(viewOf({shown: -1, listed: 5}), {shown: -1, listed: 5, partial: false});
  assert.deepEqual(viewOf({shown: 'many', listed: 5}), {shown: -1, listed: 5, partial: false});
});

test('the app asks the picture for the count and returns it beside what the sketch lists', async () => {
  const {escalate, SCHEMA} = await import('../../desktop/lib/ladder/rung4-picture.js');
  assert.ok(SCHEMA.required.includes('shown') && SCHEMA.properties.shown.type === 'integer');
  const dir = fs.mkdtempSync(new URL('./', import.meta.url).pathname.replace(/\/app-core\/test\/$/, '/') + '.tmp-cross-');
  try {
    const storage = {settings: () => ({accountAutomation: 'full'}), path: name => `${dir}/${name}`};
    const answer = {action: 'ask_person', control: '', control_kind: '', detail: '', option: '', why: 'none listed', confidence: 0.6, shown: 9};
    const client = {messages: {create: async () => ({usage: {input_tokens: 2500, output_tokens: 200}, content: [{type: 'text', text: JSON.stringify(answer)}]})}};
    const body = {kind: 'page', url: 'https://jobs.example.org/job/1', image: 'AAAA', reason: 'x', sketch: {title: 'Job', headings: ['Job'], controls: [{type: 'text', label: 'Search'}], buttons: ['Share', 'Save'], texts: [], frames: []}};
    const found = await escalate(storage, body, {client});
    assert.equal(found.shown, 9);
    assert.equal(found.listed, 3, 'the controls and the buttons and links the sketch lists');
    const without = await escalate(storage, {...body, url: 'https://jobs.example.org/job/2', image: ''}, {client});
    assert.equal(without.shown, undefined, 'a look from the sketch alone has no picture to count');
  } finally { fs.rmSync(dir, {recursive: true, force: true}); }
});

test('the closer look logs the view as numbers on the same line', () => {
  assert.match(read('extension/ladder/rung4-picture.js'), /\.\.\.viewOf\(answer\)/);
});
