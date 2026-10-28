// Characterizes consider's ordered page reads, decisions, exits and fill effects without a browser or live app.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {registerHooks} from 'node:module';
import {test} from 'node:test';

const tab = {id: 7, url: 'https://jobs.example.test/apply#jobpilotto-fill=s1'};
const job = 'https://jobs.example.test/job/1#kit';
const shape = {fields: 2, textareas: 0, files: 0, passwords: 0, choices: 0, nodes: 10};
const form = {role: 'form', kind: 'form', by: 'ai', confidence: 0.9};
let serial = 0;

// Run the actual flow modules with Chrome and their external collaborators replaced by recorded fakes.
async function rig(t, options = {}) {
  const calls = [], started = new Set(options.started ? ['7 https://jobs.example.test/apply'] : []);
  const record = (name, value) => (...args) => { calls.push([name, ...args]); return value; };
  const asyncRecord = (name, value) => async (...args) => { calls.push([name, ...args]); return value; };
  const counts = [...(options.counts || [shape])], tabReads = [...(options.tabs || [tab])], answers = [...(options.answers || [form])];
  const result = options.result || {filled: 2, todo: [], trace: []};
  const deps = {
    isStopped: record('stopped', !!options.stopped), backgroundMayFill: asyncRecord('mayFill', options.mayFill !== false),
    backgroundPage: asyncRecord('backgroundPage', !!options.backgroundPage), restoreLostQuery: asyncRecord('restore', !!options.restored),
    pageKey: url => String(url).split('#')[0], openRead: record('openRead', options.moved ? 0 : 1), dropIfLate: (...args) => { calls.push(['late', ...args]); return options.late === true || named(calls, 'late').length === options.lateAt; },
    pageStill: asyncRecord('still', {}), closeConsentEverywhere: asyncRecord('close', options.banner || ''), expandSections: asyncRecord('expand'),
    pageShape: async (...args) => { calls.push(['shape', ...args]); return counts.length > 1 ? counts.shift() : counts[0]; },
    settings: asyncRecord('settings', {}), askEarly: asyncRecord('early'),
    labelReaderIn: asyncRecord('labels'), pageSketchOf: asyncRecord('sketch', {controls: [], buttons: []}),
    framesOf: asyncRecord('frames', []), noteFrames: record('noteFrames'), frameSketch: record('frameSketch', []), mailsOf: asyncRecord('mails', []),
    apiFor: async (...args) => { calls.push(['api', ...args]); if (args[2] === '/extension/site-password') return {mode: options.confirm ? 'confirm' : 'fill'}; return answers.length > 1 ? answers.shift() : answers[0]; },
    noEffectOf: () => [], noteSignal: record('signal'), accountOutcome: asyncRecord('outcome'),
    climbOnUnsure: asyncRecord('unsure', options.unsure || null), readWhileDrawing: async (answer, parts) => { calls.push(['drawing', answer]); return options.drawing ? parts.again() : answer; },
    pageRole: record('rule', options.ruled || 'form'), controlsOf: () => [],
    markPage: asyncRecord('mark'), takePressed: record('takePressed', null), noteRole: asyncRecord('role'), accountStep: asyncRecord('account'),
    identityOf: asyncRecord('identity', {session: 's1', job, url: tab.url}), bindSession: asyncRecord('bind'),
    formCame: (before, after) => after.fields > before.fields,
    applyPhrases: asyncRecord('phrases', []), applyPressed: new Map(),
    pressApply: asyncRecord('press', options.attempt || {pressed: '', buttons: ['Apply']}), notePressed: record('notePressed'),
    startRoute: async (key, parts) => { calls.push(['route', key]); await parts.ask(); return {}; },
    laterLookIsForm: (first, later) => first?.role !== 'form' && later?.role === 'form', noteNoEffect: record('noEffect'), clickTrace: asyncRecord('clickTrace', {}),
    confirmedBody: record('confirmed', null), verifiedBody: record('verified', null),
    brokenOf: counts => counts?.status === 503 ? 'unavailable' : null, onBrokenPage: asyncRecord('broken'),
    frameSrcOf: record('frameSrc', options.frame || ''), claimFrame: record('claim', true), moveTab: asyncRecord('move'),
    climbOnStall: asyncRecord('stall', options.stall || null),
    emailReport: () => options.email || null, toldReport: () => options.told || null, closedReport: () => options.closed || null, otherReport: () => options.other || null,
    blindOn: () => false, blindOr: (_, signal) => signal,
    closerLook: asyncRecord('closer', options.closer || 'none'), lastLook: new Map([[7, {control: 'Upload'}]]),
    restartFromPosting: asyncRecord('restart', !!options.restart), deadEnd: record('deadEnd'),
    notePage: record('page'), noteProgress: record('progress'), forgetGivenUp: record('forget'),
    handGivenUpToPerson: asyncRecord('hand'), formNext: asyncRecord('next'), setApply: record('applyState'),
    decide: asyncRecord('decide'), STILL_MS: {maxMs: 5000},
  };
  const root = new URL('../../extension/', import.meta.url);
  const source = fs.readdirSync(root).filter(file => /^fill-flow.*\.js$/.test(file)).map(file => fs.readFileSync(new URL(file, root), 'utf8')).join('\n');
  const names = [...source.matchAll(/import \{([^}]+)\} from/g)].flatMap(match => match[1].split(',').map(name => name.trim()));
  // Unknown collaborators fail closed; initialization-only hooks and unused branches are inert.
  for (const name of names) if (!(name in deps)) deps[name] = () => {};
  const key = `__considerTest${serial++}`;
  globalThis[key] = deps;
  const hooks = registerHooks({
    resolve(specifier, context, next) {
      const resolved = next(specifier, context);
      if (resolved.url.includes('/extension/') && !resolved.url.includes('?')) return {...resolved, url: `${resolved.url}?${key}`};
      return resolved;
    },
    load(url, context, next) {
      if (url.includes('/extension/') && !/\/fill-flow[^/]*\.js\?/.test(url)) {
        return {format: 'module', shortCircuit: true, source: [...new Set(names)].map(name => `export const ${name} = globalThis.${key}.${name};`).join('\n')};
      }
      return next(url, context);
    },
  });
  t.after(() => { hooks.deregister(); delete globalThis[key]; });
  t.mock.method(globalThis, 'fetch', () => { throw new Error('no network in consider characterization'); });
  t.mock.method(globalThis, 'setTimeout', (callback, ms) => { if (ms < 40000) queueMicrotask(callback); return 0; });
  let now = 10000;
  t.mock.method(Date, 'now', () => (now += options.clockTick || 0));
  t.mock.method(globalThis.crypto, 'randomUUID', () => 'fill-token');
  const oldChrome = globalThis.chrome;
  t.after(() => { if (oldChrome === undefined) delete globalThis.chrome; else globalThis.chrome = oldChrome; });
  globalThis.chrome = {
    runtime: {onMessage: {addListener() {}}},
    tabs: {get: async (...args) => { calls.push(['tab', ...args]); return options.moved ? {...tab, url: 'https://jobs.example.test/next'} : tabReads.length > 1 ? tabReads.shift() : tabReads[0]; }},
    scripting: {executeScript: async spec => { calls.push(['script', spec.args || null]); return [{result: true}]; }},
  };
  const flow = await import(`../../extension/fill-flow.js?${key}`);
  flow.initFillFlow({started, fillOpenedTab: asyncRecord('fill', result), reportFlow: asyncRecord('report'), progress: asyncRecord('say')});
  calls.length = 0;
  return {calls, started, run: () => flow.consider(tab, job)};
}

