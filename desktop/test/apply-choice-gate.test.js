// The first-Apply choice (owner, 26 Oct 2026, hybrid fill step 2): until the person chose how Jobadabra applies (Settings → Apply), every way to start
// or reopen a fill answers {needsApplyChoice} and opens nothing; the window shows "How should Jobadabra apply for you?" and runs the pressed action again.
// The class: one wrapper on the app's ipcMain gates every action in APPLY_ACTIONS; a new handler that starts a fill without being listed fails here.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {test} from 'node:test';
import {APPLY_ACTIONS, NOT_GATED, guard, handlerBodies, STARTS_A_FILL} from '../lib/apply-choice-gate.js';
import {registerApplyHandlers} from '../lib/apply-handlers.js';
import {registerSessionHandlers} from '../lib/session-handlers.js';
import {registerReadyHandlers} from '../lib/ready-handlers.js';
import {useKeychainReader} from '../lib/ready-site.js';
import * as terminals from '../lib/terminals.js';

const here = path.resolve(import.meta.dirname, '..');
const HANDLER_FILES = ['lib/apply-handlers.js', 'lib/session-handlers.js', 'lib/ready-handlers.js'];

// Every handler file, registered on one gated ipcMain as main.js does; `started` lists any fill that began.
function registerAll(settings) {
  const handles = new Map(), started = [];
  let saved = settings;
  const storage = {settings: () => saved, saveSettings: patch => { saved = {...saved, ...patch}; return saved; }, secret: () => null, path: name => path.join('/nonexistent', name)};
  const ipcMain = {handle: guard((name, fn) => handles.set(name, fn), () => storage)};
  const spy = name => (...args) => { started.push(name); return {ok: true, args}; };
  registerApplyHandlers({DEMO: false, extensionGate: () => null, allowanceBlock: () => null, needsNotion: () => null, claudeConsent: async () => true,
    ipcMain, log: () => {}, here, storage, toWindow: () => {}, track: () => {}, shell: {}, prepareKitFor: async () => ({}), startClaude: spy('startClaude'), getRecipeReporter: () => null, cloud: {}});
  terminals._reset();
  terminals.usePty(async () => ({spawn: () => ({onData: () => {}, onExit: () => {}, write: () => {}, resize: () => {}, kill: () => {}})}));
  registerSessionHandlers({ipcMain, appLog: () => {}, storage, getWindow: () => null, here, DEMO: false, extensionGate: () => null, nativeImage: {createFromPath: () => ({})},
    dialog: {showMessageBox: async () => ({response: 0})}, review: {forget: () => {}, tabOf: () => null}, pipeline: {}, server: {}, notion: {}, claudeConsent: async () => true,
    focusTab: async () => 'none', apply: {openOne: spy('openOne'), applyOne: spy('applyOne'), claudeOne: spy('claudeOne'), resumeSession: spy('resumeSession')}});
  useKeychainReader(() => null);
  registerReadyHandlers({ipcMain, storage, shell: {openExternal: spy('openExternal')}, prepare: {kit: spy('kit'), cv: spy('cv')},
    deps: {jobs: async () => { started.push('jobs read'); return []; }, apply: {applyOne: spy('readyApplyOne'), formUrl: url => url}}});
  return {handles, started, storage};
}

test('not chosen yet: every apply action answers "choose first" and starts nothing', async () => {
  const {handles, started} = registerAll({});
  const {id} = terminals.startForm({id: 's1', url: 'https://jobs.example.test/a', company: 'Acme'});
  const args = {apply: [{n: 2, mode: 'chrome'}], applyOne: ['https://jobs.example.test/a', {}], applyWithClaude: ['https://jobs.example.test/a', {}],
    sessionRestart: [id], sessionReopen: [id, false], sessionResume: [id], readySend: [{}], readyRun: [{}], readyOpen: ['a1'], readyAgain: ['a1']};
  assert.deepEqual(Object.keys(args).sort(), [...APPLY_ACTIONS].sort(), 'each listed action is called below');
  for (const name of APPLY_ACTIONS) {
    assert.ok(handles.has(name), `${name} is registered`);
    const result = await handles.get(name)({}, ...args[name]);
    assert.equal(result?.needsApplyChoice, true, `${name} answers the gate`);
    assert.equal(result.ok, false, name);
  }
  assert.deepEqual(started, [], 'nothing opened, sent or read');
});

