// When the AI refuses every call (a spend limit, a bad key), a failed step says so instead of a downstream symptom like "listed: nothing" (lib/ai-refused.mjs, lib/runner.mjs).
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {test} from 'node:test';
import {aiRefusals, refusalNote} from '../lib/ai-refused.mjs';
import {failureRecords} from '../lib/artifacts.mjs';
import {createRunner} from '../lib/runner.mjs';

const LOG = [
  '2026-10-17T10:21:18.854Z ---- python -m src.desktop jobs --limit 200 --first-run run_id=ffcdb24be2aa',
  'Scored 2 of 2 job(s) with claude-haiku-5-5; 0 failed',
  '2026-10-17T10:29:15.000Z ---- python -m src daily --mode run run_id=ae22ff401222',
  'Warning: place words not worked out (BadRequestError); matching them as written.',
  'Warning: AI could not decide pool-region (BadRequestError); the rule decides this time',
  '2026-10-17T10:29:31.666Z ---- python -m src daily --mode run run_id=7610a4b59c9a',
  'Warning: job titles not sorted by Claude (BadRequestError): only your role words match this run',
].join('\n');

test('refusals are counted, with the time of the run that met the first one', () => {
  assert.deepEqual(aiRefusals(LOG), {count: 3, firstAt: '2026-10-17T10:29:15.000Z', limit: 0});
  assert.deepEqual(aiRefusals('Scored 2 of 2 job(s)\nDone.'), {count: 0, firstAt: '', limit: 0});
  assert.deepEqual(aiRefusals(''), {count: 0, firstAt: '', limit: 0});
});

test('a usage-limit or credit message counts too, and a refusal before any run header has no time', () => {
  assert.equal(aiRefusals('Error: invalid_request_error: You have reached your specified API usage limits.').count, 1);
  assert.equal(aiRefusals('Your credit balance is too low to access the Anthropic API').count, 1);
  assert.equal(aiRefusals('Warning: x (BadRequestError)').firstAt, '');
});

const profileWith = text => { const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ai-refused-')); fs.mkdirSync(path.join(dir, 'logs')); fs.writeFileSync(path.join(dir, 'logs', 'engine.log'), text); return dir; };

test('the note names "spend limit or credit" only when the log carried that message, and never under an armed stub (tools/pr-verdict.py greys on this exact text)', () => {
  const credit = [LOG, '2026-10-17T10:30:00.000Z ---- python -m src daily --mode run run_id=1', 'Error: Your credit balance is too low to access the Anthropic API (BadRequestError)'].join('\n');
  assert.equal(refusalNote(profileWith(credit), new Set()), 'the AI refused (400) 4 times, first at 2026-10-17T10:29:15.000Z, spend limit or credit');
  assert.doesNotMatch(refusalNote(profileWith(LOG), new Set()), /spend limit or credit/);   // a bare 400 can be a request of ours that is wrong
  assert.doesNotMatch(refusalNote(profileWith(credit), new Set(['no-credit'])), /spend limit or credit/);
});

test('the note names the count and the first time; no log or no refusal gives no note', () => {
  assert.equal(refusalNote(profileWith(LOG)), 'the AI refused (400) 3 times, first at 2026-10-17T10:29:15.000Z');
  assert.equal(refusalNote(profileWith('Scored 2 of 2')), '');
  assert.equal(refusalNote(path.join(os.tmpdir(), 'no-such-profile-folder')), '');
  assert.equal(refusalNote(undefined), '');
  assert.match(refusalNote(profileWith(LOG.split('\n').slice(0, 4).join('\n'))), /refused \(400\) 1 time, first at/);
});

test('every suite through the runner: a failed step leads with the refusal, keeps the symptom, and is an environment failure, never a product bug', async () => {
  const session = {profile: profileWith(LOG), keepLogs: async () => {}, shot: async () => {}};
  const runner = createRunner(() => session, {keepGoing: true});
  await runner.run('the next check keeps the posting', async () => { throw new Error('the Zebra Wrangler posting was not kept (listed: nothing)'); });
  const [result] = runner.results;
  assert.match(result.note, /^the AI refused \(400\) 3 times, first at 2026-10-17T10:29:15\.000Z; the step then failed: the Zebra Wrangler posting was not kept \(listed: nothing\)$/);
  assert.equal(result.environment, true);
  const [record] = failureRecords('strategy', runner.results);
  assert.equal(record.environment, true);
});

test('a failed step with no refusal in the log is reported as before', async () => {
  const runner = createRunner(() => ({profile: profileWith('Scored 2 of 2'), keepLogs: async () => {}, shot: async () => {}}), {keepGoing: true});
  await runner.run('a step', async () => { throw new Error('expected 3, saw 2'); });
  assert.equal(runner.results[0].note, 'expected 3, saw 2');
  assert.equal(runner.results[0].environment, undefined);
});

test('a refusal while a stub mode was armed says it came from the stub, by design', () => {
  const note = refusalNote(profileWith(LOG), new Set(['no-credit']));
  assert.match(note, /refused \(400\) 3 times, first at 2026-10-17T10:29:15.000Z \(the suite armed the stub no-credit on purpose/);
  assert.doesNotMatch(refusalNote(profileWith(LOG), new Set()), /stub/);
});
