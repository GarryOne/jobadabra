// What the window says the AI is called follows the engine the user chose (owner, 9 Oct 2026: "handle all the Claude hard-coded in the UI"):
// renderer/ai-name.js and lib/ai/names.js give one name and model per engine, and a ratchet fails on a NEW hard-coded generic "Claude" in the
// window or the main process. What stays "Claude" is Claude-only: Apply/Read with Claude sessions, Claude Code's own texts, the Claude plan.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {test} from 'node:test';
import {fileURLToPath} from 'node:url';
import * as windowNames from '../renderer/ai-name.js';
import * as appNames from '../lib/ai/names.js';
import {TIERS} from '../lib/ai/models.js';
import {ENGINES} from '../lib/ai/index.js';

const here = path.dirname(fileURLToPath(import.meta.url)), root = path.join(here, '..');

test('one name and one model per engine, in the window and the main process, matching the model tiers', () => {
  assert.deepEqual(windowNames.NAMES, appNames.NAMES);
  assert.deepEqual(windowNames.MODELS, appNames.MODELS);
  const label = id => id.replace(/^gpt-/, 'GPT-').replace(/-([a-z])/g, (_, c) => ` ${c.toUpperCase()}`).replace(/^claude ([a-z])/i, (_, c) => `Claude ${c.toUpperCase()}`);
  for (const tier of ['small', 'main', 'big']) {
    assert.equal(windowNames.MODELS.openai[tier], label(TIERS[tier].openai), tier);
    assert.match(TIERS[tier].claude, new RegExp(windowNames.MODELS.claude[tier].split(' ')[1].toLowerCase()), tier);
  }
  assert.equal(windowNames.ai('{AI} is reviewing ({AI:big})', 'codex'), 'Codex is reviewing (GPT-6.1 Sol)');
  assert.equal(windowNames.ai('{AI} read it with {AI:main}', 'cli'), 'Claude read it with Claude Sonnet');
  assert.equal(windowNames.ai('{AI}', 'openai'), 'OpenAI');
  assert.equal(windowNames.claudeFeatures('openai'), false);
  assert.equal(windowNames.claudeFeatures('cli'), true);
  const store = engine => ({settings: () => ({aiEngine: engine}), secret: () => ''});
  assert.equal(appNames.aiText(store('codex'), '{AI} answered with {AI:small}'), 'Codex answered with GPT-6 Luna');
  assert.equal(appNames.nameOfClient({engine: 'openai'}), 'OpenAI');
  assert.equal(appNames.nameOfClient({}), 'Claude');
});

// Every engine the chooser offers (the four adapters + Free AI) has a name and models in both files, and none falls back to "Claude" (owner, 24 Oct 2026).
test('every chooser engine, Free AI included, has a name and model names; an unknown engine reads "AI", never "Claude"', () => {
  for (const engine of [...Object.keys(ENGINES), 'free']) {
    assert.ok(windowNames.NAMES[engine], `renderer/ai-name.js NAMES.${engine}`);
    assert.ok(appNames.NAMES[engine], `lib/ai/names.js NAMES.${engine}`);
  }
  assert.equal(windowNames.ai('{AI} is filling the application', 'free'), 'Free AI is filling the application');
  assert.equal(windowNames.ai('{AI:big}', 'free'), 'Free AI');
  assert.equal(windowNames.ai('{AI}', 'unknown'), 'AI');
  assert.equal(appNames.nameOfClient({engine: 'nope'}), 'AI');
  const store = settings => ({settings: () => settings, secret: () => ''});
  assert.equal(appNames.aiText(store({aiFree: true}), '{AI} answered'), 'Free AI answered');
  assert.equal(appNames.aiText(store({aiTrial: true}), '{AI} answered'), 'Free AI answered');
  assert.equal(appNames.aiText(store({aiFree: true, aiEngine: 'cli'}), '{AI}'), 'Claude', 'a later pick of another engine wins over a stale Free flag');
  assert.equal(appNames.aiText(store({}), '{AI} is filling the application'), 'AI is filling the application', 'nothing chosen, no key: generic');
  assert.equal(windowNames.ai('{AI} is filling ({AI:big})', 'none'), 'AI is filling (AI)');
  assert.equal(windowNames.engineNamed(undefined, {}, false), 'none');
  assert.equal(windowNames.engineNamed(undefined, {}, true), 'api');
  assert.equal(windowNames.engineNamed('api', {aiFree: true}), 'free');
  assert.equal(windowNames.engineNamed(undefined, {aiTrial: true}), 'free');
  assert.equal(windowNames.engineNamed('codex', {aiFree: true}), 'codex');
  assert.equal(appNames.nameOfClient({engine: 'api', sdk: {apiKey: 'JPF1.abc.def'}}), 'Free AI');
  assert.equal(appNames.nameOfClient({engine: 'api', sdk: {apiKey: 'sk-ant-1'}}), 'Claude');
});

