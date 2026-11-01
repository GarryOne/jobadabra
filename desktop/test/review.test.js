// The form page's ring and the session page, in step (lib/review.js).
import assert from 'node:assert/strict';
import {test} from 'node:test';
import * as review from '../lib/review.js';

const sessions = [
  {id: 's1', url: 'https://www.anthropic.com/jobs/4567890', company: 'Anthropic', startedAt: '2026-09-29T00:20:00Z'},
  {id: 's2', url: 'https://n26.com/en/careers/positions/7012345', company: 'N26', startedAt: '2026-09-29T00:10:00Z'},
];
const form = (extra = {}) => ({url: 'https://job-boards.greenhouse.io/anthropic/jobs/4567890', title: 'Job Application for Staff+ Engineer at Anthropic',
  session: 's1', left: 3, total: 20, watch: [], ...extra});   // the tab carries its session (the id in its address, bound by the extension)

test('a form page belongs to its session by the id it carries, the id in its address, or the job its tab was opened for: nothing else', () => {
  assert.equal(review.sessionFor(sessions, {url: 'https://x.test/a', session: 's2'}).id, 's2');
  assert.equal(review.sessionFor(sessions, {url: 'https://x.test/a#jobadabra-fill=s1'}).id, 's1');
  assert.equal(review.sessionFor(sessions, {url: 'https://x.test/a', job: 'https://www.anthropic.com/jobs/4567890/'}).id, 's1');
  assert.equal(review.sessionFor(sessions, form({session: ''})), null, 'the company in the title and the job ID in the address no longer pick a session');
  assert.equal(review.sessionFor(sessions, {url: 'https://news.ycombinator.com/', title: 'Hacker News'}), null);
});

test('the page learns what to watch, reports it back, and the session page hears about changes only', () => {
  review._reset();
  const heard = [];
  review.setReporter(state => heard.push(state));
  review.setWatch('s1', [{id: 'w1', label: 'AI Policy for Application'}, {id: 'w2', label: 'Agreement to Arbitrate'}]);
  let reply = review.report(sessions, form());
  assert.equal(reply.matched, 's1');
  assert.deepEqual(Object.keys(reply.session).sort(), ['company', 'id', 'kind', 'live', 'note', 'status', 'stuck', 'title', 'url']);  // no answers, no question text (kind, stuck: fixed words for the panel's Take over)
  assert.deepEqual(reply.watch.map(item => item.label), ['AI Policy for Application', 'Agreement to Arbitrate']);
  assert.deepEqual(heard.map(state => [state.left, state.ready]), [[3, false]]);
  review.report(sessions, form());  // nothing changed: not passed on again
  assert.equal(heard.length, 1);
  review.report(sessions, form({left: 2, watch: [{id: 'w1', filled: true}, {id: 'w2', filled: false}, {id: 'w3', filled: null}]}));
  assert.deepEqual(heard.at(-1).states, {w1: true, w2: false});  // a field not found on the page (null) says nothing
  review.report(sessions, form({left: 0, watch: [{id: 'w1', filled: true}, {id: 'w2', filled: true}]}));
  assert.equal(heard.at(-1).ready, true);
  assert.equal(review.report(sessions, form({left: 0, total: 0})).matched, 's1');
  assert.equal(heard.at(-1).ready, false);  // no required field seen: never "ready"
});

test('"show me this field" reaches the matching page once, and expires', () => {
  review._reset();
  review.queueFocus('s1', 'Agreement to Arbitrate', 1000);
  assert.deepEqual(review.report(sessions, {url: 'https://job-boards.greenhouse.io/n26/jobs/1', title: 'N26'}, 2000).commands, []);  // another job's page
  assert.deepEqual(review.report(sessions, form(), 2000).commands, [{focus: 'Agreement to Arbitrate'}]);
  assert.deepEqual(review.report(sessions, form(), 3000).commands, []);  // taken
  review.queueFocus('s1', 'Old', 0);
  assert.deepEqual(review.report(sessions, form(), 10 * 60 * 1000).commands, []);  // too old
});

