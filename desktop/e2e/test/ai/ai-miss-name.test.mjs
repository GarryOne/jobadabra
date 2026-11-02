// A red that comes from an AI ask with no stored answer names the ask (operation, id, digests of its parts) and never prints its text (2 Nov 2026, beta 16 wizard, run 41372979302).
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {test} from 'node:test';
import {keepMiss} from '../../lib/ai-meter.mjs';
import {askParts, missFiles, missLine, missName, questionName, turnedAway} from '../../lib/ai-miss-name.mjs';
import {storedAnswer} from '../../lib/ai-answers.mjs';
import {checkAiMisses} from '../../lib/no-real-ai.mjs';

const SECRET = 'private fixture prompt must never be logged';
const scoreBody = {model: 'test', messages: [{role: 'user', content: `Title: Site Reliability Engineer\nCompany: Acme\nLocation: Zurich\nPosting:\n${SECRET}`}]};
// The shape of the wizard's real miss (run 41372979302): a /v1/messages call carrying the CV as a base64 PDF, a system prompt and an output schema.
const wizardAsk = (cv = 'JVBERi0xLjQK', system = 'You set up Jobadabra for a new user from their CV.') => ({model: 'claude-haiku-5-5', max_tokens: 4096, system, stream: false,
  messages: [{role: 'user', content: [{type: 'document', source: {type: 'base64', media_type: 'application/pdf', data: cv}}]}], output_config: {format: {type: 'json_schema', schema: {type: 'object'}}}});

function folder(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ai-miss-name-'));
  t.after(() => fs.rmSync(dir, {recursive: true, force: true}));
  return dir;
}
function miss(dir, name, content) {
  fs.mkdirSync(path.join(dir, 'ai-misses'), {recursive: true});
  fs.writeFileSync(path.join(dir, 'ai-misses', `${name}.json`), JSON.stringify(content));
}

test('a question is named by operation and id, items by count and first key, an unidentified one by its reason', () => {
  assert.equal(questionName({operation: 'app.score', id: '3001'}), 'app.score/3001');
  assert.equal(questionName({operation: 'app.place', items: [{key: 'k1', text: SECRET}, {key: 'k2'}]}), 'app.place (2 items, first key k1)');
  assert.equal(questionName({unkeyable: 'unknown: question identity is not in the request (/v1/messages)'}), 'unkeyable (unknown: question identity is not in the request (/v1/messages))');
  assert.equal(questionName(null), '');
  assert.equal(questionName({}), '');
});

test('the parts line digests every part of the wizard ask, shows the document size, and holds none of its text', () => {
  const line = askParts(wizardAsk());
  assert.match(line, /^model claude-haiku-5-5, system [0-9a-f]{8}, output_config [0-9a-f]{8}, \[0\] user document\(application\/pdf, 12 chars\) [0-9a-f]{8}$/);
  assert.equal(line.includes('JVBERi0xLjQK'), false);
  assert.equal(line.includes('You set up'), false);
  assert.equal(askParts(wizardAsk()), line, 'the same ask, the same line');
  // Two reds compare field by field: only the part that changed differs.
  const digests = text => text.match(/\b[0-9a-f]{8}\b/g);   // system, output_config, document
  const sameButCv = digests(askParts(wizardAsk('JVBERi0xLjQKJSBvdGhlcg==')));
  assert.deepEqual(digests(line).map((digest, n) => digest === sameButCv[n]), [true, true, false]);
  assert.deepEqual(digests(line).map((digest, n) => digest === digests(askParts(wizardAsk(undefined, 'Another system prompt')))[n]), [false, true, true]);
  assert.equal(askParts(null), '');
});

