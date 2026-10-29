// "A form came" after the Apply press means a form the press brought, never the controls the page already had (owner, 15 Oct 2026: a posting with a job-search box and a
// "Create Alert" form beside Apply was read as the application, filled and called Ready before the page moved on). The class: every posting with side forms.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {test} from 'node:test';
import {formCame} from '../../extension/tab-pages.js';

const PAGE = 'https://careers.example.test/en/job/4711';
const posting = {fields: 3, passwords: 0, files: 0, textareas: 0, anyFiles: 0, choices: 0};   // an alert form's email, name and keywords

test('controls the page already had before the press are not a form that came', () => {
  assert.equal(formCame(posting, {...posting}, PAGE), false, 'the same alert fields after the press');
  assert.equal(formCame(posting, {...posting, nodes: 999}, PAGE), false, 'the page changed elsewhere, no control more');
  assert.equal(formCame({...posting, fields: 5}, {...posting, fields: 5, textareas: 0}, PAGE), false, 'a search form and an alert form');
});

test('a form that is drawn adds controls and counts', () => {
  assert.equal(formCame(posting, {...posting, fields: 7}, PAGE), true, 'the application form appeared beside the old fields');
  assert.equal(formCame(posting, {...posting, textareas: 1}, PAGE), true, 'a cover letter box appeared');
  assert.equal(formCame(posting, {...posting, files: 1}, PAGE), true, 'a CV upload appeared');
  assert.equal(formCame({fields: 1, passwords: 0, files: 0, textareas: 0, anyFiles: 0, choices: 0}, {fields: 4, passwords: 0, files: 0, textareas: 0, anyFiles: 0, choices: 0}, PAGE), true, 'a posting with a search box, then a form');
});

test('with no earlier shape the page alone decides, as before; a page that is not a form never counts', () => {
  assert.equal(formCame(null, posting, PAGE), true);
  assert.equal(formCame({fields: 0}, {fields: 3}, PAGE), true, 'the page had no form shape before');
  assert.equal(formCame({fields: 0}, {fields: 1}, PAGE), false);
  assert.equal(formCame(posting, {...posting, passwords: 1}, PAGE), false, 'a sign-in page is an account page, not the form');
});

test('every press-then-wait site in the fill flow gives formAfterPress the shape from before the press', () => {
  const flow = ['fill-flow.js', 'fill-flow-read.js', 'fill-flow-steps.js'].map(file => fs.readFileSync(new URL(`../../extension/${file}`, import.meta.url), 'utf8')).join('\n');
  const calls = [...flow.matchAll(/formAfterPress\(([^)]*)\)/g)].map(match => match[1]).filter(args => args.startsWith('tab.id'));
  assert.equal(calls.length, 5, `found ${calls.length} calls`);
  for (const args of calls) assert.match(args, /, 8000, (counts|before)$/, `formAfterPress(${args}) has no baseline`);
  assert.match(flow, /formCame\(before, counts, live\.url\)/);
});
