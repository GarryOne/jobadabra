// A session's form tab as the app knows it, layer 3 (the real extension server and the app's wiring, a fake browser; integration/app/session-kit.js): moved from the applyflows e2e suite (R3, 1 Nov 2026).
// (1) the form tab is closed: the app sees it, and Reopen opens the form again for the SAME session, with its fill mark. (2) a second browser with the extension and no tabs never closes the form open
// in the first. (3) two applications side by side keep their own tab and their own state: a form's report lands on its own session only.
// What STAYS in e2e: the journeys themselves (a real Chrome with the real extension on a form) and every safety step.
// Job: serve stored answers
import assert from 'node:assert/strict';
import {after, before, test} from 'node:test';
import {startSessionKit} from './session-kit.js';

const JOB = {url: 'https://jobs.test/e2e/one-page-apply', title: 'Retail Assistant, One-page Sign-up', company: 'E2E One-page Retail'};
const OTHER = {url: 'https://jobs.test/e2e/chain-job', title: 'Fullstack Engineer', company: 'E2E Chain Recruiting'};
let kit;
before(async () => { kit = await startSessionKit(); });
after(async () => { await kit?.close(); });

const formsOpen = () => kit.handlers.get('formsOpen')();
const markOf = address => /#jobpilotto-fill=([^&]+)/.exec(address)?.[1] || '';

test('the form tab is closed: the app sees it, and Reopen opens the form again with its fill mark, for the same session', async () => {
  const {session} = await kit.applyOne(JOB.url, JOB, 'tab-closed');
  assert.equal(session.id, 'tab-closed');
  const first = kit.browser.opened.at(-1);
  assert.equal(markOf(first), 'tab-closed', `the app opened ${first} without the session's fill mark`);
  const chrome = kit.extension();
  await chrome.report([{id: 7, url: first, session: 'tab-closed'}]);
  assert.deepEqual(await formsOpen(), {known: true, ids: ['tab-closed'], unsure: []}, 'the app does not see the open form');
  await chrome.report([]);   // the person closed the tab
  const closed = await formsOpen();
  assert.deepEqual([closed.known, closed.ids], [true, []], `the app never saw the tab closed: ${JSON.stringify(closed)}`);
  const opened = kit.browser.opened.length;
  const reopened = await kit.handlers.get('sessionReopen')({}, 'tab-closed', false);
  assert.equal(reopened.ok, true, `Reopen failed: ${JSON.stringify(reopened)}`);
  assert.equal(kit.browser.opened.length, opened + 1, 'Reopen opened no tab');
  assert.equal(markOf(kit.browser.opened.at(-1)), 'tab-closed', 'the reopened tab has no fill mark of the same session');
  assert.ok(kit.browser.opened.at(-1).startsWith(JOB.url), `Reopen opened ${kit.browser.opened.at(-1)}, not the job's form`);
  assert.deepEqual(kit.terminals.list().filter(item => item.url === JOB.url).map(item => item.id), ['tab-closed'], 'Reopen made another session');
});

test('a second browser with the extension and no tabs: the form open in the first stays open', async () => {
  const {session} = await kit.applyOne(OTHER.url, OTHER, 'two-browsers');
  const first = kit.extension({browser: 'chrome-a'}), second = kit.extension({browser: 'chrome-b'});
  await first.report([{id: 3, url: kit.browser.opened.at(-1), session: session.id}]);
  assert.ok((await formsOpen()).ids.includes('two-browsers'), 'nothing to protect: the first browser\'s form is not open to begin with');
  // The second browser reports its tabs every 30 s: each empty report must leave the first one's form alone.
  for (let report = 0; report < 3; report++) {
    await second.report([]);
    const now = await formsOpen();
    assert.ok(now.known && now.ids.includes('two-browsers'), `the form was shown closed after the second browser's report ${report + 1}: ${JSON.stringify(now)}`);
  }
  await first.report([]);   // the first browser's own report is the one that closes it
  assert.ok(!(await formsOpen()).ids.includes('two-browsers'), 'the browser that holds the tab can no longer close it');
});

test('two applications side by side: each form tab binds to its own session, and a report lands on its own card only', async () => {
  const one = {url: 'https://jobs.test/e2e/side-one', title: 'Platform Engineer', company: 'Side One'}, two = {url: 'https://jobs.test/e2e/side-two', title: 'Site Reliability Engineer', company: 'Side Two'};
  await kit.applyOne(one.url, one, 'side-one');
  await kit.applyOne(two.url, two, 'side-two');
  const [first, second] = kit.browser.opened.slice(-2);
  assert.deepEqual([markOf(first), markOf(second)], ['side-one', 'side-two'], 'each application opens a tab carrying its own session');
  const chrome = kit.extension();
  await chrome.report([{id: 21, url: first, session: 'side-one'}, {id: 22, url: second, session: 'side-two'}]);
  assert.deepEqual((await formsOpen()).ids.filter(id => id.startsWith('side-')).sort(), ['side-one', 'side-two']);
  // Both pages are on hosts that say nothing of their job (an agency's own site, as in the Coop and Manor case of 8 Oct 2026), so only the session the tab carries can place them.
  // The form of the second job reports 9 of 12 left; the first's page is a sign-in with nothing counted: neither shows on the other's card (8 Oct 2026: one job's sign-in page on another's card).
  await chrome.reviewReport({url: 'https://forms.second-agency.test/apply/22#jobpilotto-fill=side-two', title: 'Apply', tab: 22, session: 'side-two', total: 12, left: 9, role: 'form'});
  await chrome.reviewReport({url: 'https://login.first-agency.test/signin#jobpilotto-fill=side-one', title: 'Sign in', tab: 21, session: 'side-one', total: 2, left: 2, role: 'account'});
  const states = Object.fromEntries(kit.review.allStates().filter(state => state.id.startsWith('side-')).map(state => [state.id, state]));
  assert.deepEqual([states['side-two'].total, states['side-two'].left, !!states['side-two'].account], [12, 9, false], 'the second job\'s card does not show its own form');
  assert.equal(states['side-one'].account, true, 'the first job\'s card does not show its sign-in page');
  assert.equal(states['side-one'].total === 12 || states['side-one'].left === 9, false, 'the first job\'s card shows the second job\'s form');
});
