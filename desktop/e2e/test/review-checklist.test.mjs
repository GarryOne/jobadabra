// Guards lib/review-checklist.mjs: the checklist request a Claude model gets, and which checklist answers become findings.
import assert from 'node:assert/strict';
import {execFile} from 'node:child_process';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import {test} from 'node:test';
import {promisify} from 'node:util';
import {CHECKS, CHECK_SYSTEM, checklistAsFindingsText, checklistRequest, checksToFindings} from '../lib/review-checklist.mjs';
import {parseFindingsDetailed} from '../lib/vision.mjs';

const ANSWER = JSON.stringify({checks: [{id: 'count-mismatch', answer: 'yes', where: 'header', evidence: '"6 recent" but 3 rows listed'},
  {id: 'cut-off', answer: 'yes', where: 'chip', evidence: 'the chip shows only "E…"'}, {id: 'raw-technical', answer: 'no', where: '', evidence: ''}]});

test('the checklist request names every check and carries the picture, the page and the effort', () => {
  const request = checklistRequest({view: 'jobs', pngBase64: 'x', lessons: 'LESSON', model: 'claude-haiku-5-5', effort: 'high'});
  assert.equal(request.model, 'claude-haiku-5-5');
  assert.deepEqual(request.output_config, {effort: 'high'});
  assert.ok(request.max_tokens >= 12000);
  for (const [id] of CHECKS) assert.ok(CHECK_SYSTEM.includes(id), id);
  const [picture, text] = request.messages[0].content;
  assert.equal(picture.type, 'image');
  assert.match(text.text, /Page: jobs[\s\S]*LESSON[\s\S]*Go through every check/);
  assert.equal(checklistRequest({view: 'jobs', pngBase64: 'x', model: 'm'}).output_config, undefined);
});

test('only a "yes" with quoted evidence becomes a finding', () => {
  const answer = JSON.stringify({checks: [
    {id: 'count-mismatch', answer: 'yes', where: 'header', evidence: '"6 recent" but 3 rows listed'},
    {id: 'cut-off', answer: 'yes', where: 'chip', evidence: ''},
    {id: 'raw-technical', answer: 'no', where: '', evidence: 'nothing technical shown'}]});
  assert.deepEqual(checksToFindings(`Here: ${answer}`), [{title: 'count-mismatch: header', detail: '"6 recent" but 3 rows listed'}]);
  assert.deepEqual(checksToFindings('not json'), []);
});

// Owner, 26 Oct 2026: CI's review asks Haiku 5.5 the checklist; the issue filer and the block check read the review's own findings shape, unchanged.
test('a checklist answer becomes findings the review keeps, each with its kind and impact', () => {
  const {kept, dropped} = parseFindingsDetailed(checklistAsFindingsText(ANSWER), 'jobs');
  assert.deepEqual(dropped, []);
  assert.deepEqual(kept.map(item => [item.kind, item.severity, item.title]), [['wrong-result', 'medium', 'count-mismatch: header'], ['layout', 'medium', 'cut-off: chip']]);
  assert.ok(kept.every(item => item.impact.length >= 15));
  assert.equal(checklistAsFindingsText('no json'), '{"findings":[]}');
});

test('with E2E_REVIEW_PROMPT=checklist the review asks the checklist and writes its findings', async () => {
  const asked = [];
  const server = http.createServer(async (req, res) => {
    let body = ''; for await (const chunk of req) body += chunk;
    asked.push(JSON.parse(body));
    res.writeHead(200, {'content-type': 'application/json'});
    res.end(JSON.stringify({content: [{type: 'text', text: ANSWER}], stop_reason: 'end_turn', usage: {input_tokens: 1000, output_tokens: 300}}));
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'checklist-')), art = path.join(dir, 'art');
  fs.mkdirSync(art);
  fs.writeFileSync(path.join(art, 'ui-jobs.png'), Buffer.from([137, 80, 78, 71, 1]));
  try {
    await promisify(execFile)(process.execPath, [new URL('../review-ui.mjs', import.meta.url).pathname], {env: {...process.env, E2E_ANTHROPIC_KEY: 'k',
      E2E_ANTHROPIC_URL: `http://127.0.0.1:${server.address().port}`, E2E_ARTIFACTS: art, E2E_REVIEW_CACHE: path.join(dir, 'cache'),
      E2E_REVIEW_ENGINE: 'claude', E2E_REVIEW_MODEL: 'claude-haiku-5-5', E2E_REVIEW_PROMPT: 'checklist', E2E_REVIEW_LESSONS: '0'}});
    assert.equal(asked.length, 1);
    assert.equal(asked[0].system[0].text, CHECK_SYSTEM);
    assert.equal(asked[0].model, 'claude-haiku-5-5');
    const written = JSON.parse(fs.readFileSync(path.join(art, 'ai-findings.json'), 'utf8'));
    assert.deepEqual(written.findings.map(item => item.kind), ['wrong-result', 'layout']);
    assert.match(written.model, /checklist/);
  } finally { server.close(); }
});
