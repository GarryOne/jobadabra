// Stop is on every surface the person might reach for when the extension goes wrong (owner, 13 Oct 2026: "a way to stop, in case the extension goes wrong"): the sessions page, ⌘K, the
// extension's toolbar popup and its page button (extension-stop.test.js), Chrome's own Cancel on the debugging bar, and the card of a stopped application (Reopen form starts it again).
// A surface dropped in a later change fails here by name.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {test} from 'node:test';
import {journey, journeyStep, STOPPED} from '../lib/application-journey.js';
import {sessionState} from '../renderer/session-state.js';
import {sessionSteps} from '../renderer/session-steps-list.js';
import {validateSessionCall} from '../lib/session-contracts.js';

const read = file => fs.readFileSync(new URL(`../${file}`, import.meta.url), 'utf8');
const ext = file => fs.readFileSync(new URL(`../../extension/${file}`, import.meta.url), 'utf8');

test('the app\'s surfaces: the sessions page button, the ⌘K entry, the IPC, the preload and the demo stub', () => {
  assert.match(read('renderer/index.html'), /id="ss-stop"[^>]*>Stop the extension</);
  assert.match(read('renderer/pages/nav.js'), /add\('Sessions', 'Stop the extension'.*\$\('ss-stop'\)\.click\(\)/, 'the palette entry is always there (the header button is hidden while the extension is idle)');
  assert.match(read('renderer/pages/sessions.js'), /'🛑 Stop the extension', run: \(\) => \$\('ss-stop'\)\.click\(\)/, 'the ⋯ menu entry');
  assert.match(read('renderer/index.html'), /id="ss-stop" hidden/, 'hidden until the extension acts (session-state.js extensionActing)');
  assert.match(read('renderer/pages/session-log.js'), /\$\('ss-stop'\)\.hidden = !extensionActing\(/);
  assert.match(read('renderer/pages/session-stop.js'), /window\.pilot\.sessionsStopExtension\(\)/);
  assert.match(read('renderer/app.js'), /sessionStop\(\)/);
  assert.match(read('preload.cjs'), /sessionsStopExtension: call\('sessionsStopExtension'\)/);
  assert.match(read('lib/demo.js'), /'sessionsStopExtension'/);
  assert.equal(validateSessionCall('sessionsStopExtension', []), undefined, 'the call has no arguments');
  assert.match(read('lib/session-handlers.js'), /handle\('sessionsStopExtension'/);
});

test('the extension\'s surfaces: popup, page, Chrome\'s Cancel, the app\'s request, and the one worker door all name stop', () => {
  assert.match(ext('popup.html'), /id="stop"/);
  assert.match(ext('review.js'), /type: 'stop'/);
  assert.match(ext('stop.js'), /canceled_by_user/);
  assert.match(ext('stop-messages.js'), /message\?\.type === 'stop'/);
  assert.match(ext('messages-app.js'), /stopFromApp\(answer\)/);
  assert.match(ext('tab-report.js'), /stopFromApp\(answer\)/);
});

test('a stopped application says so on every screen that names its state, and nothing a page reports takes it back', () => {
  const stopped = {id: 'f1', kind: 'form', status: 'done', stuck: 'stopped', note: STOPPED, stage: 'form'};
  assert.deepEqual(sessionState(stopped), ['Stopped', 'warn']);
  assert.ok(sessionSteps(stopped).some(step => step.tone === 'warn' && /Stopped by you/.test(step.text)));
  assert.deepEqual(journeyStep(stopped), {step: 'form', needs: STOPPED});
  const live = {id: 'f1', kind: 'form', stage: 'account', stuck: ''};
  const set = journey(live, {type: 'stop'}).set;
  assert.equal(set.stuck, 'stopped');
  const now = {...live, ...set};
  for (const event of [{type: 'stuck', why: 'no-form'}, {type: 'stuck', why: 'account', needs: 'x'}, {type: 'stuck', why: 'incomplete'}]) assert.deepEqual(journey(now, event).set, {}, JSON.stringify(event));
  assert.equal(journey(now, {type: 'stop'}).result, false, 'said once');
  assert.deepEqual(journey(now, {type: 'clear-stuck'}).set.stuck, '', 'a fill\'s report or a reopen clears it');
  assert.deepEqual(journey({...live, kind: 'claude'}, {type: 'stop'}).set, {}, 'Claude sessions are not form sessions: not touched');
  assert.deepEqual(journey({...live, outcome: 'submitted'}, {type: 'stop'}).set, {}, 'a finished application never changes');
});
