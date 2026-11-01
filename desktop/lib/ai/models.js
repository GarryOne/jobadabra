// The models each AI engine family uses, by tier (owner-approved 9 Oct 2026): data, never literals in the AI modules.
// A module asks for a tier (`model('small')`) or sends a Claude model id; an OpenAI engine maps that id to its tier's model.
// Environment overrides: JOBADABRA_OPENAI_SMALL_MODEL / _MAIN_MODEL / _BIG_MODEL. Prices are $ per million tokens.
// Mirrors the engine's tiers (src/ai/providers). Guarded by test/ai-contract.test.js.

export const TIERS = {
  small: {claude: 'claude-haiku-5-5', openai: 'gpt-6-luna'},
  main: {claude: 'claude-sonnet-5-5', openai: 'gpt-6.1-sol'},
  big: {claude: 'claude-opus-5-5', openai: 'gpt-6.1-sol', openaiEffort: 'high'},
};
export const OPENAI_PRICES = {'gpt-6-luna': {input: 0.10, cachedInput: 0.01, output: 0.50}, 'gpt-6.1-sol': {input: 2.00, cachedInput: 0.10, output: 10.00}};

// The tier of a Claude model id (haiku → small, sonnet → main, opus → big); an unknown id is main.
export const tierOf = id => (/haiku/.test(id) ? 'small' : /opus/.test(id) ? 'big' : 'main');

// The model for a tier in a family ('claude' | 'openai').
export function model(tier, family = 'claude', env = process.env) {
  const row = TIERS[tier] || TIERS.main;
  if (family !== 'openai') return row.claude;
  return env[`JOBADABRA_OPENAI_${tier.toUpperCase()}_MODEL`] || row.openai;
}

// What an OpenAI engine runs for the model a caller sent: a Claude id maps by tier; anything else is taken as an OpenAI id.
// effort: the tier's own effort (big = high) unless the caller asked for one.
export function openaiModel(id, effort = null, env = process.env) {
  if (!String(id).startsWith('claude')) return {model: id, effort};
  const tier = tierOf(id);
  return {model: model(tier, 'openai', env), effort: effort || TIERS[tier].openaiEffort || null};
}

// The price per million tokens for a call's usage: the OpenAI model's own for an OpenAI API call (its adapter records usage.model),
// else the caller's Claude price. A subscription call costs 0 wherever the caller checks usage.billing. app-core/src/ai.js has the same
// (the Worker cannot import the app); test/ai-contract.test.js keeps the two equal.
export const priceOf = (usage, claudePrice) => (usage?.provider === 'openai'
  ? OPENAI_PRICES[usage.model] || OPENAI_PRICES[TIERS.main.openai] : claudePrice);
