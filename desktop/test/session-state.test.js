// A session's state on the session page: ready for review, asking you, working, and how long it took.
import assert from 'node:assert/strict';
import {test} from 'node:test';
import fs from 'node:fs';
import {SESSION_STATE, dockCounts, dockOrder, firstLine, isLive, isSubmitted, panelAnswered, sessionDuration, sessionReview, sessionState} from '../renderer/session-state.js';

test('a filled form waiting for you is "ready for review"; a message ending on your question is not', () => {
  const report = 'The N26 form is filled and open in Chrome. Nothing was submitted.\n\n**Left for you:**\n' +
    '- ⚠️ Any relatives or partners working at N26? (required) No source.';
  // A form question listed in the report is not Claude asking you (the N26 bug).
  assert.equal(sessionReview({status: 'input', question: report}), true);
  assert.equal(sessionReview({status: 'input', question: 'The form is filled. Shall I change the visa answer?'}), false);
  // "ready for you to review … Nothing was submitted" counts (the demo's wording).
  assert.equal(sessionReview({status: 'input', question: 'The application is ready for you to review. Nothing was submitted.'}), true);
  assert.equal(sessionReview({status: 'done', note: 'Form filled — review before Submit'}), true);
  assert.deepEqual(sessionState({status: 'input', question: 'Race is set. Checking the resume.'}), ['Question for you', 'warn']);
  assert.deepEqual(sessionState({status: 'mystery'}), ['Ended', 'neutral']);
});

test('live: what the app says, else running until it ended', () => {
  assert.equal(isLive({live: false}), false);
  assert.equal(isLive({endedAt: '2026-09-29T00:00:00Z'}), false);
  assert.equal(isLive({}), true);
});

test('duration until it ended or waited for you', () => {
  const startedAt = '2026-09-29T10:00:00Z';
  assert.equal(sessionDuration({startedAt, needsYouSince: '2026-09-29T10:03:32Z'}), '3m 32s');
  assert.equal(sessionDuration({startedAt, endedAt: '2026-09-29T11:02:00Z'}), '1h 02m');
  assert.equal(sessionDuration({startedAt}, Date.parse('2026-09-29T10:00:42Z')), '42s');
});

test('a row shows whole sentences up to the limit, at least one', () => {
  assert.equal(firstLine('Short.'), 'Short.');
  assert.equal(firstLine('One sentence here. Two sentences here. Three.', 30), 'One sentence here.');
  assert.equal(firstLine('A single very long sentence without any stop at all', 10), 'A single very long sentence without any stop at all');
});

test('ready for review becomes "Ready to submit" (green) once the form page says every required field is filled', () => {
  assert.deepEqual(sessionState({status: 'done'}, true), ['Ready to submit', 'good']);
  assert.deepEqual(sessionState({status: 'done'}, false), ['Ended', 'neutral'], 'a finished process with no word from Claude is not "ready"');
  assert.deepEqual(sessionState({status: 'running'}, true), ['Applying', 'info']);  // still working: not yet
});

// "Reload the tab" is a repair, not an action: it reloads a form page (losing what was typed in it since the last
// save), so it is offered only after the page's panel has failed to answer the app (1 Oct 2026).
test('only a form page that did not answer asks for the reload repair', () => {
  assert.equal(panelAnswered({went: 'tab', taken: true}), true);      // the panel answered: nothing to repair
  assert.equal(panelAnswered({went: 'chrome', taken: false}), false); // no panel: the repair applies
  assert.equal(panelAnswered({went: 'tab', taken: false}), false);    // a tab came forward, but its panel is dead
  assert.equal(panelAnswered({went: 'posting', taken: false}), false);
  assert.equal(panelAnswered(undefined), false);
  assert.equal(panelAnswered('tab'), false);  // the old string shape cannot answer "did it?" — never "answered"
});

