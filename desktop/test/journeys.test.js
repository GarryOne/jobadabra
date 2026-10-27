// The applying scenarios as event sequences (spec: docs/superpowers/specs/2026-10-10-application-journey.md): what the extension reports, in order,
// through the app's real path (session-flow.js -> terminals.js -> lib/application-journey.js), and the one step the card must show. Seconds, no browser.
// A live bug becomes one scenario here, failing first. The push hook runs this file when a flow-core file changed (tools/journey-gate.mjs).
import assert from 'node:assert/strict';
import {test} from 'node:test';
import * as terminals from '../lib/terminals.js';
import * as apply from '../lib/apply.js';
import * as review from '../lib/review.js';
import {createSessionFlow} from '../lib/session-flow.js';
import {createAccountCheck} from '../lib/account-check.js';
import {STOPPED, journeyStep} from '../lib/application-journey.js';
import {stopLiveForms} from '../lib/stop-all.js';
import {classify} from '../lib/real-errors.js';
import {accountRecordLine} from '../renderer/session-state.js';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {decidePageKind} from '../lib/server-pages.js';
import {resolveSession} from '../lib/journey-identity.js';
import * as pipeline from '../lib/pipeline.js';
import * as questions from '../lib/questions.js';
import {createStorage} from '../lib/storage.js';
import {sharedRead} from '../lib/shared-read.js';
import {endingOf} from '../e2e/lib/ending.mjs';
import {stopsOf} from '../e2e/lib/pool-shadow.mjs';
import {doorLines, runEvents} from '../e2e/lib/pool-gaps.mjs';
import {pickDismiss} from '../lib/popup-pick.js';

const POSTING = 'https://www.jobs.ch/en/vacancies/detail/12181ac1/', SIGNIN = 'https://auth.jobs.ch/u/login/identifier', FORM = 'https://apply.example/form';
function journeyOf(id = 'f1') {
  terminals._reset();
  terminals.startForm({id, url: POSTING, company: 'Deloitte'});
  const review = {olderTab: () => false, allStates: () => [], queueClose: () => {}};
  const flow = createSessionFlow({terminals, review, apply, appLog: () => {}, toWindow: () => {}, startClaude: async () => ({ok: true}), claudeAllowed: () => false, closeTab: async () => true});
  const card = () => journeyStep(terminals.get(id));
  return {flow, card, id};
}

test('scenario: posting -> sign-in page -> a "no form" from the posting tab left behind: the card stays at the account step (10 Oct 2026)', () => {
  const {flow, card} = journeyOf();
  flow.reported({id: 'f1', url: SIGNIN, total: 1, left: 1, account: true});
  assert.equal(card().step, 'account');
  flow.stuck({url: POSTING, host: 'www.jobs.ch', why: 'no-form', session: 'f1'});
  assert.deepEqual(card(), {step: 'account', needs: ''});
  assert.notEqual(terminals.get('f1').note, 'The extension can\'t reach the form');
});

test('scenario: sign-up pressed, the account awaits its mail, the mail holds a code: the card says confirm and what the person must do', async () => {
  const {card} = journeyOf();
  terminals.setStage('f1', 'account', 'auth.jobs.ch');
  terminals.setAccount('f1', 'confirm');
  const check = createAccountCheck({confirm: async () => 'code', noteStuck: (...args) => terminals.noteStuck(...args), log: () => {}});
  assert.equal(await check({host: 'auth.jobs.ch', email: 'me@example.com', session: 'f1', force: true}), 'code');
  assert.equal(card().step, 'confirm');
  assert.match(card().needs, /code/i);
});

test('scenario: a pending account with no mail found: the person is still told (never a silent page)', async () => {
  const {card} = journeyOf();
  terminals.setAccount('f1', 'confirm');
  const check = createAccountCheck({confirm: async () => 'none', noteStuck: (...args) => terminals.noteStuck(...args), log: () => {}});
  await check({host: 'auth.jobs.ch', email: 'me@example.com', session: 'f1', force: true});
  assert.equal(card().step, 'confirm');
  assert.ok(card().needs.length > 0);
});

test('scenario: account step, then the form behind it: the form step, the account site kept for "step 2 of 2"', () => {
  const {flow, card} = journeyOf();
  flow.reported({id: 'f1', url: SIGNIN, total: 1, left: 1, account: true});
  flow.reported({id: 'f1', url: FORM, total: 9, left: 4});
  assert.equal(card().step, 'form');
  assert.equal(terminals.get('f1').accountHost, 'auth.jobs.ch');
});

test('scenario: a fill that put nothing in stays "needs you" until something is filled (c1a2fcc)', () => {
  const {flow, card} = journeyOf();
  flow.reported({id: 'f1', url: FORM, total: 3, left: 3});
  flow.stuck({url: FORM, host: 'apply.example', why: 'incomplete', session: 'f1', needs: 'Nothing could be filled'});
  flow.reported({id: 'f1', url: FORM, total: 3, left: 3});
  assert.equal(terminals.get('f1').stuck, 'incomplete');
  flow.reported({id: 'f1', url: FORM, total: 3, left: 1});
  assert.equal(terminals.get('f1').stuck, '');
  assert.equal(card().step, 'form');
});

