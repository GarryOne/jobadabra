// The OpenAI API engine ('openai'): the user's OPENAI_API_KEY through the official `openai` SDK, on the Responses API. Translates the
// contract's request: system → instructions; messages → input (input_text, input_image and input_file as data URLs); schema → strict
// json_schema (schema.js strict, the answer's nulls dropped back to the caller's shape); effort → reasoning.effort; max_tokens →
// max_output_tokens; web search → {type: 'web_search'}. A Claude model id maps by tier (models.js). cache_control is dropped (OpenAI
// caches by itself). Errors: a rejected key or no quota → AiLimit; rate limit, 5xx, connection → AiUnavailable. Billing 'api'.
// The SDK is loaded only when this engine is used. Guarded by test/ai-contract.test.js (recorded answers, no network, no key).
import {API, Adapter, AiError, AiLimit, AiUnavailable, requestFrom, response, usage} from './contract.js';
import {openaiModel} from './models.js';
import {dropNulls, strict} from './schema.js';

const dataUrl = part => `data:${part.mediaType};base64,${part.data}`;
const EFFORTS = {low: 'low', medium: 'medium', high: 'high', max: 'high'};
// Reasoning counts towards OpenAI's output cap; a call's max_tokens was sized for Claude's answer: headroom on top (a cap, not a charge).
const HEADROOM = {low: 2000, medium: 6000, high: 12000};
export const LIMIT_TEXT = 'OpenAI: your API account has no credit left or reached its spend limit (platform.openai.com → Billing), so this AI step '
  + 'is paused. Add credit there, or switch engines in Settings → Connections → AI.';
export const KEY_TEXT = 'OpenAI refused the API key (Settings → Connections → AI): check it, or switch engines there.';

// The Responses API body for a contract request (src/ai/providers/openai_api.py params_of). action: the AI step, so its calls share a cache.
export function body(request, {env = process.env, action = ''} = {}) {
  const tier = openaiModel(request.model, request.effort, env);
  const effort = tier.effort ? EFFORTS[tier.effort] || null : null;
  let documents = 0;
  const input = request.messages.map(message => ({
    role: message.role,
    content: message.parts.filter(part => typeof part !== 'string' || part).map(part => {
      if (typeof part === 'string') return {type: 'input_text', text: part};
      if (part.kind === 'image') return {type: 'input_image', image_url: dataUrl(part)};
      documents += 1;
      return {type: 'input_file', filename: `document-${documents}.pdf`, file_data: dataUrl(part)};
    }),
  }));
  return {
    model: tier.model, input, store: false,
    max_output_tokens: (request.maxTokens || 4000) + (HEADROOM[effort] || 2000),
    ...(request.system ? {instructions: request.system} : {}),
    ...(effort ? {reasoning: {effort}} : {}),
    ...(request.schema ? {text: {format: {type: 'json_schema', name: 'answer', strict: true, schema: strict(request.schema)}}} : {}),
    ...(request.webSearch ? {tools: [{type: 'web_search'}], max_tool_calls: request.webSearch} : {}),
    ...(action ? {prompt_cache_key: `jobadabra-${action}`} : {}),
  };
}

// The SDK's error as the contract's, by HTTP status and error name (never instanceof one SDK version). A non-SDK error (a bug here)
// passes through untouched, never swallowed as an AI error.
const CONNECTION = /^APIConnection(?:Timeout)?Error$|^APITimeoutError$/;
export function contractError(error) {
  const status = Number.isInteger(error?.status) ? error.status : null, name = String(error?.name || error?.constructor?.name || '');
  if (status === null && !CONNECTION.test(name)) return error;
  const code = error?.code || error?.error?.code;
  const text = `OpenAI: ${String(error?.message || error).slice(0, 300)}`;
  if (status === 401 || status === 403) return new AiLimit(KEY_TEXT, {final: true, cause: error});
  if (status === 429 && code === 'insufficient_quota') return new AiLimit(LIMIT_TEXT, {final: true, cause: error});
  if (status === null || status === 429 || status >= 500) return new AiUnavailable(text, {cause: error});
  return new AiError(text, {cause: error});
}