// A session whose application was submitted says so, whatever its process last did: it is finished, not applying.
test('a submitted session reads "Submitted", not "Ready for review"', () => {
  const done = {status: 'done', endedAt: '2026-10-01T07:37:19Z', outcome: 'submitted', question: 'The form is filled; submit it yourself.'};
  assert.deepEqual(sessionState(done), SESSION_STATE.submitted);
  assert.equal(sessionState(done)[0], 'Submitted');
  // Without the outcome it is the ordinary finished session.
  assert.equal(sessionState({...done, outcome: ''})[0], 'Ready for review');
  // A running process still Applying: the outcome only speaks for a session that is over.
  assert.equal(sessionState({status: 'running', live: true, outcome: 'submitted'})[0], 'Applying');
  // A stopped process (exit 129) whose application was submitted still reads Submitted.
  const stopped = {status: 'failed', note: 'Session stopped (exit 129)', endedAt: '2026-10-01T15:15:00Z', outcome: 'submitted', live: false};
  assert.equal(isSubmitted(stopped), true);
  assert.equal(sessionState(stopped, true)[0], 'Submitted');
  assert.equal(isSubmitted({status: 'failed', outcome: '', live: false}), false);
});

test('a form session (the Apply button) says the form is open until the extension reports it complete', () => {
  const form = {kind: 'form', status: 'done', outcome: '', live: false, endedAt: null};
  assert.deepEqual(sessionState(form), ['Form open', 'info']);
  assert.deepEqual(sessionState(form, true), SESSION_STATE.submit);
  assert.deepEqual(sessionState({...form, outcome: 'submitted'}), SESSION_STATE.submitted);
  assert.deepEqual(sessionState({status: 'done', outcome: '', endedAt: null}), ['Ended', 'neutral']);   // a Claude session that said nothing: ended, never ready
});

test('a form session the extension cannot reach says so (no form, or an account is needed)', () => {
  const form = {kind: 'form', status: 'done', outcome: '', live: false, endedAt: null};
  assert.deepEqual(sessionState({...form, stuck: 'no-form'}), ['Can\'t reach form', 'warn']);
  assert.deepEqual(sessionState({...form, stuck: 'account'}), ['Needs an account', 'warn']);
});

test('a waiting session whose form is complete is ready for review, whatever Claude last asked', () => {
  const asked = {status: 'input', question: 'Send me the missing details (street, NPA) or finish it in Chrome.', brief: 'Send me the missing details?', live: false};
  assert.equal(sessionReview(asked), false);  // the form page said nothing: Claude's question stands
  assert.equal(sessionReview(asked, true), true);  // every required field filled: it is moot
  assert.deepEqual(sessionState(asked, true), ['Ready to submit', 'good']);
  assert.deepEqual(sessionState(asked, false), ['Question for you', 'warn']);
});

test('the dock counts and orders sessions like the list: closed forms are not active, and sort after the open one', () => {
  const form = (id, status = 'done') => ({id, kind: 'form', status, live: false, endedAt: '2026-10-02T03:00:00Z', note: 'Form open in Chrome'});
  const items = [form('openai-1'), form('openai-2'), form('amazon'), {id: 'ue', kind: 'claude', status: 'input', live: true, question: 'Which visa?'}];
  const gone = item => ['openai-1', 'openai-2'].includes(item.id);
  assert.deepEqual(dockCounts(items, gone), {active: 1, waiting: 1});          // the open Amazon form; the question
  assert.deepEqual(dockCounts(items), {active: 3, waiting: 1});                // without the tab report: all three forms look open
  const shown = [...items].sort((a, b) => dockOrder(a, gone) - dockOrder(b, gone)).map(item => item.id);
  assert.deepEqual(shown, ['ue', 'amazon', 'openai-1', 'openai-2']);
});

test('the stage says whether the session is creating the account or filling the application form', async () => {
  const {sessionStage} = await import('../renderer/session-state.js');
  assert.equal(sessionStage({stage: 'account', accountHost: 'career55.sapsf.eu'}).text, 'Step 1 of 2 · Creating your account on career55.sapsf.eu');
  assert.equal(sessionStage({kind: 'form', stuck: 'account'}).step, 1);   // marked before stages existed
  assert.equal(sessionStage({stage: 'form', accountHost: 'career55.sapsf.eu'}).text, 'Step 2 of 2 · Filling the application form');
  assert.equal(sessionStage({stage: 'form'}).text, 'Filling the application form');   // no account step: no step numbers
  assert.equal(sessionStage({stage: 'form', outcome: 'submitted'}), null);
  assert.equal(sessionStage({}), null);
});