// Only collaborator call names are projected here; argument assertions below pin the public effects.
const order = calls => calls.map(call => call[0]);
const lines = calls => calls.filter(call => call[0] === 'decide').map(call => call[2]);
const sayings = calls => calls.filter(call => call[0] === 'say');
const named = (calls, name) => calls.filter(call => call[0] === name);
const prefix = ['stopped', 'mayFill', 'page', 'restore', 'still', 'tab', 'openRead', 'close', 'expand', 'shape'];

for (const [name, options, expected] of [
  ['stopped', {stopped: true}, ['stopped']],
  ['background may not fill', {mayFill: false}, ['stopped', 'mayFill']],
  ['already started', {started: true}, ['stopped', 'mayFill']],
  ['restored query', {restored: true}, ['stopped', 'mayFill', 'page', 'restore']],
  ['tab moved on', {moved: true}, ['stopped', 'mayFill', 'page', 'restore', 'still', 'tab', 'openRead']],
]) test(`consider exits: ${name}`, async t => {
  const r = await rig(t, options);
  assert.equal(await r.run(), undefined);
  assert.deepEqual(order(r.calls), expected);
  assert.deepEqual(lines(r.calls), []);
  assert.deepEqual(sayings(r.calls), []);
});

test('popup closes and settles before sections expand and the page is read', async t => {
  const r = await rig(t, {banner: 'No thanks'});
  await r.run();
  assert.deepEqual(order(r.calls).slice(0, 13), [...prefix.slice(0, 8), 'decide', 'say', 'still', 'expand', 'shape']);
  assert.deepEqual(named(r.calls, 'close'), [['close', 7, {cookiesOnly: true}]]);
  assert.deepEqual(sayings(r.calls), [['say', 7, 'Closed a popup ("No thanks")'], ['say', 7, 'Reading this page…']]);
  assert.deepEqual(lines(r.calls), ['closed a popup', 'page kind: form', 'filling']);
});

