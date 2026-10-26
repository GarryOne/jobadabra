// The app's side of the recipe library (lib/recipes.js): asks by fingerprint, remembers, validates, respects the privacy switch,
// and sends back counts in batches.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {test} from 'node:test';
import {installId} from '../lib/app-feedback.js';
import {createReporter, lookup} from '../lib/recipes.js';
import {createStorage} from '../lib/storage.js';

const fakeCrypto = {encrypt: v => v, decrypt: v => v};
const tempStorage = () => createStorage(fs.mkdtempSync(path.join(os.tmpdir(), 'pilot-recipes-')), fakeCrypto);
const recipe = (extra = {}) => ({fingerprint: '1d2pcapx18', version: 2, operator: 'toggle', params: {onAttr: 'aria-pressed', onValue: 'true'}, rollout: 100, ...extra});
const site = (answers = {}) => {
  const calls = [];
  const fetcher = async (url, init = {}) => {
    calls.push([new URL(url).pathname, init.body ? JSON.parse(init.body) : null, init.headers?.Authorization || '']);
    const path = new URL(url).pathname;
    const reply = (status, body) => ({ok: status < 400, status, json: async () => body});
    if (path === '/api/install-token') return reply(200, {token: 'tok123'});
    if (path === '/api/recipes/lookup') return reply(200, {recipes: answers.recipes ?? [recipe()]});
    if (path === '/api/controls') return answers.controls ? reply(answers.controls, {}) : reply(200, {ok: true});
    return reply(404, {});
  };
  return {calls, fetcher};
};

test('recipes come back for the fingerprints asked, validated, with one token kept and answers remembered (also none)', async () => {
  const storage = tempStorage(), net = site({recipes: [recipe(), recipe({fingerprint: 'bad0001', operator: 'run-code'})]});
  const found = await lookup(storage, ['1d2pcapx18', 'bad0001', 'none0001', 'NOT VALID'], {fetcher: net.fetcher, base: 'https://site.test'});
  assert.deepEqual(Object.keys(found), ['1d2pcapx18']);   // an invalid recipe never reaches the extension
  assert.deepEqual(net.calls.map(c => c[0]), ['/api/install-token', '/api/recipes/lookup']);
  assert.deepEqual(net.calls[1][1].fingerprints, ['1d2pcapx18', 'bad0001', 'none0001']);
  assert.equal(net.calls[1][2], 'Bearer tok123');
  const again = await lookup(storage, ['1d2pcapx18', 'none0001'], {fetcher: net.fetcher, base: 'https://site.test'});
  assert.deepEqual(Object.keys(again), ['1d2pcapx18']);
  assert.equal(net.calls.length, 2);   // all remembered, nothing asked
  await lookup(storage, ['1d2pcapx18'], {fetcher: net.fetcher, base: 'https://site.test', now: Date.now() + 7 * 3600 * 1000});
  assert.equal(net.calls.length, 3);   // after six hours it asks again, with the kept token
  assert.equal(net.calls[2][0], '/api/recipes/lookup');
});

test('with Technical reports off, no fingerprint leaves the Mac; an offline site means no recipes, not an error', async () => {
  const storage = tempStorage(), net = site();
  storage.saveSettings({telemetry: false});
  assert.deepEqual(await lookup(storage, ['1d2pcapx18'], {fetcher: net.fetcher, base: 'https://site.test'}), {});
  assert.equal(net.calls.length, 0);
  const on = tempStorage();
  const down = async () => { throw new Error('offline'); };
  assert.deepEqual(await lookup(on, ['1d2pcapx18'], {fetcher: down, base: 'https://site.test'}), {});
});