test('scenario: no form and no Apply on the posting itself: the card says the extension cannot reach the form', () => {
  const {flow, card} = journeyOf();
  flow.stuck({url: POSTING, host: 'www.jobs.ch', why: 'no-form', session: 'f1'});
  assert.equal(card().step, 'posting');
  assert.match(card().needs, /can't reach/);
});

test('scenario: a sign-in tab that carries no session id: the app finds the application by the tab\'s job, so "enter the code" reaches its card (10 Oct 2026)', async () => {
  const {card} = journeyOf();
  const {resolveSession} = await import('../lib/journey-identity.js');
  const session = resolveSession({session: '', job: POSTING, url: SIGNIN}, {get: terminals.get, list: terminals.list, isFormOf: apply.isFormOf});
  assert.equal(session, 'f1');
  terminals.setAccount(session, 'confirm');
  const check = createAccountCheck({confirm: async () => 'code', noteStuck: (...args) => terminals.noteStuck(...args), log: () => {}});
  await check({host: 'auth.jobs.ch', email: 'me@example.com', session, force: true});
  assert.equal(card().step, 'confirm');
  assert.match(card().needs, /code/i);
});

test('scenario: the confirmation page asks for the mailed code: in "Do it for me" the app reads it and hands it to the extension; in "Let me check each step" the person types it (10 Oct 2026)', async () => {
  const {accountCodeAnswer, codeFromMail} = await import('../lib/account-confirm.js');
  const logs = [];
  const read = found => codeFromMail({...found, run: async () => ({code: 0, stdout: JSON.stringify({code: '482913', links: []})}), log: (...line) => logs.push(JSON.stringify(line))});
  assert.deepEqual(await accountCodeAnswer({mode: 'full', host: 'auth.jobs.ch', email: 'me@example.com', read}), {ok: true, code: '482913'});
  assert.equal((await accountCodeAnswer({mode: 'assist', host: 'auth.jobs.ch', email: 'me@example.com', read})).ok, false);
  assert.equal((await accountCodeAnswer({mode: 'full', host: 'auth.jobs.ch', email: '', read})).ok, false);
  assert.ok(logs.length && !logs.join(' ').includes('482913'), 'the code is never logged');
  const none = found => codeFromMail({...found, run: async () => ({code: 1, stdout: '{"error": "no confirmation email yet"}'}), log: () => {}});
  assert.deepEqual(await accountCodeAnswer({mode: 'full', host: 'h.example', email: 'me@example.com', read: none}), {ok: false, why: 'no code in the mail'});
});

test('scenario: a sign-up accepts the required terms, is created, and the code from the mail is typed: the card keeps a record of it (10 Oct 2026)', () => {
  const {flow, card} = journeyOf();
  flow.reported({id: 'f1', url: SIGNIN, total: 3, left: 3, account: true});
  terminals.setAccountFact('f1', 'terms', 'I accept the terms of use');
  terminals.setAccount('f1', 'confirm');
  terminals.setAccountFact('f1', 'code');
  terminals.setAccount('f1', 'created');
  const item = terminals.get('f1');
  assert.deepEqual([item.accountTerms, item.accountCode, item.accountState], [['I accept the terms of use'], true, 'created']);
  assert.equal(accountRecordLine(item).includes('terms accepted: ‘I accept the terms of use’'), true);
  assert.equal(card().step !== 'ended', true);
});

test('scenario: a posting that asks for the application by email: the card says where to send it, never "can\'t reach the form", and Claude is not offered', () => {
  const {flow, card} = journeyOf();
  flow.stuck({url: POSTING, host: 'www.jobs.ch', why: 'email', needs: 'jobs@firma.ch', session: 'f1'});
  assert.deepEqual(card(), {step: 'posting', needs: 'Send your application to jobs@firma.ch'});
  assert.equal(terminals.get('f1').stuck, 'email');
  flow.stuck({url: POSTING, host: 'www.jobs.ch', why: 'no-form', session: 'f1'});   // the same page reported again by the structure rule: the email stays
  assert.equal(terminals.get('f1').stuck, 'email');
});

test('scenario: an email posting reported from a tab the application has left (its sign-in tab) never takes the account step back', () => {
  const {flow, card} = journeyOf();
  flow.reported({id: 'f1', url: SIGNIN, total: 1, left: 1, account: true});
  flow.stuck({url: POSTING, host: 'www.jobs.ch', why: 'email', needs: 'jobs@firma.ch', session: 'f1'});
  assert.equal(card().step, 'account');
});

test('scenario: a posting that tells the person to call: the card quotes the page\'s sentence, never "can\'t reach the form", and Claude is not offered', () => {
  const {flow, card} = journeyOf();
  flow.stuck({url: POSTING, host: 'www.jobs.ch', why: 'told', needs: 'Rufen Sie uns an: 044 555 01 00', session: 'f1'});
  assert.deepEqual(card(), {step: 'posting', needs: 'The page says: Rufen Sie uns an: 044 555 01 00'});
  assert.equal(terminals.get('f1').stuck, 'told');
});

test('scenario: the ladder ends with no usable answer (other): the card says Jobadabra could not tell how to apply, never "can\'t reach the form", and Claude is not offered', () => {
  const {flow, card} = journeyOf();
  flow.stuck({url: POSTING, host: 'www.jobs.ch', why: 'other', session: 'f1'});
  assert.deepEqual(card(), {step: 'posting', needs: 'Jobadabra could not tell how to apply: open the page'});
  assert.equal(terminals.get('f1').stuck, 'other');
});

// 12 Oct 2026 (jobs.ch "Create an account to apply faster" left open): through the app's own page-kind route, the first answer over the layer is "0.6, no route" (what the live run got) and
// the second names the manual route: the extension must be told the route (it presses "Continue without an account", start-route.js). Today's hold: no route.
test('scenario: a layer offers "continue without an account", the first answer is unsure with no route: the route still reaches the extension (jobs.ch, 12 Oct 2026)', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'jp-journey-kind-'));
  const storage = {path: name => path.join(dir, name), settings: () => ({})};
  const noWay = {kind: 'posting', confidence: 0.6, apply_button: '', apply_button_kind: '', apply_route: '', apply_by: 'other', apply_email: '', form_frame: -1, account_step: '', register_control: '', signin_control: '', account_button: '', bot_check: false};
  const manual = {...noWay, confidence: 0.85, apply_button: 'Continue without an account', apply_button_kind: 'apply', apply_route: 'manual', apply_by: 'form'};
  let asked = 0;
  const client = {messages: {create: async () => ({stop_reason: 'end_turn', usage: {input_tokens: 10, output_tokens: 5}, content: [{type: 'text', text: JSON.stringify(asked++ ? manual : noWay)}]})}};
  const layer = ['Login here', 'Create an account', 'Continue without an account'];
  const body = {url: POSTING, title: 'Real Estate Accountant', headings: ['Create an account to apply faster', 'Real Estate Accountant'], controls: [], buttons: [...layer, 'Login', 'Saved jobs'],
    noEffect: ['Easy apply'], fresh: true, onTop: {shape: 'overlay', role: 'div', text: 'Create an account to apply faster', buttons: layer}};
  const answer = await decidePageKind(storage, body, {client});
  assert.deepEqual([answer.applyRoute, answer.applyButton], ['manual', 'continue without an account']);
  assert.equal(asked, 2, 'one retry, no more');
});

