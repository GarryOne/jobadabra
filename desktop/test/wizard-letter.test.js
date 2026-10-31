// The Settings letter editor loads without spending; drafting and approval still require explicit choices.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {test} from 'node:test';
import {install} from './tiny-dom.js';
install();
const {document, window} = globalThis;
const html = fs.readFileSync(new URL('../renderer/index.html', import.meta.url), 'utf8');
for (const id of new Set([...html.matchAll(/ id="([^"]+)"/g)].map(m => m[1]))) document.body.append(Object.assign(document.createElement('div'), {id}));
document.getElementById('letter-draft').append(document.createElement('span'));
const calls = [];
window.pilot = new Proxy({coverLetter: async () => ({state: 'none', text: '', pdf: false}),
  coverLetterDraft: async () => { calls.push('draft'); return {ok:false, error:'Fictional generation failure'}; }, coverLetterApprove: () => { calls.push('approve'); },
  state: async () => ({settings: {}})}, {get: (obj, key) => obj[key] || (() => null)});
const {initLetter, loadLetter} = await import('../renderer/pages/base-letter.js');
initLetter();

test('Settings opens the letter editor without generating until the person asks', async () => {
  const editor = document.getElementById('setting-letter'), home = editor.parentNode;
  await loadLetter();
  assert.match(editor.textContent || document.getElementById('letter-empty').textContent, /Draft with AI/);
  const openedCalls = calls.slice();
  assert.deepEqual(openedCalls, [], 'opening Settings must not start a potentially paid AI request');
  assert.equal(editor.parentNode, home);
});

test('explicitly started draft is shared when reopening Settings', async () => {
  let finish, started = 0;
  window.pilot.coverLetterDraft = () => { started += 1; return new Promise(resolve => { finish = resolve; }); };
  const opening = loadLetter();
  await new Promise(resolve => setImmediate(resolve));
  const autoStarted = started;
  if (finish) { finish({ok: false, error: 'Fictional generation failure'}); await opening; }
  assert.equal(autoStarted, 0, 'opening Settings must wait for a deliberate action');
  started = 0;
  finish = null;
  await loadLetter();
  document.getElementById('letter-start-ai').click();
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(started, 1);
  const second = loadLetter();
  await new Promise(resolve => setImmediate(resolve));
  document.getElementById('letter-start-ai').click();
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(started, 1, 'navigation cannot spend twice on concurrent drafts');
  finish({ok: false, error: 'Fictional generation failure'});
  await second;
  await new Promise(resolve => setImmediate(resolve));
});

test('fake AI prefills the Settings textbox; only the person’s approval makes it usable', async () => {
  const os = await import('node:os'), path = await import('node:path');
  const {createStorage} = await import('../lib/storage.js');
  const letters = await import('../lib/cover-letter.js');
  const {letterQuestion} = await import('../lib/letter-availability.js');
  const pages = JSON.parse(fs.readFileSync(new URL('../demo/job-pages.json', import.meta.url), 'utf8'));
  const section = Object.values(pages).flatMap(page => Object.values(page.sections || {})).find(text => String(text).includes('### ✉️ Cover letter'));
  const text = JSON.parse(section.match(/```json\n([\s\S]*?)\n```/)[1]).cover_letter;
  const storage = createStorage(fs.mkdtempSync(path.join(os.tmpdir(), 'wizard-letter-fake-')), {encrypt: v => v, decrypt: v => v});
  fs.mkdirSync(storage.path('cv'));
  fs.writeFileSync(storage.path('cv/cv.json'), JSON.stringify({name: 'Example Person', jobs: [], skills: [], languages: []}));
  let generations = 0, approvals = 0;
  window.pilot.state = async () => ({settings: {}});
  window.pilot.coverLetter = async () => letters.status(storage);
  window.pilot.coverLetterDraft = async () => {
    await letters.generate(storage, {client: {messages: {create: async () => { generations += 1; return {stop_reason: 'end_turn', content: [{type: 'text', text: JSON.stringify({letter: text})}]}; }}}});
    return {ok: true, ...letters.status(storage)};
  };
  window.pilot.coverLetterApprove = async value => {approvals += 1; letters.edit(storage, value); letters.approve(storage, Buffer.from('%PDF-fictional')); return {ok: true, ...letters.status(storage)};};
  await loadLetter();
  const autoGenerations = generations;
  assert.equal(autoGenerations, 0, 'opening Settings does not spend AI credits');
  assert.equal(document.getElementById('letter-text').value, '');
  document.getElementById('letter-start-ai').click();
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(document.getElementById('letter-text').value, text);
  assert.equal(generations, 1);
  assert.equal(approvals, 0);
  assert.equal(letterQuestion(storage).setup.state, 'draft');
  document.getElementById('letter-approve').click();
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(approvals, 1);
  assert.equal(letters.status(storage).state, 'approved');
  assert.equal(letterQuestion(storage), null, 'explicit approval makes the complete base letter an automatic fallback');
});