test('a rejected token is replaced once', async () => {
  const storage = tempStorage();
  storage.saveSettings({recipesToken: {install: installId(storage), value: 'stale'}});
  let rejected = false;
  const fetcher = async (url, init = {}) => {
    const reply = (status, body) => ({ok: status < 400, status, json: async () => body});
    const path = new URL(url).pathname;
    if (path === '/api/install-token') return reply(200, {token: 'fresh'});
    if (init.headers.Authorization === 'Bearer stale') { rejected = true; return reply(401, {}); }
    return reply(200, {recipes: [recipe()]});
  };
  const found = await lookup(storage, ['1d2pcapx18'], {fetcher, base: 'https://site.test'});
  assert.deepEqual(Object.keys(found), ['1d2pcapx18']);
  assert.equal(rejected, true);
});

test('outcomes are counted per fingerprint and recipe and sent in one batch; a failed send keeps them for the next try', async () => {
  const storage = tempStorage();
  let status = 500;
  const sent = [];
  const fetcher = async (url, init) => { sent.push(JSON.parse(init.body)); return {ok: status < 400, status, json: async () => ({})}; };
  const timers = [];
  const reporter = createReporter(storage, {fetcher, base: 'https://site.test', setTimer: fn => { timers.push(fn); return {}; }});
  reporter.outcome([{fp: '1d2pcapx18', recipe: 0, ok: true}, {fp: '1d2pcapx18', recipe: 0, ok: false}, {fp: '1d2pcapx18', recipe: 2, ok: true}, {fp: 'NOT VALID', ok: true}]);
  reporter.sample([{fingerprint: 'abc123', kind: 'switch', skeleton: {t: 'div', a: {}, c: [], k: []}, question: 'Remote?'}]);
  assert.equal(timers.length, 1);   // one flush scheduled, not one per item
  assert.deepEqual(await reporter.flush(), {sent: 0});
  status = 200;
  assert.deepEqual(await reporter.flush(), {sent: 3});   // two outcome rows and one sample
  const body = sent.at(-1);
  assert.deepEqual(body.outcomes.map(o => [o.fp, o.recipe, o.ok, o.failed]).sort(), [['1d2pcapx18', 0, 1, 1], ['1d2pcapx18', 2, 1, 0]]);
  assert.equal(body.samples[0].fingerprint, 'abc123');
  assert.deepEqual(await reporter.flush(), {sent: 0});   // nothing left
  storage.saveSettings({telemetry: false});
  reporter.outcome([{fp: '1d2pcapx18', ok: true}]);
  assert.deepEqual(await reporter.flush(), {sent: 0});   // switched off: nothing is kept or sent
});

test('each filled form counts for its board and goes in the same batch; nothing when reports are off', async () => {
  const storage = tempStorage();
  const sent = [];
  const fetcher = async (url, init) => { sent.push(JSON.parse(init.body)); return {ok: true, status: 200, json: async () => ({})}; };
  const reporter = createReporter(storage, {fetcher, base: 'https://site.test', setTimer: () => ({})});
  reporter.fill('ashby'); reporter.fill('ashby'); reporter.fill('h:0123456789'); reporter.fill('bad board!'); reporter.fill('');
  assert.deepEqual(await reporter.flush(), {sent: 2});
  assert.deepEqual(sent[0].exposure, [{board: 'ashby', n: 2}, {board: 'h:0123456789', n: 1}]);
  // With the required questions each form had (the denominator of /admin/form-filling/real-users's rates), summed per board.
  reporter.fill('ashby', 9); reporter.fill('ashby', 3); reporter.fill('lever', 'x');
  await reporter.flush();
  assert.deepEqual(sent[1].exposure, [{board: 'ashby', n: 2, required: 12}, {board: 'lever', n: 1}]);
  // And the labels the page marks with a "*", counted apart from the rule: the cross-check (site /admin/form-filling/real-users, "Required marks").
  reporter.fill('recruitingapp-662.umantis.com', 0, 6); reporter.fill('recruitingapp-662.umantis.com', 0, 6); reporter.fill('ashby', 4, 'x');
  await reporter.flush();
  assert.deepEqual(sent[2].exposure, [{board: 'recruitingapp-662.umantis.com', n: 2, starred: 12}, {board: 'ashby', n: 1, required: 4}]);
  storage.saveSettings({telemetry: false});
  reporter.fill('ashby');
  assert.deepEqual(await reporter.flush(), {sent: 0});
});

