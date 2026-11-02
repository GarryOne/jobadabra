// A step that hangs says which AI ask the stand-in turned away, so the wizard's "hung" red carries its cause (beta 16, run 41372979302).
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {test} from 'node:test';

// The runner reads the suite's artifacts folder once, at import: point it at a temp folder first (each test file is its own process).
const ARTIFACTS = fs.mkdtempSync(path.join(os.tmpdir(), 'hang-names-ai-'));
process.env.E2E_ARTIFACTS = ARTIFACTS;
const {withLimit} = await import('../../lib/runner.mjs');
const never = () => new Promise(() => {});
const SECRET = 'private fixture prompt must never be logged';

test('a hang with nothing turned away keeps its old message; a replay miss and then a stand-in refusal are named after it', async t => {
  t.after(() => fs.rmSync(ARTIFACTS, {recursive: true, force: true}));
  await assert.rejects(withLimit(never(), 30, 'x'), error => { assert.equal(error.message, 'the step did not finish within 0.03 s (it hung): no app session'); return true; });

  fs.mkdirSync(path.join(ARTIFACTS, 'ai-misses'));
  const request = {model: 'test', messages: [{role: 'user', content: `Title: Site Reliability Engineer\nCompany: Acme\nLocation: Zurich\nPosting:\n${SECRET}`}]};
  fs.writeFileSync(path.join(ARTIFACTS, 'ai-misses', 'abc.json'), JSON.stringify({url: '/v1/messages', action: 'score', request}));
  await assert.rejects(withLimit(never(), 30, 'x'), error => {
    assert.match(error.message, /\(it hung\): no app session; an AI ask had no stored answer \(1 so far\), first ask: app\.score\/feed\//);
    assert.equal(error.message.includes(SECRET), false);
    assert.equal(error.stepHang, true);
    return true;
  });

  const {storedAnswer} = await import('../../lib/ai-answers.mjs');
  const table = path.join(ARTIFACTS, 'table.json');
  fs.writeFileSync(table, JSON.stringify({v: 1, about: 'Test answers.', answers: {'app.score': {}}}));
  assert.throws(() => storedAnswer({url: '/v1/messages', headers: {'x-jp-action': 'score'}, body: JSON.stringify(request)},
    {E2E_AI_ANSWERS: 'backbone', E2E_AI_ANSWERS_FILE: table, E2E_ARTIFACTS: ARTIFACTS, E2E_SUITE: 'wizard'}), /no stored answer/);
  await assert.rejects(withLimit(never(), 30, 'x'), error => {
    assert.match(error.message, /\(it hung\): no app session; the AI stand-in refused: app\.score\/feed\/[0-9a-f]+$/);
    return true;
  });
});
