// "Needs your attention" from the extension's fill, the app's half, layer 3 (the real extension server and the app's wiring, a fake browser; integration/app/session-kit.js): moved from the applyflows
// e2e step of that name (R3, 1 Nov 2026). The fill's report carries a left menu with the kit's proposal and the form's choices; the app keeps them for the session page; the person's Use on that row
// reaches the form as ONE command in the next reply to that form's report, and only once. The page's half is the recorded cases notice-period-proposed-not-typed-1 and
// notice-period-set-by-app-command-1; the row itself is screen-apply-needs.test.js.
// Job: serve stored answers
import assert from 'node:assert/strict';
import {after, before, test} from 'node:test';
import {startSessionKit} from './session-kit.js';

const JOB = {url: 'https://boards.greenhouse.io/e2e-propose/4001012', title: 'Cloud Engineer, Notice Period', company: 'E2E Notice Systems'};
const CHOICES = ['Immediately', '1 month', '2 months'];
let kit;
before(async () => { kit = await startSessionKit(); });
after(async () => { await kit?.close(); });

const report = (extra = {}) => ({url: `${JOB.url}#jobadabra-fill=fill-one`, title: 'Cloud Engineer', tab: 31, session: 'fill-one', total: 5, left: 1, role: 'form', missing: ['Notice period'], pending: ['Notice period'],
  proposals: [{label: 'Notice period', value: '3 months', key: '', options: CHOICES}], ...extra});

test('the left menu reaches the session with its proposal and the form\'s choices, and Use comes back to the form as one fill command', async () => {
  await kit.applyOne(JOB.url, JOB, 'fill-one');
  const chrome = kit.extension();
  const first = await chrome.reviewReport(report());
  assert.equal(first.matched, 'fill-one', 'the report was not placed on the session');
  const state = kit.review.allStates().find(item => item.id === 'fill-one');
  assert.deepEqual(state.proposals.map(item => [item.label, item.value, item.options]), [['Notice period', '3 months', CHOICES]], 'the session lost the proposal or the form\'s choices');
  assert.deepEqual(first.commands, [], 'a command before anyone pressed Use');
  assert.deepEqual(await kit.handlers.get('sessionFillField')({}, 'fill-one', 'Notice period', ' 2 months '), {ok: true});
  const next = await chrome.reviewReport(report());
  assert.deepEqual(next.commands, [{fill: {label: 'Notice period', value: '2 months'}}], 'the form\'s next reply does not carry the picked choice');
  assert.deepEqual((await chrome.reviewReport(report())).commands, [], 'the command is delivered once');
});

test('Use with nothing written, or for a session that is gone, fills nothing', async () => {
  assert.deepEqual(await kit.handlers.get('sessionFillField')({}, 'fill-one', 'Notice period', '  '), {ok: false, error: 'Write an answer first.'});
  assert.equal((await kit.handlers.get('sessionFillField')({}, 'no-such-session', 'Notice period', '2 months')).ok, false);
});