test('question wording and where an application got to are batched per board, cleaned, and follow the privacy switch', async () => {
  const storage = tempStorage(), net = site();
  const reporter = createReporter(storage, {fetcher: net.fetcher, base: 'https://site.test', setTimer: () => ({unref() {}})});
  reporter.question([{label: 'Heimatort *', kind: 'text'}, {label: 'Mail me at jane@example.com', kind: 'text'}, {label: 'Heimatort', kind: 'text'}], 'greenhouse');
  reporter.question([{label: 'Notice period', kind: 'select'}], 'bad board!');   // not a board name: ignored
  reporter.flow('ashby', 'no-form'); reporter.flow('ashby', 'no-form'); reporter.flow('ashby', 'filled'); reporter.flow('ashby', 'made-up');
  await reporter.flush();
  const body = net.calls.find(call => call[0] === '/api/controls')[1];
  assert.deepEqual(body.questions, [{label: 'heimatort', kind: 'text', board: 'greenhouse'}]);   // cleaned, deduplicated, the address dropped
  assert.deepEqual(body.flows, [{board: 'ashby', state: 'no-form', n: 2}, {board: 'ashby', state: 'filled', n: 1}]);
  storage.saveSettings({telemetry: false});
  const quiet = site();
  const off = createReporter(storage, {fetcher: quiet.fetcher, base: 'https://site.test', setTimer: () => ({unref() {}})});
  off.question([{label: 'Heimatort', kind: 'text'}], 'greenhouse'); off.flow('ashby', 'filled');
  await off.flush();
  assert.equal(quiet.calls.length, 0);   // reports off: nothing leaves this Mac
});

test('a failed send keeps the questions and flow counts for the next try', async () => {
  const storage = tempStorage();
  let status = 500;
  const calls = [];
  const fetcher = async (url, init = {}) => {
    const path = new URL(url).pathname;
    if (path === '/api/install-token') return {ok: true, status: 200, json: async () => ({token: 't'})};
    calls.push(JSON.parse(init.body));
    return {ok: status < 400, status, json: async () => ({ok: true})};
  };
  const reporter = createReporter(storage, {fetcher, base: 'https://site.test', setTimer: () => ({unref() {}})});
  reporter.question([{label: 'Heimatort', kind: 'text'}], 'lever'); reporter.flow('lever', 'account');
  assert.equal((await reporter.flush()).sent, 0);
  status = 200;
  assert.equal((await reporter.flush()).sent, 2);
  assert.deepEqual([calls[1].questions.length, calls[1].flows], [1, [{board: 'lever', state: 'account', n: 1}]]);
});

test('how an application went is batched by board, outcome and days; anything else is refused; off with the privacy switch', async () => {
  const storage = tempStorage(), calls = [];
  const fetcher = async (url, init = {}) => {
    if (new URL(url).pathname === '/api/install-token') return {ok: true, status: 200, json: async () => ({token: 't'})};
    calls.push(JSON.parse(init.body));
    return {ok: true, status: 200, json: async () => ({ok: true})};
  };
  const reporter = createReporter(storage, {fetcher, base: 'https://site.test', setTimer: () => ({unref() {}})});
  reporter.application({board: 'greenhouse', outcome: 'reply', days: '8-14'});
  reporter.application({board: 'greenhouse', outcome: 'reply', days: '8-14', company: 'Grafana', url: 'https://x.test'});
  reporter.application({board: 'h:0123456789', outcome: 'rejected', days: ''});
  reporter.application({board: 'greenhouse', outcome: 'hired', days: '8-14'});     // not an outcome
  reporter.application({board: 'greenhouse', outcome: 'reply', days: 'a week'});   // not a bucket
  reporter.application({board: 'bad board!', outcome: 'reply', days: ''});
  reporter.application(null);
  await reporter.flush();
  assert.deepEqual(calls[0].applications, [{board: 'greenhouse', outcome: 'reply', days: '8-14', n: 2}, {board: 'h:0123456789', outcome: 'rejected', days: '', n: 1}]);
  assert.equal(JSON.stringify(calls[0]).includes('Grafana'), false);
  storage.saveSettings({telemetry: false});
  const off = createReporter(storage, {fetcher, base: 'https://site.test', setTimer: () => ({unref() {}})});
  off.application({board: 'greenhouse', outcome: 'reply', days: '8-14'});
  calls.length = 0;
  await off.flush();
  assert.equal(calls.length, 0);
});

