// Jobs' "Apply to jobs" dialog (owner, 28 Oct 2026 rework of #2317): it applies to jobs. The same three cards as Settings → Apply, only a built mode
// can be picked (the others say Coming soon), a pick saves through Settings → Apply's one writer, and the button says "Apply to N jobs".
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {test} from 'node:test';
import {applyButtonLabel, applyDialogSelectMode, applyDialogStart, createApplyStartGate} from '../renderer/apply-dialog-model.js';
import {MODES, applyOf, modeBuilt, modeRunner} from '../renderer/apply-settings-model.js';
import {registerApplyHandlers} from '../lib/apply-handlers.js';
import {guard} from '../lib/apply-choice-gate.js';

const desktop = path.resolve(import.meta.dirname, '..');
const read = file => fs.readFileSync(path.join(desktop, file), 'utf8');

function register(mode, {chosen = true} = {}) {
  const handles = new Map(), starts = [];
  let settings = {apply: {mode, chosenAt: chosen ? '2026-10-27T00:00:00.000Z' : ''}};
  const storage = {settings: () => settings};
  const ipcMain = {handle: guard((name, handler) => handles.set(name, handler), () => storage)};
  registerApplyHandlers({DEMO: false, extensionGate: () => null, allowanceBlock: async () => null, needsNotion: () => null,
    claudeConsent: async () => true, ipcMain, log: () => {}, here: desktop, storage, toWindow: () => {}, track: () => {}, shell: {},
    prepareKitFor: async () => ({}), startClaude: async () => ({ok: true}), getRecipeReporter: () => null, cloud: {},
    applyRunner: {start: async (_storage, options) => { starts.push(options); return {ok: true}; }}});
  return {handles, starts, setSettings: value => { settings = value; }};
}

