// The credit-zero alert (credit-alert.mjs): only a credit message sends, the message names provider, workflow and the next action.
import test from 'node:test';
import assert from 'node:assert/strict';
import {alertCreditOut, creditMessage, isCreditOut} from '../../credit-alert.mjs';

const env = {CI_ALERTS_TELEGRAM_BOT_TOKEN: 'T', CI_ALERTS_TELEGRAM_CHAT_ID: 'C', GITHUB_WORKFLOW: 'CI · AI code review', GITHUB_RUN_ID: '7', GITHUB_REPOSITORY: 'o/r'};

test('the providers\' empty-balance wordings are credit messages; other failures are not', () => {
  for (const text of ['HTTP 400: Credit balance is too low', 'You exceeded your current quota', '{"code":"insufficient_quota"}']) assert.ok(isCreditOut(text), text);
  for (const text of ['HTTP 401 invalid x-api-key', 'rate limit', '']) assert.ok(!isCreditOut(text), text);
});

test('a credit message sends one Telegram message that names the provider, the workflow, the run and what to do; anything else sends nothing', async () => {
  const sent = [];
  const fetcher = async (url, init) => { sent.push({url, body: JSON.parse(init.body)}); return {ok: true}; };
  assert.equal(await alertCreditOut({provider: 'anthropic', text: 'HTTP 401', env, fetcher}), 'credit-alert: not a credit message, nothing sent');
  assert.equal(sent.length, 0);
  assert.equal(await alertCreditOut({provider: 'anthropic', text: 'Credit balance is too low', env, fetcher}), 'ci-alert: sent');
  assert.match(sent[0].url, /botT\/sendMessage/);
  assert.match(sent[0].body.text, /AI credit is 0/);
  assert.match(sent[0].body.text, /anthropic/);
  assert.match(sent[0].body.text, /CI · AI code review/);
  assert.match(sent[0].body.text, /actions\/runs\/7/);
  assert.match(sent[0].body.text, /Codex plan/);
});

test('a capped Codex broker alerts without a credit wording, with the Codex advice', async () => {
  const sent = [];
  await alertCreditOut({provider: 'codex', text: 'broker: scheduled lane over its share', always: true, env, fetcher: async (_, init) => { sent.push(JSON.parse(init.body).text); return {ok: true}; }});
  assert.match(sent[0], /weekly reset/);
});

test('no secrets: one line, no send, and the message never carries the token', async () => {
  assert.match(await alertCreditOut({provider: 'anthropic', text: 'Credit balance is too low', env: {}, fetcher: async () => { throw new Error('must not call'); }}), /not sent \(CI_ALERTS_TELEGRAM_BOT_TOKEN/);
  assert.doesNotMatch(creditMessage({provider: 'anthropic', text: 'x', env}).text, /botT|"T"/);
});

test('capped release artifacts warn and send one existing-channel alert across suites and retries', async () => {
  const fs = await import('node:fs');
  const os = await import('node:os');
  const path = await import('node:path');
  const {alertCappedSteps} = await import('../../credit-alert.mjs');
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ai-credit-health-'));
  const sent = [], lines = [];
  const fetcher = async (_, init) => { sent.push(JSON.parse(init.body)); return {ok: true}; };
  try {
    for (const suite of ['apply', 'qualityai']) {
      fs.mkdirSync(path.join(root, suite));
      fs.writeFileSync(path.join(root, suite, 'ai-capped.json'), JSON.stringify({why: 'weekly budget used up', steps: ['ask'], skipped: 1}));
    }
    const marker = path.join(root, 'alert-sent.txt');
    await alertCappedSteps({artifacts: root, marker, env, fetcher, log: line => lines.push(line)});
    assert.equal(sent.length, 1);
    assert.match(sent[0].text, /AI credit ran out/);
    assert.match(sent[0].text, /beta is not held/);
    assert.match(sent[0].text, /weekly budget used up/);
    assert.ok(lines.every(line => line.includes('::warning title=AI credit ran out::')));
    assert.ok(fs.existsSync(marker));
    await alertCappedSteps({artifacts: root, marker, env, fetcher, log: () => {}});
    assert.equal(sent.length, 1, 'a fresh-runner retry never sends a second credit alert for this run');
    fs.rmSync(marker);
    fs.rmSync(path.join(root, 'qualityai', 'ai-capped.json'));
    fs.rmSync(path.join(root, 'apply', 'ai-capped.json'));
    fs.writeFileSync(path.join(root, 'apply', 'steps.json'), JSON.stringify({results: [{aiCapped: true, status: 'skipped', note: 'AI was capped'}]}));
    await alertCappedSteps({artifacts: root, marker, env, fetcher, log: () => {}});
    assert.equal(sent.length, 2, 'aiCapped step records also alert when the cap file is missing');
  } finally { fs.rmSync(root, {recursive: true, force: true}); }
});

test('every e2e workflow reports AI credit through one nonblocking aggregate alert job', async () => {
  const fs = await import('node:fs');
  for (const name of ['desktop', 'e2e', 'e2e-windows']) {
    const text = fs.readFileSync(new URL(`../../../../.github/workflows/${name}.yml`, import.meta.url), 'utf8');
    const block = text.split('  ai-credit-health:\n')[1]?.split(/\n  [a-z][a-z-]*:/)[0] || '';
    assert.match(block, /continue-on-error: true/, name);
    assert.match(block, /if: always\(\) && !cancelled\(\) && github.ref == 'refs\/heads\/main'/, name);
    assert.match(block, /node desktop\/e2e\/credit-alert.mjs --artifacts/, name);
    assert.doesNotMatch(block, /e2e-rerun/, `${name}: a job has one try, so there is no second-try artifact to download`);
    assert.match(block, /CI_ALERTS_TELEGRAM_BOT_TOKEN:/, name);
    assert.match(block, /name: ai-credit-alert-\$\{\{ github.run_id \}\}/, name);
    assert.match(block, /overwrite: true/, name);
  }
});