// 12 Oct 2026 (Ocado, CI): a user on the Anthropic API engine asks the digest (rung 3, an unsure posting); the API refuses a schema that carries maxItems (400), so the digest
// fell to "page kind: none (400 ...)" and the ladder ended at the person. Through the app's own page-kind route and the real API adapter over an SDK that refuses limits like the API.
test('scenario: a digest request on the Anthropic API engine is answered, not refused for the list limit in its schema (Ocado, 12 Oct 2026)', async () => {
  const {AnthropicApi} = await import('../lib/ai/anthropic-api.js');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'jp-journey-digest-'));
  const storage = {path: name => path.join(dir, name), settings: () => ({})};
  const refusing = {messages: {create: async body => {
    if (/maxItems|minItems/.test(JSON.stringify(body.output_config))) throw Object.assign(new Error('400 {"type":"error","error":{"type":"invalid_request_error","message":"output_config.format.schema: For \'array\' type, property \'maxItems\' is not supported"}}'), {status: 400});
    return {stop_reason: 'end_turn', usage: {input_tokens: 700, output_tokens: 30}, content: [{type: 'text', text: JSON.stringify({outcome: 'phone', verb: 'tell_person', numbers: [1], press_kind: '', confidence: 0.9})}]};
  }}};
  const candidates = [{n: 1, kind: 'phone', position: 'main', text: '044 555 01 00'}, {n: 2, kind: 'sentence', position: 'main', text: 'Fragen? Rufen Sie uns an'}];
  const body = {url: POSTING, title: 'Real Estate Accountant', headings: ['Real Estate Accountant'], controls: [], buttons: ['Login'], candidates, digest: true, fresh: true};
  const answer = await decidePageKind(storage, body, {client: new AnthropicApi({sdk: refusing})});
  assert.equal(answer.by, 'digest', JSON.stringify(answer).slice(0, 300));
  assert.equal(answer.digest?.outcome, 'phone');
});