test('the primary button applies to jobs: "Apply to N jobs" from the count, never a settings action', () => {
  assert.equal(applyButtonLabel('3'), 'Apply to 3 jobs');
  assert.equal(applyButtonLabel(1), 'Apply to 1 job');
  assert.equal(applyButtonLabel('10'), 'Apply to 10 jobs');
  for (const bad of ['', '0', '11', '1.5', 'x']) assert.equal(applyButtonLabel(bad), 'Apply to jobs', bad);
  const page = read('renderer/pages/jobs-apply.js');
  assert.match(page, /applyButtonLabel\(/);
  assert.doesNotMatch(page + read('renderer/apply-dialog-model.js'), /Confirm Apply mode|Unavailable|for review'|saved to Settings/);
});

test('an unbuilt mode cannot be picked in the dialog: nothing is written', async () => {
  let writes = 0;
  const save = async patch => { writes++; return {apply: {mode: patch.mode}}; };
  for (const mode of MODES.filter(item => !modeBuilt(item.id)).map(item => item.id)) {
    const picked = await applyDialogSelectMode({mode, save});
    assert.equal(picked.ok, false, mode);
  }
  assert.equal((await applyDialogSelectMode({mode: 'other', save})).ok, false);
  assert.equal(writes, 0);
});

test('a built mode is saved through Settings → Apply\'s writer, keeping the first-choice stamp', async () => {
  let settings = {apply: {mode: 'check', chosenAt: '2026-10-27T00:00:00.000Z'}};
  const picked = await applyDialogSelectMode({mode: 'check', save: async patch => (settings = {apply: {...settings.apply, ...patch}})});
  assert.equal(picked.ok, true);
  assert.equal(applyOf(picked.settings).mode, 'check');
  assert.equal(picked.settings.apply.chosenAt, '2026-10-27T00:00:00.000Z');
  const page = read('renderer/pages/jobs-apply.js');
  assert.match(page, /import \{modeCards, save as saveApplySettings\} from '\.\/apply-settings\.js'/, 'one writer: the Settings → Apply save');
  assert.doesNotMatch(page, /saveSettings\(/, 'no second writer of settings.apply');
});

test('a mode is built exactly when it names its batch runner; Standard\'s is the visible Chrome batch, Background\'s the hidden browser', () => {
  assert.deepEqual(Object.fromEntries(MODES.map(mode => [mode.id, modeRunner(mode.id)])), {check: 'chrome', fill: 'background', auto: ''});
  for (const mode of MODES) assert.equal(modeBuilt(mode.id), !!modeRunner(mode.id), mode.id);
  const handlers = read('lib/apply-handlers.js');
  assert.match(handlers, /applyMode = fromSettings \? applyOf\(storage\.settings\(\)\)\.mode/, 'main reads the saved (built) mode');
  assert.match(handlers, /fromSettings \? modeRunner\(applyMode\)/, 'main starts the runner that mode names');
});

test('a save that fails is said, never shown as picked', async () => {
  const picked = await applyDialogSelectMode({mode: 'check', save: async () => null});
  assert.equal(picked.ok, false);
  assert.match(picked.error, /Could not save/);
  assert.match(read('renderer/pages/apply-settings.js'), /return saved \? current : null;/, 'Settings → Apply\'s save answers null on a failed write');
});

test('a start whose call fails says so and gives the button back', () => {
  const page = read('renderer/pages/jobs-apply.js');
  assert.match(page, /catch \(error\) \{[^}]*Could not start applying/);
  assert.match(page, /busy: saving \|\| gate\.isStarting\(\)/, 'the cards are off while a batch starts');
});

test('Start sends the validated count; the main process runs the saved mode\'s own runner', async () => {
  const registered = register('check');
  const result = await applyDialogStart({count: '3', start: args => registered.handles.get('apply')({}, args)});
  assert.equal(result.ok, true);
  assert.deepEqual(registered.starts, [{n: 3, mode: 'chrome', applyMode: 'check'}]);
});

test('a saved Background automation starts the hidden browser\'s runner (no extension needed: it carries its own copy)', async () => {
  const registered = register('fill');
  const result = await applyDialogStart({count: '2', start: args => registered.handles.get('apply')({}, args)});
  assert.equal(result.ok, true);
  assert.deepEqual(registered.starts, [{n: 2, mode: 'background', applyMode: 'fill'}]);
});

test('an older save of an unbuilt mode reads as Standard automation in the cards and the runner alike', async () => {
  for (const mode of ['auto']) {
    assert.equal(applyOf({apply: {mode}}).mode, 'check', 'the cards draw Standard selected');
    const registered = register(mode);
    await applyDialogStart({count: '2', start: args => registered.handles.get('apply')({}, args)});
    assert.deepEqual(registered.starts, [{n: 2, mode: 'chrome', applyMode: 'check'}], 'the runner is the one the cards showed');
  }
});

test('the first-choice gate holds Start, then the main process reads the mode chosen in it', async () => {
  const registered = register('check', {chosen: false});
  const send = () => registered.handles.get('apply')({}, {n: 2, mode: 'settings'});
  assert.equal((await send()).needsApplyChoice, true);
  assert.deepEqual(registered.starts, []);
  registered.setSettings({apply: {mode: 'check', chosenAt: '2026-10-28T01:00:00.000Z'}});
  assert.equal((await send()).ok, true);
  assert.deepEqual(registered.starts, [{n: 2, mode: 'chrome', applyMode: 'check'}]);
});

test('invalid counts and cancel do not start a job batch', async () => {
  const registered = register('check');
  for (const count of ['0', '11', '1.5', '']) {
    const result = await applyDialogStart({count, start: args => registered.handles.get('apply')({}, args)});
    assert.equal(result.ok, false, count);
  }
  const cancelled = await applyDialogStart({count: '3', cancelled: true, start: args => registered.handles.get('apply')({}, args)});
  assert.equal(cancelled.cancelled, true);
  assert.deepEqual(registered.starts, []);
});

test('a second Start while the first batch is in flight cannot dispatch another batch', async () => {
  const gate = createApplyStartGate();
  let releaseFirst, starts = 0;
  const first = gate.run(() => new Promise(resolve => { starts++; releaseFirst = resolve; }));
  assert.equal(gate.isStarting(), true);
  assert.deepEqual(await gate.run(async () => { starts++; return {ok: true}; }), {ignored: true});
  assert.equal(starts, 1);
  releaseFirst({ok: true});
  assert.deepEqual(await first, {ok: true});
  assert.equal(gate.isStarting(), false);
  assert.deepEqual(await gate.run(async () => { starts++; return {ok: true}; }), {ok: true});
  assert.equal(starts, 2);
  assert.match(read('renderer/pages/jobs-apply.js'), /if \(gate\.isStarting\(\)\) return;/, 'typing in the count while starting keeps the button off');
});

test('the dialog: count, the shared mode cards, a native Close, one primary button; no saved-mode badge or mode paragraph', () => {
  const html = read('renderer/index.html');
  const at = html.indexOf('<dialog id="apply-dialog">'), dialog = html.slice(at, html.indexOf('</dialog>', at));
  assert.match(dialog, /<form method="dialog" id="apply-form">/);
  assert.match(dialog, /<button class="secondary" value="cancel">Close<\/button>/);
  assert.match(dialog, /id="apply-n" type="number" min="1" max="10"/);
  assert.match(dialog, /id="apply-mode-cards"/);
  assert.equal((dialog.match(/class="primary"/g) || []).length, 1);
  assert.ok(dialog.indexOf('id="apply-n"') < dialog.indexOf('id="apply-mode-cards"'), 'how many jobs first: the dialog is about applying');
  assert.doesNotMatch(dialog + read('renderer/components.css'), /apply-mode-description|is-apply-saved-badge|apply-mode-summary/);
  assert.match(read('renderer/pages/jobs-apply.js'), /modeCards\(applyOf\(/);
});

test('the window cannot start the hidden browser by naming its runner: only the saved mode reaches it', async () => {
  const {handles, starts} = register('check');
  const result = await handles.get('apply')(null, {n: 1, mode: 'background', applyMode: 'auto'});
  assert.equal(result.ok, false);
  assert.deepEqual(starts, []);
});

// Owner's screenshot (28 Oct 2026): "Could not start applying: Error invoking remote method 'apply': Error: This job is not eligible…" showed Electron's own wrapper.
test('a start that rejects shows the reason without Electron\'s IPC wrapper', async () => {
  const wrapped = new Error("Error invoking remote method 'apply': Error: This job is not eligible to start another application.");
  const result = await applyDialogStart({count: 1, start: async () => { throw wrapped; }});
  assert.equal(result.ok, false);
  assert.equal(result.error, 'Could not start applying: This job is not eligible to start another application. Try again in a moment.');
  assert.doesNotMatch(result.error, /remote method|^Error/);
});
