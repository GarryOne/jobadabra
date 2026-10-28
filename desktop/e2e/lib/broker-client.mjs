// CI's side of the Codex broker (jobadabra-web workers/codex-broker): a test-code Messages request becomes one broker call, and the broker's answer comes back in Messages shape.
// Why (28 Oct 2026, owner): CI's AI runs on his Codex plan; a job proves itself with GitHub's per-run OIDC token (the login never leaves the broker), and each workflow keeps its Claude tier:
// Haiku -> small (gpt-6-luna), Sonnet -> mid (gpt-6.1-sol), Opus -> large (gpt-6-astra) (jobadabra-web lib/tiers.mjs is the server's side of the same map).
export const AUDIENCE = 'jobadabra-codex-broker';
export const BROKER_URL = env => env.CODEX_BROKER_URL || 'https://jobadabra-codex-broker.jobpilotto.workers.dev';

/** A Claude model id -> the broker's tier name ('small' | 'mid' | 'large'); an unknown id runs on 'mid'. */
export const tierOf = id => (/haiku/i.test(id || '') ? 'small' : /opus/i.test(id || '') ? 'large' : 'mid');

const text = content => (typeof content === 'string' ? content : (content || []).filter(part => part.type !== 'image').map(part => part.text ?? '').join('\n'));

/** A Messages request -> the broker's body: {tier, prompt, schema?, images?}. One system text, the turns in order, the pictures as base64. */
export function toBrokerCall(body) {
  const system = Array.isArray(body.system) ? body.system.map(block => block.text).join('\n\n') : body.system || '';
  const turns = body.messages.map(message => `${message.role === 'assistant' ? 'You' : 'User'}:\n${text(message.content)}`).join('\n\n');
  const images = body.messages.flatMap(message => (Array.isArray(message.content) ? message.content : []).filter(part => part.type === 'image').map((part, i) => ({name: `image${i}.${String(part.source?.media_type || 'image/png').split('/')[1]}`, base64: part.source?.data})));
  const schema = body.output_config?.format?.schema;
  return {tier: tierOf(body.model), prompt: [system, turns].filter(Boolean).join('\n\n'), ...(schema ? {schema} : {}), ...(images.length ? {images} : {})};
}

/** This run's OIDC token for the broker (the workflow needs `permissions: id-token: write`), or null outside such a job. */
export async function runToken(env = process.env, fetchImpl = fetch) {
  if (!env.ACTIONS_ID_TOKEN_REQUEST_URL || !env.ACTIONS_ID_TOKEN_REQUEST_TOKEN) return null;
  const answer = await fetchImpl(`${env.ACTIONS_ID_TOKEN_REQUEST_URL}&audience=${AUDIENCE}`, {headers: {authorization: `Bearer ${env.ACTIONS_ID_TOKEN_REQUEST_TOKEN}`}});
  return (await answer.json()).value || null;
}

/**
 * Asks the broker. -> {ok: true, message: {content, stop_reason, usage}, tier, model} or {ok: false, status, detail}.
 * status 'capped' = the broker's budget or login said no (429/503: skip with the reason, never another provider); 'no-token' = not a job with id-token; 'unreachable' = no answer.
 */
export async function askBroker(body, {env = process.env, fetchImpl = fetch} = {}) {
  const token = await runToken(env, fetchImpl).catch(() => null);
  if (!token) return {ok: false, status: 'no-token', detail: 'no GitHub OIDC token here (the job needs permissions: id-token: write; a fork run has none)'};
  const answer = await fetchImpl(`${BROKER_URL(env)}/call`, {method: 'POST', headers: {authorization: `Bearer ${token}`, 'content-type': 'application/json'}, body: JSON.stringify(toBrokerCall(body)), signal: AbortSignal.timeout(180000)}).catch(error => error);
  if (answer instanceof Error) return {ok: false, status: 'unreachable', detail: `no answer from the broker: ${answer.message}`};
  const data = await answer.json().catch(() => ({}));
  if (answer.status === 429 || answer.status === 503) return {ok: false, status: 'capped', detail: `broker: ${data.why || answer.status}`};
  if (!answer.ok) return {ok: false, status: answer.status, detail: `broker: ${data.why || data.error || answer.status}`};
  return {ok: true, tier: data.tier, model: data.model, message: {content: [{type: 'text', text: data.reply}], stop_reason: 'end_turn', usage: {input_tokens: data.tokens?.input || 0, output_tokens: data.tokens?.output || 0}}};
}
