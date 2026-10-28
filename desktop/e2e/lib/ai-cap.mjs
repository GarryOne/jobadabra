// The day's cap on CI's Workers AI neurons (owner, 28 Oct 2026: "Cap at $1/day"): a live Free AI ask past it is refused, so a suite answers from saved replies or goes grey.
// Why (28 Oct 2026, owner; fail closed: mac-27): an unreadable count is treated as capped and said as grey with its cause: a guess that lets the spend through is the silent-hiding class.
// Why (28 Oct 2026, owner): CI on Free AI billed ~$4/day of neurons unseen (fbadf96); this is the stop-gap until CI's AI runs on the Codex plan (specs/2026-10-28-ci-on-codex-subscription-design.md).
// The count is Cloudflare's own for the whole account today (GraphQL), so every runner and job shares it; asked at most once a minute per process, and once over, the day stays over.
import fs from 'node:fs';
import path from 'node:path';

// 10,000 neurons a day are free, then $0.011 per 1,000: $1 over the free part is about 100,900 neurons, so the cap is 100,000 on the account's day.
export const CAP_NEURONS = 100000;
export const TTL_MS = 60000;
const API = 'https://api.cloudflare.com/client/v4/graphql';
const QUERY = (account, day) => `query { viewer { accounts(filter: {accountTag: "${account}"}) { aiInferenceAdaptiveGroups(limit: 1, filter: {datetimeHour_geq: "${day}T00:00:00Z"}) { sum { totalNeurons } } } } }`;

let seen = {at: 0, day: '', neurons: null};
// Forgets the cached count (tests only): takes nothing, returns nothing.
export const resetCap = () => { seen = {at: 0, day: '', neurons: null}; };

// The day's cap in neurons: E2E_AI_CAP_NEURONS from env when it is a number, else CAP_NEURONS. Takes env, returns a number.
export const capOf = (env = process.env) => Number(env.E2E_AI_CAP_NEURONS) || CAP_NEURONS;
// The refusal text a capped ask gets: takes the neuron count (null = unreadable) and env, returns the string; it names the fix when the count is unreadable.
export const capMessage = (neurons, env = process.env) => (neurons == null
  ? 'ai-capped: the account\'s neuron count is unreadable here (CI_CF_ANALYTICS_TOKEN missing or not Account Analytics: Read), so the $1/day cap fails closed; set that secret'
  : `ai-capped: CI's Workers AI is at ${neurons} of ${capOf(env)} neurons today (about $1 a day, owner 28 Oct 2026); it answers from saved replies or the step goes grey`);

// -> {capped: boolean, neurons: number | null, unreadable?: true}. Unreadable (no analytics token or account, Cloudflare down): capped, with `unreadable`, so the spend stops and the grey line names the fix.
// The token is its own least-privilege secret (CI_CF_ANALYTICS_TOKEN, Account Analytics: Read only), never the AI token widened.
export async function capReached({env = process.env, fetchImpl = fetch, now = Date.now()} = {}) {
  const token = env.CI_CF_ANALYTICS_TOKEN, account = env.CI_FREE_AI_CF_ACCOUNT_ID, day = new Date(now).toISOString().slice(0, 10);
  if (seen.day === day && seen.neurons != null && seen.neurons >= capOf(env)) return {capped: true, neurons: seen.neurons};
  if (seen.day === day && now - seen.at < TTL_MS) return seen.neurons == null ? {capped: true, neurons: null, unreadable: true} : {capped: false, neurons: seen.neurons};
  let neurons = null;
  if (token && account) {
    try {
      const answer = await fetchImpl(API, {method: 'POST', headers: {authorization: `Bearer ${token}`, 'content-type': 'application/json'}, body: JSON.stringify({query: QUERY(account, day)}), signal: AbortSignal.timeout(15000)});
      const n = Number((await answer.json())?.data?.viewer?.accounts?.[0]?.aiInferenceAdaptiveGroups?.[0]?.sum?.totalNeurons);
      if (Number.isFinite(n)) neurons = n;
    } catch { /* unreadable below */ }
  }
  seen = {...seen, at: now, day, neurons};
  return neurons == null ? {capped: true, neurons: null, unreadable: true} : {capped: neurons >= capOf(env), neurons};
}

// The line the PR verdict reads (grey: <suite> (<reason>)), and the file kept with the suite's artifacts.
export function noteCapped(neurons, env = process.env) {
  const suite = env.E2E_SUITE || env.E2E_STEPS_SUITE || 'e2e';
  console.log(`grey: ${suite} (${neurons == null ? 'AI capped: neuron count unreadable, set CI_CF_ANALYTICS_TOKEN (Account Analytics: Read)' : `AI capped: ${neurons} of ${capOf(env)} neurons today`})`);
  try {
    if (env.E2E_ARTIFACTS) { fs.mkdirSync(env.E2E_ARTIFACTS, {recursive: true}); fs.writeFileSync(path.join(env.E2E_ARTIFACTS, 'ai-capped.json'), JSON.stringify({neurons, cap: capOf(env), at: new Date().toISOString()})); }
  } catch { /* a note never breaks the run */ }
}