test('scenario: Notion chosen but not connected, a search starts: the engine runs as while trying, never on a Notion store with no token (#410)', async () => {
  const {pipelineEnv} = await import('../lib/pipeline.js');
  const storage = settings => ({settings: () => settings, secret: () => '', path: name => `/folder/${name}`, secretsPresent: () => ({}), saveSettings: () => {}});
  const env = pipelineEnv(storage({store: 'notion'}), {PATH: '/usr/bin'});
  assert.equal(env.JOB_PILOTTO_STORE, undefined);   // was 'notion': src/stores/notion.py raised "needs NOTION_TOKEN", shown as "Unexpected error"
  assert.equal(env.NOTION_TOKEN, undefined);
});

test('scenario: account permission handoff and partial application never claim review completion', async () => {
  const {sessionReview, sessionState} = await import('../renderer/session-state.js');
  const {flow} = journeyOf();
  flow.stuck({url: POSTING, host: 'accounts.example', why: 'account', session: 'f1', needs: 'Continue needs permission'});
  terminals.report('f1', {event: 'input', message: 'Continue was blocked by a permission check. Nothing was submitted.'});
  assert.equal(sessionReview(terminals.get('f1'), true), false);
  assert.notEqual(sessionState(terminals.get('f1'), true)[0], 'Ready to submit');
  const partial = {kind: 'form', status: 'done'};
  assert.equal(sessionReview(partial, false), false);
  assert.deepEqual(sessionState(partial, false), ['Form open', 'info']);
  assert.deepEqual(sessionState(partial, true), ['Ready to submit', 'good']);
});

test('scenario: four open applications focus only the requested job, despite an unbound marked sign-in tab (#479, now by owner not by guess)', async () => {
  const review = await import('../lib/review.js');
  const {tabOfSession} = await import('../lib/session-tab.js');
  review._reset();
  const sessions = [1, 2, 3, 4].map(n => ({id: 'focus-' + n, company: 'Employer ' + n, url: 'https://forms.example/employer-' + n + '/job', status: 'done'}));
  const account = {id: 101, url: 'https://accounts.example/#jobpilotto-fill', title: 'Sign in'};
  const forms = sessions.map((s, n) => ({id: 102 + n, url: s.url + '/application#jobpilotto-fill=' + s.id, title: s.company}));
  sessions.forEach((s, n) => review.report(sessions, {session: s.id, tab: forms[n].id, url: forms[n].url, total: 3, left: 0}));
  for (const [n, session] of sessions.entries()) {
    assert.equal(tabOfSession(session.id, [account, ...forms], review.tabOf(session.id)), forms[n]);
    assert.equal(tabOfSession(session.id, [account], review.tabOf(session.id)), null, 'its tab closed: the sign-in tab is nobody\'s');
  }
  review._reset();
});

test('scenario: Claude opens the form tab with the session in the mark, the sign-in is on another host: the first report already belongs to that session (12 Oct 2026)', async () => {
  const store = {};
  globalThis.chrome = {runtime: {getManifest: () => ({version: 'test'}), sendMessage: async () => {}}, storage: {local: {get: async () => ({}), set: async () => {}}, session: {
    async get(keys) { return Object.fromEntries([].concat(keys).filter(key => key in store).map(key => [key, store[key]])); }, async set(items) { Object.assign(store, items); }, async remove() {}}}};
  const {identityOf} = await import('../../extension/tab-identity.js');
  const {id} = journeyOf('f1');
  const identity = await identityOf({id: 4, url: `${SIGNIN}#jobpilotto-fill=${id}`});   // no stored session, no job: the address alone says whose tab it is
  const resolved = resolveSession(identity, {get: terminals.get, list: terminals.list, isFormOf: () => false});
  assert.equal(resolved, 'f1');
});

