// The screenshot review on Free AI end to end (review-ui.mjs against a fake Cloudflare and a fake Claude): Free AI looks first, a page that looks the same
// next run is not asked again, a changed page is, and the Claude second pass runs only behind E2E_REVIEW_CONFIRM=claude, only on what Free AI flagged.
import assert from 'node:assert/strict';
import {execFile} from 'node:child_process';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import {test} from 'node:test';
import {promisify} from 'node:util';
import {png} from './png-make.mjs';

const run = promisify(execFile);
const SCRIPT = new URL('../review-ui.mjs', import.meta.url).pathname;
const FINDING = '{"findings":[{"severity":"medium","kind":"layout","title":"Row too tall","detail":"the first row is 400 px","impact":"They scroll a whole screen past one row.","suggestion":"cap it"}]}';

async function fakes() {
  const seen = {free: [], claude: 0};
  const server = http.createServer(async (req, res) => {
    let body = ''; for await (const chunk of req) body += chunk;
    res.writeHead(200, {'content-type': 'application/json'});
    if (req.url.includes('/ai/run/')) {
      const page = JSON.parse(body).messages[1].content.find(block => block.type === 'text').text.match(/Page: (\S+)/)[1];
      seen.free.push(page);
      return res.end(JSON.stringify({success: true, result: {response: page === 'jobs' ? FINDING : '{"findings":[]}', usage: {prompt_tokens: 3000, completion_tokens: 40}}}));
    }
    seen.claude++;
    res.end(JSON.stringify({content: [{type: 'text', text: '{"findings":[]}'}], stop_reason: 'end_turn', usage: {input_tokens: 1000, output_tokens: 10}}));
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const url = `http://127.0.0.1:${server.address().port}`;
  return {url, seen, close: () => server.close()};
}

const shot = (colour = [40, 60, 200]) => png(320, 200, (x, y) => (x > 20 && x < 200 && y > 20 && y < 120 ? colour : [238, 243, 247]));
async function review(api, dir, {pictures = {}, env = {}} = {}) {
  const art = path.join(dir, `art-${Math.random().toString(36).slice(2)}`); fs.mkdirSync(art);
  for (const view of ['jobs', 'settings']) fs.writeFileSync(path.join(art, `ui-${view}.png`), pictures[view] || shot());
  const {stdout} = await run(process.execPath, [SCRIPT], {env: {...process.env, E2E_REVIEW_ENGINE: 'free', E2E_JUDGE_FAMILY: 'claude', CI_FREE_AI_CF_TOKEN: 'cf', CI_FREE_AI_CF_ACCOUNT_ID: 'acct',
    E2E_REVIEW_FREE_URL: api.url, E2E_ANTHROPIC_KEY: 'k', E2E_ANTHROPIC_URL: api.url, E2E_ARTIFACTS: art, E2E_REVIEW_CACHE: path.join(dir, 'cache'), E2E_REVIEW_LESSONS: '0', ...env}});
  return {stdout, findings: JSON.parse(fs.readFileSync(path.join(art, 'ai-findings.json'), 'utf8')), usage: JSON.parse(fs.readFileSync(path.join(art, 'ai-review-usage.json'), 'utf8'))};
}

test('Free AI reviews each page; the same look next run is not asked again; a changed page is', async () => {
  const api = await fakes(), dir = fs.mkdtempSync(path.join(os.tmpdir(), 'review-free-'));
  try {
    const first = await review(api, dir);
    assert.deepEqual(api.seen.free.sort(), ['jobs', 'settings']);
    assert.equal(api.seen.claude, 0, 'the Claude pass is off by default');
    assert.deepEqual(first.findings.reviewed, ['jobs', 'settings']);
    assert.equal(first.findings.findings.length, 1);
    assert.ok(first.usage.usd > 0 && first.usage.usd < 0.01, String(first.usage.usd));
    assert.match(first.usage.model, /llama-4-scout/);
    const again = await review(api, dir);
    assert.equal(api.seen.free.length, 2, 'nothing asked again');
    assert.equal(again.usage.cached, 2);
    assert.equal(again.findings.findings.length, 1, 'the finding is still seen again');
    await review(api, dir, {pictures: {settings: shot([200, 40, 40])}});
    assert.deepEqual(api.seen.free.slice(2), ['settings'], 'only the changed page is asked');
  } finally { api.close(); }
});

test('E2E_REVIEW_CONFIRM=claude asks Claude again about the pages Free AI flagged, and Claude\'s answer wins', async () => {
  const api = await fakes(), dir = fs.mkdtempSync(path.join(os.tmpdir(), 'review-free-'));
  try {
    const {findings, usage} = await review(api, dir, {env: {E2E_REVIEW_CONFIRM: 'claude'}});
    assert.equal(api.seen.claude, 1, 'only the flagged page');
    assert.equal(usage.confirmed, 1);
    assert.equal(findings.findings.length, 0, 'Claude cleared it');
  } finally { api.close(); }
});
