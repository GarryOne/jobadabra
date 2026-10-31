// Live mail-reading quality rates, isolated from Gmail, Notion, the app and the browser.
// Job: run tolerant suites as rates
import {execFile as nodeExecFile} from 'node:child_process';
import path from 'node:path';
import {startAiProxy} from './ai-proxy.mjs';
import {familyOf, testKey} from './engine.mjs';
import {python, pythonEnv} from './python.mjs';

export const MAIL_WATCHES = ['src/ai/mail.py', 'src/ai/mail_inbox.py', 'src/ai/mail_read.py', 'src/ai/mail_triage.py', 'tools/mail_eval.py', 'tests/fixtures/mail_eval.json'];
const repo = path.resolve(import.meta.dirname, '..', '..', '..');

/** Isolate the eval environment and pass only its engine's test key; CLI engines retain sign-in HOME. */
export const evalEnv = (ctx, proxyUrl = '') => pythonEnv({JOB_PILOTTO_AI_ENGINE: ctx.engine,
  ...(familyOf(ctx.engine) === 'openai' ? {OPENAI_API_KEY: testKey(process.env, ctx.engine)} : {ANTHROPIC_API_KEY: ctx.key}),   // as before: the eval may need a key (tools/mail_eval.py)
  ...(proxyUrl ? {ANTHROPIC_BASE_URL: proxyUrl} : {})}, {realHome: ['cli', 'codex'].includes(ctx.engine)});

/** Run the existing eval once and measure answers; only an unavailable eval throws (the tolerant lane shows grey). */
export async function runMailReading(ctx, {execFile = nodeExecFile, startProxy = startAiProxy} = {}) {
  let measured = null;
  await ctx.run('mail reading: invented emails through the mail check prompt, reported as a rate', async () => {
    const proxy = ctx.engine === 'api' ? await startProxy() : null;
    let report;
    try {
      report = await new Promise(resolve => execFile(python(), [path.join(repo, 'tools', 'mail_eval.py')], {
        cwd: repo, timeout: 4 * 60 * 1000, maxBuffer: 4 << 20,
        env: evalEnv(ctx, proxy?.url),
      }, (error, stdout, stderr) => resolve({code: error ? (error.code ?? 1) : 0, out: String(stdout), err: String(stderr)})));
    } finally { await proxy?.close(); }
    const score = /(\d+)\/(\d+) right/.exec(report.out);
    if (!score) throw new Error(`the eval did not run: ${(report.err || report.out).trim().split('\n').slice(-3).join(' | ')}`);
    measured = {right: Number(score[1]), total: Number(score[2]),
      strictFailed: report.out.split('\n').filter(line => line.startsWith('MISS') && line.includes('[strict]')).length};
    console.log(`  mail reading: ${measured.right}/${measured.total} right, ${measured.strictFailed} strict miss(es)`);
  }, {needs: ctx.needs});
  return measured;
}
