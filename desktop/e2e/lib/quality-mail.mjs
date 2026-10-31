// Live mail-reading quality rates, isolated from Gmail, Notion, the app and the browser.
// Job: run tolerant suites as rates
import {execFile as nodeExecFile} from 'node:child_process';
import path from 'node:path';
import http from 'node:http';
import {modelFetch} from './model.mjs';
import {DUMMY_KEY} from './engine.mjs';
import {noteAiRefused} from './ai-cap.mjs';
import {python, pythonEnv} from './python.mjs';

export const MAIL_WATCHES = ['src/ai/mail.py', 'src/ai/mail_inbox.py', 'src/ai/mail_read.py', 'src/ai/mail_triage.py', 'tools/mail_eval.py', 'tests/fixtures/mail_eval.json', 'desktop/e2e/lib/quality-mail.mjs'];
const repo = path.resolve(import.meta.dirname, '..', '..', '..');

/** Python uses only the loopback transport; modelFetch owns every provider credential and CLI sign-in. */
export const evalEnv = proxyUrl => pythonEnv({JOB_PILOTTO_AI_ENGINE: 'api',
  ANTHROPIC_API_KEY: DUMMY_KEY, ANTHROPIC_BASE_URL: proxyUrl});

// SDK-shaped loopback bridge only: no provider choice, cache or billing outside the existing judge transport.
async function judgeProxy(ctx, fetchImpl) {
  let refusal = null;
  const server = http.createServer(async (req, res) => {
    try {
      const chunks = [];
      for await (const chunk of req) chunks.push(chunk);
      const response = await fetchImpl('https://api.anthropic.com/v1/messages', {method: 'POST',
        headers: {'content-type': 'application/json', 'anthropic-version': '2023-06-01', 'x-api-key': ctx.judgeKey || ''},
        body: Buffer.concat(chunks).toString('utf8')});
      const data = await response.json(), message = data?.error?.message || 'AI provider refused';
      if (!response.ok && ([401, 402, 403, 429, 503].includes(response.status) || /credit|usage limit|ai-capped/i.test(message))) refusal = `${response.status}: ${message}`;
      res.writeHead(response.status, {'content-type': 'application/json'});
      res.end(JSON.stringify(data));
    } catch (error) {
      res.writeHead(502, {'content-type': 'application/json'});
      res.end(JSON.stringify({error: {message: error.message}}));
    }
  });
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
  return {url: `http://127.0.0.1:${server.address().port}`, get refusal() { return refusal; },
    close: () => { server.closeAllConnections(); return new Promise(resolve => server.close(resolve)); }};
}

/** Measure the existing eval through the judge route; provider refusals use the runner grey/alert path. */
export async function runMailReading(ctx, {execFile = nodeExecFile, fetchImpl = modelFetch} = {}) {
  let measured = null;
  await ctx.run('mail reading: invented emails through the mail check prompt, reported as a rate', async () => {
    const proxy = await judgeProxy(ctx, fetchImpl);
    let report;
    try {
      report = await new Promise(resolve => execFile(python(), [path.join(repo, 'tools', 'mail_eval.py')], {
        cwd: repo, timeout: 4 * 60 * 1000, maxBuffer: 4 << 20,
        env: evalEnv(proxy.url),
      }, (error, stdout, stderr) => resolve({code: error ? (error.code ?? 1) : 0, out: String(stdout), err: String(stderr)})));
    } finally { await proxy.close(); }
    const score = /(\d+)\/(\d+) right/.exec(report.out);
    if (!score) {
      if (proxy.refusal) noteAiRefused(`mail reading: ${proxy.refusal}`);
      throw new Error(`the eval did not run: ${(report.err || report.out).trim().split('\n').slice(-3).join(' | ')}`);
    }
    measured = {right: Number(score[1]), total: Number(score[2]),
      strictFailed: report.out.split('\n').filter(line => line.startsWith('MISS') && line.includes('[strict]')).length};
    console.log(`  mail reading: ${measured.right}/${measured.total} right, ${measured.strictFailed} strict miss(es)`);
  }, {needs: ctx.needs});
  return measured;
}
