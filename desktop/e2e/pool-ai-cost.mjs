// node pool-ai-cost.mjs <smoke reports folder> <out file>: a CI pool run's AI spend for /admin/intelligence/ai-cost (owner, 12 Oct 2026, cost safety: the recording runs report
// like every scheduled AI job). Writes {usd, calls} of THIS run (the day report's thisRun: record-sites.mjs sums its rows' spend; the calls are its rows' own, lib/record-sites.mjs parseLive aiCalls)
// to the file desktop/e2e/ai-cost-report.mjs --file sends (job pool-live: .github/workflows/record-sites.yml). Never fails the job. Guard: e2e/test/pool-ai-cost.test.mjs.
import fs from 'node:fs';
import path from 'node:path';
import {pathToFileURL} from 'node:url';

export function runSpend(report = {}) {
  const ran = Array.isArray(report.thisRun?.ran) ? report.thisRun.ran : [];
  const calls = ran.reduce((sum, row) => sum + (Number(report.results?.[row]?.aiCalls) || 0), 0);
  return {usd: Math.round((Number(report.thisRun?.usd) || 0) * 1e6) / 1e6, calls};
}

if (import.meta.url === pathToFileURL(process.argv[1] || '').href) {
  const [dir = '', out = ''] = process.argv.slice(2);
  const days = (() => { try { return fs.readdirSync(dir).filter(name => /^\d{4}-\d\d-\d\d\.json$/.test(name)).sort(); } catch { return []; } })();
  const report = (() => { try { return JSON.parse(fs.readFileSync(path.join(dir, days.at(-1)), 'utf8')); } catch { return {}; } })();
  const spend = runSpend(report);
  fs.writeFileSync(out, JSON.stringify(spend));
  console.log(`pool AI spend: $${spend.usd.toFixed(4)} in ${spend.calls} call(s), for /admin/intelligence/ai-cost`);
}
