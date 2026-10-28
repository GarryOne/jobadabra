// Profile → Cover letter → Base letter (owner's mockup 07, 18 Oct 2026; pages/base-letter.js): a neutral "Not created" (never a green dot for nothing),
// the empty state with Draft with AI / Write my own until a choice or a letter, the editor after; who pays said before and after a draft from the
// engine settings (no estimate, no hardcoded price or duration); the forms switch only once the letter is approved.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {test} from 'node:test';
import {install} from './tiny-dom.js';
import {setCostEngine, setCostsShown} from '../renderer/ai-cost.js';

setCostsShown(true);
setCostEngine(() => 'api');   // the API-key user's cases; test/ai-cost.test.js covers every other engine

install();
globalThis.globalThis.window.pilot = new Proxy({}, {get: () => async () => ({})});
globalThis.localStorage = {getItem: () => null, setItem: () => {}};
const {statePill, showsEditor} = await import('../renderer/pages/base-letter.js');
const {lastCost, usageAfter, usageBefore} = await import('../renderer/ai-engine-view.js');

test('the state pill: neutral when none exists, warn for a draft, good with its date once approved', () => {
  const none = statePill({state: 'none'});
  assert.equal(none.textContent, 'Not created');
  assert.match(none.className, /tone-neutral/);
  assert.doesNotMatch(none.className, /\bdot\b/);
  assert.match(statePill({state: 'draft'}).className, /tone-warn/);
  const approved = statePill({state: 'approved', approvedAt: '2026-10-18T09:00:00Z'});
  assert.match(approved.className, /tone-good/);
  assert.match(approved.textContent, /^Approved /);
});

test('the empty state shows until a choice or a letter; reading shows the editor with its skeleton', () => {
  assert.equal(showsEditor({state: 'none'}), false);
  assert.equal(showsEditor({state: 'none'}, {writing: true}), true, 'Write my own');
  assert.equal(showsEditor({state: 'none'}, {reading: true}), true, 'the skeleton stands in, so "Not created" is never just an unread letter');
  assert.equal(showsEditor({state: 'none'}, {typed: 'Dear team'}), true, 'typed text is never hidden');
  assert.equal(showsEditor({state: 'draft'}), true);
  assert.equal(showsEditor({state: 'approved'}), true);
});

test('who pays: said before from the engine, after from the run; an unknown cost is never $0', () => {
  setCostsShown(true);
  setCostEngine(() => 'api');   // the page modules imported above set the window's own engine
  assert.equal(usageBefore({aiFree: true}), 'Uses your AI credits.');
  assert.equal(usageBefore({aiEngine: 'cli'}), 'Uses your plan allowance.');
  assert.equal(usageBefore({aiEngine: 'api'}, true), 'Billed to your API account.');
  assert.equal(usageAfter({paidBy: 'api', usd: 0.031}), 'Cost $0.03');
  assert.equal(usageAfter({paidBy: 'api', usd: 0}), 'Billed to your API account');
  assert.equal(usageAfter({paidBy: 'credits', usd: 0.02}), 'Used your AI credits');
  assert.equal(usageAfter({}), '');
  assert.equal(lastCost({paidBy: 'api', usd: 0.03}), 'Last draft: $0.03');
  assert.equal(lastCost({paidBy: 'plan', usd: 0.03}), '');
});

