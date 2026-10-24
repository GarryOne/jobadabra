// "What happened" (renderer/session-steps-list.js; owner, 9 Oct 2026): a session's steps in plain words instead of a terminal. Each state a session card shows
// gets its steps: started, stuck at an account page or with no form, the form read and filled with suggestions, the person's turn, submitted.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {test} from 'node:test';
import {sessionSteps} from '../renderer/session-steps-list.js';

const texts = steps => steps.map(step => `${step.tone}: ${step.text}`);

test('a session\'s steps, for every state its card shows', () => {
  const time = () => '14:45';
  assert.deepEqual(texts(sessionSteps({startedAt: 'x', status: 'running', note: 'Filling the form…'}, null, {time})), ['done: Opened the job in Chrome · 14:45', 'now: Filling the form…']);
  assert.deepEqual(texts(sessionSteps({stuck: 'account', note: 'Needs you: Solve the check, then press "Connexion"'}, {account: true, total: 3, left: 3})),
    ['done: Opened the job in Chrome', 'warn: Needs you: Solve the check, then press "Connexion"']);   // an account page's fields are not the form's
  assert.deepEqual(texts(sessionSteps({stuck: 'no-form'})), ['done: Opened the job in Chrome', 'warn: No application form found on the page yet']);
  const report = {total: 18, left: 12, proposals: [{label: 'a', value: 'Oui'}, {label: 'b', value: ''}, {label: 'c', value: 'Suisse'}]};
  assert.deepEqual(texts(sessionSteps({status: 'done'}, report)),
    ['done: Opened the job in Chrome', 'done: Read the form: 18 required fields', 'done: Filled 6 of 18', 'done: 2 answers suggested for you to check', 'now: Your turn: 12 fields left, then submit in Chrome']);
  assert.equal(texts(sessionSteps({status: 'done'}, {total: 1, left: 0})).at(-1), 'now: Your turn: review and submit in Chrome');
  assert.equal(texts(sessionSteps({status: 'done'}, report, {submitted: true})).at(-1), 'done: Submitted · marked Applied');
});

test('the terminal is only for a Claude conversation with Claude help on; elsewhere the steps, and the terminal one click away', () => {
  const page = fs.readFileSync(new URL('../renderer/pages/session-steps.js', import.meta.url), 'utf8');
  assert.match(page, /export const terminalShown = item => \(claudeHelp\(\) && \(item\.kind \|\| 'claude'\) === 'claude'\) \|\| logAsked\.has\(item\.id\);/);
  const log = fs.readFileSync(new URL('../renderer/pages/session-log.js', import.meta.url), 'utf8');
  assert.match(log, /show\(\$\('ss-log'\), terminalShown\(item\)\);/);
  assert.match(fs.readFileSync(new URL('../renderer/index.html', import.meta.url), 'utf8'), /<ul class="activity-phases" id="ss-steps"><\/ul>/);   // Recent activity's step list, reused
});

test('an email posting says where to send it once, not twice', () => {
  const time = () => '14:45';
  const email = {startedAt: 'x', status: 'running', stuck: 'email', note: 'Send your application to jobs@firma.ch'};
  assert.deepEqual(texts(sessionSteps(email, null, {time})), ['done: Opened the job in Chrome · 14:45', 'warn: Send your application to jobs@firma.ch']);
});

test('a page that tells the person what to do shows its own sentence once, like an email posting', () => {
  const time = () => '14:45';
  const told = {startedAt: 'x', status: 'running', stuck: 'told', note: 'The page says: Rufen Sie uns an: 044 555 01 00'};
  assert.deepEqual(texts(sessionSteps(told, null, {time})), ['done: Opened the job in Chrome · 14:45', 'warn: The page says: Rufen Sie uns an: 044 555 01 00']);
});

test('a page the ladder could not read says so once and asks the person to open it', () => {
  const time = () => '14:45';
  const other = {startedAt: 'x', status: 'running', stuck: 'other', note: 'Jobadabra could not tell how to apply: open the page'};
  assert.deepEqual(texts(sessionSteps(other, null, {time})), ['done: Opened the job in Chrome · 14:45', 'warn: Jobadabra could not tell how to apply: open the page']);
});
