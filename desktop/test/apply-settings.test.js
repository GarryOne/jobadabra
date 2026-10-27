// Settings → Apply (owner, 26 Oct 2026, hybrid fill step 2): the model (modes, answers, Full automation checks with defaults), the tab's markup with every
// applying setting in one place, and its ⌘K entries. The gate and the first-Apply dialog's wiring: test/apply-choice-gate.test.js.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {test} from 'node:test';
import {AUTO_DEFAULTS, MODES, MODE_TODAY, applyChosen, applyOf, applyPatch} from '../renderer/apply-settings-model.js';

const here = path.resolve(import.meta.dirname, '..');
const html = fs.readFileSync(path.join(here, 'renderer/index.html'), 'utf8');
const page = name => { const at = html.indexOf(`data-settings-page="${name}"`); return html.slice(at, html.indexOf('data-settings-page="', at + 10)); };

test('nothing saved: Standard automation, facts only, the owner\'s defaults, not chosen', () => {
  assert.deepEqual(applyOf({}), {mode: 'check', answers: 'facts', auto: {minFit: 80, noEmpty: true, factsOnly: true, perDay: 20, perEmployer: 1, waitMin: 10}, chosenAt: ''});
  assert.deepEqual(AUTO_DEFAULTS, applyOf(undefined).auto);
  assert.equal(applyChosen({}), false);
  assert.equal(applyChosen({apply: {mode: 'check'}}), false, 'a mode saved from Settings without Confirm is not the choice');
});

test('a change keeps the rest; numbers stay in range; Confirm stamps the choice', () => {
  const now = new Date('2026-10-26T10:00:00Z');
  const one = applyPatch({}, {mode: 'auto', auto: {perDay: '500'}});
  assert.equal(one.apply.mode, 'auto');
  assert.equal(one.apply.auto.perDay, 200, 'clamped');
  assert.equal(one.apply.auto.minFit, 80, 'the other checks kept');
  assert.equal(one.apply.chosenAt, '');
  const two = applyPatch({apply: one.apply}, {auto: {noEmpty: false, minFit: 'x'}}, {chosen: true, now});
  assert.equal(two.apply.mode, 'auto');
  assert.equal(two.apply.auto.noEmpty, false);
  assert.equal(two.apply.auto.minFit, 80, 'not a number: the default');
  assert.equal(two.apply.chosenAt, now.toISOString());
  assert.equal(applyChosen(two), true);
  assert.equal(applyOf({apply: {mode: 'nonsense', answers: 'nonsense'}}).mode, 'check');
});

test('three modes; the two that come later say what happens until then', () => {
  assert.deepEqual(MODES.map(mode => mode.id), ['check', 'fill', 'auto']);
  assert.deepEqual(MODES.map(mode => mode.title), ['Standard automation', 'Background automation', 'Full automation']);
  assert.deepEqual(MODES.map(mode => mode.text), [
    'Fills in a visible browser; you review and submit.',
    'Fills in a hidden browser; you review and submit when ready.',
    'Fills and submits in a hidden browser when your checks pass.',
  ]);
  assert.equal(MODE_TODAY.check, '');
  for (const id of ['fill', 'auto']) assert.match(MODE_TODAY[id], /coming update[\s\S]*opens in a tab/);
  assert.match(MODES.find(mode => mode.id === 'auto').text, /hidden browser when your checks pass/i);
});

test('every applying setting is on the Apply tab, and nowhere else', () => {
  const apply = page('apply');
  for (const id of ['setting-apply-mode', 'setting-apply-answers', 'setting-consent', 'setting-claude', 'setting-apply-auto', 'apply-confirm-bar']) assert.ok(apply.includes(`id="${id}"`), id);
  assert.ok(!page('automation').includes('setting-claude'));
  assert.ok(!page('advanced').includes('setting-consent'));
  const settings = html.slice(html.indexOf('data-view="settings"'), html.indexOf('data-settings-page="logs"'));
  assert.equal((settings.match(/data-assistant-mode="full"/g) || []).length, 1, 'one accounts choice in Settings (the setup wizard asks the same setting)');
});

test('⌘K lists the Apply page and each of its cards (read from the page by nav.js)', () => {
  assert.match(html, /<button data-settings-go="apply"><i data-icon="send"><\/i>Apply<\/button>/);
  const nav = fs.readFileSync(path.join(here, 'renderer/pages/nav.js'), 'utf8');
  assert.match(nav, /querySelectorAll\('\[data-settings-go\]'\)/);
  assert.match(nav, /querySelectorAll\('\[data-settings-page\] \.setting\[id\]'\)/);
  for (const id of ['setting-apply-mode', 'setting-apply-answers', 'setting-apply-auto']) {
    assert.match(page('apply'), new RegExp(`class="setting panel" id="${id}"[^>]*>\\s*<div class="summary-head"><i data-icon="\\w+"></i><h3>`), `${id} has the heading ⌘K names it by`);
  }
});
