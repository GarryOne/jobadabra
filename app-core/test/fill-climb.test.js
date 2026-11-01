// The fill ladder's climb for controls, the worker's side (extension/ladder/fill-climb.js, fill-repair.js; spec docs/superpowers/specs/2026-10-12-fill-ladder.md, PR C2): the repairs the app
// named run with the extension's own primitives (a page verb in the page, a real click at the page's spot, the layer closer only when its own pick is the named button, once per page),
// a refused repair or ask_person does nothing; without the test switch nothing new is asked (no model call added for a person); a late retype makes the page read again for the record.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {test} from 'node:test';
import {runRepairs} from '../../extension/ladder/fill-repair.js';

const tools = (pageAnswers = {}) => {
  const done = {page: [], clicks: [], layers: []};
  return {done, page: async (func, args) => { done.page.push(args); const key = String(func).match(/\?\.(mayClick|spot|clicked)/)?.[0]; return key && key in pageAnswers ? pageAnswers[key] : {ok: true, why: ''}; },
    click: async (x, y) => { done.clicks.push([x, y]); }, closeLayer: async ({want}) => { done.layers.push(want); return want; }, sleep: async () => {}};
};

test('each verb goes to its primitive; refused, ask_person and a verb repair does not do yet touch nothing', async () => {
  const t = tools();
  const results = await runRepairs([
    {n: 2, verb: 'choose_option', option: 0, refused: ''},
    {n: 3, verb: 'toggle', option: 0, refused: 'floor: legal or password'},
    {n: 4, verb: 'open_section', option: 0, refused: ''}], t, null);
  assert.deepEqual(results.map(row => [row.n, row.verb, row.ok]), [[2, 'choose_option', true], [3, 'toggle', undefined], [4, 'open_section', undefined]]);
  assert.deepEqual((await runRepairs([{n: 5, verb: 'ask_person', option: 0, refused: ''}], t, null)).map(row => row.ok), [undefined]);
  assert.deepEqual(t.done.page, [[2, 'choose_option', 0]], 'only the page verb ran in the page');
  assert.equal(t.done.clicks.length, 0);
});

test('dismiss_layer presses the button the repair named, through the layer closer, once per page', async () => {
  const t = tools();
  const onTop = {buttons: ['Subscribe', 'No thanks', '×']};
  const results = await runRepairs([{n: 1, verb: 'dismiss_layer', option: 2}, {n: 2, verb: 'dismiss_layer', option: 2}, {n: 3, verb: 'dismiss_layer', option: 3}], t, onTop);
  assert.deepEqual(t.done.layers, ['No thanks'], 'want = the named button; the closer presses only if the app\'s own pick is that one (consent.js closeLayer)');
  assert.deepEqual(results.map(row => row.ok), [true, undefined, undefined]);
  const refused = tools();
  refused.closeLayer = async () => '';
  assert.equal((await runRepairs([{n: 1, verb: 'dismiss_layer', option: 1}], refused, onTop))[0].ok, false, 'the closer picked another button: nothing pressed, not worked');
  assert.equal((await runRepairs([{n: 1, verb: 'dismiss_layer', option: 1}], tools(), null))[0].ok, false, 'no layer on top: nothing to press');
});

test('a real click goes to the spot the page gives, only when the page allows the try, and the page says if it holds', async () => {
  const t = tools({'?.mayClick': 'empty:0:1', '?.spot': {x: 40, y: 80}, '?.clicked': true});
  const [row] = await runRepairs([{n: 6, verb: 'trusted_click', option: 0}], t, null);
  assert.deepEqual(t.done.clicks, [[40, 80]]);
  assert.equal(row.ok, true);
  const no = tools({'?.mayClick': null});
  assert.equal((await runRepairs([{n: 6, verb: 'toggle', option: 0}], no, null))[0].ok, false);
  assert.equal(no.done.clicks.length, 0, 'refused by the floors or the attempt log: no click');
});

test('at most 3 repairs per page', async () => {
  const t = tools();
  const rows = await runRepairs(Array.from({length: 5}, (_, i) => ({n: i + 1, verb: 'commit', option: 0})), t, null);
  assert.equal(rows.length, 3);
});

test('with repair switched off the climb asks nothing new; a late retype makes the page read again', async () => {
  const {climbFill} = await import('../../extension/ladder/fill-climb.js');
  const asked = [], scripts = [];
  const keep = {chrome: globalThis.chrome, fetch: globalThis.fetch};
  let retyped = 0;
  globalThis.chrome = {
    storage: {local: {get: async () => ({}), set: async () => {}}, session: {get: async () => ({}), set: async () => {}}},
    scripting: {executeScript: async ({func}) => { const source = String(func); scripts.push(source); return [{result: source.includes('RetypeWiped') ? retyped : source.includes('pass()') ? [{field: 'first', type: 'text', state: 'committed'}] : null}]; }},
    runtime: {getManifest: () => ({version: '0'})}};
  globalThis.fetch = async (url, init) => { asked.push([String(url), JSON.parse(init?.body || '{}')]); return {ok: true, status: 200, json: async () => ({}), text: async () => '{}'}; };
  try {
    assert.equal(await climbFill({id: 7, url: 'https://apply.example/a'}, {workerUrl: 'http://127.0.0.1:47111', token: 't', repairAct: false}), null, 'nothing changed: the first read stands');
    assert.equal(asked.filter(([url]) => /account-judge/.test(url)).length, 0, 'switched off: no fill check, no repair asked');
    retyped = 2;
    const again = await climbFill({id: 7, url: 'https://apply.example/a'}, {workerUrl: 'http://127.0.0.1:47111', token: 't', repairAct: false});
    assert.deepEqual(JSON.parse(JSON.stringify(again)), {readBack: [{field: 'first', type: 'text', state: 'committed'}]}, 'a box typed again after the first read: the record takes the second read');
    await new Promise(resolve => setTimeout(resolve, 50));   // the climb's log lines are not awaited: let them finish on the stubs
  } finally { Object.assign(globalThis, keep); }
});

test('repair acts for every user by default: no storage key at all means on, only repairAct false means off, the harness switch changes nothing', async () => {
  const {repairActs} = await import('../../extension/ladder/acts.js');
  assert.equal(repairActs({}), true, 'the product default is on');
  assert.equal(repairActs(null), true);
  assert.equal(repairActs({ladderAct: true}), true);
  assert.equal(repairActs({repairAct: false}), false, 'the kill switch');
  assert.equal(repairActs({repairAct: true}), true);
  const climb = fs.readFileSync(new URL('../../extension/ladder/fill-climb.js', import.meta.url), 'utf8');
  assert.match(climb, /repairActs\(config\) \? await repairPage/, 'fill-climb asks the one switch, not ladderAct');
});
