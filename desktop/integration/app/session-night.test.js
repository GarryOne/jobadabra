// Ready to send's "Open in Chrome" on a form the night filled, the app's half, layer 3 (the real extension server, a fake browser; integration/app/session-kit.js): moved from the apply e2e step
// of that name (R3, 1 Nov 2026). The night's hand-off waits in the app; the tab learns only that the night filled it (no answer goes to the tab), the page kind comes back as a form with no AI, and the
// night's answer comes back for its question with no AI; a question the night never saw is not answered from it. The page's half (the answer typed, "Last night's fill is back") is the recorded case
// night-fill-back-on-open-in-chrome-1.
// Job: serve stored answers
import assert from 'node:assert/strict';
import {after, before, test} from 'node:test';
import {startSessionKit} from './session-kit.js';

const POSTING = 'https://jobs.lever.co/e2e/night-posting', FORM = `${POSTING}/apply`, NIGHT = 'From last night: your platform team runs what I have built for six years.';
const HANDOFF = {url: FORM, storage: {cookies: [], origins: []}, sessionStorage: {}, snapshot: {fields: [], files: []},
  night: {role: 'form', answers: [{field: 'why', label: 'Why do you want to work at E2E Lever Systems?', answer: {field: 'why', value: NIGHT, confidence: 'medium', note: ''}}]}};
let kit, handoffs;
before(async () => {
  kit = await startSessionKit();
  handoffs = await import('../../lib/ready-handoff.js');
  handoffs.clear();
  assert.equal(handoffs.keep(HANDOFF, [POSTING]), true);
});
after(async () => { handoffs?.clear(); await kit?.close(); });

test('the tab is handed the night\'s mark and nothing of its answers', () => {
  const given = handoffs.take(`${POSTING}#jobadabra-fill=night-1`);
  assert.equal(given.fromNight, true);
  assert.ok(!JSON.stringify(given).includes('six years'), 'a night answer went to the tab');
});

test('the page kind comes back as a form from the night, and the open question as the night answered it, with no AI asked (the kit\'s fetch refuses any call outside its own server)', async () => {
  const kind = await kit.call('/extension/page-kind', {url: FORM, title: 'Platform Engineer'});
  assert.deepEqual([kind.kind, kind.role, kind.by], ['form', 'form', 'night'], `the page kind was asked anew: ${JSON.stringify(kind)}`);
  const answer = await kit.call('/extension/answer', {url: FORM, fields: [{field: 'why', label: 'Why do you want to work at E2E Lever Systems?', type: 'textarea', required: true}]});
  assert.equal(answer.night, true, `the question went to the AI: ${JSON.stringify(answer).slice(0, 200)}`);
  assert.deepEqual(answer.answers.map(item => [item.field, item.value]), [['why', NIGHT]]);
});

test('another page gets nothing from the night, and a contradicted kind is dropped', async () => {
  assert.equal(handoffs.nightKind('https://jobs.lever.co/e2e/other-page/apply'), '');
  assert.equal(handoffs.nightAnswers('https://jobs.lever.co/e2e/other-page/apply', [{field: 'why', label: 'Why do you want to work at E2E Lever Systems?'}]), null);
  assert.equal(handoffs.nightKind(FORM), 'form');
  handoffs.forgetNightKind(FORM);   // the page contradicted the night (lib/server-pages.js): asked as any page from now on
  assert.equal(handoffs.nightKind(FORM), '');
});