test('what the installs teach about a job search is batched as counts by fixed tags, refused when off the lists, and sent only with reports on', async () => {
  const storage = tempStorage(), calls = [];
  const fetcher = async (url, init = {}) => {
    if (new URL(url).pathname === '/api/install-token') return {ok: true, status: 200, json: async () => ({token: 't'})};
    calls.push(JSON.parse(init.body));
    return {ok: true, status: 200, json: async () => ({ok: true})};
  };
  const reporter = createReporter(storage, {fetcher, base: 'https://site.test', setTimer: () => ({unref() {}})});
  reporter.termAccepted('Backend', ['sre_devops'], ['europe']);
  reporter.termAccepted('<script>', ['sre_devops'], ['europe']);                     // not a role word
  reporter.termAccepted('storage', [], []);                                          // no tags: generalised
  reporter.coverage({at: 'x', in_places: 3142, matched: 164, roles: ['sre_devops', 'data'], regions: ['europe'],
    suggestions: [{term: 'backend', count: 49, examples: ['Senior Backend Engineer']}, {term: 'bad!', count: 9}]});
  reporter.dismissal('seniority', '60-79'); reporter.dismissal('seniority', '60-79');
  reporter.dismissal('my boss', '60-79'); reporter.dismissal('tech', '999');        // off the fixed lists
  reporter.snapshot([{bucket: '80-100', state: 'applied', n: 4}, {bucket: '80-100', state: 'banana', n: 4}, {bucket: 'nope', state: 'new', n: 1}, {bucket: 'unscored', state: 'new', n: 0}]);
  await reporter.flush();
  const intel = calls[0].intel;
  assert.deepEqual(intel.terms, [{term: 'backend', role: 'sre_devops', region: 'europe'}, {term: 'storage', role: 'other', region: 'none'}]);
  assert.deepEqual(intel.coverage, {role: 'sre_devops', region: 'europe', in_places: 3142, matched: 164, missed: [{term: 'backend', count: 49}]});   // examples never leave
  assert.deepEqual(intel.dismissals, [{reason: 'seniority', bucket: '60-79', n: 2}]);
  assert.deepEqual(intel.snapshot, [{bucket: '80-100', state: 'applied', n: 4}]);
  assert.equal(JSON.stringify(calls[0]).includes('Senior Backend'), false);
  storage.saveSettings({telemetry: false});
  const off = createReporter(storage, {fetcher, base: 'https://site.test', setTimer: () => ({unref() {}})});
  off.termAccepted('backend', ['sre_devops'], ['europe']); off.dismissal('tech', '40-59'); off.snapshot([{bucket: '80-100', state: 'applied', n: 1}]);
  calls.length = 0;
  await off.flush();
  assert.equal(calls.length, 0);
});

test('a failed send keeps the intelligence counts for the next try and does not double a snapshot taken meanwhile', async () => {
  const storage = tempStorage();
  let status = 500;
  const calls = [];
  const fetcher = async (url, init = {}) => {
    if (new URL(url).pathname === '/api/install-token') return {ok: true, status: 200, json: async () => ({token: 't'})};
    calls.push(JSON.parse(init.body));
    return {ok: status < 400, status, json: async () => ({ok: true})};
  };
  const reporter = createReporter(storage, {fetcher, base: 'https://site.test', setTimer: () => ({unref() {}})});
  reporter.dismissal('location', '40-59');
  reporter.snapshot([{bucket: '60-79', state: 'saved', n: 3}]);
  assert.equal((await reporter.flush()).sent, 0);
  reporter.dismissal('location', '40-59');
  status = 200;
  await reporter.flush();
  assert.deepEqual(calls[1].intel.dismissals, [{reason: 'location', bucket: '40-59', n: 2}]);
  assert.deepEqual(calls[1].intel.snapshot, [{bucket: '60-79', state: 'saved', n: 3}]);
});