test('chosen: the same press goes on (positive control)', async () => {
  const {handles, started} = registerAll({apply: {mode: 'check', chosenAt: '2026-10-26T10:00:00Z'}});
  const {id} = terminals.startForm({id: 's2', url: 'https://jobs.example.test/b', company: 'Acme'});
  const result = await handles.get('sessionRestart')({}, id);
  assert.notEqual(result?.needsApplyChoice, true);
  assert.deepEqual(started, ['applyOne']);
});

test('the class: every handler that starts a fill is gated, or named as not gated with a reason', () => {
  const found = [];
  for (const file of HANDLER_FILES) {
    for (const [name, body] of handlerBodies(fs.readFileSync(path.join(here, file), 'utf8'))) if (STARTS_A_FILL.test(body)) found.push(name);
  }
  assert.ok(found.length >= APPLY_ACTIONS.length, `the scan finds the fills (found ${found.join(', ')})`);
  for (const name of found) assert.ok(APPLY_ACTIONS.includes(name) || NOT_GATED[name], `${name} starts a fill: add it to APPLY_ACTIONS (lib/apply-choice-gate.js) or NOT_GATED with why`);
  for (const name of APPLY_ACTIONS) assert.ok(found.includes(name), `${name} is listed but the scan no longer sees it start a fill`);
});

test('main.js puts the gate on the one ipcMain every handler file registers on', () => {
  const main = fs.readFileSync(path.join(here, 'main.js'), 'utf8');
  const at = main.indexOf('ipcMain.handle = applyChoiceGuard(');
  assert.ok(at > 0, 'main.js wraps ipcMain.handle with the gate');
  assert.ok(at < main.indexOf('registerSessionHandlers(') && at < main.indexOf('registerApplyHandlers(') && at < main.indexOf('registerKitHandlers('), 'before any apply handler is registered');
});

test('Ready never sends by itself before the choice', () => {
  assert.match(fs.readFileSync(path.join(here, 'lib/ready-handlers.js'), 'utf8'), /const ownApp = \(\) => applyChosen\(storage\.settings\(\)\) &&/);
});

test('the window: preload holds the pressed call, the dialog opens, and the same call runs after the choice', () => {
  const preload = fs.readFileSync(path.join(here, 'preload.cjs'), 'utf8');
  assert.match(preload, /needsApplyChoice[\s\S]{0,900}pilot-needs-apply-choice/);
  assert.match(preload, /pilot-apply-chosen[\s\S]{0,300}call\(name\)\(\.\.\.args\)/, 'after the choice the same action runs again');
  assert.match(preload, /pilot-apply-not-chosen/);
  const html = fs.readFileSync(path.join(here, 'renderer/index.html'), 'utf8');
  for (const id of ['apply-choice-dialog', 'apply-choice-modes', 'apply-choice-go', 'apply-choice-adjust', 'apply-confirm-bar', 'apply-confirm-go', 'apply-confirm-cancel']) assert.ok(html.includes(`id="${id}"`), id);
  assert.ok(!html.includes('apply-choice-today'), 'the first-Apply dialog has no extra coming-update paragraph');
  assert.ok(!html.includes('You can change this any time in Settings → Apply.'), 'the mode cards stay the concise explanation');
  assert.match(html, /data-settings-go="apply"/);
  assert.match(html, /data-settings-page="apply"/);
  assert.match(fs.readFileSync(path.join(here, 'renderer/app.js'), 'utf8'), /applyChoice\(\)/);
  assert.match(fs.readFileSync(path.join(here, 'renderer/pages/apply-choice.js'), 'utf8'), /modeCards\(pick,/);
  assert.doesNotMatch(fs.readFileSync(path.join(here, 'renderer/pages/apply-choice.js'), 'utf8'), /dialog:\s*true/);
});

test('every window caller of an apply action stays quiet on Not now ({cancelled}), so no "Try again" follows the person\'s own choice', () => {
  const files = fs.readdirSync(path.join(here, 'renderer'), {recursive: true}).filter(file => file.endsWith('.js') && !file.startsWith('gallery'));
  const calls = [];
  for (const file of files) {
    const source = fs.readFileSync(path.join(here, 'renderer', file), 'utf8');
    for (const match of source.matchAll(new RegExp(`window\\.pilot\\.(${APPLY_ACTIONS.join('|')})\\(`, 'g'))) {
      calls.push(`${file}:${match[1]}`);
      const after = source.slice(match.index, match.index + 600).split('\n').slice(0, 4).join('\n');
      assert.match(after, /cancelled/, `${file}: window.pilot.${match[1]}(…) handles {cancelled} within its next lines`);
    }
  }
  assert.ok(calls.length >= 10, `found the callers (${calls.join(', ')})`);
});
