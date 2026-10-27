// An optional cover-letter textarea is actionable when setup is missing, and uses the approved payload without overwriting written text.
import fs from 'node:fs';
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {loadJsdom, openPage} from './helpers/page.js';
const JSDOM = await loadJsdom();
const skip = JSDOM ? false : 'jsdom unavailable';
const pages = JSON.parse(fs.readFileSync(new URL('../../desktop/demo/job-pages.json', import.meta.url), 'utf8'));
const kit = Object.values(pages).flatMap(page => Object.values(page.sections || {})).find(text => String(text).includes('### ✉️ Cover letter'));
const LETTER = JSON.parse(kit.match(/```json\n([\s\S]*?)\n```/)[1]).cover_letter;
const FORM = '<form><label for="cover_letter">Cover letter (optional)</label><textarea id="cover_letter"></textarea></form>';

test('a blank optional letter is an important setup action, not a silently complete form', {skip}, async () => {
  const w = openPage(JSDOM, FORM);
  try {
    const status = {state: 'missing', ready: false, reason: 'No cover letter has been created.', action: 'Create cover letter'};
    const result = await w.__jobPilottoExtensionFill([], {}, {coverLetterStatus: status});
    assert.ok(result.todo.some(text => /important.*cover letter/i.test(text)), JSON.stringify(result.todo));
    assert.equal(result.coverLetterStatus?.state, 'missing');
    assert.equal(w.document.querySelector('textarea').value, '');
  } finally { w.close(); }
});

test('Applying panel prominently offers missing-letter setup even when required fields and CV are complete', {skip}, async () => {
  const {evalPanel} = await import('./helpers/panel.js');
  const w = openPage(JSDOM, '<form><label for="a">First name</label><input id="a" required value="Example"><label for="b">Last name</label><input id="b" required value="Person"><label for="c">Email</label><input id="c" required value="example@example.test">' + FORM + '</form>');
  const sent = [];
  let status = {state: 'missing', ready: false, reason: 'No usable cover letter has been created.', action: 'Create cover letter'};
  w.chrome = {runtime: {id: 'test', getManifest: () => ({version: 'test'}), onMessage: {addListener() {}}, sendMessage: async message => {
    sent.push(message);
    if (message.type === 'panelAllowed') return {ok: true};
    if (message.type === 'review') return {session: {id: 'fictional', kind: 'form'}, cv: {tailored: false}, coverLetterStatus: status};
    return {};
  }}};
  try {
    await w.__jobPilottoExtensionFill([], {}, {coverLetterStatus: status});
    w.document.documentElement.setAttribute('data-jobpilotto-page', 'form');
    w.eval(fs.readFileSync(new URL('../../extension/page/review-payload.js', import.meta.url), 'utf8'));
    evalPanel(w);
    await new Promise(resolve => setTimeout(resolve, 60));
    const root = w.document.getElementById('jobpilotto-review-host').shadowRoot;
    const banner = root.querySelector('.letter-setup');
    assert.ok(banner, 'the important setup action exists');
    assert.equal(banner.hidden, false, JSON.stringify(sent.map(m => m.type))); 
    assert.match(banner.textContent, /HIGH PRIORITY/);
    assert.match(banner.textContent, /Create cover letter/);
    assert.doesNotMatch(root.querySelector('.pill b').textContent, /Ready to submit/);
    banner.querySelector('button').click();
    assert.ok(sent.some(message => message.type === 'panelOpenApp' && message.session === 'setup:cover-letter'));
    // A kit or the person's written letter satisfies this form even when the general setup is still missing.
    const box = w.document.getElementById('cover_letter');
    box.value = LETTER;
    box.setAttribute('data-jobpilotto-letter', '1');
    box.dispatchEvent(new w.Event('input', {bubbles: true}));
    await new Promise(resolve => setTimeout(resolve, 450));
    assert.equal(banner.hidden, true, 'an actual written letter clears this form’s warning');
    box.value = '';
    box.dispatchEvent(new w.Event('input', {bubbles: true}));
    await new Promise(resolve => setTimeout(resolve, 450));
    assert.equal(banner.hidden, false, 'clearing the letter restores missing setup');

  } finally { w.close(); }
});

for (const label of ['Cover letter', 'Bewerbungsschreiben']) test(`selected text fills a supported ${label} textarea and never replaces a written letter`, {skip}, async () => {
  const w = openPage(JSDOM, `<form><label for="letter">${label}</label><textarea id="letter"></textarea></form>`);
  try {
    const file = {coverLetterStatus: {state: 'ready', ready: true}};
    const first = await w.__jobPilottoExtensionFill([], {}, file, LETTER);
    assert.equal(w.document.querySelector('textarea').value, LETTER);
    assert.equal(first.todo.some(text => /^Important:/.test(text)), false);
    w.document.querySelector('textarea').value = LETTER + '\n';
    await w.__jobPilottoExtensionFill([], {}, file, LETTER);
    assert.equal(w.document.querySelector('textarea').value, LETTER + '\n', 'written text wins');
  } finally { w.close(); }
});