test('the empty state is the shared one (page-parts.js emptyState) with two choices and who pays; no own Save; no hardcoded price or duration', () => {
  const html = fs.readFileSync(new URL('../renderer/index.html', import.meta.url), 'utf8');
  const panel = html.slice(html.indexOf('id="setting-letter"'), html.indexOf('id="setting-answers'));
  assert.match(panel, /<div id="letter-empty" hidden><\/div>/, 'drawn by emptyState, not markup');
  assert.equal((panel.match(/data-letter-usage/g) || []).length, 1, 'the editor\'s line; the empty state carries it as its note');
  assert.doesNotMatch(panel, /id="letter-save"/, 'typed changes go on Profile\'s one save bar');
  assert.match(panel, /preparation kit/);
  const source = fs.readFileSync(new URL('../renderer/pages/base-letter.js', import.meta.url), 'utf8');
  assert.match(source, /emptyState\(\{[\s\S]*label: 'Draft with AI'[\s\S]*label: 'Write my own'[\s\S]*note: usageLine\(\)/);
  assert.match(source, /ai\.id = 'letter-start-ai';[\s\S]*own\.id = 'letter-own';/, 'the ids ⌘K and the tests find');
  assert.match(source, /profileBar\(\)\.register\(\{id: 'base-letter', tab: 'letter'/);
  for (const text of [panel, source]) assert.doesNotMatch(text, /\$\d|\d+\s?s\b|seconds|\$5 credit/, 'no price or duration from the mockup');
  assert.doesNotMatch(panel, /letter-fallback|Use this approved base letter/);
  // Owner, 28 Oct 2026: the overlay's sparkles and pill sat on the letter's text; the shared AI-writing strip sits above the letter instead.
  assert.doesNotMatch(panel, /letter-busy|letter-card-busy/, 'no overlay over the letter');
  assert.match(source, /stop = aiWriting\(editor, \{title:/, 'a draft shows the shared AI-writing state (ai-writing.js)');
});

test('an explicit redraft marks the whole card busy once and restores the approved PDF after failure', async () => {
  globalThis.document.body.replaceChildren();
  const ids = ['setting-letter', 'letter-editor', 'letter-text', 'letter-feedback', 'letter-draft', 'letter-approve', 'letter-pdf', 'letter-state', 'letter-message', 'letter-empty', 'profile-dock'];
  for (const id of ids) globalThis.document.body.append(Object.assign(globalThis.document.createElement(id === 'letter-text' ? 'textarea' : 'div'), {id}));
  const card = globalThis.document.getElementById('setting-letter'), draft = globalThis.document.getElementById('letter-draft');
  card.className = 'setting panel roomy';
  globalThis.document.getElementById('letter-text').setAttribute('data-reads-letter', 'Reading your letter…');
  globalThis.document.getElementById('letter-text').focus = () => { globalThis.document.activeElement = globalThis.document.getElementById('letter-text'); };
  draft.append(globalThis.document.createElement('span'));
  const status = {state: 'approved', text: 'Approved original', pdf: true, approvedAt: '2026-10-27T10:00:00Z'};
  let calls = 0, finish;
  globalThis.window.pilot = {state: async () => ({settings: {letterFallback: false}}), coverLetter: async () => status,
    coverLetterDraft: () => { calls += 1; return new Promise(resolve => { finish = resolve; }); }};
  let confirms = 0;
  globalThis.confirm = () => { confirms += 1; return true; };
  globalThis.window.confirm = () => true;
  const {initLetter, loadLetter} = await import('../renderer/pages/base-letter.js');
  initLetter();
  await loadLetter();
  const text = globalThis.document.getElementById('letter-text');
  text.value = 'Typed working copy that should survive a failed redraft';
  draft.focus = () => { globalThis.document.activeElement = draft; };
  draft.focus();   // a real click moves focus from the editor to the explicit action
  assert.equal((draft.listeners.click || []).length, 1, 'the redraft action is explicitly wired');
  draft.click();
  draft.click();
  await new Promise(resolve => setImmediate(resolve));
  const during = {calls, confirms, busy: text.getAttribute('aria-busy'), strip: globalThis.document.querySelector('.ai-writing-strip')?.textContent || '',
    focus: globalThis.document.activeElement, text: text.value, readOnly: text.readOnly, pdfHidden: globalThis.document.getElementById('letter-pdf').hidden,
    draftDisabled: draft.disabled, pdfDisabled: globalThis.document.getElementById('letter-pdf').disabled};
  finish({ok: false, error: 'Fictional generation failure'});
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(during.confirms, 1, 'the existing replacement confirmation remains in front of drafting');
  assert.equal(during.calls, 1, 'double activation shares the in-flight request');
  assert.equal(during.busy, 'true', 'the letter box is marked busy, not the whole card');
  assert.match(during.strip, /^Writing a new draft · 0:00/, 'the strip says what runs, with its timer');
  assert.equal(during.focus, draft, 'busy treatment does not steal focus from the action');
  assert.equal(during.text, 'Typed working copy that should survive a failed redraft', "the user's text stays visible while generation runs");
  assert.equal(during.readOnly, true, 'typing cannot race the paid request');
  assert.equal(during.pdfHidden, false, 'the approved PDF remains visible during redraft');
  assert.equal(during.draftDisabled, true);
  assert.equal(during.pdfDisabled, true, 'the old PDF cannot be opened as the new draft');
  assert.equal(text.getAttribute('aria-busy'), null);
  assert.equal(globalThis.document.querySelector('.ai-writing-strip'), null, 'the strip goes with the failure');
  assert.match(globalThis.document.getElementById('letter-state').textContent, /^Approved /, 'the card is back to the approved letter it kept');
  assert.equal(Boolean(text.readOnly), false, 'editing is restored after failure');
  assert.equal(globalThis.document.getElementById('letter-pdf').hidden, false, 'a failed redraft keeps the prior approved PDF');
  assert.equal(draft.disabled, false, 'the draft action is restored after failure');
  assert.match(globalThis.document.getElementById('letter-message').textContent, /Fictional generation failure/);
});

test('only the explicit draft action generates and returns an unapproved draft without a PDF', async () => {
  globalThis.document.body.replaceChildren();
  const ids = ['setting-letter', 'letter-editor', 'letter-text', 'letter-feedback', 'letter-draft', 'letter-approve', 'letter-pdf', 'letter-state', 'letter-message', 'letter-empty', 'profile-dock'];
  for (const id of ids) globalThis.document.body.append(Object.assign(globalThis.document.createElement(id === 'letter-text' ? 'textarea' : 'div'), {id}));
  globalThis.document.getElementById('setting-letter').className = 'setting panel roomy';
  globalThis.document.getElementById('letter-text').setAttribute('data-reads-letter', 'Reading your letter…');
  globalThis.document.getElementById('letter-draft').append(globalThis.document.createElement('span'));
  let calls = 0;
  globalThis.window.pilot = {state: async () => ({settings: {}}), coverLetter: async () => ({state: 'approved', text: 'Old approved letter', pdf: true, approvedAt: '2026-10-27T10:00:00Z'}),
    coverLetterDraft: async () => { calls += 1; return {ok: true, state: 'draft', text: 'Fictional new draft', pdf: false}; }};
  globalThis.confirm = () => true;
  globalThis.window.confirm = () => true;
  const {initLetter, loadLetter} = await import('../renderer/pages/base-letter.js');
  initLetter();
  await loadLetter();
  assert.equal(calls, 0, 'opening and reading the card do not generate');
  assert.ok(globalThis.document.getElementById('letter-draft'), 'the approved letter exposes its explicit draft action');
  globalThis.document.getElementById('letter-draft').click();
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(calls, 1, 'the explicit action makes one request');
  assert.equal(globalThis.document.getElementById('letter-text').value, 'Fictional new draft');
  assert.match(globalThis.document.getElementById('letter-state').textContent, /Draft/);
  assert.equal(globalThis.document.getElementById('letter-pdf').hidden, true);
  assert.equal(globalThis.document.getElementById('letter-approve').disabled, false, 'approval remains an explicit next step');
  assert.equal(globalThis.document.getElementById('setting-letter').getAttribute('aria-busy'), null);
});

// The card's elements, fresh for a test (the ids pages/base-letter.js reads).
function freshCard() {
  const doc = globalThis.document;
  doc.body.replaceChildren();
  for (const id of ['setting-letter', 'letter-editor', 'letter-text', 'letter-feedback', 'letter-draft', 'letter-approve', 'letter-pdf', 'letter-state', 'letter-message', 'letter-empty', 'profile-dock']) {
    doc.body.append(Object.assign(doc.createElement(id === 'letter-text' ? 'textarea' : 'div'), {id}));
  }
  doc.getElementById('letter-text').setAttribute('data-reads-letter', 'Reading your letter…');
  doc.getElementById('letter-draft').append(doc.createElement('span'));
  globalThis.confirm = () => true;
  return id => doc.getElementById(id);
}
const settle = () => new Promise(resolve => setImmediate(resolve));

// The owner's shot (28 Oct 2026): an approved letter, "Approved ✓ …" under the buttons from the approve, then Redraft with AI. The card kept saying
// Approved while a new draft was written, and the old letter read as the result.
test("the owner's redraft: nothing on the card says Approved while the AI writes; the old letter stays until the new one lands", async () => {
  const $ = freshCard();
  let finish;
  globalThis.window.pilot = {state: async () => ({settings: {}}), coverLetter: async () => ({state: 'draft', text: 'Fictional letter', pdf: false}),
    coverLetterApprove: async () => ({ok: true, state: 'approved', text: 'Fictional letter', pdf: true, approvedAt: '2026-10-28T17:40:00Z'}),
    coverLetterDraft: () => new Promise(resolve => { finish = resolve; })};
  const {initLetter, loadLetter} = await import('../renderer/pages/base-letter.js');
  initLetter();
  await loadLetter();
  $('letter-approve').click();
  await settle();
  assert.match($('letter-message').textContent, /^Approved ✓/, 'the owner approved first: the line under the buttons says so');
  $('letter-draft').click();
  await settle();
  assert.doesNotMatch(globalThis.document.body.textContent, /Approved/, 'neither the pill nor the line under the buttons says Approved while it writes');
  assert.equal($('letter-state').textContent, 'Writing…');
  assert.match(globalThis.document.querySelector('.ai-writing-strip').textContent, /^Writing a new draft · 0:00Your current letter stays until the new one is ready\.$/);
  assert.equal($('letter-text').value, 'Fictional letter', 'the old letter is kept while the new one is written');
  assert.match($('letter-text').className, /\bis-ai-writing\b/, 'and shown faded (ai-writing.css)');
  assert.equal($('letter-draft').getAttribute('aria-busy'), 'true');
  assert.equal($('letter-draft').querySelector('span').textContent, 'Writing…');
  assert.equal($('letter-feedback').disabled, true, 'a change asked now would not reach this draft');
  finish({ok: true, state: 'draft', text: 'Fictional new draft', pdf: false});
  await settle();
  assert.equal(globalThis.document.querySelector('.ai-writing-strip'), null);
  assert.equal($('letter-text').value, 'Fictional new draft');
  assert.doesNotMatch($('letter-text').className, /is-ai-writing/);
  assert.match($('letter-state').textContent, /^Draft/);
  assert.match($('letter-message').textContent, /^Here is a draft/);
  assert.equal($('letter-draft').getAttribute('aria-busy'), null);
  assert.equal($('letter-feedback').disabled, false);
});

test('a kept draft being redrafted: Approve stays locked until the new draft lands (a press would approve the old text under the new one)', async () => {
  const $ = freshCard();
  let finish;
  globalThis.window.pilot = {state: async () => ({settings: {}}), coverLetter: async () => ({state: 'draft', text: 'Fictional draft', pdf: false}),
    coverLetterApprove: async () => ({ok: true, state: 'approved', text: 'Fictional draft', pdf: true}),
    coverLetterDraft: () => new Promise(resolve => { finish = resolve; })};
  const {initLetter, loadLetter} = await import('../renderer/pages/base-letter.js');
  initLetter();
  await loadLetter();
  assert.equal($('letter-approve').disabled, false, 'a kept draft can be approved');
  $('letter-draft').click();
  await settle();
  assert.equal($('letter-approve').disabled, true, 'not while the new draft is written');
  finish({ok: true, state: 'draft', text: 'Fictional new draft', pdf: false});
  await settle();
  assert.equal($('letter-approve').disabled, false, 'and open again once it landed');
});

test('a first draft from the empty state: the editor opens on letter-shaped skeleton lines under the strip; a failure brings the empty state back', async () => {
  const $ = freshCard();
  let finish;
  globalThis.window.pilot = {state: async () => ({settings: {}}), coverLetter: async () => ({state: 'none', text: '', pdf: false}),
    coverLetterDraft: () => new Promise(resolve => { finish = resolve; })};
  const {initLetter, loadLetter} = await import('../renderer/pages/base-letter.js');
  initLetter();
  await loadLetter();
  assert.equal($('letter-editor').hidden, true, 'no letter yet: the empty state with its two choices');
  $('letter-start-ai').click();
  await settle();
  assert.equal($('letter-editor').hidden, false, 'the editor shows while the first draft is written');
  assert.equal($('letter-empty').hidden, true);
  assert.match(globalThis.document.querySelector('.ai-writing-strip').textContent, /^Writing your first draft · 0:00/);
  assert.ok(globalThis.document.querySelector('.ai-writing-bones'), 'the letter\'s shape in skeleton lines, not an empty box');
  assert.equal($('letter-text').hidden, true);
  assert.equal($('letter-state').textContent, 'Writing…');
  finish({ok: false, error: 'Fictional generation failure'});
  await settle();
  assert.equal(globalThis.document.querySelector('.ai-writing-bones'), null);
  assert.equal($('letter-text').hidden, false);
  assert.equal($('letter-editor').hidden, true, 'nothing was written: the empty state again');
  assert.equal($('letter-state').textContent, 'Not created');
  assert.match($('letter-message').textContent, /Fictional generation failure/);
});