test('a miss file with its action names the operation; a stale-prompt marker names its family', () => {
  assert.equal(missName({url: '/v1/messages', action: 'score', request: scoreBody}).startsWith('app.score/feed/'), true);
  assert.match(missName({url: '/v1/messages', request: wizardAsk()}), /^unkeyable \(unknown: question identity is not in the request/);
  assert.match(missName({url: '/v1/messages', action: 'strategy', request: wizardAsk()}), /^unkeyable \(strategy: /, 'the action is named even when no table kind identifies it');
  assert.equal(missName({family: 'app.place', question: {operation: 'app.place', keys: ['k9']}, approved: 'a', current: 'b'}), 'stale prompt app.place: app.place (1 item, first key k9)');
  assert.equal(missName(null), 'unreadable miss file');
});

test('keepMiss writes the action header into the miss file only when there is one', t => {
  const dir = folder(t), env = {E2E_AI_REPLAY: '1', E2E_AI_CACHE: path.join(dir, 'cache'), E2E_ARTIFACTS: dir};
  keepMiss('with-action', '/v1/messages', Buffer.from(JSON.stringify(scoreBody)), env, 'score');
  keepMiss('no-action', '/v1/messages', Buffer.from(JSON.stringify(scoreBody)), env);
  const read = name => JSON.parse(fs.readFileSync(path.join(dir, 'ai-misses', `${name}.json`), 'utf8'));
  assert.equal(read('with-action').action, 'score');
  assert.equal('action' in read('no-action'), false);
});

test('the miss line keeps its old start and adds the first ask, with no prompt text', t => {
  const dir = folder(t);
  miss(dir, 'abc', {url: '/v1/messages', action: 'score', request: scoreBody});
  const result = checkAiMisses(dir, {aiMissesMax: 0});
  assert.match(result.message, /^AI asks with no stored answer: 1 \(allowed 0\); first ask key: abc; first ask: app\.score\/feed\/[0-9a-f]+; parts: model test, \[0\] user text [0-9a-f]{8}$/);
  assert.equal(result.message.includes(SECRET), false);
  const wizard = folder(t);
  miss(wizard, '21b4b1a27b41630284ee6d3e5ae458d9', {url: '/v1/messages', request: wizardAsk()});
  assert.match(checkAiMisses(wizard, {aiMissesMax: 0}).message, /; first ask: unkeyable .*; parts: model claude-haiku-5-5, system [0-9a-f]{8},.*document\(application\/pdf, 12 chars\)/);
});

test('an unreadable miss file is said so in the line, and the suite still fails', t => {
  const dir = folder(t);
  miss(dir, 'broken', {});
  fs.writeFileSync(path.join(dir, 'ai-misses', 'broken.json'), '{');
  assert.match(missLine(path.join(dir, 'ai-misses', 'broken.json')), /^first ask: unreadable miss file/);
  assert.equal(checkAiMisses(dir, {aiMissesMax: 0}).ok, false);
});

test('a hang message gets nothing when the AI turned nothing away, the first miss when a replay missed, the refused question when the stand-in refused', t => {
  const dir = folder(t);
  assert.equal(turnedAway(dir, {}), '');
  miss(dir, 'abc', {url: '/v1/messages', action: 'score', request: scoreBody});
  assert.match(turnedAway(dir, {}), /^; an AI ask had no stored answer \(1 so far\), first ask: app\.score\/feed\//);
  // The stand-in's own refusal (backbone mode) outranks a miss: the same list the finalizer reads.
  const table = path.join(dir, 'table.json');
  fs.writeFileSync(table, JSON.stringify({v: 1, about: 'Test answers.', answers: {'app.score': {}}}));
  const env = {E2E_AI_ANSWERS: 'backbone', E2E_AI_ANSWERS_FILE: table, E2E_ARTIFACTS: dir, E2E_SUITE: 'wizard'};
  assert.throws(() => storedAnswer({url: '/v1/messages', headers: {'x-jp-action': 'score'}, body: JSON.stringify(scoreBody)}, env), /no stored answer/);
  const said = turnedAway(dir, env);
  assert.match(said, /^; the AI stand-in refused: app\.score\/feed\/[0-9a-f]+$/);
  assert.equal(said.includes(SECRET), false);
});

test('the hang message and the suite verdict count the same files: a folder named like a miss is no miss', t => {
  const dir = folder(t);
  miss(dir, 'real', {url: '/v1/messages', action: 'score', request: scoreBody});
  fs.mkdirSync(path.join(dir, 'ai-misses', 'a-folder.json'));
  fs.writeFileSync(path.join(dir, 'ai-misses', 'notes.txt'), 'not a miss');
  assert.deepEqual(missFiles(dir), ['real.json']);
  assert.deepEqual(missFiles(path.join(dir, 'nowhere')), []);
  assert.match(turnedAway(dir, {}), /\(1 so far\), first ask: app\.score/);
  assert.equal(checkAiMisses(dir, {aiMissesMax: 1}).misses, 1);
});