for (const hidden of [false, true]) test(`a rejected optional letter upload is actionable in Applying (${hidden ? 'hidden' : 'visible'} input)`, {skip}, async () => {
  const {evalPanel} = await import('./helpers/panel.js');
  const w = openPage(JSDOM, `<form><label for="a">First name</label><input id="a" required value="Example"><label for="b">Last name</label><input id="b" required value="Person"><label for="c">Email</label><input id="c" required value="example@example.test"><div class="field"><label for="letter">Cover letter</label><input id="letter" type="file" ${hidden ? 'style="display:none"' : ''}><button type="button">Attach</button></div></form>`);
  const status = {state: 'ready', ready: true, source: 'base'};
  w.DataTransfer = class {constructor() {this.files = []; this.items = {add: file => this.files.push(file)};}};
  const input = w.document.getElementById('letter');
  let files = [];
  Object.defineProperty(input, 'files', {get: () => files, set: value => { files = value; }});
  input.addEventListener('change', () => {files = [];});
  w.chrome = {runtime: {id: 'test', getManifest: () => ({version: 'test'}), onMessage: {addListener() {}}, sendMessage: async message => message.type === 'panelAllowed' ? {ok: true} : message.type === 'review' ? {session: {id: 'fictional', kind: 'form'}, coverLetterStatus: status} : {}}};
  try {
    await w.__jobPilottoExtensionFill([], {}, {coverLetterStatus: status, coverLetterFile: {name: 'Cover letter.pdf', type: 'application/pdf', data: 'JVBERi0xLjQK'}});
    w.eval(fs.readFileSync(new URL('../../extension/page/review-payload.js', import.meta.url), 'utf8'));
    w.document.documentElement.setAttribute('data-jobpilotto-page', 'form');
    evalPanel(w);
    await new Promise(resolve => setTimeout(resolve, 60));
    const root = w.document.getElementById('jobpilotto-review-host').shadowRoot;
    assert.equal(root.querySelector('.letter-setup').hidden, false);
    assert.equal(root.querySelector('.letter-action').textContent, 'Show on form');
    assert.doesNotMatch(root.querySelector('.pill b').textContent, /Ready to submit/);
  } finally {w.close();}
});

test('a form with no letter field can be ready while the separate setup queue remains outstanding', {skip}, async () => {
  const {evalPanel} = await import('./helpers/panel.js');
  const w = openPage(JSDOM, '<form><label for="a">First name</label><input id="a" required value="Example"><label for="b">Last name</label><input id="b" required value="Person"><label for="c">Email</label><input id="c" required value="example@example.test"></form>');
  const status = {state: 'missing', ready: false, reason: 'No usable letter.', action: 'Create cover letter'};
  w.chrome = {runtime: {id: 'test', getManifest: () => ({version: 'test'}), onMessage: {addListener() {}}, sendMessage: async m => m.type === 'panelAllowed' ? {ok: true} : m.type === 'review' ? {session: {id: 'fictional', kind: 'form'}, coverLetterStatus: status} : {}}};
  try {
    const result = await w.__jobPilottoExtensionFill([], {}, {coverLetterStatus: status});
    assert.equal(result.todo.some(text => /^Important: cover letter/.test(text)), false);
    w.eval(fs.readFileSync(new URL('../../extension/page/review-payload.js', import.meta.url), 'utf8'));
    w.document.documentElement.setAttribute('data-jobpilotto-page', 'form');
    evalPanel(w);
    await new Promise(resolve => setTimeout(resolve, 60));
    const root = w.document.getElementById('jobpilotto-review-host').shadowRoot;
    assert.equal(root.querySelector('.letter-setup').hidden, true);
    assert.match(root.querySelector('.pill b').textContent, /Ready to submit/);
  } finally {w.close();}
});

for (const available of [false, true]) test(`a letter behind a manual entry control stays actionable (${available ? 'available' : 'missing'} draft)`, {skip}, async () => {
  const {evalPanel} = await import('./helpers/panel.js');
  const w = openPage(JSDOM, '<form><label for="a">First name</label><input id="a" required value="Example"><label for="b">Last name</label><input id="b" required value="Person"><label for="c">Email</label><input id="c" required value="example@example.test"><div><h3>Cover letter</h3><button type="button" id="manual">Enter manually</button><textarea id="cover_letter" style="display:none"></textarea></div></form>');
  const status = available ? {state: 'ready', ready: true} : {state: 'missing', ready: false, reason: 'No usable letter.', action: 'Create cover letter'};
  const sent = [];
  let clicks = 0;
  w.document.getElementById('manual').onclick = () => { clicks++; w.document.getElementById('cover_letter').style.display = ''; };
  w.chrome = {runtime: {id: 'test', getManifest: () => ({version: 'test'}), onMessage: {addListener() {}}, sendMessage: async m => {sent.push(m); return m.type === 'panelAllowed' ? {ok: true} : m.type === 'review' ? {session: {id: 'fictional', kind: 'form'}, coverLetterStatus: status} : {};}}};
  try {
    const result = await w.__jobPilottoExtensionFill([], {}, {coverLetterStatus: status}, available ? LETTER : '');
    assert.equal(result.todo.some(text => /^Important: cover letter/.test(text)), !available);
    assert.equal(clicks, available ? 1 : 0, 'missing content does not click the manual control');
    assert.equal(w.document.getElementById('cover_letter').value, available ? LETTER : '');
    w.eval(fs.readFileSync(new URL('../../extension/page/review-payload.js', import.meta.url), 'utf8'));
    w.document.documentElement.setAttribute('data-jobpilotto-page', 'form');
    evalPanel(w);
    await new Promise(resolve => setTimeout(resolve, 60));
    const root = w.document.getElementById('jobpilotto-review-host').shadowRoot;
    assert.equal(root.querySelector('.letter-setup').hidden, available);
    assert.equal(sent.filter(m => m.type === 'review').at(-1)?.payload?.letterAsked, true, 'Applying receives the same letter observation');
    assert.equal(/Ready to submit/.test(root.querySelector('.pill b').textContent), available);
    if (!available) {
      w.document.getElementById('manual').style.display = 'none';
      w.document.getElementById('a').dispatchEvent(new w.Event('input', {bubbles: true}));
      await new Promise(resolve => setTimeout(resolve, 450));
      assert.equal(root.querySelector('.letter-setup').hidden, true, 'a manual control hidden on another step does not leave a stale warning');
    }
  } finally {w.close();}
});
