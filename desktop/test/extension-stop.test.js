// "Stop": one button that halts everything the extension does, on every tab, at once (extension/stop.js). 13 Oct 2026, the owner's own Chrome: the extension acted on a tab that was
// not an application ("Jobadabra started debugging this browser", 24 sections opened) and nothing but turning the extension off in chrome://extensions stopped it.
// Stopped means: no press, no typing, the debugger detached, fill marks and the tabs' application state cleared, and nothing restarts until the person presses Apply again.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {test} from 'node:test';
import {fileURLToPath} from 'node:url';

const store = {};
const calls = {detached: [], attached: [], scripted: [], told: [], sent: [], funcs: []};
let pageWasStopped = true;   // what startedPage answers from the page
let attachedTargets = [], detachListener = null;
globalThis.chrome = {
  runtime: {getManifest: () => ({version: 'test'}), sendMessage: async () => {}},
  storage: {local: {get: async () => ({}), set: async () => {}}, session: {
    async get(keys) { if (keys == null) return {...store}; return Object.fromEntries([].concat(keys).filter(key => key in store).map(key => [key, store[key]])); },
    async set(items) { Object.assign(store, items); },
    async remove(keys) { for (const key of [].concat(keys)) delete store[key]; },
  }},
  debugger: {
    async attach(target) { calls.attached.push(target.tabId); },
    async detach(target) { calls.detached.push(target.tabId); },
    async getTargets() { return attachedTargets; },
    onDetach: {addListener(fn) { detachListener = fn; }},
  },
  tabs: {async get() { return null; }, async query() { return [{id: 5, url: 'https://github.com/x/y/pull/1#jobpilotto-fill=s1'}, {id: 6, url: 'https://example.com/'}]; }, async sendMessage(id, message) { calls.told.push([id, message.type]); }, onRemoved: {addListener() {}}},
  scripting: {async executeScript(options) { calls.scripted.push(options.target.tabId); calls.funcs.push([options.target.tabId, options.func?.name || '']); return options.func?.name === 'startedPage' ? [{result: pageWasStopped}] : []; }},
};
const stop = await import('../../extension/stop.js');
const {isCurrent, beginRead} = await import('../../extension/read-gen.js');
const {followOpener, notePress} = await import('../../extension/tabs.js');
const reset = () => { for (const key of Object.keys(store)) delete store[key]; for (const list of Object.values(calls)) list.length = 0; attachedTargets = []; stop.restart('test'); };

test('Stop clears every armed tab\'s state, keeps what is not a tab\'s, and says it is stopped', async () => {
  reset();
  Object.assign(store, {'armed:5': true, 'session:5': 's1', 'from:5': 'https://x.test/job', 'job:5': 'https://x.test/job', 'carried:5': 'https://x.test/job#jobpilotto-fill', 'submit:5': 1, 'judged:5': 1,
    'armed:7': true, 'session:7': 's2', boot: 'run-1', 'armed:8': false});
  assert.equal(stop.isStopped(), false);
  const done = await stop.stopAll('the person pressed Stop');
  assert.equal(stop.isStopped(), true);
  for (const key of ['armed:5', 'session:5', 'from:5', 'job:5', 'carried:5', 'submit:5', 'judged:5', 'armed:7', 'session:7']) assert.equal(key in store, false, `${key} is cleared`);
  assert.equal(store.boot, 'run-1');
  assert.ok(store.stopped, 'the stop is kept for a worker that starts again');
  assert.deepEqual([...new Set(calls.scripted)].sort(), [5, 7], 'the page script runs in every tab that was armed or carried the mark, in no other');
  assert.equal(done.tabs, 2);
});

test('Stop detaches the debugger it holds; never one that is not ours to name', async () => {
  reset();
  attachedTargets = [{tabId: 5, attached: true}, {tabId: 6, attached: false}, {attached: true, type: 'browser'}];
  await stop.stopAll('Chrome\'s debugging bar was cancelled');
  assert.deepEqual(calls.detached, [5]);
});

test('while stopped nothing attaches the debugger, a press is refused and a read of a tab is late; a tab never armed is never debugged either', async () => {
  reset();
  store['armed:9'] = true;
  await stop.attachDebugger(9);
  assert.deepEqual(calls.attached, [9]);
  await assert.rejects(stop.attachDebugger(10), /not one of the tabs/);   // armed:10 is not set: no job was opened there
  assert.equal(stop.mayAct(), true);
  const gen = beginRead(9);
  assert.equal(isCurrent(9, gen), true);
  await stop.stopAll('test');
  assert.equal(stop.mayAct(), false);
  assert.equal(isCurrent(9, gen), false, 'every answer still on its way is late');
  store['armed:9'] = true;
  await assert.rejects(stop.attachDebugger(9), /stopped/);
  assert.deepEqual(calls.attached, [9], 'no second attach');
});