test('scenario: Reopen opens the form again for the SAME session: its new tab\'s first report resolves to that session, whatever page it lands on (12 Oct 2026)', async () => {
  const store = {};
  globalThis.chrome = {runtime: {getManifest: () => ({version: 'test'}), sendMessage: async () => {}}, storage: {local: {get: async () => ({}), set: async () => {}}, session: {
    async get(keys) { return Object.fromEntries([].concat(keys).filter(key => key in store).map(key => [key, store[key]])); }, async set(items) { Object.assign(store, items); }, async remove() {}}}};
  const {identityOf} = await import('../../extension/tab-identity.js');
  const {id} = journeyOf('f1');
  const spawned = [];
  assert.equal(apply.openOne(POSTING, {session: id, open: (...args) => { spawned.push(args); return {unref() {}}; }}).ok, true);
  const address = spawned[0].flat(3).find(item => String(item).startsWith('http'));
  const landed = await identityOf({id: 9, url: address.replace(/^https:\/\/[^/]+\/.*#/, `${SIGNIN}#`)});   // redirected to another host: the mark stays
  assert.equal(resolveSession(landed, {get: terminals.get, list: terminals.list, isFormOf: () => false}), 'f1');
});

test('scenario: the sessions page opens after a restart: a session with no evidence of its tab says "checking", one Chrome shows is open, one the extension saw leave is closed (12 Oct 2026)', async () => {
  const review = await import('../lib/review.js');
  const {sessionsWithTab} = await import('../lib/session-tab.js');
  const {checkingTabs, tabNotFound} = await import('../renderer/session-state.js');
  review._reset();
  const ids = ['a1', 'b2', 'c3'];
  const items = ids.map(id => ({id, kind: 'form', status: 'done', url: `https://forms.example/${id}`}));
  review.noteTabs({ids: [11], boot: 'run1', sessions: {11: 'c3'}}, new Set(ids));   // the extension's report: c3's tab is bound
  review.noteTabs({ids: [], boot: 'run1'}, new Set(ids));                          // and then it leaves
  const live = sessionsWithTab(items, [{id: 21, url: 'https://forms.example/a1/application#jobpilotto-fill=a1'}], () => '');   // Chrome's list right now
  const {ids: open, unsure} = review.formStates(ids, live);
  assert.deepEqual([open, unsure], [['a1'], ['b2']]);                                // c3: closed (known gone); b2: nothing says either
  const forms = {known: true, ids: open, unsure};
  assert.deepEqual(items.map(item => checkingTabs(item, forms, 1000)), [false, true, false]);     // the first look: b2 checks
  assert.deepEqual(items.map(item => tabNotFound(item, forms, 1e9)), [false, true, false]);       // after it: b2 says "Tab not found", never checking for ever
});

test('scenario: Apply on an Ashby job opens the form address; its first report with no session id still lands on the session (12 Oct 2026, the owner\'s stale "Form open")', async () => {
  const review = await import('../lib/review.js');
  review._reset();
  const posting = 'https://jobs.ashbyhq.com/acme/621bb104-9daa-4c9e-949a-03d5730334e8';
  const sessions = [{id: 'k1', url: posting, company: 'Acme', kind: 'form', status: 'done', startedAt: '2026-10-12T10:00:00Z'}];
  const formAddress = `${posting}/application`;
  const reply = review.report(sessions, {url: `${formAddress}#jobpilotto-fill`, job: formAddress, tab: 7, left: 2, total: 5, watch: []});
  assert.equal(reply.matched, 'k1');
  review.noteTabs({ids: [7], boot: 'run1', sessions: {7: 'k1'}}, new Set(['k1']));
  assert.equal(review.tabOpen('k1'), true);
  review.noteTabs({ids: [], boot: 'run1'}, new Set(['k1']));
  assert.equal(review.tabOpen('k1'), false);
});

test('scenario: a weak page-kind answer on an account page is asked again on the next visit, a sure one is kept (12 Oct 2026)', async () => {
  const fs = await import('node:fs'), os = await import('node:os'), path = await import('node:path');
  const {kindKey, pageKind, pageKindCache} = await import('../lib/page-kind.js');
  const cache = pageKindCache(path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'jp-kind-')), 'page-kinds.json'));
  const page = {url: 'https://accounts.example-careers.test/login', title: 'Log in or create account', headings: ['Log in or create account'], buttons: ['Continue'], fields: [{label: 'Email', type: 'text'}]};
  const said = [];
  const ai = answer => ({messages: {create: async () => { said.push(answer); return {stop_reason: 'end_turn', usage: {input_tokens: 600, output_tokens: 20}, content: [{type: 'text', text: JSON.stringify(answer)}]}; }}});
  await pageKind(ai({kind: 'account', confidence: 0.6, account_step: ''}), page, cache);
  const next = await pageKind(ai({kind: 'account', confidence: 0.95, account_step: 'sign_in'}), page, cache);
  assert.deepEqual([said.length, next.by, next.accountStep, cache.get(kindKey(page))?.accountStep], [2, 'ai', 'sign_in', 'sign_in']);
});

// 12 Oct 2026, the owner's app.log: a job-list read started 14:56:15, the session's Cancel wrote Kit ready at 14:56:37, the read ended 14:56:45 with
// the old stage, and the cancelled job showed "still marked Applying but has no open session". A read asked after any engine stage write starts
// its own (lib/pipeline-commands.js afterWrite); the window never paints the older one (renderer/job-writes.js, test/job-writes.test.js).
test('scenario: a session is cancelled while the job list is being read: a read asked after it starts its own, for every engine stage write', async () => {
  const jobs = sharedRead('jobs', () => new Promise(() => {}));   // a read that is still running
  const url = 'https://jobs.example.test/sre';
  pipeline.setDemo(true);   // the engine command ends at once: nothing runs
  try {
    let running = jobs();
    for (const [write, ...args] of [['unapply', url], ['setStatus', url, 'dismissed'], ['setStatus', url, 'applied'], ['notSubmitted', url],
      ['markOutcome', url, 'Rejected'], ['deleteJob', url]]) {
      assert.equal(jobs(), running, `${write}: positive control, before the write an ask joins the running read`);
      await pipeline[write]({}, ...args);
      const next = jobs();
      assert.notEqual(next, running, `${write}: a read asked after the write must not join the one begun before it`);
      running = next;
    }
  } finally { pipeline.setDemo(false); }
});