test('a session whose tab is gone is closed: a form seen before, a form session after its first minute, a Claude session no longer running', async () => {
  const {tabClosed} = await import('../renderer/session-state.js');
  const none = {known: true, ids: []}, now = Date.parse('2026-10-08T12:30:00Z'), old = '2026-10-08T10:08:00Z';
  assert.equal(tabClosed({id: 'c1', kind: 'claude', live: false, status: 'input'}, none, false, now), true);   // Migros: sign-up page, no fields ever
  assert.equal(tabClosed({id: 'c1', kind: 'claude', live: true, status: 'running'}, none, false, now), false);  // may not have opened its tab yet
  assert.equal(tabClosed({id: 'f1', kind: 'form', stuck: 'no-form', startedAt: old}, none, false, now), true);  // Manor
  assert.equal(tabClosed({id: 'f1', kind: 'form', startedAt: '2026-10-08T12:29:40Z'}, none, false, now), false);  // just opened by Apply
  assert.equal(tabClosed({id: 'f1', kind: 'form', startedAt: old}, {known: true, ids: ['f1']}, false, now), false);
  assert.equal(tabClosed({id: 'f1', kind: 'form', startedAt: old}, {known: false, ids: []}, true, now), false);   // the extension is not reporting
  assert.equal(tabClosed({id: 'f1', kind: 'form', outcome: 'submitted', live: false}, none, true, now), false);
  assert.equal(tabClosed({id: 'r1', kind: 'read', live: false}, none, false, now), false);
  assert.equal(tabClosed({id: 'c1', kind: 'claude', live: false, status: 'ended'}, {known: true, ids: [], unsure: ['c1']}, true, now), false);   // no tab known: never "closed"
});

test('just after the app starts, a session waiting on its Chrome tab is "checking" until the extension reports in', async () => {
  const {checkingTabs, CHECK_MS} = await import('../renderer/session-state.js');
  const claude = {id: 'c1', kind: 'claude', live: false, status: 'input'}, form = {id: 'f1', kind: 'form'};
  assert.equal(checkingTabs(claude, null, 500), true);                        // nothing heard yet
  assert.equal(checkingTabs(form, {known: false, ids: []}, 500), true);       // the extension has not reported in
  assert.equal(checkingTabs(form, {known: true, ids: []}, 500), false);       // known: closed or open, the card says which
  assert.equal(checkingTabs(form, null, CHECK_MS + 1), false);                // no answer in time: the last state again
  // 12 Oct 2026 (owner: "the state is not reflecting the reality"): a tab nothing confirms is never "Form open", however long ago the app started.
  assert.equal(checkingTabs(form, {known: true, ids: [], unsure: [form.id]}, 500), true);                // restart: unsure sessions check for CHECK_MS ...
  assert.equal(checkingTabs(form, {known: true, ids: [], unsure: [form.id]}, CHECK_MS + 1), false);     // ... and no longer (14 Oct 2026: "Checking…" never ended)
  assert.equal(checkingTabs(form, {known: true, ids: [form.id], unsure: []}, 500), false);
  assert.equal(checkingTabs({...claude, live: true, status: 'running'}, null, 500), false);
  assert.equal(checkingTabs({...form, outcome: 'submitted', live: false}, null, 500), false);
});

test('after the first look an unsure session says "Tab not found": never checking for ever, never closed, open again once a tab shows up (14 Oct 2026)', async () => {
  const {checkingTabs, tabClosed, tabNotFound, CHECK_MS} = await import('../renderer/session-state.js');
  const items = [{id: 'f1', kind: 'form', status: 'done'}, {id: 'c1', kind: 'claude', live: false, status: 'input'}];
  const restart = {known: true, ids: [], unsure: ['f1', 'c1']};
  for (const item of items) {
    assert.deepEqual([checkingTabs(item, restart, 1000), tabNotFound(item, restart, 1000)], [true, false], 'first look: checking');
    assert.deepEqual([checkingTabs(item, restart, CHECK_MS + 1), tabNotFound(item, restart, CHECK_MS + 1)], [false, true], 'after it: tab not found');
    assert.equal(tabClosed(item, restart, true), false, 'never "closed" for an unsure tab');
    const found = {known: true, ids: [item.id], unsure: []};   // its tab showed up: by address or the extension's report
    assert.deepEqual([checkingTabs(item, found, CHECK_MS + 1), tabNotFound(item, found, CHECK_MS + 1)], [false, false]);
    assert.equal(tabNotFound(item, {known: true, ids: [], unsure: []}, CHECK_MS + 1), false, 'known gone is "closed", not "not found"');
    assert.equal(tabNotFound(item, {known: false, ids: []}, CHECK_MS + 1), false, 'Chrome silent is its own state');
    assert.equal(tabNotFound({...item, outcome: 'submitted'}, restart, CHECK_MS + 1), false);
  }
});