// The Responses API's answer as the contract's response.
export function fromResponse(answer, request) {
  const blocks = (answer.output || []).filter(item => item.type === 'message').flatMap(item => item.content || []);
  const refused = blocks.find(block => block.type === 'refusal');
  let text = answer.output_text ?? blocks.filter(block => block.type === 'output_text').map(block => block.text).join('');
  let stopReason = 'end_turn';
  if (refused) { stopReason = 'refusal'; text = refused.refusal || ''; }
  else if (answer.status === 'incomplete' && answer.incomplete_details?.reason === 'max_output_tokens') stopReason = 'max_tokens';
  if (request.schema && stopReason === 'end_turn') {
    try { text = JSON.stringify(dropNulls(JSON.parse(text), request.schema)); }
    catch (error) { throw new AiError('OpenAI gave no valid JSON answer for this step', {cause: error}); }
  }
  const used = answer.usage || {};
  const cached = used.input_tokens_details?.cached_tokens || 0;
  return response({text, model: answer.model || request.model, stopReason, engine: 'openai',
    usage: {...usage({input: (used.input_tokens || 0) - cached, output: used.output_tokens || 0, cacheRead: cached, billing: API, provider: 'openai'}),
      model: answer.model || request.model}});   // the model it was priced as (models.js priceOf)
}

export class OpenAiApi extends Adapter {
  static engine = 'openai';
  static family = 'openai';
  static billing = API;
  static label = 'your OpenAI API key';

  constructor({apiKey = '', sdk = null, env = process.env, action = '', ...options} = {}) {
    super(options);
    Object.assign(this, {apiKey, sdk, env, action});
    // The Anthropic SDK's stream shape (on('text', (delta, snapshot)), finalMessage()), so a caller with a progress bar (the strategy draft) shows
    // it on OpenAI too, not only on the Anthropic key (owner, 9 Oct 2026: no degradation when switching). Streaming is this engine's and the Anthropic API's.
    this.messages.stream = params => this.stream(params);
  }

  stream(params) {
    const request = requestFrom(params), listeners = [];
    let done = null;
    const run = async () => {
      const sdk = await this.client();
      let snapshot = '', final = null;
      try {
        const events = await sdk.responses.create({...body(request, {env: this.env, action: this.action}), stream: true});
        for await (const event of events) {
          if (event.type === 'response.output_text.delta') {
            snapshot += event.delta || '';
            for (const listener of listeners) listener(event.delta || '', snapshot);
          } else if (['response.completed', 'response.incomplete', 'response.failed'].includes(event.type)) final = event.response;
          else if (event.type === 'error') throw Object.assign(new Error(event.message || 'stream error'), {status: 500});
        }
      } catch (error) { throw contractError(error); }
      if (!final) throw new AiUnavailable('OpenAI: the answer stream ended without a response');
      if (final.status === 'failed') throw new AiError(`OpenAI: ${final.error?.message || 'the answer failed'}`);
      return fromResponse(final, request);
    };
    return {
      on(event, listener) { if (event === 'text') listeners.push(listener); return this; },
      finalMessage: () => (done ??= run()),
    };
  }

  async client() {
    if (!this.sdk) {
      if (!this.apiKey) throw new AiLimit('This needs your OpenAI API key (Settings → Connections → AI).', {final: true});
      const {default: OpenAI} = await import('openai');
      this.sdk = new OpenAI({apiKey: this.apiKey});
    }
    return this.sdk;
  }

  async complete(request) {
    const sdk = await this.client();
    let answer;
    try { answer = await sdk.responses.create(body(request, {env: this.env, action: this.action})); }
    catch (error) { throw contractError(error); }
    return fromResponse(answer, request);
  }
}

// Is this key valid? A free call (list the models), never a generation. The SDK is loaded only here and in OpenAiApi.
export async function checkOpenAiKey(apiKey, {Sdk = null} = {}) {
  const OpenAI = Sdk || (await import('openai')).default;
  await new OpenAI({apiKey}).models.list();
}
