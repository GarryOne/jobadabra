// Errors over a whole suite become findings: an uncaught exception, a console.error, one of the app's files failing to load. Expected AI refusals in a
// suite that breaks the AI on purpose, and outside noise, do not.
import {loadAppModule} from '../../lib/app-module.mjs';
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {journeyFindings} from '../../lib/journey.mjs';
import {normalize, issueTitle} from '../../lib/triage.mjs';

test('distinct window errors become findings, each once, at most a few per kind', () => {
  const store = {pageErrors: ['TypeError: Cannot read properties of undefined (reading \'id\')', 'TypeError: Cannot read properties of undefined (reading \'id\')'],
    consoleErrors: ['Uncaught (in promise) Error: notion 502', 'DevTools failed to load source map', 'RateLimitError: 429'], failedLoads: ['desktop/renderer/icons/missing.svg']};
  const plain = journeyFindings(store, {suite: 'jobs'});
  assert.deepEqual(plain.map(item => [item.view, item.kind, item.detail.split(':')[0]]), [
    ['jobs-journey', 'console-error', 'window threw TypeError'], ['jobs-journey', 'console-error', 'console Uncaught-in-promise'],
    ['jobs-journey', 'console-error', 'console RateLimitError'], ['jobs-journey', 'broken-resource', 'failed to load']]);
  const expecting = journeyFindings(store, {suite: 'activityfailures', expectsFailures: true});
  assert.ok(!expecting.some(item => /RateLimitError/.test(item.detail)), 'an AI refusal is expected where the suite causes it');
  assert.ok(expecting.some(item => /TypeError/.test(item.detail)), 'an exception is still a bug there');
});

test('a Notion outage the suite causes is expected in the console; an uncaught rejection never is', () => {
  const store = {pageErrors: [], consoleErrors: ['Notion is unavailable, please try again later. 503', 'TypeError: Failed to fetch', 'Uncaught (in promise) Error: notion 502'], failedLoads: []};
  assert.equal(journeyFindings(store, {suite: 'jobs'}).length, 3, 'no suite expects it by default');
  const expecting = journeyFindings(store, {suite: 'wander', expectsFailures: true});
  assert.deepEqual(expecting.map(item => item.detail.split(':')[0]), ['console Uncaught-in-promise']);
});

test('a journey error is filed with a title that names the error', () => {
  const [finding] = normalize({ui: journeyFindings({pageErrors: ['TypeError: x is undefined'], consoleErrors: [], failedLoads: []}, {suite: 'focus'})});
  assert.equal(issueTitle(finding), '[auto-ui] focus-journey: console error on focus-journey: window: "TypeError: x is undefined"');
});

test('a journey error is marked not seen when its suite ran again without it', async () => {
  const {triage} = await import('../../triage.mjs');
  const fs = await import('node:fs'), os = await import('node:os'), path = await import('node:path');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'journey-'));
  fs.mkdirSync(path.join(dir, 'e2e-artifacts-focus')); fs.writeFileSync(path.join(dir, 'e2e-artifacts-focus', 'ui-findings.json'), '[]');
  const issue = {number: 3, state: 'OPEN', title: '[auto-ui] focus-journey: console error on focus-journey: window', body: '**MEDIUM** · console-error · found by the layout check', labels: [{name: 'auto-ui'}, {name: 'fp:x'}], comments: []};
  const gh = args => (args[0] === 'issue' && args[1] === 'list' ? JSON.stringify([issue]) : args[0] === 'pr' ? '[]' : '');
  assert.equal(triage({artifacts: dir, runUrl: 'https://x/runs/5', gh}).gone.length, 1);
});

// 4 Oct 2026: the app counted days in the runner's UTC and the suites in Zurich, so Focus's 14-day count failed from 0:00 to 2:00 Zurich time.
test('the e2e app runs in the zone the suites check against, or the one a suite sets, for the window and the engine alike', async () => {
  const {zoneOf} = await import('../../lib/app.mjs');
  assert.equal(zoneOf({}), 'Europe/Zurich');
  assert.equal(zoneOf({TZ: 'Asia/Tokyo'}), 'Asia/Tokyo');
  const fs = await import('node:fs');
  const source = fs.readFileSync(new URL('../../lib/app.mjs', import.meta.url), 'utf8');
  assert.match(source, /TZ: zoneOf\(env\), JOBADABRA_TZ: env\.JOBADABRA_TZ \|\| zoneOf\(env\)/);
});

test('the test profile\'s undecryptable seeded secrets are not the app\'s error (#217)', () => {
  const found = journeyFindings({pageErrors: ["Error: Error invoking remote method 'state': Error: Error while decrypting the ciphertext provided to safeStorage.decryptString."], consoleErrors: [], failedLoads: []}, {suite: 'jobs'});
  assert.deepEqual(found, []);
});

// The launcher opts out deliberately: the normal startup migration must preserve that choice.
test('a throwaway app stays opted out of employer sharing through startup and relaunch', async () => {
  const {initialSettings} = await import('../../lib/app.mjs');
  const {openPoolShare} = await loadAppModule('migrate.js');
  const {on, variables} = await import('../../../lib/pool-share.js');
  let settings = initialSettings();
  const storage = {settings: () => settings, saveSettings: patch => { settings = {...settings, ...patch}; }};
  assert.equal(on(storage), false);
  assert.equal(openPoolShare(storage), false, 'startup must not reopen the harness opt-out');
  assert.equal(on(storage), false);
  settings = JSON.parse(JSON.stringify(settings));
  assert.equal(openPoolShare(storage), false, 'relaunch preserves the same choice');
  assert.equal(variables(storage), null, 'no sharing variables reach the pipeline');
  assert.equal(initialSettings({shareEmployers: true}).shareEmployers, true, 'a suite can explicitly test sharing');
});
