// Which cover letter a form got, and a required letter slot with no letter (owner, 18 Oct 2026, decision 4 of the cover-letter redesign): the fill record
// says which document went in ("this job's letter" or "your base letter", never a guess for a file the person chose), and a required letter slot the app
// has no letter for asks the person for one, where to write it. The left row keeps its reason ("upload: no file for this question", read by e2e/lib/ending.mjs).
import test from 'node:test';
import assert from 'node:assert/strict';
import { loadJsdom, openPage } from './helpers/page.js';

const JSDOM = await loadJsdom();
const slot = (id, title, required) => `<div class="field"><label for="${id}">${title}${required ? ' *' : ''}</label><input type="file" id="${id}"${required ? ' required' : ''}></div>`;
const formWith = (letterRequired, other = '') => `<form><div class="field"><label for="first">First name *</label><input id="first" required></div>${slot('cv', 'CV', true)}${slot('letter', 'Cover letter', letterRequired)}${other}</form>`;
const CV = {name: 'cv.pdf', type: 'application/pdf', data: 'JVBERi0xLjQK'};

async function fill(form, resume, {rejectLetter = false} = {}) {
  const window = openPage(JSDOM, form);
  // jsdom has no DataTransfer and its input takes only a real FileList: the smallest stand-ins, so the attach runs as in a browser.
  window.DataTransfer = class { constructor() { this.files = []; this.items = {add: file => this.files.push(file)}; } };
  for (const el of window.document.querySelectorAll('input[type=file]')) { let files = []; Object.defineProperty(el, 'files', {get: () => files, set: list => { files = list; }}); }
  if (rejectLetter) window.document.getElementById('letter').addEventListener('change', event => { event.target.files = []; });
  const summary = await window.__jobPilottoExtensionFill([], {}, resume, '', false);
  const out = {trace: Array.from(summary.trace).map(row => ({...row})), todo: Array.from(summary.todo)};
  window.close();
  return out;
}
const letterRow = trace => trace.find(row => /cover letter/i.test(row.label));

test('the job\'s own letter attached: its row says "this job\'s letter"', { skip: !JSDOM }, async () => {
  const {trace} = await fill(formWith(true), {...CV, coverLetterFile: {name: 'Ada L - Acme.pdf', type: 'application/pdf', data: 'JVBERi0xLjQK', tailored: true}});
  assert.deepEqual([letterRow(trace)?.outcome, letterRow(trace)?.source], ['filled', 'this job\'s letter'], JSON.stringify(trace));
});

test('the base letter attached (fallback on): its row says "your base letter"', { skip: !JSDOM }, async () => {
  const {trace} = await fill(formWith(false), {...CV, coverLetterFile: {name: 'Cover letter.pdf', type: 'application/pdf', data: 'JVBERi0xLjQK'}});
  assert.deepEqual([letterRow(trace)?.outcome, letterRow(trace)?.source], ['filled', 'your base letter'], JSON.stringify(trace));
});

test('a required letter slot with no letter asks for one, and where to write it; its row keeps the upload reason', { skip: !JSDOM }, async () => {
  const {trace, todo} = await fill(formWith(true), CV);
  assert.deepEqual([letterRow(trace)?.outcome, letterRow(trace)?.reason, letterRow(trace)?.source], ['left', 'upload: no file for this question', ''], JSON.stringify(trace));
  assert.ok(todo.includes('Attach a cover letter: write this job\'s letter in its preparation kit, then press Fill again'), JSON.stringify(todo));
  assert.ok(!todo.some(line => /^Answer: cover letter/i.test(line)), 'a file slot is never "Answer:"');
});

test('an optional letter slot with missing setup stays empty and asks for important setup', { skip: !JSDOM }, async () => {
  const {trace, todo} = await fill(formWith(false), {...CV, coverLetterStatus: {state: 'missing', ready: false, reason: 'No usable cover letter has been created.', action: 'Create cover letter'}});
  assert.deepEqual([letterRow(trace)?.outcome, letterRow(trace)?.required], ['left', false]);
  assert.ok(todo.some(line => /^Important: cover letter/.test(line)), JSON.stringify(todo));
});

// The class: every required upload slot that is not the CV is asked as a file to attach, never as a question to answer.
test('any other required upload slot left empty is asked as "Attach: <its title>", never "Answer:"', { skip: !JSDOM }, async () => {
  const {todo} = await fill(formWith(false, slot('cert', 'Certificates', true)), CV);
  assert.ok(todo.some(line => /^Attach: certificates/i.test(line)), JSON.stringify(todo));
  assert.ok(!todo.some(line => /^Answer: certificates/i.test(line)), JSON.stringify(todo));
});


test('a rejected optional cover-letter upload explains the important delivery gap', {skip: !JSDOM}, async () => {
  const {trace, todo} = await fill(formWith(false), {...CV, coverLetterStatus: {state: 'ready', ready: true}, coverLetterFile: {...CV, name: 'Cover letter.pdf'}}, {rejectLetter: true});
  assert.equal(letterRow(trace)?.outcome, 'left');
  assert.ok(todo.some(text => /^Important: cover letter/.test(text) && /attach/i.test(text)), JSON.stringify(todo));
});