test('"reload that page" reaches the panel of the matching page once, and expires', () => {
  review._reset();
  review.queueReload('s1', 1000);
  assert.deepEqual(review.report(sessions, {url: 'https://news.ycombinator.com/', title: 'Hacker News'}, 2000).commands, []);  // another page
  assert.deepEqual(review.report(sessions, form(), 2000).commands, [{reload: true}]);
  assert.deepEqual(review.report(sessions, form(), 3000).commands, []);  // taken
  review.queueReload('s1', 0);
  assert.deepEqual(review.report(sessions, form(), 10 * 60 * 1000).commands, []);  // too old
});

test('"show me this field": the app learns whether a form page took it, or that none did', async () => {
  review._reset();
  review.queueFocus('s1', 'Agreement to Arbitrate');
  const taken = review.delivered('s1', 2000);
  review.report(sessions, form());  // the page's next report picks it up
  assert.equal(await taken, true);
  review.queueFocus('s2', 'Privacy');
  assert.equal(await review.delivered('s2', 30), false);  // no page with the extension answered
});

test('"close this form" reaches the matching page once, and the app hears that it was taken', async () => {
  review._reset();
  review.queueClose('s1');
  const taken = review.delivered('s1', 2000);
  assert.deepEqual(review.report(sessions, form()).commands, [{close: true}]);
  assert.equal(await taken, true);
  assert.deepEqual(review.report(sessions, form()).commands, []);
});

test('a window that just loaded gets every form\'s last state (they are passed on only when they change)', () => {
  review._reset();
  const heard = [];
  review.setReporter(state => heard.push(state));
  review.setWatch('s1', [{id: 'w1', label: 'AI Policy for Application'}]);
  review.report(sessions, form({left: 0, watch: [{id: 'w1', filled: true}]}));
  review.report(sessions, form({left: 0, watch: [{id: 'w1', filled: true}]}));  // unchanged: not passed on again…
  assert.equal(heard.length, 1);
  const all = review.allStates();  // …but a reloaded window asks, and gets it
  assert.deepEqual(all.map(state => [state.id, state.ready, state.states]), [['s1', true, {w1: true}]]);
});

test('the last form states are saved and come back after a restart (only for sessions that still exist)', async () => {
  const {mkdtempSync} = await import('node:fs');
  const {tmpdir} = await import('node:os');
  const file = `${mkdtempSync(`${tmpdir()}/review-`)}/review-states.json`;
  review._reset();
  review.persist(file);
  review.report(sessions, form({left: 0, total: 14}));
  review._reset();
  review.persist(file, ['s1']);
  assert.deepEqual(review.allStates().map(state => [state.id, state.ready]), [['s1', true]]);
  review._reset();
  review.persist(file, ['s2']);
  assert.deepEqual(review.allStates(), []);
});

test('each filled field is ticked off with the time it was first seen, and keeps that time', () => {
  review._reset();
  const heard = [];
  review.setReporter(state => heard.push(state));
  review.report(sessions, form({filled: ['First name'], busy: true}), 1000);  // already filled when first heard of: no time
  review.report(sessions, form({left: 2, filled: ['First name', 'Email'], busy: true}), 3000);
  review.report(sessions, form({left: 1, filled: ['First name', 'Email', 'Phone'], over: true}), 5000);  // after the fill: you
  assert.deepEqual(heard.at(-1).filled, [{label: 'First name', at: null, by: 'fill'}, {label: 'Email', at: 3000, by: 'fill'},
    {label: 'Phone', at: 5000, by: 'you'}]);
  review.report(sessions, form({left: 1, filled: ['First name', 'Email', 'Phone'], over: true}), 9000);  // nothing new: not passed on again
  assert.equal(heard.length, 3);
  review.report(sessions, form({left: 3, filled: ['First name']}), 9500);  // emptied again: off the list
  assert.deepEqual(heard.at(-1).filled.map(item => item.label), ['First name']);
});