test('form filled: ordered asks, marks, token writes, fill, report and next-step handoff', async t => {
  const r = await rig(t);
  assert.equal(await r.run(), undefined);
  assert.deepEqual(order(r.calls), [...prefix, 'settings', 'early', 'say', 'mark', 'labels', 'outcome', 'sketch', 'frames', 'noteFrames', 'frameSketch', 'mails', 'script', 'settings', 'api', 'signal', 'late', 'drawing', 'late', 'backgroundPage', 'late', 'rule', 'late', 'decide', 'mark', 'takePressed', 'role', 'mark', 'backgroundPage', 'forget', 'decide', 'late', 'script', 'fill', 'tab', 'script', 'applyState', 'report', 'confirmed', 'hand', 'next']);
  assert.deepEqual(named(r.calls, 'fill'), [['fill', tab, 'https://jobs.example.test/job/1', false, {fast: true, quiet: true}]]);
  assert.deepEqual(named(r.calls, 'script').slice(1), [['script', [JSON.stringify({state: 'running'}), 'fill-token', 'running']], ['script', [JSON.stringify({state: 'done', filled: 2, left: 0, todo: []}), 'fill-token', 'done']]]);
  assert.deepEqual(lines(r.calls), ['page kind: form', 'filling']);
  assert.deepEqual(sayings(r.calls), [['say', 7, 'Reading this page…']]);
  assert.deepEqual(named(r.calls, 'report'), [['report', tab, {role: 'form', ok: true}]]);
  await r.run();
  assert.deepEqual(order(r.calls).slice(-2), ['stopped', 'mayFill'], 'a completed page keeps its started key');
});

test('no form: press refused, digest asked, state and dead end reported', async t => {
  const kind = {role: 'no-form', kind: 'posting', by: 'ai'};
  const r = await rig(t, {answers: [kind], counts: [{...shape, fields: 1}], ruled: 'no-form'});
  await r.run();
  assert.deepEqual(order(r.calls).slice(0, 10), prefix);
  assert.deepEqual(lines(r.calls), ['page kind: posting', 'no Apply button to press', 'no form on this page']);
  assert.deepEqual(named(r.calls, 'press'), [['press', 7, [], '', '', []]]);
  assert.deepEqual(named(r.calls, 'stall'), [['stall', tab, assertFunction(r.calls, 'stall'), '7 https://jobs.example.test/apply', kind]]);
  assert.deepEqual(order(r.calls).slice(-9), ['backgroundPage', 'say', 'mark', 'late', 'script', 'applyState', 'decide', 'deadEnd', 'report']);
  assert.deepEqual(named(r.calls, 'deadEnd')[0][1], {job: 'https://jobs.example.test/job/1', host: 'jobs.example.test', why: 'no-form', tabId: 7, page: tab.url, needs: ''});
  assert.deepEqual(sayings(r.calls), [['say', 7, 'Reading this page…'], ['say', 7, '', '', 'your-turn']]);
});

// The real askKind callback is passed unchanged to the ladder.
function assertFunction(calls, name) { const fn = named(calls, name)[0][2]; assert.equal(typeof fn, 'function'); return fn; }

test('nothing filled climbs the text and picture ladder before incomplete and after-fill', async t => {
  const result = {filled: 0, unfilledRequired: 1, trace: [{required: true, outcome: 'left', label: ' CV  upload '}]};
  const r = await rig(t, {result, closer: 'blocked'});
  await r.run();
  assert.deepEqual(named(r.calls, 'closer'), [false, true].map(picture => ['closer', tab, 0, 'the fill put nothing in and required fields are left', {kind: 'form', picture}]));
  assert.deepEqual(order(r.calls).slice(-6), ['closer', 'closer', 'decide', 'deadEnd', 'hand', 'next']);
  assert.deepEqual(lines(r.calls), ['page kind: form', 'filling', 'nothing filled, required fields left: the person is told, Claude is offered']);
  assert.equal(named(r.calls, 'deadEnd')[0][1].needs, 'CV upload · try "Upload"');
  assert.equal(named(r.calls, 'deadEnd')[0][1].why, 'incomplete');
});

