// Runs a persona command behind CI's Codex Messages relay; GitHub OIDC stays in the parent and no API credential or fallback reaches the child.
import {spawn} from 'node:child_process';
import http from 'node:http';
import {pathToFileURL} from 'node:url';
import {aiProvider} from '../../desktop/e2e/lib/ai-provider.mjs';
import {aiLine, askBroker, toBrokerCall} from '../../desktop/e2e/lib/broker-client.mjs';
import {answerViaBroker} from '../../desktop/e2e/lib/broker-relay.mjs';

/** The answer's output tokens (the model's tier is already on the line as `small`), or null when the call failed: the per-call cost table is measured, not estimated (#2913). */
function outputTokens(counted) {
  try { return JSON.parse(counted)?.usage?.output_tokens ?? null; } catch { return null; }
}

/** Measure each relay call without changing its answer. `waited` is the client residual, not a measurement of queue time alone; no prompt text is logged. */
export function timedRelay({env = process.env, ask = askBroker, now = Date.now, log = line => console.error(line)} = {}) {
  let inFlight = 0;
  return async (body, kind = 'unlabelled') => {
    const started = now(), call = toBrokerCall(body);
    let chars = call.prompt.length, brokerMs = null, sent = false, status = 'error', outTokens = null;
    inFlight++;
    try {
      const answer = await answerViaBroker(body, {env, ask: async (wire, options) => {
        chars = toBrokerCall(wire).prompt.length;
        sent = true;
        const result = await ask(wire, options);
        if (Number.isFinite(result.ms)) brokerMs = result.ms;
        return result;
      }});
      status = answer.status;
      outTokens = outputTokens(answer.counted);
      return answer;
    } finally {
      const total = now() - started;
      const label = String(kind).replace(/[^a-zA-Z0-9_.-]/g, '_').slice(0, 64);
      log(`relay: ${call.tier} total ${total} broker ${brokerMs ?? 'na'} waited ${brokerMs === null ? 'na' : total - brokerMs} in-flight ${inFlight} prompt-chars ${chars} kind ${label} start ${started} status ${status} sent ${sent ? 'yes' : 'no'} tools ${body.tools?.length || 0} out-tokens ${outTokens ?? 'na'}`);
      inFlight--;
    }
  };
}

/** Run one command on the Codex relay and return its exit code. Invariant: every proxy request uses the broker; no API fallback, even on refusal. */
export async function runOnCodex(command, args, {env = process.env, ask = askBroker} = {}) {
  if (!env.CI || aiProvider(env).provider !== 'codex' || !env.ACTIONS_ID_TOKEN_REQUEST_URL || !env.ACTIONS_ID_TOKEN_REQUEST_TOKEN) {
    throw new Error('the persona Codex relay requires CI, the Codex provider and GitHub OIDC');
  }
  // Why (30 Oct 2026, Gitar on #2635): persona quality must be live; the e2e proxy's golden answers, stale stamps and replay cache cannot measure a changed search.
  const relay = timedRelay({env, ask});
  const server = http.createServer(async (request, response) => {
    const chunks = [];
    for await (const chunk of request) chunks.push(chunk);
    try {
      const answer = await relay(JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}'), request.headers['x-jp-action'] || 'unlabelled');
      response.writeHead(answer.status, {'content-type': answer.contentType});
      response.end(answer.body);
    } catch (error) {
      response.writeHead(502, {'content-type': 'application/json'});
      response.end(JSON.stringify({type: 'error', error: {type: 'api_error', message: `relay: ${error.message}`}}));
    }
  });
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
  const url = `http://127.0.0.1:${server.address().port}`;
  try {
    const childEnv = Object.fromEntries(Object.entries(env).filter(([name]) => !name.endsWith('_KEY') && !name.endsWith('_TOKEN') && !name.endsWith('_SECRET') && !name.startsWith('ANTHROPIC_') && !name.startsWith('ACTIONS_ID_TOKEN_')));
    Object.assign(childEnv, {JOBADABRA_PERSONA_CODEX: '1', ANTHROPIC_BASE_URL: url, JOBADABRA_E2E: '1', JOBADABRA_E2E_AI_BASE_URL: url, JOBADABRA_NO_DOTENV: '1'});
    return await new Promise((resolve, reject) => {
      const child = spawn(command, args, {env: childEnv, stdio: 'inherit'});
      child.once('error', reject);
      child.once('exit', code => resolve(code ?? 1));
    });
  } finally { server.closeAllConnections?.(); await new Promise(resolve => server.close(resolve)); }
}

/** The --proof line: which AI answered (engine / model / what it fell back from), never "Codex" when Claude did (Gitar on #2947). */
export const proofLine = answer => `AI broker answered (${aiLine(answer) || answer.model || answer.tier}); no API key used`;

async function main() {
  if (process.argv[2] === '--proof') {
    const answer = await askBroker({model: 'claude-haiku-5-5', max_tokens: 8, messages: [{role: 'user', content: 'Answer ok.'}]});
    if (!answer.ok) throw new Error(`AI broker: ${answer.status}: ${answer.detail}`);
    console.log(proofLine(answer));
    return 0;
  }
  if (process.argv[2] !== '--' || !process.argv[3]) throw new Error('usage: codex.mjs -- <command> [args] | --proof');
  return runOnCodex(process.argv[3], process.argv.slice(4));
}
if (import.meta.url === pathToFileURL(process.argv[1] || '').href) main().then(code => { process.exitCode = code; }).catch(error => { console.error(error.message); process.exitCode = 1; });
