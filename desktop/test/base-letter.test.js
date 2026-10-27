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
  assert.match(panel, /id="letter-busy" hidden role="status" aria-live="polite"/);
  assert.match(panel, /aria-atomic="true" aria-label="Cover letter draft status"/);
  const styles = fs.readFileSync(new URL('../renderer/style.css', import.meta.url), 'utf8');
  assert.match(styles, /\.letter-card-busy \{[^}]*position: absolute;[^}]*pointer-events: auto/);
  assert.match(styles, /prefers-reduced-motion: reduce\) \{\s*\.letter-card-busy::before, \.letter-busy-sparkles \.icon \{ animation: none;/);
});

test('an explicit redraft marks the whole card busy once and restores the approved PDF after failure', async () => {
  globalThis.document.body.replaceChildren();
  const ids = ['setting-letter', 'letter-editor', 'letter-text', 'letter-feedback', 'letter-draft', 'letter-approve', 'letter-pdf', 'letter-state', 'letter-message', 'letter-empty', 'letter-busy', 'profile-dock'];
  for (const id of ids) globalThis.document.body.append(Object.assign(globalThis.document.createElement(id === 'letter-text' ? 'textarea' : 'div'), {id}));
  const card = globalThis.document.getElementById('setting-letter'), draft = globalThis.document.getElementById('letter-draft');
  globalThis.document.getElementById('letter-busy').append(Object.assign(globalThis.document.createElement('span'), {className: 'letter-busy-copy'}));
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
  const during = {calls, confirms, busy: card.getAttribute('aria-busy'), overlayHidden: globalThis.document.getElementById('letter-busy').hidden,
    focus: globalThis.document.activeElement, text: text.value, readOnly: text.readOnly, pdfHidden: globalThis.document.getElementById('letter-pdf').hidden,
    draftDisabled: draft.disabled, pdfDisabled: globalThis.document.getElementById('letter-pdf').disabled};
  finish({ok: false, error: 'Fictional generation failure'});
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(during.confirms, 1, 'the existing replacement confirmation remains in front of drafting');
  assert.equal(during.calls, 1, 'double activation shares the in-flight request');
  assert.equal(during.busy, 'true');
  assert.equal(during.overlayHidden, false);
  assert.equal(during.focus, draft, 'busy treatment does not steal focus from the action');
  assert.equal(during.text, 'Typed working copy that should survive a failed redraft', "the user's text stays visible while generation runs");
  assert.equal(during.readOnly, true, 'typing cannot race the paid request');
  assert.equal(during.pdfHidden, false, 'the approved PDF remains visible during redraft');
  assert.equal(during.draftDisabled, true);
  assert.equal(during.pdfDisabled, true, 'the old PDF cannot be opened as the new draft');
  assert.equal(card.getAttribute('aria-busy'), null);
  assert.equal(globalThis.document.getElementById('letter-busy').hidden, true);
  assert.equal(Boolean(text.readOnly), false, 'editing is restored after failure');
  assert.equal(globalThis.document.getElementById('letter-pdf').hidden, false, 'a failed redraft keeps the prior approved PDF');
  assert.equal(draft.disabled, false, 'the draft action is restored after failure');
  assert.match(globalThis.document.getElementById('letter-message').textContent, /Fictional generation failure/);
});

test('only the explicit draft action generates and returns an unapproved draft without a PDF', async () => {
  globalThis.document.body.replaceChildren();
  const ids = ['setting-letter', 'letter-editor', 'letter-text', 'letter-feedback', 'letter-draft', 'letter-approve', 'letter-pdf', 'letter-state', 'letter-message', 'letter-empty', 'letter-busy', 'profile-dock'];
  for (const id of ids) globalThis.document.body.append(Object.assign(globalThis.document.createElement(id === 'letter-text' ? 'textarea' : 'div'), {id}));
  globalThis.document.getElementById('setting-letter').className = 'setting panel roomy';
  globalThis.document.getElementById('letter-busy').append(Object.assign(globalThis.document.createElement('span'), {className: 'letter-busy-copy'}));
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
