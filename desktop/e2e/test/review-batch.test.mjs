// The screenshot review against a fake Anthropic API: the pages go as one batch (half price), a cut-off answer is "not reviewed"
// (never a clean page), and a batch too slow to wait for is cancelled and its pages asked directly.
import assert from 'node:assert/strict';
import {execFile} from 'node:child_process';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import {test} from 'node:test';
import {promisify} from 'node:util';

const run = promisify(execFile);
const SCRIPT = new URL('../review-ui.mjs', import.meta.url).pathname;
const FINDING = '{"findings":[{"severity":"medium","kind":"layout","title":"Row too tall","detail":"the first row is 400 px","impact":"They scroll a whole screen past one row.","suggestion":"cap it"}]}';
const message = (text, stop = 'end_turn') => ({content: [{type: 'text', text}], stop_reason: stop, usage: {input_tokens: 1000, cache_read_input_tokens: 2000, output_tokens: 500}});

async function fakeApi({batchEnds = true}) {
  const seen = {batches: 0, direct: 0, cancelled: 0};
  const server = http.createServer(async (req, res) => {
    let body = ''; for await (const chunk of req) body += chunk;
    const send = (data, type = 'application/json') => { res.writeHead(200, {'content-type': type}); res.end(typeof data === 'string' ? data : JSON.stringify(data)); };
    const base = `http://127.0.0.1:${server.address().port}`;
    if (req.url === '/v1/messages/batches' && req.method === 'POST') { seen.batches++; seen.ids = JSON.parse(body).requests.map(r => r.custom_id); return send({id: 'b1', processing_status: 'in_progress'}); }
    if (req.url === '/v1/messages/batches/b1/cancel') { seen.cancelled++; return send({id: 'b1', processing_status: 'canceling'}); }
    if (req.url === '/v1/messages/batches/b1') return send({id: 'b1', processing_status: batchEnds || seen.cancelled ? 'ended' : 'in_progress', results_url: `${base}/results`, request_counts: {}});
    if (req.url === '/results') return send(batchEnds
      ? [{custom_id: 'r0', result: {type: 'succeeded', message: message(FINDING)}}, {custom_id: 'r1', result: {type: 'succeeded', message: message('{"findings":[{"sev', 'max_tokens')}}].map(JSON.stringify).join('\n')
      : [{custom_id: 'r0', result: {type: 'canceled'}}, {custom_id: 'r1', result: {type: 'canceled'}}].map(JSON.stringify).join('\n'), 'application/x-jsonl');
    if (req.url === '/v1/messages') { seen.direct++; return send(message(FINDING)); }
    res.writeHead(404).end();
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  return {url: `http://127.0.0.1:${server.address().port}`, seen, close: () => server.close()};
}

async function review(api, extraEnv = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'review-'));
  const art = path.join(dir, 'art'); fs.mkdirSync(art);
  for (const view of ['jobs', 'settings']) fs.writeFileSync(path.join(art, `ui-${view}.png`), Buffer.from([137, 80, 78, 71, view.length]));
  const {stdout} = await run(process.execPath, [SCRIPT], {env: {...process.env, E2E_ANTHROPIC_KEY: 'k', E2E_ANTHROPIC_URL: api.url, E2E_REVIEW_BATCH_MIN: '2', E2E_ARTIFACTS: art,
    E2E_REVIEW_CACHE: path.join(dir, 'cache'), E2E_REVIEW_POLL_MS: '20', GITHUB_STEP_SUMMARY: '', E2E_JUDGE_FAMILY: 'claude', E2E_REVIEW_LESSONS: '0', ...extraEnv}});
  return {stdout, findings: JSON.parse(fs.readFileSync(path.join(art, 'ai-findings.json'), 'utf8')), usage: JSON.parse(fs.readFileSync(path.join(art, 'ai-review-usage.json'), 'utf8'))};
}