test('a new session opened after the app has been up for minutes gets its own first look: "Checking…", then "Tab not found" (review of #741)', async () => {
  const {checkingTabs, tabNotFound, CHECK_MS} = await import('../renderer/session-state.js');
  const now = Date.now(), up = 10 * 60 * 1000, restart = {known: true, ids: [], unsure: ['n1', 'n2']};
  for (const kind of ['form', 'claude']) {
    const fresh = {id: 'n1', kind, live: false, status: 'input', startedAt: new Date(now - 5000).toISOString()};
    assert.deepEqual([checkingTabs(fresh, restart, up, now), tabNotFound(fresh, restart, up, now)], [true, false], 'started 5 s ago: checking');
    assert.deepEqual([checkingTabs(fresh, restart, up, now + CHECK_MS), tabNotFound(fresh, restart, up, now + CHECK_MS)], [false, true], '45 s after its own start: not found');
    const old = {...fresh, id: 'n2', startedAt: new Date(now - 3600e3).toISOString()};
    assert.deepEqual([checkingTabs(old, restart, up, now), tabNotFound(old, restart, up, now)], [false, true], 'an old session on an old window: not found');
  }
});

test('every view of the tab state (list, dock, session title, next-step card) draws "Tab not found" from the one function', () => {
  for (const file of ['sessions.js', 'session-log.js', 'session-next-step.js']) {
    const source = fs.readFileSync(new URL(`../renderer/pages/${file}`, import.meta.url), 'utf8');
    assert.match(source, /tabLost\(item\)/, `${file} draws the state without tabLost`);
  }
});

test('Applying in the menu counts every card in the list, whatever its state; the colour is the most urgent one', async () => {
  const {applyingBadge} = await import('../renderer/session-state.js');
  const level = item => item.level;
  // 8 Oct 2026: four "Form closed" cards, the badge said 2 (only the two still flagged as questions were counted).
  assert.deepEqual(applyingBadge([{level: 0}, {level: 0}, {level: 4}, {level: 4}], level), {count: 4, tone: 'warn'});
  assert.deepEqual(applyingBadge([{level: 2}, {level: 3}, {level: 4}], level), {count: 3, tone: 'info'});
  assert.deepEqual(applyingBadge([{level: 3}, {level: 3}], level), {count: 2, tone: 'good'});
  assert.deepEqual(applyingBadge([{level: 4}], level), {count: 1, tone: 'neutral'});
  assert.deepEqual(applyingBadge([], level), {count: '', tone: 'neutral'});
});

test("a session's Chrome tab on its card: host and path, no query or www, long paths cut in the middle", async () => {
  const {tabAddress} = await import('../renderer/session-state.js');
  assert.equal(tabAddress('https://www.apply.refline.ch/845721/0412/pub/1/index.html?lang=fr'), 'apply.refline.ch/845721/0412/pub/1/index.html');
  assert.equal(tabAddress('https://jobs.coop.ch/'), 'jobs.coop.ch');
  const long = tabAddress('https://jobs.coop.ch/Coop/job/Nyon-Assistante-Assistant-du-commerce-de-d%C3%A9tail-AFP-Vaud/1405093533/');
  assert.ok(long.length <= 70 && long.startsWith('jobs.coop.ch/Coop/job/') && long.endsWith('AFP-Vaud/1405093533'), long);
  assert.equal(tabAddress(''), '');
  assert.equal(tabAddress(undefined), '');
});

test('after the first look, a session waiting on its tab says Chrome is not reporting until the extension does', async () => {
  const {chromeSilent, CHECK_MS} = await import('../renderer/session-state.js');
  const claude = {id: 'c1', kind: 'claude', live: false, status: 'input'}, form = {id: 'f1', kind: 'form'};
  const {WAIT_MS} = await import('../renderer/session-state.js');
  assert.equal(chromeSilent(form, {known: false, ids: []}, WAIT_MS + 1), true);
  assert.equal(chromeSilent(claude, null, WAIT_MS + 1), true);                         // the app never heard back at all
  assert.equal(chromeSilent(form, {known: false, ids: []}, 500), false);                // still the first look ("Checking…")
  assert.equal(chromeSilent(form, {known: true, ids: []}, CHECK_MS + 1), false);        // reporting: closed or open, the card says which
  assert.equal(chromeSilent({...claude, live: true, status: 'running'}, null, CHECK_MS + 1), false);
  assert.equal(chromeSilent({...form, outcome: 'submitted', live: false}, null, CHECK_MS + 1), false);
});