test('replies by score band, source kinds and filled/corrected labels are sent as counts, and refused when off the lists', async () => {
  const storage = tempStorage(), calls = [];
  const fetcher = async (url, init = {}) => {
    if (new URL(url).pathname === '/api/install-token') return {ok: true, status: 200, json: async () => ({token: 't'})};
    calls.push(JSON.parse(init.body));
    return {ok: true, status: 200, json: async () => ({ok: true})};
  };
  const reporter = createReporter(storage, {fetcher, base: 'https://site.test', setTimer: () => ({unref() {}})});
  reporter.reply('80-100', 'screening'); reporter.reply('80-100', 'screening'); reporter.reply('nope', 'reply'); reporter.reply('40-59', 'banana');
  reporter.sources([{board: 'greenhouse', seen: 10, acted: 3, dismissed: 2, heard: 1}, {board: 'h:abc', seen: 4, acted: 0, dismissed: 0, heard: 0}, {board: 'lever', seen: 0}]);
  reporter.fillQuality(['Notice period', 'Notice period', 'First name'], ['Notice period']);
  await reporter.flush();
  const intel = calls[0].intel;
  assert.deepEqual(intel.replies, [{bucket: '80-100', outcome: 'screening', n: 2}]);
  assert.deepEqual(intel.sources, [{board: 'greenhouse', seen: 10, acted: 3, dismissed: 2, heard: 1, good: 0, hours: null}]);
  assert.deepEqual(intel.fixes.map(f => [f.label, f.filled, f.corrected]), [['notice period', 2, 1], ['first name', 1, 0]]);
});

test('a learned note is sent as a wording and a fixed profile field only, once; nothing when reports are off', async () => {
  const storage = tempStorage();
  const sent = [];
  const fetcher = async (url, init) => { sent.push(JSON.parse(init.body)); return {ok: true, status: 200, json: async () => ({})}; };
  const reporter = createReporter(storage, {fetcher, base: 'https://site.test', setTimer: () => ({})});
  const {proposalsOf} = await import('../lib/learn.js');
  const notes = [{scope: 'any', kind: 'answer', field: 'Preferred First Name', value: 'Igor', note: 'x', key: 'first_name'},
    {scope: 'any', kind: 'option', field: 'How did you hear', value: 'Careers Website', note: 'x', key: ''},
    {scope: 'any', kind: 'meaning', field: 'I agree to the terms', value: '', note: 'x', key: 'email'}];
  reporter.proposal(proposalsOf(notes)); reporter.proposal(proposalsOf(notes));
  await reporter.flush();
  assert.deepEqual(sent[0].proposals, [{key: 'first_name', phrase: 'preferred first name'}]);   // no value, no sentence, no consent wording
  storage.saveSettings({telemetry: false});
  reporter.proposal([{key: 'email', phrase: 'courriel'}]);
  assert.deepEqual(await reporter.flush(), {sent: 0});
});

test('empty-field reasons are summed per board and reason word; unknown words and boards are dropped', async () => {
  const storage = tempStorage();
  const sent = [];
  const fetcher = async (url, init) => { sent.push(JSON.parse(init.body)); return {ok: true, status: 200, json: async () => ({})}; };
  const reporter = createReporter(storage, {fetcher, base: 'https://site.test', setTimer: () => ({})});
  reporter.unfilled('ashby', [{reason: 'no_answer', n: 2}, {reason: 'my salary', n: 4}]);
  reporter.unfilled('ashby', [{reason: 'no_answer', n: 1}]);
  reporter.unfilled('bad board!', [{reason: 'no_answer', n: 1}]);
  await reporter.flush();
  assert.deepEqual(sent[0].unfilled, [{board: 'ashby', reason: 'no_answer', n: 3}]);
});

