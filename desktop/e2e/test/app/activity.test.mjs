// The checks the activity suite applies to a run's words: they must flag what they claim to, and let a good line through.
import assert from 'node:assert/strict';
import test from 'node:test';
import {badSummary, leaks, liveLogProblems} from '../../lib/activity.mjs';

test('a good summary line passes', () => {
  for (const line of ['3 new jobs', 'nothing new', 'Gmail not connected (Settings → Connections)', 'Your Anthropic API spending limit was reached, so 2 jobs weren\'t scored.']) assert.equal(badSummary(line), '');
});
test('an empty, programming-value, JSON or stack-trace summary is flagged', () => {
  assert.match(badSummary(''), /empty/);
  assert.match(badSummary(undefined), /empty/);
  assert.match(badSummary('Insight: undefined'), /programming value/);
  assert.match(badSummary('[object Object]'), /programming value/);
  assert.match(badSummary('{"error":{"type":"rate_limit_error"}}'), /raw JSON/);
  assert.match(badSummary('Traceback (most recent call last):'), /stack trace/);
  assert.match(badSummary('anthropic.AuthenticationError: invalid x-api-key'), /stack trace/);
});
test('a log with a key, a token, an email or a home path is flagged; a clean one is not', () => {
  assert.deepEqual(leaks('Checked 4 feeds; 2 new jobs\nScored Senior SRE (82)'), []);
  assert.match(leaks('using key sk-ant-api03-AbCdEfGh123456')[0], /Anthropic key/);
  assert.match(leaks('token ntn_abcdefghijkl1234')[0], /Notion token/);
  assert.match(leaks('chat 123456789:AAAbbbCCCdddEEEfffGGGhhhIIIjjjKKK12')[0], /Telegram/);
  assert.match(leaks('mail from igor@gmail.com')[0], /email/);
  assert.deepEqual(leaks('lib /opt/homebrew/Cellar/python@3.12/3.12.6/lib/python3.12/urllib/request.py'), []);   // a version after an @ is not an address
  assert.match(leaks('wrote /Users/mac/Library/x.json')[0], /home folder/);
  assert.match(leaks('wrote C:\\Users\\igor\\x.json')[0], /home folder/);
  assert.match(leaks('data in /var/folders/zz/jp-e2e-abc/data', {dirs: ['/var/folders/zz/jp-e2e-abc']})[0], /path on this computer/);
  assert.match(leaks('the value hunter2hunter2 leaked', {secrets: ['hunter2hunter2']})[0], /saved secret/);
});
test('the saved secret is never repeated in the finding', () => {
  assert.ok(!leaks('the value hunter2hunter2 leaked', {secrets: ['hunter2hunter2']}).join().includes('hunter2hunter2'));
});

test('a task that ran for minutes with an empty live log is flagged; one that spoke at once is not', () => {
  const at = ms => ({running: {kind: 'scout'}, at: 1000 + ms});
  const silent = [0, 10000, 30000, 60000, 120000].map(ms => ({...at(ms), logShown: 0}));
  assert.match(liveLogProblems(silent, {label: 'Find new employers'})[0], /never showed a line/);
  const late = [0, 10000, 50000, 60000].map(ms => ({...at(ms), logShown: ms >= 50000 ? 2 : 0}));
  assert.match(liveLogProblems(late)[0], /showed nothing for the first 50 s/);
  const talks = [0, 10000, 30000].map(ms => ({...at(ms), logShown: ms >= 0 ? 3 : 0}));
  assert.deepEqual(liveLogProblems(talks), []);
  assert.deepEqual(liveLogProblems([{running: null, at: 1, logShown: 0}]), []);   // never saw it running: nothing to say
  assert.deepEqual(liveLogProblems(silent.slice(0, 2)), []);                       // a short run may be silent: no judgement under the limit
});
