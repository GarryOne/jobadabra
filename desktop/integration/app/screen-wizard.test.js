/* global document, window */
// Setup wizard and the Notion prompt, layer 2: the AI step with each engine to choose from, and what Focus and Interviews show with and without Notion. Moved from the e2e `wizard`
// suite (1 Nov 2026) to the app's demo window, started as a new install (no keys, setup not done). The demo blocks the actions that reach outside (lib/demo.js BLOCKED: checking or
// saving a key, Free AI), so what a key does is tested beside it on the real handlers (setup-ai-handlers.test.js). What STAYS in e2e: the wizard's journey (welcome, key saved,
// CV read, strategy built, finish, Jobs on Find jobs, the store set once) and "a Notion token connects" (a real Notion page).
import assert from 'node:assert/strict';
import {before, test} from 'node:test';
import {needsElectron} from '../../test/needs-electron.js';
import {probeWindow} from './window-probe.js';

const live = {skip: needsElectron.skip};
const NEW_INSTALL = {files: {'secrets.json': {}}, settings: {setupDone: false, wizardStep: 'welcome', notionIds: {}}};
const NO_NOTION = store => ({files: {'secrets.json': {}}, settings: {store, notionIds: {}}});
let ai, sqlite, notion;

before(() => {
  if (needsElectron.skip) return;
  ai = probeWindow({...NEW_INSTALL, timeout: 180000, script: async kit => {
    const step = () => [...document.querySelectorAll('.step')].find(node => !node.hidden)?.dataset.step;
    const card = id => document.querySelector(`[data-choice="${id}"]`);
    const shown = id => !!card(id)?.offsetParent;
    const state = () => window.pilot.state();
    const toStep = async name => kit.until(() => step() === name, `the ${name} step (now ${step()})`);
    const save = () => document.getElementById('ai-save');
    // The notice shows only the first time an own engine is chosen; it is answered when it is there.
    const confirm = async () => { const yes = document.querySelector('[data-notice="yes"]'); if (yes?.offsetParent) yes.click(); };
    const enabled = async id => { await kit.until(() => !save().disabled, `Continue to be enabled for ${id}`); };
    const again = async () => { document.querySelector('#step-list li[data-step="ai"]').click(); await toStep('ai'); };
    const out = {};
    await kit.until(() => document.querySelector('.step[data-step="welcome"]:not([hidden])'), 'the welcome step');
    out.welcome = !!document.querySelector('.step[data-step="welcome"] [data-next]');
    document.querySelector('.step[data-step="welcome"] [data-next]').click();
    await toStep('ai');
    out.start = ['free', 'family-claude', 'family-openai'].map(shown);
    document.querySelector('[data-choice="family-openai"]').click();
    await kit.until(() => shown('codex') && shown('openai'), 'the two OpenAI cards');
    out.openai = ['codex', 'openai'].map(shown);
    card('codex').click(); await confirm(); await enabled('codex');
    save().click(); await toStep('cv');
    out.codex = {engine: (await state()).settings.aiEngine, step: step()};
    await again();
    card('family-claude').click();
    await kit.until(() => shown('cli'), 'the Claude cards');
    card('cli').click(); await confirm(); await enabled('cli');
    save().click(); await toStep('cv');
    out.cli = {engine: (await state()).settings.aiEngine, step: step()};
    await again();
    card('free').click(); await enabled('free');
    out.free = {button: save().textContent.trim(), note: !document.getElementById('ai-free').hidden};
    card('family-claude').click();
    await kit.until(() => shown('api'), 'the API key card');
    card('api').click();
    await kit.until(() => document.getElementById('anthropic-key')?.offsetParent, 'the key box');
    out.noKey = {disabled: save().disabled, step: step()};
    const key = document.getElementById('anthropic-key');
    key.value = 'sk-ant-not-a-real-key'; key.dispatchEvent(new window.Event('input', {bubbles: true}));
    await enabled('api');
    save().click();
    await kit.until(() => document.getElementById('ai-message')?.textContent.trim() && !save().disabled, 'the key check to answer');
    const after = await state();
    out.rejected = {step: step(), message: document.getElementById('ai-message').textContent.trim(), secret: !!after.secrets.ANTHROPIC_API_KEY, engine: after.settings.aiEngine};
    return out;
  }});
  const focusAndInterviews = store => probeWindow({...NO_NOTION(store), timeout: 180000, script: async kit => {
    await kit.until(() => document.querySelector('.nav[data-view=focus]:not([hidden])'), 'the menu');
    const out = {};
    await kit.go('focus');
    const focus = document.querySelector('.view[data-view="focus"]');
    await kit.until(() => document.querySelector('#focus-onboarding')?.offsetParent || focus.querySelector('.focus-item'), 'Focus content');
    out.focus = {gate: !!focus.querySelector('.ui-gate'), started: focus.classList.contains('focus-started'), onboarding: !!document.querySelector('#focus-onboarding')?.offsetParent};
    await kit.go('interviews');   // not in the menu until used: opened as the More row / ⌘K does
    const interviews = document.querySelector('.view[data-view="interviews"]');
    await kit.until(() => document.querySelector('#iv-add')?.offsetParent || interviews.querySelector('.ui-gate'), 'Interviews content');
    out.interviews = {add: !!document.querySelector('#iv-add')?.offsetParent, gate: !!interviews.querySelector('.ui-gate'), dialog: !!document.querySelector('#notion-connect-dialog[open]')};
    if (!out.interviews.gate) return out;
    interviews.querySelector('.ui-gate button.primary').click();
    await kit.until(() => document.querySelector('#notion-connect-dialog[open]'), 'the connect prompt');
    out.prompt = {benefits: document.querySelectorAll('#notion-connect-benefits li').length, reason: document.querySelector('#notion-connect-reason').innerText};
    document.getElementById('notion-connect-later').click();
    await kit.until(() => !document.getElementById('notion-connect-why').hidden, 'the reasons for Not now');
    [...document.querySelectorAll('#notion-connect-why .ui-tag')].find(chip => chip.textContent.includes('Privacy')).click();
    await kit.until(() => !document.querySelector('#notion-connect-dialog[open]'), 'the prompt to close');
    out.closed = true;
    return out;
  }});
  sqlite = focusAndInterviews('sqlite');
  notion = focusAndInterviews('notion');
});

