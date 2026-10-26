// The Anthropic API engine ('api'): the user's ANTHROPIC_API_KEY through the official SDK, the only `new Anthropic` in the app
// (test/ai-contract.test.js fails on one elsewhere). Lossless: the caller's params go to the SDK as written (cache_control kept; only a schema's maxItems/minItems come out, forApi), and the
// SDK's answer and errors come back as they are, with usage.billing 'api'. Free AI (lib/ai-free.js) still works: the SDK
// follows ANTHROPIC_BASE_URL itself, so no baseURL is set here.
import Anthropic from '@anthropic-ai/sdk';
import {API, Adapter, AiLimit, requestFrom} from './contract.js';
import {withoutLimits} from './schema.js';
import {capNow, heard} from './refusals.js';
import {isFreeKey} from '../ai-free.js';

// The one place every ask to the API passes through (create and stream): the schema without maxItems/minItems, which the API refuses in structured
// output (400). Callers write them to cap their own lists and check the answer themselves; everything else in the params stays as written.
const forApi = params => {
  const shape = params?.output_config?.format;
  return shape?.schema ? {...params, output_config: {...params.output_config, format: {...shape, schema: withoutLimits(shape.schema)}}} : params;
};

export class AnthropicApi extends Adapter {
  static engine = 'api';
  static family = 'claude';
  static billing = API;
  static label = 'your Anthropic API key';

  constructor({apiKey, sdk = null, fetch = undefined, ...options} = {}) {
    super(options);
    this.sdk = sdk || new Anthropic({apiKey, ...(fetch ? {fetch} : {})});
    // Streaming stays the SDK's own (the strategy draft's progress bar); only this engine offers it, callers check for it.
    this.messages.stream = (params, options) => { requestFrom(params); return this.sdk.messages.stream(forApi(params), options); };
  }

  async complete(request) {
    // On our Free AI key, a line already reached (refusals.js) stops the call here: the site would refuse it, and the window opens the top-up dialog.
    const cap = isFreeKey(this.sdk?.apiKey) ? capNow() : null;
    if (cap) { heard(null, cap); throw new AiLimit(cap.message || 'Free AI is not available right now.', {final: true}); }
    let answer;
    try { answer = await this.sdk.messages.create(forApi(request.params), request.action ? {headers: {'x-jp-action': request.action}} : undefined); }
    catch (error) { heard(error); throw error; }   // a refusal is heard (refusals.js: a Free AI line reached opens the top-up dialog); the error goes on as it was
    if (answer?.usage) Object.assign(answer.usage, {billing: API, provider: 'anthropic'});
    return answer;
  }
}

// The app's client on an Anthropic key, for the callers that were given one (`client || anthropicApi(apiKey)`).
export const anthropicApi = (apiKey, options = {}) => new AnthropicApi({apiKey, ...options});

// Is this key valid? A free call (list one model), always at Anthropic itself, never the Free AI relay.
export async function checkAnthropicKey(apiKey, {Sdk = Anthropic} = {}) {
  await new Sdk({apiKey, baseURL: 'https://api.anthropic.com'}).models.list({limit: 1});
}
