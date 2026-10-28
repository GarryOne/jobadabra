// The day's cap on CI's Workers AI neurons (owner, 28 Oct 2026: "Cap at $1/day"): a live Free AI ask past it is refused, so a suite answers from saved replies or goes grey.
// Why (28 Oct 2026, owner): CI on Free AI billed ~$4/day of neurons unseen (fbadf96); this is the stop-gap until CI's AI runs on the Codex plan (specs/2026-10-28-ci-on-codex-subscription-design.md).
// The count is Cloudflare's own for the whole account today (GraphQL), so every runner and job shares it; asked at most once a minute per process, and once over, the day stays over.
import fs from 'node:fs';
import path from 'node:path';

// 10,000 neurons a day are free, then $0.011 per 1,000: $1 over the free part is about 100,900 neurons, so the cap is 100,000 on the account's day.
export const CAP_NEURONS = 100000;
export const TTL_MS = 60000;
const API = 'https://api.cloudflare.com/client/v4/graphql';
const QUERY = (account, day) => `query { viewer { accounts(filter: {accountTag: "${account}"}) { aiInferenceAdaptiveGroups(limit: 1, filter: {datetimeHour_geq: "${day}T00:00:00Z"}) { sum { totalNeurons } } } } }`;

let seen = {at: 0, day: '', neurons: null, warned: false};
export const resetCap = () => { seen = {at: 0, day: '', neurons: null, warned: false}; };

export const capOf = (env = process.env) => Number(env.E2E_AI_CAP_NEURONS) || CAP_NEURONS;
export const capMessage = (neurons, env = process.env) => `ai-capped: CI's Workers AI is at ${neurons} of ${capOf(env)} neurons today (about $1 a day, owner 28 Oct 2026); it answers from saved replies or the step goes grey`;

// -> {capped: boolean, neurons: number | null}. Unreadable (no token or account, Cloudflare down): not capped, said once on stderr, because a guess must not switch the AI off.
export async function capReached({env = process.env, fetchImpl = fetch, now = Date.now()} = {}) {
  const token = env.CI_FREE_AI_CF_TOKEN, account = env.CI_FREE_AI_CF_ACCOUNT_ID, day = new Date(now).toISOString().slice(0, 10);
  if (seen.day === day && seen.neurons != null && seen.neurons >= capOf(env)) return {capped: true, neurons: seen.neurons};
  if (seen.day === day && now - seen.at < TTL_MS) return {capped: seen.neurons != null && seen.neurons >= capOf(env), neurons: seen.neurons};
  let neurons = null;
  if (token && account) {
    try {
      const answer = await fetchImpl(API, {method: 'POST', headers: {authorization: `Bearer ${token}`, 'content-type': 'application/json'}, body: JSON.stringify({query: QUERY(account, day)}), signal: AbortSignal.timeout(15000)});
      const n = Number((await answer.json())?.data?.viewer?.accounts?.[0]?.aiInferenceAdaptiveGroups?.[0]?.sum?.totalNeurons);
      if (Number.isFinite(n)) neurons = n;
    } catch { /* unreadable below */ }
  }
  if (neurons == null && !seen.warned) { seen.warned = true; console.error('ai-cap: the account\'s neuron count is unreadable here (the CI token needs Account Analytics: Read); the $1/day cap is NOT enforced in this process'); }
  seen = {...seen, at: now, day, neurons};
  return {capped: neurons != null && neurons >= capOf(env), neurons};
}

// The line the PR verdict reads (grey: <suite> (<reason>)), and the file kept with the suite's artifacts.
export function noteCapped(neurons, env = process.env) {
  const suite = env.E2E_SUITE || env.E2E_STEPS_SUITE || 'e2e';
  console.log(`grey: ${suite} (AI capped: ${neurons} of ${capOf(env)} neurons today)`);
  try {
    if (env.E2E_ARTIFACTS) { fs.mkdirSync(env.E2E_ARTIFACTS, {recursive: true}); fs.writeFileSync(path.join(env.E2E_ARTIFACTS, 'ai-capped.json'), JSON.stringify({neurons, cap: capOf(env), at: new Date().toISOString()})); }
  } catch { /* a note never breaks the run */ }
}