test('Start opens the AI step with both engines to choose from', live, () => {
  assert.equal(ai.result.welcome, true);
  assert.deepEqual(ai.result.start, [true, true, true], 'Free, Claude and OpenAI cards (free, family-claude, family-openai)');
});

test('the OpenAI side of the switch shows its two cards', live, () => {
  assert.deepEqual(ai.result.openai, [true, true], 'Codex and the OpenAI API key');
});

test('Codex is chosen (confirmed once, then checked) and the AI step continues', live, () => {
  assert.deepEqual(ai.result.codex, {engine: 'codex', step: 'cv'});
});

test('Claude Code is chosen (confirmed once, then checked) and the AI step continues', live, () => {
  assert.deepEqual(ai.result.cli, {engine: 'cli', step: 'cv'});
});

test('Free AI is chosen and the AI step offers to continue on it', live, () => {
  assert.deepEqual(ai.result.free, {button: 'Use Free AI', note: true});   // what Free AI does once pressed: setup-ai-handlers.test.js
});

test('the AI step will not continue without a key', live, () => {
  assert.deepEqual(ai.result.noKey, {disabled: true, step: 'ai'});
});

test('a key the check refuses is shown in words and never saved', live, () => {
  const {step, message, secret, engine} = ai.result.rejected;
  assert.equal(step, 'ai', 'the step moved on after a refused key');
  assert.match(message, /Demo mode: nothing is sent/, 'the check\'s answer is not shown to the person');   // the demo refuses every check; the real wording is tested on the handler
  assert.equal(secret, false, 'the refused key was saved');
  assert.notEqual(engine, 'api', 'the engine was switched to the key that was refused');
});

test("on this Mac's store no page asks to connect Notion: Focus and Interviews open their own content", live, () => {
  assert.deepEqual(sqlite.result.focus.gate, false);
  assert.deepEqual(sqlite.result.interviews, {add: true, gate: false, dialog: false});
});

test('Focus shows Get started without Notion; Interviews asks to connect Notion, lists the advantages, and Not now with a reason closes the prompt', live, () => {
  assert.equal(notion.result.focus.gate, false, 'Focus shows the Notion prompt instead of Get started');
  assert.deepEqual([notion.result.focus.started, notion.result.focus.onboarding], [true, true]);
  assert.deepEqual(notion.result.interviews, {add: false, gate: true, dialog: false});
  assert.equal(notion.result.prompt.benefits, 6);
  assert.match(notion.result.prompt.reason, /Connect Notion to keep interview transcripts\./);
  assert.equal(notion.result.closed, true);
});