test('scenario: the uploader emptied its input and shows the CV as a chip: the panel reports it filled and the card lists nothing left, the same truth as the fill record (one reader, 12 Oct 2026)', async () => {
  const review = await import('../lib/review.js');
  review._reset();
  const FORM_URL = 'https://jobs.example.com/upload/apply', sessions = [{id: 'c1', url: FORM_URL, startedAt: 1}];
  // What the panel sends when the one reader (extension/page/read-back.js) reads the chip as the CV: nothing pending, the CV among the filled.
  review.report(sessions, {session: 'c1', tab: 3, url: FORM_URL, total: 4, left: 0, pending: [], missing: [], filled: ['First name', 'Last name', 'Email', 'Resume'], watch: []});
  const state = review.allStates().find(item => item.id === 'c1');
  assert.deepEqual(state.pending, [], 'the card\'s left rows are the panel\'s pending list (renderer/pages/session-needs.js emptyFields reads state.pending)');
  assert.equal(state.left, 0);
  assert.ok((state.filled || []).some(item => item.label === 'Resume'), 'the CV is ticked off on the card');
  // The same page read as before the one reader (the panel saw no file in the input): the card follows the panel, word for word.
  review.report(sessions, {session: 'c1', tab: 3, url: FORM_URL, total: 4, left: 1, pending: ['Resume'], missing: ['Resume'], filled: ['First name', 'Last name', 'Email'], watch: []});
  assert.deepEqual(review.allStates().find(item => item.id === 'c1').pending, ['Resume']);
});

// The control level of the one door (extension/ladder/control-door.js, spec fill-ladder 5): a row whose log holds control doors (a control that used its tries, a verify that called one wrong, a
// repair left to the person) beside the page's own stop. The page's ending, the shadow table, the door counts and the silence clock read only the page's stop, by the `level` field.
test('scenario: control doors in a row\'s log never become the page\'s stop, its shadow question or the end of the silence clock', () => {
  const at = n => `2026-10-14T10:00:${String(n).padStart(2, '0')}.000Z [extension] fill: `;
  const log = [
    `${at(1)}progress: first_fill {}`,
    `${at(2)}dead end: stalled {"door":1,"host":"jobs.example","level":"control","reason":"tries","rung":0,"signal":"stalled","tried":3}`,
    `${at(3)}dead end: contradicted {"door":2,"host":"jobs.example","level":"control","reason":"verify","rung":4,"signal":"contradicted"}`,
    `${at(4)}dead end: refused {"door":3,"host":"jobs.example","level":"control","reason":"repair left","rung":3,"signal":"refused"}`,
    `${at(5)}dead end: other {"door":4,"ending":"unresolved","host":"jobs.example","named":false}`,
  ].join('\n');
  assert.deepEqual(stopsOf(log).map(stop => [stop.door, stop.why]), [[4, 'other']], 'one page stop; the control doors ask no question');
  assert.deepEqual(doorLines(log), {stops: 1, seen: 0});
  assert.equal(runEvents(log).filter(event => event.type === 'end').length, 1, 'only the page stop ends the silence clock');
  const control = [at(2) + 'dead end: stalled {"door":1,"level":"control","signal":"stalled"}'].join('\n');
  assert.equal(endingOf({reached: 'form', fieldList: []}, control).why === 'dead end: stalled', false, 'a control door is never the row\'s stop');
});

test('scenario: the person presses Stop mid-application (an account page, a filled form): every live application says Stopped, a late report changes nothing, the next fill\'s report starts it again (13 Oct 2026)', () => {
  const {flow, card} = journeyOf('f1');
  terminals.startForm({id: 'f2', url: 'https://apply.example/other', company: 'Other'});
  flow.reported({id: 'f1', url: SIGNIN, total: 1, left: 1, account: true});
  flow.reported({id: 'f2', url: FORM, total: 9, left: 4});
  assert.equal(stopLiveForms(terminals), 2);
  assert.equal(terminals.get('f1').stuck, 'stopped');
  assert.equal(terminals.get('f2').stuck, 'stopped');
  assert.equal(card().needs, STOPPED);
  flow.stuck({url: POSTING, host: 'www.jobs.ch', why: 'no-form', session: 'f1'});   // a report still on its way from a tab that has since been stopped
  assert.equal(terminals.get('f1').stuck, 'stopped');
  terminals.clearStuck('f1');   // Reopen form: the application is started again by the person
  assert.equal(terminals.get('f1').stuck, '');
  assert.equal(terminals.get('f2').stuck, 'stopped', 'only the reopened one starts');
});

// #961: the fill the Stop cut short reports "Stopped by you." as its error; the card stays Stopped and the error watcher (Sentry, Telegram) sees no error.
test('scenario: a fill cut short by Stop reports its error late: the card stays Stopped and no fill error is raised (#961)', () => {
  const {flow, card} = journeyOf('f1');
  flow.reported({id: 'f1', url: FORM, total: 9, left: 4});
  assert.equal(stopLiveForms(terminals), 1);
  flow.stuck({url: FORM, host: 'apply.example', why: 'error', session: 'f1'});
  assert.equal(card().needs, STOPPED);
  assert.equal(classify({kind: 'fill', text: 'the page fill failed', fields: {error: 'Stopped by you.', stopped: true}}), null);
});

