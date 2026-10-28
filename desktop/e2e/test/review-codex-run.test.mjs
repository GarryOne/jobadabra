// The screenshot review on Codex end to end (review-ui.mjs against a fake GitHub token endpoint and a fake broker): each page is one broker call at the tier of the review's Claude
// model, no Anthropic key is needed, the same look next run is not asked again, and a broker "no" leaves a page unreviewed with its reason (never another provider).
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
  const seen = {calls: [], claude: 0, auth: new Set()}, mode = {status: 200};
  const server = http.createServer(async (req, res) => {
    let body = ''; for await (const chunk of req) body += chunk;
    res.writeHead(req.url.startsWith('/call') ? mode.status : 200, {'content-type': 'application/json'});
    if (req.url.startsWith('/token')) return res.end(JSON.stringify({value: 'jwt-for-run'}));
    if (req.url.startsWith('/v1/messages')) { seen.claude++; return res.end(JSON.stringify({content: [{type: 'text', text: '{"findings":[]}'}], stop_reason: 'end_turn', usage: {input_tokens: 1000, output_tokens: 10}})); }   // the Claude API, for the run that fills the cache first
    const call = JSON.parse(body); seen.calls.push({tier: call.tier, images: (call.images || []).length}); seen.auth.add(req.headers.authorization);
    if (mode.status !== 200) return res.end(JSON.stringify({why: 'budget:week 85% of 85% (scheduled)'}));
    res.end(JSON.stringify({reply: seen.calls.length === 1 ? FINDING : '{"findings":[]}', tokens: {input: 13000, output: 30}, tier: call.tier, model: 'gpt-6-luna'}));
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  return {url: `http://127.0.0.1:${server.address().port}`, seen, mode, close: () => server.close()};
}

const shot = (colour = [40, 60, 200]) => png(320, 200, (x, y) => (x > 20 && x < 200 && y > 20 && y < 120 ? colour : [238, 243, 247]));
async function review(api, dir, {pictures = {}, env = {}} = {}) {
  const art = path.join(dir, `art-${Math.random().toString(36).slice(2)}`); fs.mkdirSync(art);
  for (const view of ['jobs', 'settings']) fs.writeFileSync(path.join(art, `ui-${view}.png`), pictures[view] || shot());
  const {stdout} = await run(process.execPath, [SCRIPT], {env: {...process.env, CI: 'true', CI_AI_PROVIDER: 'codex', E2E_AI_PROVIDER: '', E2E_AI_PROVIDER_REVIEW: '', E2E_REVIEW_ENGINE: 'claude', E2E_REVIEW_MODEL: 'claude-haiku-5-5',
    E2E_ANTHROPIC_KEY: '', ACTIONS_ID_TOKEN_REQUEST_URL: `${api.url}/token?x=1`, ACTIONS_ID_TOKEN_REQUEST_TOKEN: 'rt', CODEX_BROKER_URL: api.url,
    E2E_ARTIFACTS: art, E2E_REVIEW_CACHE: path.join(dir, "cache"), E2E_REVIEW_LESSONS: "0", ...env}});
  return {stdout, findings: JSON.parse(fs.readFileSync(path.join(art, 'ai-findings.json'), 'utf8')), usage: JSON.parse(fs.readFileSync(path.join(art, 'ai-review-usage.json'), 'utf8'))};
}

test('Codex reviews each page at the small tier with the run token; the same look next run is not asked again', async () => {
  const api = await fakes(), dir = fs.mkdtempSync(path.join(os.tmpdir(), 'review-codex-'));
  try {
    const first = await review(api, dir);
    assert.deepEqual(api.seen.calls.map(call => [call.tier, call.images]), [['small', 1], ['small', 1]]);
    assert.deepEqual([...api.seen.auth], ['Bearer jwt-for-run']);
    assert.deepEqual(first.findings.reviewed.sort(), ['jobs', 'settings']);
    assert.equal(first.findings.findings.length, 1);
    assert.equal(first.usage.usd, 0, 'the plan pays, not a price per page');
    assert.match(first.usage.model, /on Codex/);
    await review(api, dir);
    assert.equal(api.seen.calls.length, 2, 'nothing asked again');
  } finally { api.close(); }
});

test('the broker saying no leaves the pages unreviewed with a warning, and the step does not fail', async () => {
  const api = await fakes(), dir = fs.mkdtempSync(path.join(os.tmpdir(), 'review-codex-'));
  try {
    api.mode.status = 429;
    const out = await review(api, dir);
    assert.deepEqual(out.findings.reviewed, []);
    assert.equal(out.findings.unreviewed.length, 2);
    assert.match(out.stdout, /budget:week 85%/);
  } finally { api.close(); }
});

test('a look Claude judged earlier is not reused as a Codex one: the same pages are asked again on Codex', async () => {
  const api = await fakes(), dir = fs.mkdtempSync(path.join(os.tmpdir(), 'review-codex-'));
  try {
    await review(api, dir, {env: {CI_AI_PROVIDER: 'claude', E2E_ANTHROPIC_KEY: 'k', E2E_ANTHROPIC_URL: api.url, E2E_REVIEW_BATCH: '0'}});
    assert.equal(api.seen.claude, 2, 'Claude looked at both pages and kept them');
    const codex = await review(api, dir);
    assert.equal(api.seen.calls.length, 2, 'Codex asked for both pages, none came from Claude\'s cache');
    assert.equal(codex.usage.cached, 0);
  } finally { api.close(); }
});
