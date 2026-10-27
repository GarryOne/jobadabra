// Setup moves the one existing letter editor into its own step and restores it; entering generates one draft through the existing action and never approves it.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {test} from 'node:test';
import {install} from './tiny-dom.js';
install();
const html = fs.readFileSync(new URL('../renderer/index.html', import.meta.url), 'utf8');
for (const id of new Set([...html.matchAll(/ id="([^"]+)"/g)].map(m => m[1]))) document.body.append(Object.assign(document.createElement('div'), {id}));
document.getElementById('letter-draft').append(document.createElement('span'));
const calls = [];
window.pilot = new Proxy({coverLetter: async () => ({state: 'none', text: '', pdf: false}),
  coverLetterDraft: async () => { calls.push('draft'); return {ok:false, error:'Fictional generation failure'}; }, coverLetterApprove: () => { calls.push('approve'); }}, {get: (obj, key) => obj[key] || (() => null)});
const {showLetterStep, hideLetterStep} = await import('../renderer/pages/wizard-letter.js');

test('setup shares the editor and starts a draft, leaving approval to the person', async () => {
  const editor = document.getElementById('setting-letter'), home = editor.parentNode;
  await showLetterStep();
  assert.equal(editor.parentNode, document.getElementById('setup-letter-slot'));
  assert.equal(editor.hidden, false);
  assert.match(editor.textContent || document.getElementById('letter-empty').textContent, /Draft with AI/);
  assert.deepEqual(calls, ['draft'], 'setup drafts once but never approves');
  hideLetterStep();
  assert.equal(editor.parentNode, home);
  assert.equal(editor.hidden, true);
});