test('a waiting "show me this field" names the open tab to join, and no other tab', () => {
  review._reset();
  assert.deepEqual(review.tabsToArm(sessions, [{url: 'https://job-boards.greenhouse.io/anthropic/jobs/4567890#jobadabra-fill=s1', title: 'Anthropic'}]), []);
  review.queueFocus('s1', 'Agreement to Arbitrate', 1000);
  assert.deepEqual(review.tabsToArm(sessions, [
    {url: 'https://news.ycombinator.com/', title: 'Hacker News'},
    {url: 'https://job-boards.greenhouse.io/anthropic/jobs/4567890#jobadabra-fill', title: 'Job Application for Staff+ Engineer at Anthropic'},
    {url: 'https://job-boards.greenhouse.io/anthropic/jobs/4567890#jobadabra-fill=s1', title: 'Job Application for Staff+ Engineer at Anthropic'},
  ], 2000), ['https://job-boards.greenhouse.io/anthropic/jobs/4567890']);
  review.report(sessions, form(), 2000);  // the page took the command: nothing left to join
  assert.deepEqual(review.tabsToArm(sessions, [{url: 'https://job-boards.greenhouse.io/anthropic/jobs/4567890', title: 'Anthropic'}], 2000), []);
});

test('the page says whether it found the field, including when it looked before anyone waited', async () => {
  review._reset();
  review.queueFocus('s1', 'Agreement to Arbitrate');
  assert.equal(review.noteFocus(sessions, {url: 'https://news.ycombinator.com/', title: 'Hacker News', found: true}).ok, false);
  const waiting = review.focusFound('s1', 2000);
  assert.equal(review.noteFocus(sessions, {url: form().url, session: 's1', title: form().title, found: false}).ok, true);
  assert.equal(await waiting, false);
  review.queueFocus('s1', 'Again');  // a new ask forgets the previous answer
  assert.equal(review.noteFocus(sessions, {url: form().url, session: 's1', title: form().title, found: true}).id, 's1');
  assert.equal(await review.focusFound('s1', 50), true);
});

test('what is left comes as the ring counts it, and an older extension sends no filled list at all', () => {
  review._reset();
  const heard = [];
  review.setReporter(state => heard.push(state));
  review.report(sessions, form({left: 1, missing: [], pending: ['Additional Information'], filled: ['Email']}), 1000);
  assert.deepEqual(heard.at(-1).pending, ['Additional Information']);  // an emptied answer Claude wrote, not required
  review.report(sessions, form({left: 1, missing: [], pending: ['Precisa de visto?'], knockouts: ['Precisa de visto?', 42]}), 1500);
  assert.deepEqual(heard.at(-1).knockouts, ['Precisa de visto?', '42']);   // the AI's knockouts, any language, for the session card
  review._reset();
  review.setReporter(state => heard.push(state));
  review.report(sessions, form({left: 1, missing: []}), 2000);  // 0.8.11: no "filled", no "pending"
  assert.equal(heard.at(-1).filled, undefined);  // unknown, not "0 filled"
  assert.equal(heard.at(-1).pending, undefined);
});

test('text we drafted and the person has not read comes through as drafts (labels and a kind only), and is not a failure reason', () => {
  review._reset();
  const heard = [];
  review.setReporter(state => heard.push(state));
  review.report(sessions, form({left: 2, missing: [], pending: ['Describe a production incident', 'Why us?'], why: [],
    drafts: [{label: 'Describe a production incident', outline: true, text: 'never read'}, {label: 'Why us?'}, {nope: 1}, 7]}), 1000);
  assert.deepEqual(heard.at(-1).drafts, [{label: 'Describe a production incident', outline: true}, {label: 'Why us?', outline: false}]);
  assert.deepEqual(heard.at(-1).reasons, []);
});

test('a session\'s form is its newest tab: an older tab for the same job answers nothing and does not hide a closed form', () => {
  review._reset();
  review.noteTabs({ids: [10, 40], boot: 'run1'});
  review.queueFocus('s1', 'Resume');
  assert.equal(review.tabOpen('s1'), null);                              // no tab seen yet
  assert.equal(review.report(sessions, form({tab: 40})).matched, 's1');  // the new tab
  const old = review.report(sessions, form({tab: 10}));                  // a leftover tab, polling too
  assert.deepEqual([old.matched, old.commands.length], [null, 0]);       // it gets nothing, and the focus command stays queued
  assert.equal(review.tabOpen('s1'), true);
  review.noteTabs({ids: [10], boot: 'run1'});                            // the new tab was closed, the old one is still there
  assert.equal(review.tabOpen('s1'), false);
  review.noteTabs({ids: [3], boot: 'run2'});                             // Chrome restarted: tabs were numbered again
  assert.equal(review.tabOpen('s1'), false);                             // its tab was in the old run: closed (tab-identity.test.js)
  assert.equal(review.report(sessions, form({tab: 3})).matched, 's1');
  assert.equal(review.tabOpen('s1'), true);
});

