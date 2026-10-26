// The e2e suites' daily AI budget (owner, 7 Oct 2026: "$30 a week" in a busy week, $10 in a quiet one). Reads what the e2e jobs reported today (the site's
// /ai-cost/data, the same rows /admin/intelligence/ai-cost shows) and says whether today's budget is spent: then the run skips what is paid and optional, the paid AI judge
// steps (E2E_FULL) and the AI screenshot review. The app under test still asks the model what it has not seen (replayed answers cost nothing).
//   node ai-spend.mjs >> "$GITHUB_OUTPUT"     (env: AI_COST_PUBLISH_KEY; E2E_DAILY_BUDGET in USD, default 5) -> over=true|false, spent=<usd>
// Never fails a run: an unreadable figure counts as under budget, and says so.
import {pathToFileURL} from 'node:url';

export const DEFAULT_BUDGET = 5;
const SITE = 'https://www.jobpilotto.top';

export function verdict(spent, budget = DEFAULT_BUDGET) {
  const usd = Number(spent?.usd);
  if (!Number.isFinite(usd)) return {over: false, why: 'today\'s e2e spend could not be read: under budget'};
  return usd >= budget ? {over: true, why: `today's e2e AI spend $${usd.toFixed(2)} reached the $${budget} budget: no paid judge, no screenshot review`}
    : {over: false, why: `today's e2e AI spend $${usd.toFixed(2)} of $${budget}`};
}

export async function readSpent({key, fetcher = fetch, day = new Date().toISOString().slice(0, 10)} = {}) {
  if (!key) return null;
  try {
    const response = await fetcher(`${SITE}/ai-cost/data?day=${day}&prefix=e2e-`, {headers: {Authorization: `Bearer ${key}`}});
    return response.ok ? await response.json() : null;
  } catch { return null; }
}

if (import.meta.url === pathToFileURL(process.argv[1] || '').href) {
  const budget = Number(process.env.E2E_DAILY_BUDGET) || DEFAULT_BUDGET;
  const spent = await readSpent({key: process.env.AI_COST_PUBLISH_KEY});
  const {over, why} = verdict(spent, budget);
  console.log(`over=${over}`);
  console.log(`spent=${spent?.usd ?? ''}`);
  console.error(`- **E2E AI budget:** ${why}\n`);
}