test('scenario: a sign-up fill leaves Captcha, Your password and Repeat Password unanswered: none becomes an "Answer once" question, a real one still does (13 Oct 2026)', async () => {
  const storage = createStorage(path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'jp-')), 'x'), {encrypt: v => v, decrypt: v => v});
  storage.setSecret('NOTION_TOKEN', 'ntn');
  storage.saveSettings({notionIds: {NOTION_PROFILE_PAGE_ID: 'profile', NOTION_ANSWERS_PAGE_ID: 'answers'}, telemetry: false});
  const added = [];
  const fetcher = async (url, init = {}) => { if (init.method === 'PATCH') added.push(JSON.parse(init.body)); return {ok: true, json: async () => ({results: [], has_more: false})}; };
  const trace = ['Captcha', 'Your password', 'Repeat Password', 'Visa sponsorship?'].map(label => ({required: true, reason: questions.NO_ANSWER, label}));
  assert.equal(await questions.collect(storage, {trace}, 'Move UP SA', fetcher), 1);
  assert.doesNotMatch(JSON.stringify(added), /captcha|password/i);
});

test('scenario: Free is on, the person presses the API key card: Free is left, its token forgotten, the chooser shows the API key and an empty key box (#1017)', async () => {
  const {leave} = await import('../lib/ai-free.js');
  const {chosen} = await import('../renderer/ai-engine-view.js');
  let settings = {aiFree: true, aiEngine: 'api'}; const secrets = {ANTHROPIC_API_KEY: 'JPF1.inst.tok'};
  const storage = {settings: () => settings, saveSettings: p => { settings = {...settings, ...p}; }, secret: n => secrets[n] || '', setSecret: (n, v) => { secrets[n] = v; }};
  assert.equal(chosen(settings, !!secrets.ANTHROPIC_API_KEY), 'free');
  leave(storage, {});
  assert.equal(chosen(settings, !!secrets.ANTHROPIC_API_KEY), 'api');
  assert.equal(secrets.ANTHROPIC_API_KEY, '');
});

test('scenario: Fill in Chrome pressed twice on one job with its tab open: one tab, the session keeps it, the open tab refills (22 Oct 2026, beta run 8)', async () => {
  terminals._reset(); review._reset();
  const opened = [], focused = [];
  const options = {open: (...args) => { opened.push(args); return {unref() {}}; }, focus: async arg => { focused.push(arg.id); return 'tab'; }, run: async () => {}, id: () => 'f1'};
  const first = await apply.applyOne({}, FORM, {company: 'A'}, options);
  assert.equal(opened.length, 1);
  review.noteTabs({ids: [5], boot: 'b1', sessions: {5: first.session.id}}, new Set([first.session.id]));   // the extension reports the tab open and carrying the session
  await apply.applyOne({}, FORM, {company: 'A'}, options);
  assert.equal(opened.length, 1, 'the second press opens no second tab');
  assert.deepEqual(focused, [first.session.id]);
  const reply = review.report([{id: first.session.id, url: FORM, kind: 'form'}], {url: FORM, session: first.session.id, tab: 5, boot: 'b1', total: 9, left: 0});
  assert.ok(reply.commands.some(command => command.reload), 'the open tab reloads, so its mark fills the form again');
  assert.equal(review.tabOf(first.session.id), 5, 'the session stays on its one tab');
});

const claude = (button, sent = [], effect = 'closes_only') => ({messages: {create: async request => { sent.push(request); return {stop_reason: 'end_turn', content: [{type: 'text', text: JSON.stringify({button, effect})}]}; }}});
const popup = {text: 'Bleiben Sie auf dem Laufenden mit unserem Newsletter!', buttons: ['Jetzt anmelden', 'Nein, danke']};
const storageOf = () => createStorage(fs.mkdtempSync(path.join(os.tmpdir(), 'pilot-')), {encrypt: v => Buffer.from(v).reverse().toString('base64'), decrypt: s => Buffer.from(s, 'base64').reverse().toString()});

