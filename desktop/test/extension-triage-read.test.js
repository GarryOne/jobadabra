// A triage read in the hidden browser looks at the form and reports it; it never fills, never hands a page to the person, and closes its own tab (extension/background-apply.js).
import assert from 'node:assert/strict';
import {test} from 'node:test';
import vm from 'node:vm';

const SESSION = 'tr12345678';

// background-apply.js builds its session runner once and keeps the `chrome` it saw first: one chrome for the whole file, its state reset per test.
let current = null;
const pick = (store, keys) => { const names = typeof keys === 'string' ? [keys] : Array.isArray(keys) ? keys : Object.keys(keys || {}); return Object.fromEntries(names.filter(name => name in store).map(name => [name, store[name]])); };
globalThis.chrome = {
  storage: {local: {get: async keys => pick(current.local, keys), set: async value => { Object.assign(current.local, value); }}, session: {get: async keys => pick(current.session, keys), set: async value => { Object.assign(current.session, value); }, remove: async () => {}}},
  tabs: {get: async id => (id === 7 ? {id: 7, url: current.local.backgroundApplySessions[SESSION].url, windowId: 3} : null), remove: async id => { current.removed.push(id); }},
  scripting: {executeScript: async ({files, func, args = []}) => {
    if (files) { current.files.push(...files); return []; }
    const window = {__jobPilottoDescribeForm: async () => current.form, __jobPilottoCheckboxQuestions: () => [],
      __jobPilottoProfileEntries: (rows, profile) => rows.filter(row => profile[row.field]).map(row => ({field: row.field})), __jobPilottoPageText: () => 'Fictional form'};
    return [{result: await vm.runInNewContext(`(${func.toString()})(...args)`, {window, args})}];
  }},
};