test('read refused then retried before any AI asks', async t => {
  const r = await rig(t, {counts: [null, null, shape]});
  await r.run();
  assert.deepEqual(order(r.calls).slice(0, 13), [...prefix, 'shape', 'shape', 'settings']);
  assert.deepEqual(lines(r.calls), ['page kind: form', 'filling']);
  assert.deepEqual(named(r.calls, 'fill').length, 1);
});

for (const [name, options, stop] of [
  ['read never succeeds', {counts: [null]}, 'broken'],
  ['broken page', {counts: [{...shape, status: 503}]}, 'broken'],
  ['late answer', {late: true}, 'decide'],
  ['background page hands over', {backgroundPage: true}, 'backgroundPage'],
]) test(`consider exits: ${name}`, async t => {
  const r = await rig(t, options);
  await r.run();
  assert.equal(order(r.calls).at(-1), stop);
  assert.equal(named(r.calls, 'fill').length, 0);
  if (stop === 'broken') assert.deepEqual(r.started.size, options.counts[0] ? 1 : 0);
});

for (const confirm of [false, true]) test(`account page: ${confirm ? 'confirmation waits without refilling' : 'details fill before account step'}`, async t => {
  const r = await rig(t, {answers: [{role: 'account', kind: 'account', by: 'ai', accountStep: 'sign_in'}], ruled: 'account', counts: [{...shape, passwords: 1}], confirm});
  await r.run();
  assert.equal(named(r.calls, 'fill').length, confirm ? 0 : 1);
  assert.equal(named(r.calls, 'account').length, 1);
  assert.equal(named(r.calls, 'next').length, 0);
  assert.deepEqual(lines(r.calls), confirm ? ['page kind: account', 'account page left for Claude'] : ['account page (sign_in): filled with your details', 'page kind: account', 'filling']);
  if (!confirm) assert.ok(order(r.calls).indexOf('fill') < order(r.calls).indexOf('account'));
});

for (const [name, options, expected] of [
  ['Apply navigates', {tabs: [tab, {...tab, url: 'https://jobs.example.test/form'}]}, ['page kind: posting', 'pressed the Apply button', 'after the press: the page moved']],
  ['Apply brings a form', {counts: [{...shape, fields: 1}, shape]}, ['page kind: posting', 'pressed the Apply button', 'after the press: a form came', 'filling']],
  ['Apply has no effect and fresh look says form', {clockTick: 1000, answers: [{role: 'no-form', kind: 'posting'}, form]}, ['page kind: posting', 'pressed the Apply button', 'after the press: no form came', 'page sketched for a second look', 'a later look says this page is the form: filled', 'page kind corrected: a later look says form', 'filling']],
]) test(`posting: ${name}`, async t => {
  const r = await rig(t, {answers: [{role: 'no-form', kind: 'posting'}], counts: [{...shape, fields: 1}], ruled: 'no-form', attempt: {pressed: 'Apply', buttons: ['Apply']}, ...options});
  await r.run();
  assert.deepEqual(lines(r.calls), expected);
  assert.equal(named(r.calls, 'fill').length, name === 'Apply navigates' ? 0 : 1);
});

test('a named application frame opens before the stall ladder and releases the started key', async t => {
  const kind = {role: 'no-form', kind: 'posting', form_frame: 0};
  const r = await rig(t, {answers: [kind], counts: [{...shape, fields: 1}], ruled: 'no-form', frame: 'https://forms.example.test/apply'});
  await r.run();
  assert.deepEqual(order(r.calls).slice(-4), ['frameSrc', 'claim', 'decide', 'move']);
  assert.deepEqual(named(r.calls, 'move'), [['move', 7, 'https://forms.example.test/apply']]);
  assert.equal(r.started.size, 0);
});

for (const lateAt of [2, 3, 4, 5]) test(`late answer exits at guard ${lateAt}`, async t => {
  const r = await rig(t, {lateAt});
  await r.run();
  assert.equal(named(r.calls, 'fill').length, 0);
  assert.equal(lines(r.calls).at(-1), 'late answer dropped: a newer read of this tab answered');
  assert.equal(named(r.calls, 'late').length, lateAt);
});
