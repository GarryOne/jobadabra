// A triage read in the hidden browser looks at the form and reports it; it never fills, never hands a page to the person, and closes its own tab (extension/background-apply.js).
import assert from 'node:assert/strict';
import {test} from 'node:test';

const SESSION = 'tr12345678';

// background-apply.js builds its session runner once and keeps the `chrome` it saw first: one chrome for the whole file, its state reset per test.
let current = null;
const pick = (store, keys) => { const names = typeof keys === 'string' ? [keys] : Array.isArray(keys) ? keys : Object.keys(keys || {}); return Object.fromEntries(names.filter(name => name in store).map(name => [name, store[name]])); };
globalThis.chrome = {
  storage: {local: {get: async keys => pick(current.local, keys), set: async value => { Object.assign(current.local, value); }}, session: {get: async keys => pick(current.session, keys), set: async value => { Object.assign(current.session, value); }, remove: async () => {}}},
  tabs: {get: async id => (id === 7 ? {id: 7, url: current.local.backgroundApplySessions[SESSION].url, windowId: 3} : null), remove: async id => { current.removed.push(id); }},
  scripting: {executeScript: async () => []},
};

function install(t, {mode = 'read'} = {}) {
  current = {removed: [], posted: [], session: {'session:7': SESSION},
    local: {backgroundOwner: 'o1', workerUrl: 'http://127.0.0.1:47111', token: 'fictional', backgroundApplySessions: {[SESSION]: {session: SESSION, mode, tab: 7, window: 3, url: `https://jobs.example.test/a#jobpilotto-fill=${SESSION}`, manualRequired: false}}}};
  t.mock.method(globalThis, 'fetch', async (url, init) => { current.posted.push({url: String(url), body: JSON.parse(init.body)}); return {ok: true, status: 200, json: async () => ({ok: true})}; });
  return current;
}

test('a form the judge answered is reported with its flags, and the read tab is closed', async t => {
  const {removed, posted} = install(t);
  const {backgroundFormReady} = await import('../../extension/background-apply.js');
  const done = await backgroundFormReady({id: 7, url: 'https://jobs.example.test/a'}, 0, {answer: 'needs_person', botCheck: false, loginWall: true, accountCreation: false});
  assert.equal(done, true, 'the flow ends here: nothing is typed or pressed');
  assert.deepEqual(posted.map(call => [call.url.endsWith('/extension/background-apply'), call.body.action, call.body.session, call.body.loginWall]), [[true, 'triage-read', SESSION, true]]);
  assert.deepEqual(removed, [7]);
});

test('a bot check and a page that is not a form are reported without asking the judge, and the tab is closed', async t => {
  const {removed, posted} = install(t);
  const {backgroundRead} = await import('../../extension/background-apply.js');
  assert.equal(await backgroundRead({id: 7, url: 'https://jobs.example.test/a'}, {kind: {botCheck: true}, role: 'form'}), true);
  assert.equal(posted[0].body.botCheck, true);
  assert.equal(await backgroundRead({id: 7, url: 'https://jobs.example.test/a'}, {kind: {}, role: 'posting'}), true);
  assert.equal(posted[1].body.unreadable, true);
  assert.deepEqual(removed, [7, 7]);
});

test('the page hand-off stands down for a read: a bot check or an account page never opens a window for the person', async t => {
  const {posted} = install(t);
  const {backgroundPage} = await import('../../extension/background-apply.js');
  assert.equal(await backgroundPage(7, 'account', true), false);
  assert.deepEqual(posted, [], 'no manual request, no reveal');
});

test('a tab that is not a read is left alone by the read hook', async t => {
  const {posted} = install(t, {mode: 'fill'});
  const {backgroundRead} = await import('../../extension/background-apply.js');
  assert.equal(await backgroundRead({id: 7, url: 'https://jobs.example.test/a'}, {kind: {botCheck: true}, role: 'form'}), false);
  assert.deepEqual(posted, []);
});
