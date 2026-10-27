// Jobs' Apply dialog reads the saved Settings → Apply mode and starts only the path that mode supports.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {test} from 'node:test';
import {applyDialogCopy, applyDialogStart, createApplyStartGate} from '../renderer/apply-dialog-model.js';
import {applyOf} from '../renderer/apply-settings-model.js';
import {registerApplyHandlers} from '../lib/apply-handlers.js';
import {guard} from '../lib/apply-choice-gate.js';

const desktop = path.resolve(import.meta.dirname, '..');

function register(mode, {chosen = true} = {}) {
  const handles = new Map(), starts = [], launches = [];
  let settings = {apply: {mode, chosenAt: chosen ? '2026-10-27T00:00:00.000Z' : ''}};
  const storage = {settings: () => settings};
  const ipcMain = {handle: guard((name, handler) => handles.set(name, handler), () => storage)};
  registerApplyHandlers({DEMO: false, extensionGate: () => null, allowanceBlock: async () => null, needsNotion: () => null,
    claudeConsent: async () => true, ipcMain, log: () => {}, here: desktop, storage, toWindow: () => {}, track: () => {}, shell: {},
    prepareKitFor: async () => ({}), startClaude: async () => ({ok: true}), getRecipeReporter: () => null, cloud: {},
    applyRunner: {start: async (_storage, options) => {
      starts.push(options);
      if (options.mode !== 'chrome') throw new Error(`unexpected runner mode: ${options.mode}`);
      launches.push('visible Chrome');
      return {ok: true};
    }}});
  return {handles, starts, launches, setSettings: value => { settings = value; }};
}

test('the dialog describes the persisted mode and enables only the implemented manual-review path', () => {
  assert.match(applyDialogCopy({apply: {mode: 'check'}}).description, /opens in a Chrome tab[\s\S]*review every tab and press Submit/i);
  assert.equal(applyDialogCopy({apply: {mode: 'check'}}).available, true);
  for (const mode of ['fill', 'auto']) {
    const copy = applyDialogCopy({apply: {mode}});
    assert.equal(copy.available, false, mode);
    assert.match(copy.description, /not available in this build/i);
  }
  assert.match(applyDialogCopy({apply: {mode: 'auto'}}).description, /Full automation/i);
  assert.equal(applyDialogCopy({apply: {mode: 'unknown'}}).mode, 'check');
  assert.equal(applyDialogCopy({}).mode, applyOf({}).mode);
  assert.equal(applyDialogCopy({apply: {mode: 'auto'}}).canStart, true, 'an unconfirmed saved choice still reaches the first-choice gate');
  assert.equal(applyDialogCopy({apply: {mode: 'auto', chosenAt: '2026-10-27T00:00:00.000Z'}}).canStart, false);
});

test('Start dispatches check to the guarded batch runner and leaves review and submission with the owner', async () => {
  const registered = register('check');
  const result = await applyDialogStart({settings: {apply: {mode: 'check'}}, count: '3', start: args => registered.handles.get('apply')({}, args)});
  assert.equal(result.ok, true);
  assert.deepEqual(registered.starts, [{n: 3, mode: 'chrome'}]);
  assert.deepEqual(registered.launches, ['visible Chrome']);
});

test('fill and Full automation never dispatch to the visible Chrome batch fallback', async () => {
  for (const mode of ['fill', 'auto']) {
    const registered = register(mode);
    const result = await applyDialogStart({settings: {apply: {mode}}, count: '2', start: args => registered.handles.get('apply')({}, args)});
    assert.equal(result.ok, false, mode);
    assert.match(result.error, /not available in this build/i);
    assert.deepEqual(registered.starts, [], mode);
    assert.deepEqual(registered.launches, [], mode);
  }
});

test('the first-choice gate re-reads saved mode before the held Start is dispatched', async () => {
  const registered = register('check', {chosen: false});
  const send = () => registered.handles.get('apply')({}, {n: 2, mode: 'settings'});
  assert.equal((await send()).needsApplyChoice, true);
  registered.setSettings({apply: {mode: 'auto', chosenAt: '2026-10-27T01:00:00.000Z'}});
  const result = await send();
  assert.equal(result.ok, false);
  assert.match(result.error, /not available in this build/i);
  assert.deepEqual(registered.starts, []);
  assert.deepEqual(registered.launches, []);
});

test('invalid counts and cancel do not start a job batch', async () => {
  const registered = register('check');
  for (const count of ['0', '11', '1.5', '']) {
    const result = await applyDialogStart({settings: {apply: {mode: 'check'}}, count, start: args => registered.handles.get('apply')({}, args)});
    assert.equal(result.ok, false, count);
    assert.equal(result.cancelled, undefined);
  }
  const cancelled = await applyDialogStart({settings: {apply: {mode: 'check'}}, count: '3', cancelled: true,
    start: args => registered.handles.get('apply')({}, args)});
  assert.equal(cancelled.cancelled, true);
  assert.deepEqual(registered.starts, []);
  assert.deepEqual(registered.launches, []);
});

test('a second Start while the first batch is in flight cannot dispatch another batch', async () => {
  const gate = createApplyStartGate();
  let releaseFirst;
  let starts = 0;
  const first = gate.run(() => new Promise(resolve => { starts++; releaseFirst = resolve; }));
  assert.equal(gate.isStarting(), true);
  const second = await gate.run(async () => { starts++; return {ok: true}; });
  assert.deepEqual(second, {ignored: true});
  assert.equal(starts, 1);
  releaseFirst({ok: true});
  assert.deepEqual(await first, {ok: true});
  assert.equal(gate.isStarting(), false);
  assert.deepEqual(await gate.run(async () => { starts++; return {ok: true}; }), {ok: true});
  assert.equal(starts, 2);
});

test('the dialog keeps a native cancel action and has no independent Apply mode selector', () => {
  const html = fs.readFileSync(path.join(desktop, 'renderer/index.html'), 'utf8');
  const dialog = html.slice(html.indexOf('<dialog id="apply-dialog">'), html.indexOf('</dialog>', html.indexOf('<dialog id="apply-dialog">')));
  assert.match(dialog, /<form method="dialog" id="apply-form">/);
  assert.match(dialog, /<button class="secondary" value="cancel">Close<\/button>/);
  assert.doesNotMatch(dialog, /name="apply-mode"/);
});