test('a form on another host than the posting belongs to the session by the job its tab was opened for, an exact address, or by its own id', () => {
  const sessions = [{id: 's1', url: 'https://www.jobs.ch/en/vacancies/detail/abc-def/', company: 'Undisclosed employer', startedAt: 1}];
  const form = {url: 'https://api.easytemp.ch/live/bew/15777849101268111120-FR.php#jobadabra-fill', title: 'Software Developer (M/F)', left: 2, total: 5, watch: []};
  review._reset();
  assert.equal(review.report(sessions, form).matched, null);                                                   // by itself: nothing links them
  assert.equal(review.report(sessions, {...form, job: 'https://www.jobs.ch/en/vacancies/detail/other'}).matched, null);   // another job's tab
  assert.equal(review.report(sessions, {...form, job: 'https://www.jobs.ch/en/vacancies/detail/abc-def/'}).matched, 's1');
  review._reset();
  assert.equal(review.report(sessions, {...form, url: `${form.url}=s1`}).matched, 's1');                       // the id in its own address
  review._reset();
});

test('an armed form that names nobody is never given to the one session without a tab (no guess, one or two sessions)', () => {
  review._reset();
  const open = [{id: 'u1', url: 'https://www.jobs.ch/en/vacancies/detail/abc/', company: 'Undisclosed employer', status: 'input', live: true, startedAt: '2026-10-01T17:33:00Z'}];
  const agency = (extra = {}) => ({url: 'https://api.easytemp.ch/live/bew/1577784910-FR.php#jobadabra-fill', title: 'Software Developer (M/F)', left: 3, total: 15, tab: 7, watch: [], ...extra});
  assert.equal(review.report(open, agency()).matched, null);
  assert.equal(review.report(open, agency({url: 'https://api.easytemp.ch/other.php'})).matched, null);
  assert.equal(review.report(open, agency({session: 'u1'})).matched, 'u1');
  review._reset();
  const two = [...open, {id: 'u2', url: 'https://boards.example/jobs/1', company: 'Example', status: 'running', live: true, startedAt: '2026-10-01T17:34:00Z'}];
  assert.equal(review.report(two, agency()).matched, null);
  assert.equal(review.report(two, agency({tab: 8, session: 'u2'})).matched, 'u2');
  review._reset();
});

test('a session closed with the app (restored, waiting, not live) still owns its open form', () => {
  review._reset();
  const restored = [{id: 'r1', url: 'https://www.jobs.ch/en/vacancies/detail/abc/', company: 'Undisclosed employer', status: 'input', live: false, startedAt: '2026-10-01T17:33:00Z'}];
  const page = {url: 'https://api.easytemp.ch/live/bew/1577784910-FR.php#jobadabra-fill=r1', title: 'Software Developer (M/F)', left: 3, total: 15, tab: 7, watch: []};
  assert.equal(review.report(restored, page).matched, 'r1');
  review._reset();
});

test('a "show me this field" nobody took is cancelled, so the page does not act on it later', () => {
  review._reset();
  review.queueFocus('s1', 'Street');
  review.queueClose('s1');
  review.cancelFocus('s1');
  const reply = review.report(sessions, form());
  assert.deepEqual(reply.commands, [{close: true}]);  // only the focus is dropped
  review._reset();
});

test('a sign-in or sign-up page is reported as one, so the session shows no CV card there', () => {
  review._reset();
  const heard = [];
  review.setReporter(state => heard.push(state));
  review.report(sessions, form({account: true}));
  assert.equal(heard.at(-1).account, true);
  review.report(sessions, form({account: false, left: 2}));   // the application form after the sign-up
  assert.equal(heard.at(-1).account, undefined);
});

