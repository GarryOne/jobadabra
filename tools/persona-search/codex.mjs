// Runs a persona command behind CI's Codex Messages relay; GitHub OIDC stays in the parent and no API credential or fallback reaches the child.
import {spawn} from 'node:child_process';
import {pathToFileURL} from 'node:url';
import {aiProvider} from '../../desktop/e2e/lib/ai-provider.mjs';
import {askBroker} from '../../desktop/e2e/lib/broker-client.mjs';
import {answerViaBroker} from '../../desktop/e2e/lib/broker-relay.mjs';
import {startAiProxy} from '../../desktop/e2e/lib/ai-proxy.mjs';

/** Run one command on the Codex relay and return its exit code. Invariant: every proxy request uses the broker; no API fallback, even on refusal. */
export async function runOnCodex(command, args, {env = process.env, ask = askBroker} = {}) {
  if (!env.CI || aiProvider(env).provider !== 'codex' || !env.ACTIONS_ID_TOKEN_REQUEST_URL || !env.ACTIONS_ID_TOKEN_REQUEST_TOKEN) {
    throw new Error('the persona Codex relay requires CI, the Codex provider and GitHub OIDC');
  }
  const proxy = await startAiProxy({kind: 'app-codex', metered: /./, relay: body => answerViaBroker(body, {env, ask})});
  try {
    const childEnv = Object.fromEntries(Object.entries(env).filter(([name]) => !name.endsWith('_KEY') && !name.endsWith('_TOKEN') && !name.endsWith('_SECRET') && !name.startsWith('ANTHROPIC_') && !name.startsWith('ACTIONS_ID_TOKEN_')));
    Object.assign(childEnv, {JOB_PILOTTO_PERSONA_CODEX: '1', ANTHROPIC_BASE_URL: proxy.url, JOB_PILOTTO_E2E: '1', JOB_PILOTTO_E2E_AI_BASE_URL: proxy.url, JOB_PILOTTO_NO_DOTENV: '1'});
    return await new Promise((resolve, reject) => {
      const child = spawn(command, args, {env: childEnv, stdio: 'inherit'});
      child.once('error', reject);
      child.once('exit', code => resolve(code ?? 1));
    });
  } finally { await proxy.close(); }
}

async function main() {
  if (process.argv[2] === '--proof') {
    const answer = await askBroker({model: 'claude-haiku-5-5', max_tokens: 8, messages: [{role: 'user', content: 'Answer ok.'}]});
    if (!answer.ok) throw new Error(`Codex broker: ${answer.status}: ${answer.detail}`);
    console.log(`Codex subscription broker answered (${answer.model || answer.tier}); no API key used`);
    return 0;
  }
  if (process.argv[2] !== '--' || !process.argv[3]) throw new Error('usage: codex.mjs -- <command> [args] | --proof');
  return runOnCodex(process.argv[3], process.argv.slice(4));
}
if (import.meta.url === pathToFileURL(process.argv[1] || '').href) main().then(code => { process.exitCode = code; }).catch(error => { console.error(error.message); process.exitCode = 1; });