test('a tab does not join an application while stopped, however fresh the press', async () => {
  reset();
  Object.assign(store, {'armed:21': true, 'session:21': 'session-A', 'from:21': 'https://x.test/job'});
  notePress(21, 'https://x.test/job');
  await stop.stopAll('test');
  Object.assign(store, {'armed:21': true, 'session:21': 'session-A'});   // as if something armed it again
  assert.equal(await followOpener({id: 22, openerTabId: 21, url: '', pendingUrl: ''}), false);
  assert.equal(store['armed:22'], undefined);
});

test('Chrome\'s own "Cancel" on the debugging bar stops everything; a closed tab or DevTools does not', async () => {
  reset();
  stop.watchDebugger();
  assert.equal(typeof detachListener, 'function');
  detachListener({tabId: 5}, 'target_closed');
  detachListener({tabId: 5}, 'replaced_with_devtools');
  assert.equal(stop.isStopped(), false);
  detachListener({tabId: 5}, 'canceled_by_user');
  assert.equal(stop.isStopped(), true);
});

test('only the person starts it again: Apply in the app (a mark on a tab the app opens), the panel\'s Fill, the popup\'s Apply on this page', async () => {
  reset();
  await stop.stopAll('test');
  assert.equal(stop.restart('the app opened a tab'), true);
  assert.equal(stop.isStopped(), false);
  assert.equal(store.stopped, undefined);
  assert.equal(stop.restart('again'), false, 'nothing to start');
});

test('the app\'s Stop reaches the extension in the answer to any report, once per request', async () => {
  reset();
  assert.equal(await stop.stopFromApp({stop: 'req-1'}), true);
  assert.equal(stop.isStopped(), true);
  stop.restart('the person pressed Fill');
  assert.equal(await stop.stopFromApp({stop: 'req-1'}), false, 'the same request again is not a new Stop');
  assert.equal(stop.isStopped(), false);
  assert.equal(await stop.stopFromApp({stop: 'req-2'}), true);
  assert.equal(await stop.stopFromApp({matched: 'x'}), false);
  assert.equal(await stop.stopFromApp(null), false);
});

// The class: every way the extension acts goes through stop.js's checks (a new press or debugger site that skips them fails here).
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../extension');
const sources = dir => fs.readdirSync(path.join(root, dir)).filter(name => name.endsWith('.js')).map(name => [path.join(dir, name), fs.readFileSync(path.join(root, dir, name), 'utf8')]);
const all = [...sources(''), ...sources('ladder')];