test("each session's tab: its address and when it first reported; the same tab keeps its time, a newer tab starts again", () => {
  review._reset();
  const heard = [];
  review.setReporter(state => heard.push(state));
  review.report(sessions, form({tab: 7}), 1000);
  review.report(sessions, form({tab: 7, left: 2}), 5000);
  review.report(sessions, form({tab: 9, url: 'https://job-boards.greenhouse.io/anthropic/jobs/4567890/confirmation?x=1'}), 9000);
  assert.deepEqual(heard.map(state => [state.tab, state.tabAt, state.url]), [
    [7, 1000, 'https://job-boards.greenhouse.io/anthropic/jobs/4567890'],
    [7, 1000, 'https://job-boards.greenhouse.io/anthropic/jobs/4567890'],
    [9, 9000, 'https://job-boards.greenhouse.io/anthropic/jobs/4567890/confirmation'],
  ]);
});

// A session follows its newest tab, and a tab carries its session (8 Oct 2026: Migros's sign-in tab showed on Manor's card).
test('a tab carrying its session is that session\'s; one carrying a session that is gone is never guessed onto another', () => {
  review._reset();
  const binds = [];
  review.onBind(entry => binds.push(entry));
  const manor = {id: 'm2', url: 'https://www.jobs.ch/en/vacancies/detail/manor/', company: 'Manor AG', status: 'running', startedAt: '2026-10-08T12:29:00Z'};
  const migros = {id: 'g2', url: 'https://jobs.migros.ch/fr/job/subito/', company: 'Migros', status: 'running', startedAt: '2026-10-08T12:29:30Z'};
  const signIn = {url: 'https://career2.successfactors.eu/career?login#jobadabra-fill', title: 'Career Opportunities: Sign In', total: 3, left: 3};
  // Migros's old tab still carries its session from before "Start again" (g1, gone) and its job was never stored: no guess, not Manor's.
  assert.equal(review.report([manor, migros], {...signIn, tab: 40, session: 'g1'}).matched, null);
  // The same page carrying nothing is nobody's: it was once guessed onto the one session no tab is bound to (owner, 12 Oct 2026: no guessing).
  assert.equal(review.report([manor], {...signIn, tab: 41}).matched, null);
  review._reset();
  // Carried: it is that session's, whatever the page looks like.
  assert.equal(review.report([manor, migros], {...signIn, tab: 40, session: 'g2'}).matched, 'g2');
});

test('a session follows its newest tab: an older tab of it goes quiet and is told the application moved', () => {
  review._reset();
  const binds = [];
  review.onBind(entry => binds.push(entry));
  const manor = {id: 'm2', url: 'https://www.jobs.ch/en/vacancies/detail/manor/', company: 'Manor AG', status: 'running'};
  const page = (url, tab, extra = {}) => ({url, title: 'Manor', tab, session: 'm2', total: 0, left: 0, ...extra});
  assert.equal(review.report([manor], page('https://live.solique.ch/manor/job/1#jobadabra-fill', 50)).matched, 'm2');
  assert.equal(review.report([manor], page('https://career55.sapsf.eu/careers#jobadabra-fill', 52, {total: 3, left: 3})).matched, 'm2');   // Apply's new tab
  const older = review.report([manor], page('https://live.solique.ch/manor/job/1#jobadabra-fill', 50, {total: 9, left: 9}));
  assert.deepEqual([older.matched, older.moved], [null, true]);
  assert.equal(review.olderTab('m2', 50), true);
  assert.equal(review.olderTab('m2', 52), false);
  assert.deepEqual(review.allStates().map(state => [state.id, state.total]), [['m2', 3]]);   // the older tab's "9 left" never reached the card
  assert.deepEqual(binds.map(({tab, before, by}) => [tab, before, by]), [[50, null, 'session'], [52, 50, 'session']]);
});

