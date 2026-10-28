// The screenshot review on Free AI (owner, 26 Oct 2026: "Free AI does the first pass; Claude looks only at what it flags", the Claude pass off until he funds
// Claude): the same request lib/vision.mjs builds for Claude, asked of a Workers AI vision model over Cloudflare's REST API with CI's own token
// (CI_FREE_AI_CF_TOKEN + CI_FREE_AI_CF_ACCOUNT_ID, never production's; docs/rules/why.md), answered in Claude's message shape so review-ui.mjs reads both alike.
// Its cost comes from the answer's own token counts at Cloudflare's list price. Guarded by test/review-free.test.mjs.
import {capMessage, capReached, noteCapped} from './ai-cap.mjs';

export const FREE_MODEL = process.env.E2E_REVIEW_FREE_MODEL || '@cf/meta/llama-4-scout-17b-16e-instruct';
// USD per million tokens (Cloudflare Workers AI pricing, Oct 2026: neurons per million tokens x $0.011 per 1000 neurons).
export const FREE_PRICES = {'@cf/meta/llama-4-scout-17b-16e-instruct': {input: 0.27, output: 0.85}, '@cf/mistralai/mistral-small-3.1-24b-instruct': {input: 0.351, output: 0.555}};
const API = process.env.E2E_REVIEW_FREE_URL || 'https://api.cloudflare.com/client/v4';   // a test points this at a fake
const MAX_TOKENS = 1500;   // no thinking on these models: the JSON answer alone (at most 3 findings) fits

// Claude's request -> Workers AI's: one system text, the picture as a data URL, the same words.
export function toWorkersAi(request) {
  const system = (request.system || []).map(block => block.text).join('\n\n');
  const content = request.messages[0].content.map(block => (block.type === 'image'
    ? {type: 'image_url', image_url: {url: `data:${block.source.media_type};base64,${block.source.data}`}}
    : {type: 'text', text: block.text}));
  return {messages: [{role: 'system', content: system}, {role: 'user', content}], max_tokens: MAX_TOKENS, temperature: 0};
}

export function freeCost(model, usage = {}) {
  const price = FREE_PRICES[model];
  return price ? ((Number(usage.prompt_tokens) || 0) * price.input + (Number(usage.completion_tokens) || 0) * price.output) / 1e6 : null;
}

// -> {ok: true, message: {content: [{type: 'text', text}], stop_reason, usage: {input_tokens, output_tokens}, usd}} or {ok: false, status, detail}.
export async function askFree(request, {token = process.env.CI_FREE_AI_CF_TOKEN, account = process.env.CI_FREE_AI_CF_ACCOUNT_ID, model = FREE_MODEL, fetchImpl = fetch, cap = () => capReached({fetchImpl})} = {}) {
  if (!token || !account) return {ok: false, status: 'no-token', detail: 'CI_FREE_AI_CF_TOKEN or CI_FREE_AI_CF_ACCOUNT_ID is not set'};
  const day = await cap();   // the day's cap on CI's Workers AI neurons (lib/ai-cap.mjs)
  if (day.capped) { noteCapped(day.neurons); return {ok: false, status: 'capped', detail: capMessage(day.neurons)}; }
  const response = await fetchImpl(`${API}/accounts/${account}/ai/run/${model}`, {method: 'POST',
    headers: {authorization: `Bearer ${token}`, 'content-type': 'application/json'}, body: JSON.stringify(toWorkersAi(request)), signal: AbortSignal.timeout(120000)}).catch(error => error);
  if (response instanceof Error) return {ok: false, status: 0, detail: `no answer: ${response.message}`};
  const body = await response.json().catch(() => ({}));
  if (!response.ok || body.success === false) return {ok: false, status: response.status, detail: JSON.stringify(body.errors || body).slice(0, 300)};
  const said = body.result?.response, usage = body.result?.usage || {};
  const text = typeof said === 'string' ? said : said == null ? '' : JSON.stringify(said);   // a model may hand back the JSON already parsed
  const cut = (Number(usage.completion_tokens) || 0) >= MAX_TOKENS;
  return {ok: true, message: {content: [{type: 'text', text}], stop_reason: cut ? 'max_tokens' : 'end_turn',
    usage: {input_tokens: Number(usage.prompt_tokens) || 0, output_tokens: Number(usage.completion_tokens) || 0}}, usd: freeCost(model, usage)};
}
