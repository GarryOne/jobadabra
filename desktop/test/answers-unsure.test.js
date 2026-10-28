// The owner's Application answers and Your details, value by value (owner, 18 Oct 2026, PR 9 of the approved plan): an answer saved with "(guess)" reads as
// unconfirmed, never as a confirmed fact; an empty answer is not answered (his "How to pronounce your name" was left empty on purpose: "Leave it empty"); a
// label that ended in its own colon ("Please indicate your nationality: : Romanian") reads and writes with one colon. Fictional values, his line shapes.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {test} from 'node:test';
import {createStorage} from '../lib/storage.js';
import * as sections from '../lib/profile-sections.js';
import * as questions from '../lib/questions.js';
import {TEXT_FILES} from '../lib/store/text-files.js';
import {labelledLine, sections as answerSections, valueOf} from '../renderer/answers-model.js';

const fresh = () => {
  const storage = createStorage(fs.mkdtempSync(path.join(os.tmpdir(), 'jp-unsure-')), {encrypt: v => v, decrypt: v => v});
  storage.saveSettings({store: 'sqlite', telemetry: false});
  return storage;
};

test('"(guess)" is unconfirmed: the value without the mark, flagged, not open', () => {
  assert.deepEqual(valueOf('"Cannot recall" (guess).'), {open: false, optional: false, guess: true, value: '"Cannot recall"', hint: '', asked: ''});
  assert.deepEqual(valueOf('Bachelor\'s in Computer Science; no exact grade. (guess)'), {open: false, optional: false, guess: true, value: 'Bachelor\'s in Computer Science; no exact grade.', hint: '', asked: ''});
  assert.equal(valueOf('Cannot recall').guess, undefined, 'a plain answer is confirmed');
  const line = answerSections([{type: 'bulleted_list_item', id: 'm', text: '- How did you perform in mathematics at high school?: "Cannot recall" (guess).'}])[0].items[0];
  assert.equal(line.guess, true);
});

test('an empty answer is not answered, on the screen and in Answer once', async () => {
  assert.deepEqual(valueOf(''), {open: true, optional: false, value: '', hint: '', asked: ''});
  const cell = answerSections([{type: 'table', id: 't', header: true, rows: [{id: 'h', cells: ['Question', 'Answer']}, {id: 'p', cells: ['How to pronounce your name', '']}]}])[0].items[0];
  assert.equal(cell.open, true);
  const storage = fresh();
  storage.writeText(TEXT_FILES.answers, '# Recurring form questions\n\n| Question | Answer |\n|---|---|\n| How to pronounce your name | |\n| Pronouns | He/him |\n');
  assert.deepEqual((await questions.list(storage)).map(q => q.question), ['How to pronounce your name']);
});

test('a label that ended in its own colon reads and writes with one colon (every "label: value" writer)', async () => {
  assert.equal(labelledLine('Please indicate your nationality: : Portuguese').raw, 'Portuguese');
  const storage = fresh();
  await sections.save(storage, 'eligibility', [{label: 'Please indicate your nationality:', value: 'Portuguese'}]);
  assert.match(storage.readText(TEXT_FILES.profile), /Please indicate your nationality: Portuguese/);
  assert.deepEqual((await sections.read(storage)).eligibility, [{label: 'Please indicate your nationality', value: 'Portuguese'}]);
  storage.writeText(TEXT_FILES.profile, `${storage.readText(TEXT_FILES.profile).replace('nationality: Portuguese', 'nationality: : Portuguese')}`);
  assert.deepEqual((await sections.read(storage)).eligibility, [{label: 'Please indicate your nationality', value: 'Portuguese'}], 'a line saved before reads right');
  await questions.remember(storage, 'What is your nickname?:', 'Garry');
  assert.match(storage.readText(TEXT_FILES.answers), /What is your nickname\?: Garry/);
  assert.doesNotMatch(storage.readText(TEXT_FILES.answers), /:\s*:/);
});

test('What we learned: a guessed answer says "Unconfirmed" under its question, chip Guessed, never Confirmed, with its value shown', async () => {
  const {install} = await import('./tiny-dom.js');
  const body = install();
  const items = [{id: 'h', type: 'heading_2', text: 'Education'}, {id: 'g', type: 'bulleted_list_item', text: 'How did you perform in mathematics at high school?: "Cannot recall" (guess).'}];
  globalThis.window.pilot = new Proxy({textOutline: async name => ({ok: true, items: name === 'answers' ? items : [], store: 'sqlite', link: null})}, {get: (all, key) => all[key] || (() => null)});
  const node = globalThis.document.createElement('div');
  node.id = 'answers-body';
  body.replaceChildren(node);
  await (await import('../renderer/pages/application-answers.js')).loadApplicationAnswers();
  const row = node.querySelectorAll('.qa-learned .qa-row').find(each => /mathematics/.test(each.textContent));
  assert.match(row.textContent, /Unconfirmed: saved as a guess/);
  assert.match(row.textContent, /Guessed/);
  assert.doesNotMatch(row.textContent, /Confirmed/);
  assert.match(row.querySelector('.qa-value').textContent, /^"Cannot recall"$/);
});