test('an account page\'s report is never the application form\'s progress: no "ready", flagged account, by the rule or the panel', () => {
  review._reset();
  const heard = [];
  review.setReporter(state => heard.push(state));
  const manor = {id: 'm3', url: 'https://www.jobs.ch/en/vacancies/detail/manor3/', company: 'Manor AG', status: 'running'};
  review.report([manor], {url: 'https://career55.sapsf.eu/careers#jobadabra-fill', title: 'Sign In', tab: 60, session: 'm3', total: 3, left: 0, role: 'account'});
  assert.deepEqual([heard.at(-1).account, heard.at(-1).ready], [true, false]);   // all three filled is "ready to create the account", not "ready to submit"
  review.report([manor], {url: 'https://career55.sapsf.eu/careers/apply#jobadabra-fill', title: 'Apply', tab: 61, session: 'm3', total: 9, left: 0, role: 'form'});
  assert.deepEqual([heard.at(-1).account, heard.at(-1).ready], [undefined, true]);
});

test('the AI\'s "needs you" (extension/form-ready.js) vetoes "ready": every counted field filled, still not ready, and the need is kept for the card; cleared, it is ready again', () => {
  review._reset();
  const heard = [];
  review.setReporter(state => heard.push(state));
  review.report(sessions, form({left: 0, total: 8, needs: ' Lire et accepter la déclaration '}));
  assert.deepEqual([heard.at(-1).ready, heard.at(-1).needs], [false, 'Lire et accepter la déclaration']);
  review.report(sessions, form({left: 0, total: 8, needs: ''}));
  assert.deepEqual([heard.at(-1).ready, heard.at(-1).needs], [true, '']);
  review.report(sessions, form({left: 0, total: 8, needs: 'x'.repeat(200)}));
  assert.equal(heard.at(-1).needs.length, 80);
});

test('a field the extension filled itself after the fill was over (the account step\'s passwords) is not "you"; a field the person filled still is', () => {
  review._reset();
  const heard = [];
  review.setReporter(state => heard.push(state));
  review.report(sessions, form({left: 3, filled: ['E-mail'], busy: true}), 1000);
  review.report(sessions, form({left: 0, filled: ['E-mail', 'Mot de passe', 'Phone'], ours: ['Mot de passe'], over: true}), 5000);
  assert.deepEqual(heard.at(-1).filled.map(field => [field.label, field.by]), [['E-mail', 'fill'], ['Mot de passe', 'fill'], ['Phone', 'you']]);
});

// 12 Oct 2026 (owner: "the state is not reflecting the reality"): Apply opens Ashby, Lever and Workable at the form address (apply.js formUrl), so the tab's job
// is not the session's posting address. The page-to-session match must know that, or those tabs are nobody's and their cards cannot say open or closed.
test('a tab opened at a form address that differs from the posting still belongs to its session, for every site formUrl rewrites', async () => {
  const {formUrl} = await import('../lib/apply.js');
  const postings = ['https://jobs.ashbyhq.com/acme/621bb104-9daa-4c9e-949a-03d5730334e8', 'https://jobs.lever.co/acme/621bb104-9daa-4c9e-949a-03d5730334e8', 'https://apply.workable.com/acme/j/ABC123DEF4'];
  for (const posting of postings) {
    assert.notEqual(formUrl(posting), posting, `${posting} is a site whose form lives at another address`);
    review._reset();
    const sessions = [{id: 'k1', url: posting, company: 'Acme', kind: 'form', status: 'done', startedAt: '2026-10-12T10:00:00Z'}];
    const reply = review.report(sessions, {url: `${formUrl(posting)}#jobadabra-fill`, job: formUrl(posting), tab: 7, left: 2, total: 5, watch: []});
    assert.equal(reply.matched, 'k1', posting);
    assert.equal(review.tabOf('k1'), 7, `${posting}: the session is bound to its tab`);
  }
});

