// Fails a CI suite at once, with the key's name, when the AI test key is refused (401/403) or a model a suite asks for is refused: free calls (the model list, then
// count_tokens per model: no tokens are produced, nothing is billed). Before it, a refusal showed only as a bare "400" or "AI limit reached" in the engine log and a step that
// expected an AI answer (17 Oct 2026, strategy). Guarded by test/key-check.test.mjs.
// Job: run the backbone
import crypto from 'node:crypto';
const CHECKS = {
  openai: {secret: 'E2E_OPENAI_KEY', url: 'https://api.openai.com/v1/models', headers: key => ({authorization: `Bearer ${key}`})},
  api: {secret: 'E2E_ANTHROPIC_KEY', url: 'https://api.anthropic.com/v1/models', headers: key => ({'x-api-key': key, 'anthropic-version': '2023-06-01'})},
};
// The Claude models the app and the suites call (src/ai/models.py SMALL/MAIN/BIG; test/key-check.test.mjs keeps this list equal to that file).
export const CLAUDE_MODELS = ['claude-haiku-5-5', 'claude-sonnet-5-5', 'claude-opus-5-5'];
const COUNT_TOKENS = 'https://api.anthropic.com/v1/messages/count_tokens';
const MESSAGES = 'https://api.anthropic.com/v1/messages';
// The shape the app sends (src/ai/engine.py structured(): a json_schema format plus effort 'low' on Haiku 5.5, which always runs at low): one tiny paid call, about a tenth of a cent, so a
// 400 that count_tokens cannot see (the request's shape, not the model) shows its message in the first suite's log (owner's yes, 18 Oct 2026, ~$0.05 per beta run in all).
const EXACT_SHAPE = {model: CLAUDE_MODELS[0], max_tokens: 256, messages: [{role: 'user', content: 'Answer ok.'}],
  output_config: {format: {type: 'json_schema', schema: {type: 'object', properties: {answer: {type: 'string'}}, required: ['answer'], additionalProperties: false}}, effort: 'low'}};

// 8 hex of the key's SHA-256: enough to tell two keys apart in a log, useless as a key (the strategy refusals of 18 Oct 2026: is the app sending the key the preflight checked?).
export const keyFingerprint = key => (key ? crypto.createHash('sha256').update(String(key)).digest('hex').slice(0, 8) : 'none');

const say = async response => { try { return String((await response.json())?.error?.message || '').replace(/\s+/g, ' ').replace(/sk-[\w-]{6,}|Bearer\s+\S+|\b[A-Za-z0-9_-]{32,}\b/g, '…').slice(0, 160); } catch { return ''; } };

// An unreachable network is not a verdict on the key: only the provider's own 401/403, or a 400/404 about a model, stops the suite.
export async function checkKeyAccepted({engine, key, fetchImpl = fetch}) {
  const check = CHECKS[engine];
  if (!check || !key) return;
  const ask = async (url, options = {}) => { try { return await fetchImpl(url, {...options, headers: {...check.headers(key), ...options.headers}, signal: AbortSignal.timeout(15000)}); } catch { return null; } };
  const listed = await ask(check.url);
  if (!listed) return;
  if (listed.status === 401 || listed.status === 403) throw new Error(`${check.secret} refused (${listed.status}): the key is revoked, from the wrong project or without access; replace the secret before the next run`);
  if (engine !== 'api') return;
  for (const model of CLAUDE_MODELS) {
    const counted = await ask(COUNT_TOKENS, {method: 'POST', headers: {'content-type': 'application/json'}, body: JSON.stringify({model, messages: [{role: 'user', content: 'ok'}]})});
    if (counted && (counted.status === 400 || counted.status === 404)) throw new Error(`${check.secret}: the API refused model ${model} (${counted.status}) before any suite ran: "${await say(counted)}"`);
  }
  const sent = await ask(MESSAGES, {method: 'POST', headers: {'content-type': 'application/json'}, body: JSON.stringify(EXACT_SHAPE)});
  if (sent && sent.status >= 400 && sent.status < 500 && ![401, 403, 429].includes(sent.status)) throw new Error(`${check.secret}: the API refused the app's own request shape on ${EXACT_SHAPE.model} (${sent.status}): "${await say(sent)}"`);
}
export const CHECKED_ENGINES = Object.keys(CHECKS);

// The other family's key, on every run (17 Oct 2026: an OpenAI-family run could not show why the Claude calls were refused until the next, 1.5 hours later). It never stops the
// suite (this suite does not run on it, though its judges may): a refusal is printed as a preflight warning with the API's words; a pass prints one line.
const KEY_OF = {openai: 'E2E_OPENAI_KEY', api: 'E2E_ANTHROPIC_KEY'};
export async function checkOtherKeys({engine, env = process.env, log = console.log, fetchImpl = fetch}) {
  for (const other of CHECKED_ENGINES.filter(name => name !== engine)) {
    const secret = CHECKS[other].secret;
    try { await checkKeyAccepted({engine: other, key: env[KEY_OF[other]], fetchImpl}); log(env[KEY_OF[other]] ? `  preflight: ${secret} is accepted${other === 'api' ? ` for ${CLAUDE_MODELS.join(', ')}` : ''}` : `  preflight: no ${secret} here`); }
    catch (error) { log(`  ⚠ preflight: ${error.message}`); }
  }
}

/**
 * Takes {provider, engine, key}; checks the app's key like checkKeyAccepted, unless the app's AI provider is codex: then the key is the placeholder (lib/engine.mjs testKey)
 * and the broker relay answers, so there is nothing to ask the provider's API about. Returns false when it checked nothing, else true. Throws as checkKeyAccepted does.
 * Why (#2427 follow-up, 29 Oct 2026): setting CI_AI_PROVIDER=codex made every suite stop at "E2E_ANTHROPIC_KEY refused (401)": the placeholder was sent to api.anthropic.com.
 */
export async function checkAppKey({provider, engine, key, fetchImpl = fetch, log = console.log}) {
  if (provider === 'codex') { log('  preflight: the app is on Codex (the broker relay); no API key is checked for it'); return false; }
  await checkKeyAccepted({engine, key, fetchImpl});
  return true;
}