// #520: start() made a form session per job and then found no browser: the sessions stayed in the Applying page with no tab (applyOne already removes its own).
test('scenario: Apply to N jobs with no browser installed leaves no form session behind in Applying (#520)', async () => {
  const real = process.platform, home = {HOME: process.env.HOME, LOCALAPPDATA: process.env.LOCALAPPDATA, ProgramFiles: process.env.ProgramFiles, 'ProgramFiles(x86)': process.env['ProgramFiles(x86)']};
  process.env.HOME = process.env.LOCALAPPDATA = process.env.ProgramFiles = process.env['ProgramFiles(x86)'] = fs.mkdtempSync(path.join(os.tmpdir(), 'jp-home-'));   // a Windows runner has Chrome under Program Files   // the launcher reads a browser's profile folder: never the owner's
  Object.defineProperty(process, 'platform', {value: 'win32'});   // the only launcher that returns null when no browser is installed
  const before = terminals.list().map(s => s.id);
  try {
    const result = await apply.start(storageOf(), {n: 1, mode: 'chrome'}, () => ({unref() {}}),
      async () => ({jobs: [{url: 'https://jobs.example.test/nochrome-520', status: 'saved', fit: 60, title: 'SRE', company: 'A', kit: true}]}));
    assert.equal(result.ok, false);
    assert.match(result.error, /No supported browser/, 'the test must reach the no-browser branch');
    const left = terminals.list().filter(s => !before.includes(s.id));
    left.forEach(s => terminals.remove(s.id));
    assert.deepEqual(left.map(s => s.url), []);
  } finally { Object.defineProperty(process, 'platform', {value: real}); for (const [name, value] of Object.entries(home)) { if (value === undefined) delete process.env[name]; else process.env[name] = value; } }
});

// #962: a pick kept before the effect floor (c8e0113) had no effect on record and was pressed anyway for up to 30 days.
test('scenario: a popup pick kept before the closes_only floor (no effect on record) is asked again, never pressed blind (#962)', async () => {
  const files = {}, storage = {readText: name => files[name] ?? null, writeText: (name, text) => { files[name] = text; }}, sent = [];
  await pickDismiss(storage, popup, {client: claude('Nein, danke', sent)});
  const kept = JSON.parse(storage.readText('popup-picks.json')), [key] = Object.keys(kept);
  assert.equal(kept[key].e, 'closes_only', 'the effect is kept with the pick');
  delete kept[key].e;   // what an older install holds
  storage.writeText('popup-picks.json', JSON.stringify(kept));
  assert.deepEqual(await pickDismiss(storage, popup, {client: claude('Jetzt anmelden', sent, 'declines_consent')}), {button: '', how: 'ai'});
  assert.equal(sent.length, 2, 'asked again');
  assert.deepEqual(await pickDismiss(storage, popup, {client: claude('x', sent)}), {button: '', how: 'kept'}, 'a kept "none" needs no effect');
});

test('scenario: Apply answers after its job is marked Applying: a list read asked then is a fresh one, so the Jobs chips count it (#1737, 24 Oct 2026)', async () => {
  terminals._reset();
  const jobs = sharedRead('jobs', () => new Promise(() => {}));   // a read that began before the press, still running
  const running = jobs();
  const run = () => new Promise(resolve => setTimeout(() => resolve({}), 10));   // the engine's Stage write takes a moment
  const result = await apply.applyOne({}, 'https://jobs.example.test/apply-1737', {company: 'E2E'}, {open: () => ({unref() {}}), term: terminals, run, id: () => 'j1737', focus: () => {}});
  assert.equal(result.ok, true);
  assert.notEqual(jobs(), running, 'Apply answered while its Applying write was still running: the window re-read the old stage');
  terminals._reset();
});

// The replay app does not run setup or the review queue: prove their shared missing-letter state through the desktop boundary.
test('scenario: attached CV and complete required fields still leave missing cover-letter setup HIGH PRIORITY', async () => {
  const {openShown} = await import('../lib/question-lists.js');
  const {me} = await import('../lib/server-contact.js');
  const {availableLetter} = await import('../lib/letter-availability.js');
  const storage = createStorage(fs.mkdtempSync(path.join(os.tmpdir(), 'jp-letter-journey-')), {encrypt: v => v, decrypt: v => v});
  fs.writeFileSync(storage.path('cv.pdf'), '%PDF-fictional-CV');
  const queue = await openShown(storage, {rows: [], groups: [], ai: {client: {messages: {create: async () => { throw new Error('This setup state never needs AI'); }}}}});
  assert.equal(queue.list.filter(row => row.setup?.kind === 'cover-letter').length, 1);
  assert.equal(queue.list[0].priority, 'HIGH PRIORITY');
  const details = await me(storage, FORM);
  assert.ok(details.resume, 'the CV is attached/available while the letter is missing');
  assert.equal(details.coverLetterStatus.state, 'missing');
  assert.equal(details.coverLetterFile, null);
  review._reset();
  const sessions = [{id: 'letter-journey', url: FORM, company: 'Example', kind: 'form', status: 'done'}];
  const payload = {session: 'letter-journey', url: FORM, tab: 91, total: 3, left: 0, letterGiven: false};
  review.report(sessions, payload);
  const state = review.allStates().find(row => row.id === 'letter-journey');
  assert.equal(availableLetter(storage, FORM, {given: state.letterGiven}).status.ready, false, 'filled required fields cannot stand in for a missing letter');
  review.report(sessions, {...payload, letterGiven: true});
  const written = review.allStates().find(row => row.id === 'letter-journey');
  assert.equal(availableLetter(storage, FORM, {given: written.letterGiven}).status.source, 'form', 'a letter actually supplied satisfies this form without changing fallback consent');
});