test('the class: the debugger is attached in one place, and every press site asks mayAct first', () => {
  for (const [file, text] of all) {
    if (file === 'stop-state.js') continue;
    assert.equal(/chrome\.debugger\.attach\(/.test(text), false, `${file} attaches the debugger itself: use attachDebugger (stop-state.js)`);
  }
  const pressers = all.filter(([file, text]) => file !== 'tabs.js' && /\bnotePress\(/.test(text));
  assert.ok(pressers.length >= 4, `press sites: ${pressers.map(([file]) => file).join(', ')}`);
  for (const [file, text] of pressers) assert.match(text, /\bmayAct\(\)/, `${file} presses without asking mayAct() (stop.js)`);
  for (const [file, text] of all.filter(([name]) => name === 'flow.js' || name === 'fill-verify.js' || name === 'ladder/fill-climb.js' || name === 'ladder/rung4-picture.js')) assert.match(text, /attachDebugger\(/, file);
});

test('the class: the fill\'s entry points and the page-side gate check stopped', () => {
  const read = file => fs.readFileSync(path.join(root, file), 'utf8');
  assert.match(read('fill-flow.js'), /export async function consider[\s\S]{0,400}?isStopped\(\)/, 'consider() looks first');
  assert.match(read('page/guard-gate.js'), /__jobPilottoStopped/, 'the fill\'s stage gate holds when stopped');
  assert.match(read('page/fill.js'), /__jobPilottoStopped/, 'the fill\'s first look');
  assert.match(read('messages-app.js'), /isStopped\(\)/, 'a stopped worker answers no report, password or judgment');
  assert.match(read('visit.js'), /mayAct\(\)\) return;/, 'no read of a job list starts while stopped');
});

test('the Stop button is on every page of the extension: the toolbar popup and the application\'s own page', () => {
  const read = file => fs.readFileSync(path.join(root, file), 'utf8');
  assert.match(read('popup.html'), /id="stop"/, 'the popup has a Stop button, shown on every tab the app opened (popup-controls.js; none on the person\'s own tabs, owner 16 Oct 2026)');
  assert.match(read('popup.js'), /type: 'stop'/, 'the popup sends stop');
  assert.match(read('review.js'), /root\.querySelectorAll\('\.stop-btn, \.pill-stop'\)\][^\n]*\n\s*for \(const button of stopButtons\) button\.onclick[^\n]*type: 'stop'/, 'the panel\'s Stop (in the live step row, and on the minimised pill) sends stop');
  assert.match(read('panel-markup.js'), /class="stop-btn"[^]*class="pill-stop"/, 'a Stop in the step row and one beside the pill, so it is one press away open or minimised');
  assert.doesNotMatch(read('background.js'), /panel-stop\.js/, 'the bottom-left chip is gone (owner, 19 Oct 2026): Stop lives in the panel');
});

// #648 and the class: every message that is the person starting work again (a button they press) clears Stop first; the stopped worker's refusals are only for what starts by itself.
test('every person-pressed start message clears Stop, Read this board included', async () => {
  const {createStopMessages} = await import('../../extension/stop-messages.js');
  const handle = createStopMessages();
  for (const type of ['panelFill', 'applyHere', 'fillAnyway', 'panelTakeOver', 'visitRead']) {
    reset();
    await stop.stopAll('test');
    assert.equal(stop.isStopped(), true);
    assert.equal(handle({type}, {tab: {id: 5}}, () => {}), undefined, `${type} is left to its own group`);
    assert.equal(stop.isStopped(), false, `${type} clears Stop`);
  }
});

// 27 Oct 2026 (owner: "I stopped the extension, then said fill again and then it still stays stopped"; ""Check form again" is not working"): the worker's Stop was lifted, the page's
// own flag was not, and the page fill answered "Stopped by you." at once. Each start on a tab clears that page, tells its panel and the app, and the fill waits for it.
test('every person-pressed start on a tab clears that page\'s own Stop, tells its panel, and the page fill waits for it', async () => {
  const {createStopMessages} = await import('../../extension/stop-messages.js');
  const {pageStarted} = await import('../../extension/stop-state.js');
  const handle = createStopMessages();
  for (const [type, sender, extra] of [['panelFill', {tab: {id: 5}}, {}], ['fillAnyway', {tab: {id: 5}}, {}], ['panelTakeOver', {tab: {id: 5}}, {}], ['applyHere', {}, {tabId: 5}]]) {
    reset();
    await stop.stopAll('test');
    assert.equal(store['stoppedTab:5'] > 0, true, 'a tab Stop cleared stays the app\'s for the person\'s own start (the popup\'s Apply on this page)');
    calls.funcs.length = 0; calls.told.length = 0;
    handle({type, ...extra}, sender, () => {});
    await pageStarted(5);
    await new Promise(resolve => setTimeout(resolve, 0));
    assert.deepEqual(calls.funcs.filter(([, name]) => name === 'startedPage'), [[5, 'startedPage']], `${type}: the page's own Stop is cleared on the tab it was pressed for`);
    assert.ok(calls.told.some(([id, what]) => id === 5 && what === 'started'), `${type}: the panel hears it and leaves "Stopped by you"`);
  }
  // Not stopped anywhere and the page never was: nothing to tell.
  reset(); pageWasStopped = false; calls.told.length = 0;
  handle({type: 'panelFill'}, {tab: {id: 5}}, () => {});
  await pageStarted(5); await new Promise(resolve => setTimeout(resolve, 0));
  assert.equal(calls.told.some(([, what]) => what === 'started'), false, 'a plain Fill on a page that was never stopped says nothing');
  pageWasStopped = true;
});

test('the page fill waits for the page\'s Stop to clear before it starts', () => {
  const flow = fs.readFileSync(new URL('../../extension/fill-tab-inputs.js', import.meta.url), 'utf8');
  assert.match(flow, /const summary = await pageStarted\(tab\.id\)\.then\(\(\) => inPage\(tab\.id, \(list, profile, resume, letter, consents\) => window\.__jobPilottoExtensionFill/, 'flow.js awaits pageStarted right before the page fill');
  const stopFile = fs.readFileSync(new URL('../../extension/stop.js', import.meta.url), 'utf8');
  assert.doesNotMatch(stopFile.match(/function stoppedPage\(\) \{[\s\S]*?\n\}/)[0].match(/for \(const id of \[[^\]]*\]\) document\.getElementById\(id\)\?\.remove\(\)/)[0], /'jobpilotto-review-host'/, 'Stop keeps the panel: it says "Stopped by you" with Check form again (owner mockup 03), never a panel taken away and drawn back working');
});
