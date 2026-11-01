/* global document */
// Recent activity when things go wrong, layer 2: the words and the layout of the failure states, moved from the e2e `activityfailures` suite (1 Nov 2026): the spending limit,
// Telegram refusing the digest, Google access revoked, the AI out of credit (the CV card), and the failure and queued states' layout. The states are the fictional records of
// e2e/fixtures/activity-states.json in the app's demo window. What STAYS in e2e: the steps that make the real engine fail (the AI's 429/500/401, Notion, the quit in the middle,
// the silence limit), because the words here start from a record, and only a real run proves the record the engine writes.
import assert from 'node:assert/strict';
import {before, test} from 'node:test';
import {badSummary} from '../../e2e/lib/activity.mjs';
import {humanError, isSpendingLimit} from '../../renderer/run-warnings.js';
import {FAILED_STATES, STATES, activityKit, demoFocus, indexOf, stateFiles, withData} from './screen-activity-kit.js';
import {needsElectron} from '../../test/needs-electron.js';
import {probeWindow} from './window-probe.js';

const live = {skip: needsElectron.skip};
const NAMES = FAILED_STATES;
// Every state that ends badly or waits: the ones the old step looked at for layout and technical text.
const BAD = STATES.map(state => state.name).filter(name => /failed|stopped|telegram-not-delivered|warnings|partial/.test(name));
let seen;

before(() => {
  if (needsElectron.skip) return;
  seen = probeWindow({files: stateFiles(Date.now(), demoFocus()), use: [activityKit], timeout: 180000, script: withData({at: Object.fromEntries(Object.entries(NAMES).map(([key, name]) => [key, indexOf(name)])), bad: BAD.map(name => [name, indexOf(name)])}, async (kit, {at, bad}) => {
    await kit.until(() => document.querySelector('.nav[data-view=focus]:not([hidden])'), 'the menu');
    await kit.openRuns();
    const out = {};
    const read = async index => { await kit.select(index); return {status: kit.text('#activity-status'), line: kit.rows()[index].innerText.replace(/\s+/g, ' '), warnings: kit.text('#activity-warnings'), words: kit.readable()}; };
    for (const [key, index] of Object.entries(at)) { try { out[key] = await read(index); } catch (error) { out[key] = {error: error.message}; } }
    // The Gmail connection is asked of the main process after the window opens; the revoked run reads the same either way, so no wait is needed for its words.
    out.layout = [];
    for (const [name, index] of bad) { await kit.select(index); const problems = kit.severe('actions'); if (problems.length) out.layout.push(`${name}: ${problems.join(' | ')}`); }
    return out;
  })});
});

const facts = key => { const value = seen.result[key]; assert.equal(value?.error, undefined, `${key}: ${value?.error}`); return value; };
const RAW_API = /rate_limit_error|api_error|authentication_error|invalid_request_error|\{'type': 'error'|"type":\s*"error"|Traceback/;

test('a search analysis stopped by the spending limit names the limit in words, with a way to raise it, and sends nobody to a terminal', live, () => {
  const {line, words, warnings} = facts('limit');
  assert.match(`${warnings} ${line}`, /spend(ing)? limit|AI limit/i, `the limit is not named: ${warnings.slice(0, 160)}`);
  assert.doesNotMatch(words, /terminal/i, 'the words send an app user to a terminal');
  assert.doesNotMatch(words, RAW_API, 'raw API words are shown');
  assert.match(words, /Manage API limits/, 'no way to raise the limit');
  assert.equal(badSummary(line), '');
});

test('Telegram refuses the digest: the run says so in words, never a plain Completed', live, () => {
  const {status, words, warnings} = facts('telegram');
  assert.notEqual(status, 'Completed', 'the run says plain "Completed" though the digest never reached the person');
  assert.match(warnings, /telegram/i, 'nothing on the run names Telegram as what failed');
  assert.doesNotMatch(words, /"ok":\s*false|error_code|Forbidden:/, 'Telegram\'s raw answer is shown');
  assert.match(words, /Open Telegram settings/, 'no way to fix it');
});

test('Google access revoked: the Gmail check says so in words, never a plain Completed, never Google\'s raw answer', live, () => {
  const {status, words} = facts('google');
  assert.notEqual(status, 'Completed', 'the check says plain "Completed" though it could not read the mail');
  assert.match(words, /google|gmail|sign.?in|connect/i, 'nothing says the Google sign-in is the problem');
  assert.equal(/invalid_grant|error_description|Token has been expired/.test(words), false, `Google's raw answer is shown: ${words.slice(0, 200)}`);
});

test('the AI out of credit while reading the CV: the CV card says it in words, never the API\'s JSON (#94)', () => {
  // The CV card shows humanError(result.error) (pages/profile.js cvError); the answers are the ones the AI proxy gives (e2e/lib/ai-proxy.mjs FAILURES, 'no-credit') and the CLI's own wrapping.
  const answers = [
    '400 {"type":"error","error":{"type":"invalid_request_error","message":"Your credit balance is too low to access the Anthropic API. Please go to Plans & Billing to upgrade or purchase credits."},"request_id":"req_011"}',
    'Error code: 400 - {\'type\': \'error\', \'error\': {\'type\': \'invalid_request_error\', \'message\': \'Your credit balance is too low to access the Anthropic API. Please go to Plans & Billing to upgrade or purchase credits.\'}}',
  ];
  for (const raw of answers) {
    const said = humanError(raw);
    assert.doesNotMatch(said, /[{}]|"type"|request_id|invalid_request_error|Error code/, `the CV card would show the API's raw answer: ${said}`);
    assert.match(said, /credit|limit/i, `the CV card would not say the AI is out of credit: ${said}`);
    assert.equal(isSpendingLimit(said), true, `the "Manage API limits" link would not show for: ${said}`);
  }
});

test('the failure and queued states render without layout problems or technical text', live, () => {
  assert.ok(BAD.length >= 12, `only ${BAD.length} failure states: ${BAD}`);
  for (const key of ['credits', 'unexplained', 'queued']) assert.ok(facts(key).words, `${key} drew nothing`);
  assert.deepEqual(seen.result.layout, []);
});