// Owner, 15 Oct 2026: Reopen opened a second tab; the live signed-in tab (older) then reported the application form and was ignored as "older".
test('when two tabs carry a session, the one showing the application form wins over a newer tab that shows none', () => {
  review._reset();
  const job = {id: 'a1', url: 'https://careers.example.test/job/1', company: 'Adnovum', status: 'input'};
  const page = (tab, extra = {}) => ({url: 'https://career74.example.test/apply#jobadabra-fill=a1', title: 'Apply', tab, session: 'a1', total: 0, left: 0, ...extra});
  review.report([job], page(1825));                                              // the newer, empty tab binds first
  assert.equal(review.tabOf('a1'), 1825);
  const live = review.report([job], page(1728, {total: 6, left: 2}));            // the older tab holds the form
  assert.equal(live.matched, 'a1');
  assert.equal(review.tabOf('a1'), 1728);
  assert.deepEqual(review.allStates().map(state => [state.id, state.total]), [['a1', 6]]);
  review.report([job], page(1825));                                // the empty newer tab no longer takes it back
  assert.equal(review.tabOf('a1'), 1728);
  assert.deepEqual(review.allStates().map(state => [state.id, state.total]), [['a1', 6]]);
});

// Owner, 15 Oct 2026: Reopen opened the posting, and the card said "Ready to submit · 1 of 1" over it.
test('a posting page reports no counts and no ready, and the form page\'s own address is kept for Reopen', () => {
  review._reset();
  const job = {id: 'p1', url: 'https://careers.example.test/job/1', company: 'Adnovum', status: 'input'};
  const page = (url, extra = {}) => ({url, title: 'Apply', tab: 7, session: 'p1', total: 0, left: 0, ...extra});
  review.report([job], page('https://career74.example.test/apply?x=1#jobadabra-fill=p1', {total: 6, left: 0}));
  review.report([job], page('https://careers.example.test/job/1#jobadabra-fill=p1', {total: 1, left: 0, page: 'opening', needs: 'x', filled: ['Email']}));
  const state = review.allStates().find(entry => entry.id === 'p1');
  assert.deepEqual([state.page, state.total, state.left, state.ready, state.filled], ['opening', 0, 0, false, []]);   // a posting is never Ready, never counts
});

// Owner, 15 Oct 2026: "when we're redirected, this should disappear already and show the state on the new form".
test('posting then its form: the redirect state is gone at once and the form\'s own counts show, nothing of the posting carried over', () => {
  review._reset();
  const job = {id: 'r1', url: 'https://careers.example.test/job/1', company: 'Adnovum', status: 'input'};
  const page = (url, tab, extra = {}) => ({url, title: 'Apply', tab, session: 'r1', total: 0, left: 0, ...extra});
  review.report([job], page('https://careers.example.test/job/1#jobadabra-fill=r1', 10, {total: 1, left: 0, page: 'opening', filled: ['Email'], needs: 'x'}));
  assert.equal(review.allStates().find(state => state.id === 'r1').page, 'opening');
  review.report([job], page('https://career74.example.test/apply#jobadabra-fill=r1', 11, {total: 6, left: 4, filled: ['First name', 'Last name'], missing: ['Phone']}));   // the form, in a new tab
  const state = review.allStates().find(entry => entry.id === 'r1');
  assert.deepEqual([state.page, state.total, state.left, state.ready], [undefined, 6, 4, false]);
  assert.deepEqual(state.filled.map(item => item.label), ['First name', 'Last name'], 'the posting\'s own fill is not carried over');
  assert.equal(state.url, 'https://career74.example.test/apply');
  assert.equal(review.tabOf('r1'), 11);
});

test('a page the extension has not judged yet reports "reading": no counts, never ready', () => {
  review._reset();
  const job = {id: 'q1', url: 'https://careers.example.test/job/1', company: 'Adnovum', status: 'input'};
  review.report([job], {url: 'https://careers.example.test/job/1#jobadabra-fill=q1', title: 'Job', tab: 3, session: 'q1', total: 1, left: 0, page: 'reading', filled: ['7']});
  const state = review.allStates().find(entry => entry.id === 'q1');
  assert.deepEqual([state.page, state.total, state.left, state.ready, state.filled], ['reading', 0, 0, false, []]);
  review.report([job], {url: 'https://careers.example.test/job/1#jobadabra-fill=q1', title: 'Job', tab: 3, session: 'q1', total: 1, left: 0, page: 'form', filled: ['7']});
  assert.equal(review.allStates().find(entry => entry.id === 'q1').ready, true, 'a page judged to be a form counts');
});