test('AI answer calls go in the batch summed per engine, counts only; nothing when reports are off', async () => {
  const storage = tempStorage();
  const sent = [];
  const fetcher = async (url, init) => { sent.push(JSON.parse(init.body)); return {ok: true, status: 200, json: async () => ({})}; };
  const reporter = createReporter(storage, {fetcher, base: 'https://site.test', setTimer: () => ({})});
  const trace = {fields: 3, returned: 3, kept: 2, empty: 1, proposed: 0, unknownIds: ['x_salary'], stop: 'end_turn', ms: 4000, engine: 'cli'};
  reporter.answer(trace); reporter.answer(trace);
  await reporter.flush();
  assert.deepEqual(sent[0].answers, [{engine: 'cli', calls: 2, fields: 6, returned: 6, kept: 4, empty: 2, unknown: 2, proposed: 0, cut: 0, ms: [2, 0, 0, 0, 0, 0]}]);
  assert.ok(!JSON.stringify(sent[0]).includes('x_salary'));
  storage.saveSettings({telemetry: false});
  reporter.answer(trace);
  assert.deepEqual(await reporter.flush(), {sent: 0});
});

test('a fill\'s record carries the host it ended on, as a plain host name only (usage-weighted pool)', async () => {
  const storage = tempStorage();
  const sent = [];
  const fetcher = async (url, init) => { sent.push(JSON.parse(init.body)); return {ok: true, status: 200, json: async () => ({})}; };
  const reporter = createReporter(storage, {fetcher, base: 'https://site.test', setTimer: () => ({})});
  reporter.card('h:0123456789', {id: 'fill-0001-abc', required: 2, filled: 2}, 'Careers.Acme.MD');
  reporter.card('h:0123456789', {id: 'fill-0002-abc'}, 'acme.md/jobs/123?token=abc');   // an address: no host is sent, the card still is
  reporter.card('h:0123456789', {id: 'fill-0003-abc'});   // no host known
  await reporter.flush();
  assert.deepEqual(sent[0].cards.map(card => [card.id, card.host]), [['fill-0001-abc', 'careers.acme.md'], ['fill-0002-abc', undefined], ['fill-0003-abc', undefined]]);
  assert.ok(!JSON.stringify(sent[0]).includes('token'), 'nothing of the address is sent');
});

test('each fill\'s record and what Submit added go in the batch, with the board; nothing when reports are off', async () => {
  const storage = tempStorage();
  const sent = [];
  const fetcher = async (url, init) => { sent.push(JSON.parse(init.body)); return {ok: true, status: 200, json: async () => ({})}; };
  const reporter = createReporter(storage, {fetcher, base: 'https://site.test', setTimer: () => ({})});
  reporter.card('ashby', {id: 'fill-0001-abc', v: '0.8.97', required: 5, filled: 4, causes: {ai_unsure: 1}});
  reporter.card('ashby', {id: 'x'});   // not a record's id: dropped
  reporter.submit('fill-0001-abc', {submitted: true, by_you: 1});
  reporter.submit('fill-0001-abc', {page_error: 2});
  await reporter.flush();
  assert.deepEqual(sent[0].cards.map(c => [c.id, c.board]), [['fill-0001-abc', 'ashby']]);
  assert.deepEqual(sent[0].submits, [{id: 'fill-0001-abc', submitted: true, by_you: 1, by_you_unread: 0, page_error: 2}]);
  storage.saveSettings({telemetry: false});
  reporter.card('ashby', {id: 'fill-0002-abc'});
  assert.deepEqual(await reporter.flush(), {sent: 0});
});

// Owner, 9 Oct 2026: a beta install also tests canary learning; the app says so in a header (api/canary-reach.js).
test('a beta install asks for recipes with X-Beta: 1; any other install without it', async () => {
  for (const beta of [true, false]) {
    const storage = tempStorage();
    storage.saveSettings({betaChannel: beta});
    const seen = [];
    const fetcher = async (url, init = {}) => {
      if (new URL(url).pathname === '/api/install-token') return {ok: true, status: 200, json: async () => ({token: 't'})};
      seen.push(init.headers || {});
      return {ok: true, status: 200, json: async () => ({recipes: []})};
    };
    await lookup(storage, ['1d2pcapx18'], {fetcher, base: 'https://site.test'});
    assert.equal(seen[0]['X-Beta'], beta ? '1' : undefined, String(beta));
  }
});