test('Claude working on a sign-in or sign-up page says "Creating account", not "Applying"', () => {
  assert.deepEqual(sessionState({kind: 'claude', status: 'running', stage: 'account', live: true}), ['Creating account', 'info']);
  assert.notDeepEqual(sessionState({kind: 'claude', status: 'running', stage: 'form', live: true}), ['Creating account', 'info']);
  assert.deepEqual(sessionState({kind: 'form', stuck: 'account', status: 'done'}), ['Needs an account', 'warn']);
});

test('a stopped Claude session whose form is open in Chrome reads "Form open", like the Apply button\'s session', async () => {
  const {sessionState} = await import('../renderer/session-state.js');
  assert.deepEqual(sessionState({id: 'c1', kind: 'claude', status: 'done', inChrome: true, live: false}), ['Form open', 'info']);
  assert.equal(sessionState({id: 'c1', kind: 'claude', status: 'ended', live: false})[0], 'Ended');
});

test('a hand-over in any language is "ready for review" by its fixed status line, which the card hides (8 Oct 2026)', async () => {
  const {readSessionMessage} = await import('../renderer/session-message.js');
  const french = 'Le formulaire est rempli dans l\'onglet ouvert ; rien n\'a été envoyé.\n- **Rempli :** 14 champs.\nStatus: ready-for-review';
  assert.equal(sessionReview({status: 'input', question: french}), true);
  assert.deepEqual(sessionState({status: 'input', question: french}), ['Ready for review', 'warn']);
  assert.equal(sessionReview({status: 'input', question: french.replace(/\nStatus.*$/, '')}), false, 'without the line, French words are not read');
  assert.ok(!JSON.stringify(readSessionMessage(french)).includes('ready-for-review'));
  assert.equal(sessionReview({status: 'input', question: 'Status: ready-for-review\nQuelle adresse dois-je utiliser ?'}), false, 'a question to you still wins');
});

test('the account made for an application shows on its session: "Confirm your email" while a mail is awaited, "Account created" once it is usable', async () => {
  const {sessionStage, sessionState} = await import('../renderer/session-state.js');
  assert.deepEqual(sessionState({kind: 'form', status: 'done', accountState: 'confirm'}), ['Confirm your email', 'info']);
  assert.equal(sessionStage({stage: 'account', accountState: 'confirm', accountHost: 'jobs.example.ch'}).text.startsWith('Step 1 of 2 · Creating your account'), true);   // still on the account page
  assert.equal(sessionStage({stage: 'form', accountState: 'confirm', accountHost: 'jobs.example.ch'}).text, 'Step 1 of 2 · Confirm your email on jobs.example.ch');
  assert.equal(sessionStage({stage: 'form', accountState: 'created', accountHost: 'jobs.example.ch'}).text, 'Step 2 of 2 · Account created · Filling the application form');
  // A sign-in the site refused: the card says so, instead of "Form open" and "Sign in" over a page that rejected it (10 Oct 2026). Any later account state replaces it.
  assert.deepEqual(sessionState({kind: 'form', status: 'done', accountState: 'refused'}), ['Sign-in refused', 'warn']);
  assert.deepEqual(sessionState({kind: 'form', status: 'done', accountState: 'refused', stuck: 'account', accountNeeds: 'x'})[0], 'Needs you', 'a page the person must finish keeps its own label');
  assert.equal(sessionStage({stage: 'account', accountState: 'refused', accountHost: 'apply.deloitte.ch'}).text, 'Step 1 of 2 · Sign-in refused on apply.deloitte.ch: tried once, not retried');
  assert.equal(sessionStage({stage: 'account', accountState: 'refused'}).tone, 'warn');
  assert.deepEqual(sessionState({kind: 'form', status: 'done', accountState: 'confirm'}), ['Confirm your email', 'info'], 'the next state replaces it');
  assert.equal(sessionStage({outcome: 'submitted', accountState: 'refused'}), null, 'a submitted application is finished whatever happened at the door');
  assert.equal(sessionStage({stage: 'form'}).text, 'Filling the application form');
});

