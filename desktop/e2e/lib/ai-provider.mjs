// Which AI provider CI's test-code calls (the judges, the reviews) go to: codex (the owner's Codex plan through the broker), claude (the API key) or free (Workers AI).
// Why (28 Oct 2026, owner: "a switch where we can easily switch globally between Codex/Claude/Cloudflare Free AI, or per workflow"): one resolver, never a provider picked by a fallback.
// Precedence, most specific first: E2E_AI_PROVIDER (a manual run's input or a workflow's env), E2E_AI_PROVIDER_<CONSUMER> (one job), CI_AI_PROVIDER (the repo variable, the global switch), then 'free' (what CI did before the broker).
// A capped or refused ask is said and skipped (lib/ai-cap.mjs): it never moves to another provider by itself.
export const PROVIDERS = ['codex', 'claude', 'free'];
export const DEFAULT_PROVIDER = 'free';

/**
 * Takes env and an optional consumer name ('judges', 'review'); returns {provider, from} where `from` names the variable that decided (for the run's log line).
 * Throws on a value that is not codex, claude or free. A Mac (no CI) is not switched: its calls use its own Claude Code (lib/model.mjs).
 */
export function aiProvider(env = process.env, consumer = '') {
  if (!env.CI) return {provider: 'claude', from: 'this Mac (Claude Code)'};
  const names = ['E2E_AI_PROVIDER', ...(consumer ? [`E2E_AI_PROVIDER_${consumer.toUpperCase()}`] : []), 'CI_AI_PROVIDER'];
  for (const name of names) {
    const value = String(env[name] || '').trim().toLowerCase();
    if (!value) continue;
    if (!PROVIDERS.includes(value)) throw new Error(`${name} must be codex, claude or free, not "${value}"`);
    return {provider: value, from: name};
  }
  return {provider: DEFAULT_PROVIDER, from: 'default'};
}

/** The one line a run logs so the provider in use is never a guess. */
export const providerLine = (env = process.env, consumer = '') => { const {provider, from} = aiProvider(env, consumer); return `AI provider: ${provider} (from ${from})`; };