// The extension's panel and popup texts have no engine to name: they say "AI". Generic "Claude" strings there may only shrink (decision logs and
// Claude-only takeover texts: panel-claude.js).
const ALLOWED_EXT = {'extension/panel-claude.js': 6, 'extension/flow.js': 2, 'extension/fill-tab-inputs.js': 1, 'extension/fill-tab-finish.js': 4, 'extension/fill-flow-steps.js': 2, 'extension/messages-panel.js': 2, 'extension/background.js': 1, 'extension/visit.js': 1};
test('no new hard-coded generic "Claude" in the extension (the panel, popup and progress lines say "AI")', () => {
  const dir = path.join(root, '..', 'extension'), found = {};
  for (const f of fs.readdirSync(dir).filter(f => f.endsWith('.js'))) {
    for (const line of fs.readFileSync(path.join(dir, f), 'utf8').split('\n')) {
      if (/^\s*(\/\/|\*)/.test(line)) continue;
      for (const m of line.replace(/\/\/ .*$/, '').matchAll(/(['"`])((?:(?!\1).)*\bClaude\b(?:(?!\1).)*)\1/g)) if (!SPECIFIC.test(m[2])) found[`extension/${f}`] = (found[`extension/${f}`] || 0) + 1;
    }
  }
  const over = Object.entries(found).filter(([file, n]) => n > (ALLOWED_EXT[file] || 0)).map(([file, n]) => `${file}: ${n} (allowed ${ALLOWED_EXT[file] || 0})`);
  assert.deepEqual(over, []);
});

// Files allowed to say "Claude" in a string, and how many times: Claude-only features. May only shrink; a new file or a higher count fails.
const ALLOWED = {
  'renderer/pages/sessions.js': 3, 'renderer/pages/session-next-step.js': 5, 'renderer/pages/activity-visits.js': 9, 'lib/ai/names.js': 8, 'renderer/ai-name.js': 7,
  'renderer/index.html': 3, 'lib/quit-dialog.js': 4,  'renderer/pages/jobs-render.js': 3, 'lib/session-runs.js': 3,
  'renderer/pages/session-needs.js': 2, 'renderer/ai-engine-view.js': 2, 'lib/terminals.js': 2, 'lib/session-flow.js': 2,
  'renderer/pages/session-actions.js': 1, 'renderer/pages/claude-prereqs.js': 1, 'lib/transcript.js': 1, 'lib/session-stats.js': 1, 'lib/run-result.js': 1,
  'lib/claude-session.js': 1, 'lib/apply-handlers.js': 1, 'lib/ladder/rung5-takeover.js': 2, 'lib/ladder/rung5-takeover-teach.js': 1, 'renderer/claude-offer.js': 6, 'lib/app-reminders.js': 1, 'lib/ai/claude-code-cli.js': 1,
};
const SPECIFIC = /Claude Code|Claude in Chrome|with Claude|claude\.ai|Claude\.ai|Claude (?:subscription|plan|account|Desktop|session)|(?:Resume|Pause|Stop|Tell|Send (?:it |all \S+ )?to|Starting|Use) Claude|Claude'?s? (?:full )?report|\{AI/;

test('no new hard-coded generic "Claude" in what the window shows or the main process says (use {AI} and ai()/aiText())', () => {
  const found = {};
  const files = ['renderer', 'lib'].flatMap(dir => fs.readdirSync(path.join(root, dir), {recursive: true}).map(f => path.join(dir, f).split(path.sep).join('/')))
    .filter(f => /\.(js|html)$/.test(f) && !f.includes('gallery'));
  for (const file of files) {
    for (const line of fs.readFileSync(path.join(root, file), 'utf8').split('\n')) {
      if (/^\s*(\/\/|\*|<!--)/.test(line)) continue;
      const code = line.replace(/\/\/ .*$/, '').replace(/<span data-ai[^>]*>[^<]*<\/span>/g, '');   // a data-ai span is filled with the chosen name
      for (const m of code.matchAll(/(['"`])((?:(?!\1).)*\bClaude\b(?:(?!\1).)*)\1|>([^<]*\bClaude\b[^<]*)</g)) {
        if (!SPECIFIC.test(m[2] ?? m[3])) found[file] = (found[file] || 0) + 1;
      }
    }
  }
  const over = Object.entries(found).filter(([file, n]) => n > (ALLOWED[file] || 0)).map(([file, n]) => `${file}: ${n} (allowed ${ALLOWED[file] || 0})`);
  assert.deepEqual(over, [], 'write {AI} through ai() (window) or aiText()/nameOfClient() (main process); Claude-only features keep "Claude"');
});

test('Claude-only features exist only with a Claude engine, in every main-process gate: the panel\'s Take over, starting, the consent question, the session flow', () => {
  const store = engine => ({settings: () => (engine ? {aiEngine: engine} : {}), secret: () => ''});
  assert.equal(appNames.claudeFamily(store('codex')), false);
  assert.equal(appNames.claudeFamily(store('openai')), false);
  assert.equal(appNames.claudeFamily(store('cli')), true);
  assert.equal(appNames.claudeFamily(store('')), true, 'nothing chosen: Claude, as before');
  // Every place the main process decides about Claude asks the family too (a new gate without it fails here).
  const source = file => fs.readFileSync(path.join(root, file), 'utf8');
  const main = source('main.js'), server = source('lib/ext-server-handlers.js');
  assert.match(server, /claudeHelp: takeoverOffered\(storage\), claudeTakeover: SHOW_RESUME_CLAUDE, claudeAlways: SHOW_RESUME_CLAUDE && !!storage\.settings\(\)\.claudeAuto, claudeAuto: claudeAutoStart\(storage\)/);   // lib/claude-ready.js asks the family itself
  assert.match(main, /const startClaude = async \(url, details = null\) => !claudeFamily\(storage\)/);
  assert.match(main, /claudeAllowed: \(\) => takeoverOffered\(storage\)/);
  assert.match(main, /async function claudeConsent\(\) \{\n  if \(!claudeFamily\(storage\)\) return false;/);
  const gates = [...main.matchAll(/storage\.settings\(\)\.claudeConsent/g)].length + [...server.matchAll(/storage\.settings\(\)\.claudeConsent/g)].length;
  assert.equal(gates, 2, 'main.js\'s consent question + the panel\'s consent flag (ext-server-handlers.js, only reported, never a gate): a new read of the Claude switch in the main process must also ask claudeFamily(storage)');
});