import {accountCardOf, accountProgress} from '../renderer/session-state.js';
test('the account step has its own card: count of its fields, what is left for you first (the AI\'s next press), never "Ready to submit"', () => {
  const state = {account: true, total: 10, left: 2, needs: 'Solve the check, then press "Créer un compte"', pending: ['Mot de passe'], ready: false};
  const card = accountCardOf({accountStep: 'sign_up'}, state);
  assert.deepEqual([card.title, card.done, card.total, card.count], ['Account page', 8, 10, ' of 10 fields filled']);
  assert.deepEqual(card.left, ['Solve the check, then press "Créer un compte"', 'Mot de passe']);   // the next press first
  assert.deepEqual(card.pill, {text: 'Needs you: Solve the check, then press "Créer un compte"', tone: 'warn'});
  assert.equal(accountCardOf({accountStep: 'sign_in'}, state).title, 'Sign-in page');
  assert.deepEqual(accountCardOf({}, {account: true, total: 3, left: 1, needs: '', missing: ['Email']}).pill, {text: '1 remaining', tone: 'warn'});
  assert.deepEqual(accountCardOf({}, {account: true, total: 3, left: 0, needs: ''}).pill, {text: 'All fields filled', tone: 'good'});
  assert.equal(accountCardOf({}, {account: true, total: 2, left: 0, needs: '1'}).left[0], 'See what the page asks');   // the AI said "something", no words
  assert.equal(accountCardOf({}, {account: false, total: 10, left: 2}), null);   // the application form keeps its own card
  assert.equal(accountCardOf({}, {account: true, total: 0, left: 0}), null);
});

test('an account stop says how far its page is instead of "nothing filled yet"; no report yet keeps the old words', () => {
  assert.equal(accountProgress({account: true, total: 10, left: 2}), '· 8 of 10 filled');
  assert.equal(accountProgress(undefined), '· nothing filled yet');
  assert.equal(accountProgress({account: false, total: 10, left: 2}), '· nothing filled yet');
});

test('the first look at Chrome waits longer than one report of the extension, so a working Chrome is never called silent', async () => {
  const fs = await import('node:fs');
  const {CHECK_MS} = await import('../renderer/session-state.js');
  const alarm = fs.readFileSync(new URL('../../extension/report-alarm.js', import.meta.url), 'utf8');
  const period = Number(alarm.match(/periodInMinutes = ([\d.]+)/)[1]) * 60 * 1000;
  assert.ok(CHECK_MS >= period + 10 * 1000, `CHECK_MS ${CHECK_MS} ms vs the extension's report every ${period} ms (9 Oct 2026: 15 s vs 30 s)`);
});


test('a permission-blocked account report is never a filled application', () => {
  const question = "I'm stopped on the sign-in page. My click on Continue was blocked by a permission check, so the form is not filled and nothing was submitted. I've typed your email into the box.\n\n**Needs you:**\n- Press Continue in Chrome, then reply continue.\n- Or say allow it if you want me to press Continue myself.";
  for (const status of ['input', 'done']) {
    const item = {kind: 'claude', status, question, stage: 'account', live: false};
    assert.equal(sessionReview(item), false);
    assert.equal(sessionReview(item, true), false, 'account fields are not the application');
    assert.notEqual(sessionState(item)[0], 'Ready for review');
  }
  assert.equal(sessionReview({status: 'input', question}), false, 'older records without a stage are safe too');
  assert.equal(sessionReview({status: 'input', question: 'Nothing was submitted.'}), false);
  assert.equal(sessionReview({status: 'input', question: 'Filled 1 of 12 fields. Review before you submit.'}), false);
  assert.equal(sessionReview({kind: 'claude', status: 'done'}), false, 'a finished process proves no completion');
  assert.equal(sessionReview({status: 'input', stage: 'account', question: 'Status: ready-for-review'}), false);
});


test('an open extension form is not ready for review until its fields are complete', () => {
  const item = {kind: 'form', status: 'done', live: false};
  assert.equal(sessionReview(item, false), false);
  assert.deepEqual(sessionState(item, false), ['Form open', 'info']);
  assert.equal(sessionReview(item, true), true);
  assert.deepEqual(sessionState(item, true), ['Ready to submit', 'good']);
});


