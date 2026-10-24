// The result file is the contract with the engine (tests/fixtures/run-result.json, src/run_result.py).
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {test} from 'node:test';
import {fileURLToPath} from 'node:url';
import {jobFromResult} from '../lib/job-line.js';
import {deliveryProblem, mailProblem, readResult} from '../lib/run-result.js';

const fixture = path.join(path.dirname(fileURLToPath(import.meta.url)), '../../tests/fixtures/run-result.json');

test('the shared fixture is a result, and a reworded mail sentence no longer decides the reason', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'jp-result-'));
  const file = path.join(dir, 'result.json');
  fs.copyFileSync(fixture, file);
  const body = readResult(file);
  assert.equal(body.run_id, 'abc123def456');
  assert.equal(body.v, 1);
  assert.equal(mailProblem('Mail check skipped: something we reworded later', body),
    'not checked: the Anthropic API spend limit was reached');
  assert.equal(jobFromResult(body).pageId, 'page-1');
  assert.equal(readResult(path.join(dir, 'missing.json')), null);
});

test('a log with no result file still reads the sentences', () => {
  assert.equal(mailProblem('Mail check skipped: the Anthropic API spend limit is reached (Error code: 400)'),
    'not checked: the Anthropic API spend limit was reached');
  assert.equal(mailProblem('all quiet'), null);
});

test('a digest Telegram refused is named on the run: a blocked bot, a missing chat, a refused token; an ordinary log or an AI key problem says nothing (#298)', () => {
  assert.match(deliveryProblem(['Jobadabra · 1 new', 'RuntimeError: Forbidden: bot was blocked by the user']), /^not delivered: Telegram blocked the bot \(open the chat with it and press Start/);
  assert.match(deliveryProblem(['Bad Request: chat not found']), /Telegram cannot find the chat/);
  assert.match(deliveryProblem(['Telegram API rejected the message: Unauthorized']), /Telegram refused the bot token/);
  assert.equal(deliveryProblem(['Jobadabra · 3 new jobs', 'Mail: 2 new email(s) read']), null);
  assert.equal(deliveryProblem(['Anthropic 401 Unauthorized: invalid x-api-key']), null, 'an AI key problem is not Telegram');
  assert.equal(deliveryProblem([]), null);
});