// 9 Oct 2026: the twin restarted 44 s after a fill, before the 5-minute send, and that fill's record never reached the site.
test('a waiting batch survives a restart: a new reporter on the same folder sends it', async () => {
  const storage = tempStorage();
  const sent = [];
  const fetcher = async (url, init = {}) => { if (init.body) sent.push(JSON.parse(init.body)); return {ok: true, status: 200, json: async () => ({})}; };
  const before = createReporter(storage, {fetcher, base: 'https://site.test', setTimer: () => ({})});
  before.card('ashby', {id: 'fill-0003-abc', required: 4, filled: 3, causes: {no_data: 1}});
  before.proposalUse({board: 'ashby', source: 'fill_guess', act: 'shown', v: '0.9.1'});
  // The app restarts here: nothing was sent.
  const timers = [];
  const after = createReporter(storage, {fetcher, base: 'https://site.test', setTimer: fn => { timers.push(fn); return {}; }});
  assert.equal(timers.length, 1);   // a send is scheduled for what was waiting
  await after.flush();
  assert.deepEqual([sent[0].cards.map(card => card.id), sent[0].proposalUses.length], [['fill-0003-abc'], 1]);
  const again = createReporter(storage, {fetcher, base: 'https://site.test', setTimer: fn => { timers.push(fn); return {}; }});
  assert.equal(timers.length, 1);   // sent: nothing waits any more
  assert.deepEqual(await again.flush(), {sent: 0});
});

test('a failed outcome carries a fixed reason word, never the operator\'s own message', async () => {
  const storage = tempStorage();
  const sent = [];
  const reporter = createReporter(storage, {fetcher: async (url, init) => { sent.push(JSON.parse(init.body)); return {ok: true, status: 200, json: async () => ({})}; }, base: 'https://site.test', setTimer: () => ({})});
  reporter.outcome([{fp: 'aaaaaa1', ok: false, why: 'no_answer'}, {fp: 'aaaaaa2', ok: false, why: 'no option "Igor Mardari"'}, {fp: 'aaaaaa3', ok: false, why: 'the list did not open'}, {fp: 'aaaaaa4', ok: false, why: 'wording unknown'}, {fp: 'aaaaaa5', ok: true, why: 'x'}]);
  await reporter.flush();
  assert.deepEqual(sent.at(-1).outcomes.map(o => [o.fp, o.why]), [['aaaaaa1', 'no_answer'], ['aaaaaa2', 'no_option'], ['aaaaaa3', 'not_opened'], ['aaaaaa4', 'other'], ['aaaaaa5', undefined]]);
});

test('the facts forms asked go as fixed ids once a day, alone if nothing else is waiting, and never with reports off', async () => {
  const storage = tempStorage(), calls = [];
  storage.saveSettings({questionVerdicts: {a: {reuse: 'details', fact: 'Notice period', asked: 1, question: 'Kündigungsfrist?'}}});
  const fetcher = async (url, init = {}) => {
    if (new URL(url).pathname === '/api/install-token') return {ok: true, status: 200, json: async () => ({token: 't'})};
    calls.push(JSON.parse(init.body));
    return {ok: true, status: 200, json: async () => ({ok: true})};
  };
  const reporter = createReporter(storage, {fetcher, base: 'https://site.test', setTimer: () => ({unref() {}})});
  await reporter.flush();
  assert.deepEqual(calls[0].intel.facts, ['notice'], 'the fixed id, never the wording');
  assert.ok(!JSON.stringify(calls[0]).includes('Kündigungsfrist'));
  await reporter.flush();
  assert.equal(calls.length, 1, 'once a day');
});