test('Claude stopped on an account page with things for you: "Needs you", never ready, and the needs card keeps its rows', async () => {
  const {leftForYou} = await import('../renderer/session-state.js');
  // The owner's 12 Oct 2026 case, fictional words: a finished session, stage account, a report with a "Needs you" list.
  const question = 'I stopped on the sign-in page: my click on Continue was blocked by a permission check, so the form is not filled.\n\n**Needs you:**\n- Press Continue in Chrome, then reply continue.\n- Or say allow it.';
  const item = {kind: 'claude', status: 'done', stage: 'account', question, live: false, endedAt: '2026-10-12T04:05:00Z'};
  assert.equal(sessionReview(item), false);
  assert.equal(leftForYou(item), true);
  assert.deepEqual(sessionState(item), ['Needs you', 'warn']);
  // The card of what Claude needs is shown whenever it has rows, also while Claude asks: its answer boxes and "Remember" live there (owner, 8 Oct 2026).
  const page = fs.readFileSync(new URL('../renderer/pages/session-next-step.js', import.meta.url), 'utf8');
  assert.match(page, /show\(\$\('ss-needs-card'\), needs\.length \+ empty\.length > 0 && !gone\)/);
  assert.doesNotMatch(page, /What Claude needs from you:'/, 'the list is the card below, not a second copy in the top card');
  const needs = fs.readFileSync(new URL('../renderer/pages/session-needs.js', import.meta.url), 'utf8');
  assert.equal((needs.match(/if \(item\.stage !== 'account'\) actions\.append\(reviewButton\(/g) || []).length, 2, 'no form to review on the account step (decision and ask rows)');
});

test('right after the app starts a silent Chrome is a neutral wait; the warning comes after WAIT_MS', async () => {
  const {chromeSilent, chromeWaiting, CHECK_MS, WAIT_MS} = await import('../renderer/session-state.js');
  const form = {id: 'f1', kind: 'form'}, none = {known: false, ids: []};
  assert.equal(chromeWaiting(form, none, CHECK_MS + 1), true);
  assert.equal(chromeSilent(form, none, CHECK_MS + 1), false);          // 45-60 s: no warning yet
  assert.equal(chromeWaiting(form, none, 500), false);                   // the first look is "Checking…"
  assert.equal(chromeSilent(form, none, WAIT_MS + 1), true);
  assert.equal(chromeWaiting(form, none, WAIT_MS + 1), false);
  assert.equal(chromeWaiting(form, {known: true, ids: []}, CHECK_MS + 1), false);
});

test('a frozen Claude ask yields to a live application-form report of the session\'s tab', async () => {
  const {askOutdated} = await import('../renderer/session-state.js');
  const frozen = {id: 'a1', kind: 'claude', status: 'input', live: false, stage: 'account'};
  assert.equal(askOutdated(frozen, {total: 6, left: 2}), true);               // frozen at the account step, the live tab shows the form
  assert.equal(askOutdated(frozen, {total: 9, left: 9, account: true}), false); // still a sign-in page: the ask stands
  assert.equal(askOutdated(frozen, undefined), false);                         // no report: nothing says it changed
  assert.equal(askOutdated({...frozen, live: true, status: 'input'}, {total: 6}), false);   // Claude is running: its ask is live
});

// #1433: a form that is ready (Review, 5 of 5 filled) never reads "Filling the application form" next to its "Ready to submit" state.
test('the stage chip says the form is filled once the session is ready to review', async () => {
  const {sessionStage} = await import('../renderer/session-state.js');
  assert.equal(sessionStage({stage: 'form'}, true).text, 'Application form filled');
  assert.equal(sessionStage({stage: 'form', accountHost: 'jobs.example.ch', accountState: 'created'}, true).text, 'Step 2 of 2 · Account created · Application form filled');
  assert.equal(sessionStage({stage: 'form'}, false).text, 'Filling the application form');
});

// #1676: "Applying" and "Ready to submit" are the Jobs list's server rule (ready-rows.js); the menu's foot counts local sessions and says "session(s)".
test('the menu foot names local sessions, never the Jobs chips\' words', async () => {
  const {sessionsFoot} = await import('../renderer/session-state.js');
  const lines = [[3, 0, 0, 5], [0, 10, 0, 10], [0, 0, 2, 2], [0, 0, 0, 1], [1, 0, 0, 1]].map(([needs, working, ready, all]) => sessionsFoot(needs, working, ready, all).text);
  assert.deepEqual(lines, ['3 sessions need you', '10 sessions open', '2 sessions filled', '1 session', '1 session needs you']);
  for (const line of lines) assert.doesNotMatch(line, /applying|ready to submit/i);
});