function install(t, {mode = 'read', form = [{field: 'a', required: true, type: 'text'}], answers = [], fail = false, dropped = false, contact = {}} = {}) {
  current = {form, files: [], removed: [], posted: [], session: {'session:7': SESSION},
    local: {backgroundOwner: 'o1', workerUrl: 'http://127.0.0.1:47111', token: 'fictional', backgroundApplySessions: {[SESSION]: {session: SESSION, mode, tab: 7, window: 3, url: `https://jobs.example.test/a#jobpilotto-fill=${SESSION}`, manualRequired: false}}}};
  t.mock.method(globalThis, 'fetch', async (url, init) => {
    current.posted.push({url: String(url), body: JSON.parse(init?.body || '{}')});
    if (url.endsWith('/extension/answer') && fail) throw new Error('fictional failure');
    const reply = url.includes('/extension/me?') ? {contact} : url.endsWith('/extension/answer') ? (dropped ? null : {answers}) : {ok: true};
    return {ok: true, status: 200, json: async () => reply};
  });
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

test('a poll that names a read the app ended (Cancel, a timeout) closes that read tab, and a later poll with none closes nothing (#2624)', async t => {
  const {removed} = install(t);
  t.mock.method(globalThis, 'fetch', async () => ({ok: true, status: 200, json: async () => ({ok: true, jobs: [], checks: [], handoffs: [], closes: [{session: SESSION}]})}));
  const {pollBackgroundApply} = await import('../../extension/background-apply.js');
  await pollBackgroundApply({workerUrl: 'http://127.0.0.1:47111', token: 'fictional'});
  assert.deepEqual(removed, [7], 'the page the app stopped waiting for is closed');
  t.mock.method(globalThis, 'fetch', async () => ({ok: true, status: 200, json: async () => ({ok: true, jobs: [], checks: [], handoffs: [], closes: []})}));
  await pollBackgroundApply({workerUrl: 'http://127.0.0.1:47111', token: 'fictional'});
  assert.deepEqual(removed, [7], 'an empty closes list leaves the tabs alone');
});

const fillable = {answer: 'needs_person', botCheck: false, loginWall: false, accountCreation: false};
for (const [name, extra, expected] of [
  ['saved answers', {answers: [{field: 'a', use: 'fill', fact: 'other_saved', category: 'normal'}]}, true],
  ['proposal', {answers: [{field: 'a', use: 'propose', fact: 'none'}]}, false],
  ['failed call', {fail: true}, null],
  ['dropped call', {dropped: true}, null],
  ['no fields', {form: []}, null],
  ['unreadable form', {form: null}, null],
  ['profile contact only', {form: [{field: 'first_name', required: true}], contact: {first_name: 'Ada'}}, true],
]) test(`a read reports ${name} from its plan and always closes without input`, async t => {
  const state = install(t, extra);
  const {backgroundFormReady} = await import('../../extension/background-apply.js');
  assert.equal(await backgroundFormReady({id: 7, url: 'https://jobs.example.test/a'}, 0, fillable), true);
  const report = state.posted.find(call => call.body.action === 'triage-read');
  assert.equal(report.body.allFactsSaved, expected);
  assert.deepEqual(state.removed, [7]);
  const answerCalls = state.posted.filter(call => call.url.endsWith('/extension/answer'));
  assert.equal(answerCalls.length, ['no fields', 'unreadable form', 'profile contact only'].includes(name) ? 0 : 1);
  if (answerCalls.length) assert.equal(answerCalls[0].body.fields[0].field, 'a');
  assert.ok(state.files.includes('page/fill.js'), 'the shared form reader is prepared');
  assert.ok(state.posted.every(call => /\/extension\/(me\?|aliases|answer|background-apply)/.test(call.url)), 'no fill or upload route');
});

for (const judgment of [{...fillable, answer: 'blocked'}, {...fillable, answer: 'unsure'}, {...fillable, botCheck: true}, {...fillable, loginWall: true}, {...fillable, accountCreation: true}, {answer: 'ready'}]) test(`a non-fillable judgment skips the plan: ${JSON.stringify(judgment)}`, async t => {
  const state = install(t);
  const {backgroundFormReady} = await import('../../extension/background-apply.js');
  await backgroundFormReady({id: 7, url: 'https://jobs.example.test/a'}, 0, judgment);
  assert.equal(state.posted.length, 1);
  assert.equal(state.posted[0].body.allFactsSaved, null);
  assert.deepEqual(state.files, []);
  assert.deepEqual(state.removed, [7]);
});

test('a read never starts the speculative early answer call before its form judge', async t => {
  const state = install(t);
  const {askEarly} = await import('../../extension/flow.js');
  assert.equal(await askEarly({id: 7, url: 'https://jobs.example.test/a'}, state.local), false);
  assert.deepEqual(state.posted, []);
  assert.deepEqual(state.files, []);
});

test('the owned browser poll command uses the same ownership-checked poll as the report alarm', async t => {
  const state = install(t);
  await import('../../extension/background-apply.js');
  assert.equal(await globalThis.__jobPilottoBackgroundSessions.poll(), true);
  assert.deepEqual(state.posted.map(call => call.body.action), ['poll']);
  delete state.local.backgroundOwner;
  await assert.rejects(() => globalThis.__jobPilottoBackgroundSessions.poll(), /poll/);
  assert.deepEqual(state.posted.map(call => call.body.action), ['poll'], 'an ordinary browser cannot poll background applications');
});


test('a forced poll waits for an in-flight alarm then makes its own extension request', async t => {
  install(t);
  const {pollBackgroundApply} = await import('../../extension/background-apply.js');
  let release, entered, calls = 0, settled = false;
  const held = new Promise(resolve => { release = resolve; }), opened = new Promise(resolve => { entered = resolve; });
  t.mock.method(globalThis, 'fetch', async () => {
    calls++;
    if (calls === 1) { entered(); await held; }
    return {ok: true, status: 200, json: async () => ({ok: true})};
  });
  const alarm = pollBackgroundApply(current.local);
  await opened;
  const forced = globalThis.__jobPilottoBackgroundSessions.poll().then(value => { settled = true; return value; });
  await new Promise(resolve => setImmediate(resolve));
  const wasSettled = settled;
  release();
  await alarm;
  assert.equal(await forced, true);
  assert.equal(wasSettled, false, 'no success acknowledgement while another poll is in flight');
  assert.equal(calls, 2, 'the forced poll made a new request after the alarm');
});
