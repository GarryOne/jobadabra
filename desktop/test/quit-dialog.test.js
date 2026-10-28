import assert from 'node:assert/strict';
import fs from 'node:fs';
import {test} from 'node:test';
import {cancel, sessionsOnly, submitted, working} from '../lib/quit-dialog.js';

const label = session => session.company;
const sessions = names => names.map(company => ({company}));

test('only sessions: a title with the count, one line each, what happens, two clear buttons', () => {
  const dialog = sessionsOnly(sessions(['N26', 'Grafana Labs']), label);
  assert.equal(dialog.message, 'Claude is still filling 2 applications');
  assert.match(dialog.detail, /^•  N26\n•  Grafana Labs\n\nQuitting stops them where they are\./);
  assert.match(dialog.detail, /open Application sessions/);   // Resume Claude is hidden for now (claude-help.js)
  assert.deepEqual(dialog.buttons, ['Keep working', 'Stop and quit']);
  assert.equal(sessionsOnly(sessions(['N26']), label).message, 'Claude is still filling an application');
});

test('a long list is cut with "and N more", never a wall of job titles', () => {
  const dialog = sessionsOnly(sessions(['A', 'B', 'C', 'D', 'E', 'F']), label);
  assert.equal(dialog.detail.split('\n').filter(line => line.startsWith('•')).length, 5);
  assert.match(dialog.detail, /•  and 2 more/);
});

test('a search, waiting tasks and sessions together: one line each, then the three choices', () => {
  const dialog = working({busy: {kind: 'search'}, queue: [{kind: 'mail'}, {kind: 'insight'}], sessions: sessions(['N26']), label,
    taskName: kind => ({search: 'New jobs check', mail: 'Gmail check', insight: 'Insight'})[kind]});
  assert.equal(dialog.message, 'Jobadabra is still working');
  assert.match(dialog.detail, /^•  New jobs check is running\n•  2 tasks waiting: Gmail check, Insight\n•  Claude is filling 1 application: N26\n\n/);
  assert.match(dialog.detail, /Quit when done:.*\nQuit now:/);
  assert.deepEqual(dialog.buttons, ['Quit when done', 'Quit now', 'Cancel']);
  assert.doesNotMatch(working({busy: {kind: 'search'}, taskName: () => 'Search', label}).detail, /Resume Claude/);
});

test('removing a session whose job is still Applying asks whether it was submitted, both answers explained', () => {
  const dialog = submitted('N26');
  assert.equal(dialog.message, 'Did you submit the application to N26?');
  assert.match(dialog.detail, /Yes: it is marked Applied\.\nNo: it goes back to Kit ready/);   // on every store
  assert.deepEqual(dialog.buttons, ['Yes, I submitted it', 'No, not submitted', 'Cancel']);
});


test('cancel: asked once, says the form tab closes (what was filled is lost) and the job goes back to Kit ready', () => {
  const dialog = cancel('Canonical');
  assert.equal(dialog.message, 'Cancel the Canonical application?');
  assert.match(dialog.detail, /the form tab closes in Chrome \(what was filled there is lost\), and the job goes back to Kit ready/);
  assert.deepEqual(dialog.buttons, ['Cancel application', 'Keep it']);
});

test('Start again asks nothing: it restarts in Chrome, Claude stays the safety net (owner, 9 Oct 2026)', () => {
  const source = fs.readFileSync(new URL('../lib/session-handlers.js', import.meta.url), 'utf8');
  const handler = source.slice(source.indexOf("checkedSessions.handle('sessionRestart'"), source.indexOf('});', source.indexOf("checkedSessions.handle('sessionRestart'")));
  assert.doesNotMatch(handler, /showMessageBox/);
  assert.match(handler, /restartAs\(old, 'chrome'\)/);
});

test('quitting with a hidden-browser application says the browser closes with the app, not that the form stays in Chrome', () => {
  const hidden = [{company: 'Air France', background: {state: 'filling'}}], label = session => session.company;
  assert.match(sessionsOnly(hidden, label).detail, /hidden browser closes with the app/);
  assert.doesNotMatch(sessionsOnly(hidden, label).detail, /stay in Chrome/);
  assert.match(working({busy: null, sessions: hidden, taskName: () => '', label}).detail, /hidden browser closes with the app/);
  assert.equal(sessionsOnly(hidden, label).message, 'The hidden browser is still filling an application', 'the actor is named truthfully');
});
