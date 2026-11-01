// The automatic refill's cap check and alert (owner, 17 Oct 2026: a PR whose replay finds changed asks starts replay-refill.yml itself, at most $0.50 a run and $5 a calendar month, Telegram at the cap).
// Runs in the refill workflow's pick job (main's code, the only place with the cost key), never in the PR's job. Guard: e2e/test/refill-auto.test.mjs.
//   node refill-auto.mjs cap <estimate usd>      (env AI_COST_PUBLISH_KEY) -> prints "ok" or why not, exit 1 when it must not run
//   node refill-auto.mjs alert "<what>"          (env CI_ALERTS_TELEGRAM_*) -> the owner's Telegram
import path from 'node:path';
import {autoRefusal} from './lib/refill.mjs';
import {send} from './ci-alert.mjs';

const SITE = 'https://www.jobpilotto.top';
// The month's spend of the refill job as /admin/intelligence/ai-cost has it, or NaN when it cannot be read (then nothing is asked).
export async function monthSpend({key, fetcher = fetch, now = new Date()} = {}) {
  if (!key) return NaN;
  try {
    const answer = await fetcher(`${SITE}/ai-cost/data?month=${now.toISOString().slice(0, 7)}&prefix=replay-refill`, {headers: {Authorization: `Bearer ${key}`}, signal: AbortSignal.timeout(15000)});
    const usd = answer.ok ? Number((await answer.json()).usd) : NaN;
    return Number.isFinite(usd) ? usd : NaN;
  } catch { return NaN; }
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(new URL(import.meta.url).pathname)) {
  const [command, arg] = process.argv.slice(2);
  if (command === 'cap') {
    const month = await monthSpend({key: process.env.AI_COST_PUBLISH_KEY}), why = autoRefusal(Number(arg) || 0, month);
    console.log(why || `ok: about $${Number(arg || 0).toFixed(3)} this run, $${month.toFixed(2)} spent this month`);
    process.exit(why ? 1 : 0);
  }
  if (command === 'alert') console.log(await send(`⚠️ Replay refill (automatic): ${arg}\n${process.env.GITHUB_SERVER_URL || 'https://github.com'}/${process.env.GITHUB_REPOSITORY}/actions/runs/${process.env.GITHUB_RUN_ID}`));
  else if (command !== 'cap') { console.error('usage: node refill-auto.mjs cap <estimate usd> | alert "<what>"'); process.exit(2); }
}
