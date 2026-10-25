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
globalThis.window.pilot = new Proxy({}, {get: () => async () => ({})});
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
  assert.match(source, /show\(\$\('letter-fallback-row'\), saved\.state === 'approved'\)/, 'the forms switch only for an approved letter');
});