test('the pages go as one batch at half price; a cut-off answer is not reviewed, not a clean page', async () => {
  const api = await fakeApi({batchEnds: true});
  try {
    const {findings, usage, stdout} = await review(api);
    assert.equal(api.seen.batches, 1);
    assert.deepEqual(api.seen.ids, ['r0', 'r1']);
    assert.equal(api.seen.direct, 0, 'nothing asked twice');
    assert.deepEqual(findings.reviewed, ['jobs']);
    assert.deepEqual(findings.unreviewed, [{view: 'settings', why: 'answer cut off (max_tokens)'}]);
    assert.equal(findings.findings.length, 1);
    assert.equal(usage.batched, 2);
    assert.equal(usage.cutOff, 1);
    assert.ok(Math.abs(usage.usd - 2 * 0.5 * (1000 * 2 + 2000 * 0.2 + 500 * 10) / 1e6) < 1e-9, String(usage.usd));
    assert.match(stdout, /stopped early \(max_tokens/);
  } finally { api.close(); }
});

test('a batch too slow to wait for is cancelled and its pages are asked directly, at full price', async () => {
  const api = await fakeApi({batchEnds: false});
  try {
    const {findings, usage} = await review(api, {E2E_REVIEW_BATCH_WAIT_S: '0.1'});
    assert.equal(api.seen.cancelled, 1);
    assert.equal(api.seen.direct, 2);
    assert.deepEqual(findings.reviewed, ['jobs', 'settings']);
    assert.equal(usage.batched, 0);
    assert.equal(usage.calls, 2);
  } finally { api.close(); }
});

// 6 Oct 2026: four pages waited minutes in a batch to save about a cent. Below E2E_REVIEW_BATCH_MIN (20) the pages are asked directly, at once.
test('a few pages skip the batch and are asked directly', async () => {
  const api = await fakeApi({batchEnds: true});
  try {
    const {findings} = await review(api, {E2E_REVIEW_BATCH_MIN: '20'});
    assert.equal(api.seen.batches, 0);
    assert.equal(api.seen.direct, 2);
    assert.deepEqual(findings.reviewed, ['jobs', 'settings']);
  } finally { api.close(); }
});

// 26 Oct 2026 (owner: "cut the costs in half, but close to the same quality as Claude"): each suite job reviewed its own 1-10 pages, under the batch's 20, so no run
// ever batched. CI's review job now reviews every suite's folder at once: one batch for all, each folder's findings in OUT/<folder>/ beside the pictures they name.
test('every suite\'s folder in one batch; each folder\'s findings and pictures land in its own folder under the output', async () => {
  const api = await fakeApi({batchEnds: true}), dir = fs.mkdtempSync(path.join(os.tmpdir(), 'review-many-'));
  try {
    const dirs = ['e2e-artifacts-jobs', 'e2e-artifacts-settings'].map(name => { const at = path.join(dir, 'in', name); fs.mkdirSync(at, {recursive: true}); return at; });
    fs.writeFileSync(path.join(dirs[0], 'ui-jobs.png'), Buffer.from([137, 80, 78, 71, 4]));
    fs.writeFileSync(path.join(dirs[1], 'ui-settings.png'), Buffer.from([137, 80, 78, 71, 8]));
    const out = path.join(dir, 'out'), usageDir = path.join(dir, 'usage');
    await run(process.execPath, [SCRIPT], {env: {...process.env, E2E_ANTHROPIC_KEY: 'k', E2E_ANTHROPIC_URL: api.url, E2E_REVIEW_BATCH_MIN: '1', E2E_ARTIFACTS: usageDir,
      E2E_REVIEW_DIRS: [...dirs, path.join(dir, 'in', 'empty')].join(path.delimiter), E2E_REVIEW_OUT: out, E2E_REVIEW_ENGINE: 'claude', E2E_JUDGE_FAMILY: 'free',
      E2E_REVIEW_CACHE: path.join(dir, 'cache'), E2E_REVIEW_POLL_MS: '20', GITHUB_STEP_SUMMARY: '', E2E_REVIEW_LESSONS: '0'}});
    assert.equal(api.seen.batches, 1, 'one batch for both suites');
    assert.deepEqual(api.seen.ids, ['r0', 'r1']);
    const jobs = JSON.parse(fs.readFileSync(path.join(out, 'e2e-artifacts-jobs', 'ai-findings.json'), 'utf8'));
    const settings = JSON.parse(fs.readFileSync(path.join(out, 'e2e-artifacts-settings', 'ai-findings.json'), 'utf8'));
    assert.deepEqual([jobs.reviewed, jobs.findings.length, jobs.findings[0].file, 'dir' in jobs.findings[0]], [['jobs'], 1, 'ui-jobs.png', false]);
    assert.deepEqual([settings.reviewed, settings.unreviewed], [[], [{view: 'settings', why: 'answer cut off (max_tokens)'}]]);
    assert.ok(fs.existsSync(path.join(out, 'e2e-artifacts-jobs', 'ui-jobs.png')), 'the picture beside its findings');
    assert.ok(!fs.existsSync(path.join(dirs[0], 'ai-findings.json')), 'the suite\'s own folder is left as it came');
    assert.equal(JSON.parse(fs.readFileSync(path.join(usageDir, 'ai-review-usage.json'), 'utf8')).batched, 2);
  } finally { api.close(); }
});
