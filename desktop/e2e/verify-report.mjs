// Sends the verdicts of "Confirmed offline" to /admin/form-filling/lab in ONE PUT (site/src/applying-verify.js): the plan's own (rows answered without a replay) and each row job's verdict.json.
// Bearer REPLAYS_PUBLISH_KEY from the environment, never printed. A row job that died sends nothing for its row: the old verdict stays. Main only (the workflow). 
// Run: node verify-report.mjs <plan.json> <folder with verdict.json files> [--dry]. Guard: e2e/test/verify-report.test.mjs.
import fs from 'node:fs';
import path from 'node:path';

export const VERIFY = 'https://www.jobpilotto.top/applying/verify';
const json = file => { try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return null; } };
const FIELDS = ['kind', 'row', 'verdict', 'why', 'commit', 'buildBy', 'recordedAt', 'olderAt'];

// The verdict files under a folder (any depth) -> their rows.
export function readVerdicts(dir) {
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir, {withFileTypes: true}).flatMap(entry => (entry.isDirectory() ? readVerdicts(path.join(dir, entry.name)) : entry.name === 'verdict.json' ? [json(path.join(dir, entry.name))].filter(Boolean) : []));
}

// -> the rows to send: the plan's immediate verdicts and the jobs', fixed fields only.
export const rowsOf = (plan, verdicts) => [...(plan?.verdicts || []), ...verdicts].map(item => Object.fromEntries(FIELDS.filter(field => item[field] != null).map(field => [field, item[field]])));

export async function uploadVerify(rows, sha, {env = process.env, fetcher = fetch, dry = false} = {}) {
  if (!rows.length) return 'verify report: nothing to send';
  if (dry) return `verify report: dry run: would send ${rows.length} verdict(s)`;
  if (!env.REPLAYS_PUBLISH_KEY) return 'verify report: not sent (REPLAYS_PUBLISH_KEY is not in the environment)';
  try {
    const answer = await fetcher(VERIFY, {method: 'PUT', headers: {Authorization: `Bearer ${env.REPLAYS_PUBLISH_KEY}`, 'Content-Type': 'application/json', 'X-Caller': 'verify-upload'}, body: JSON.stringify({sha, rows}), signal: AbortSignal.timeout(20000)});
    const body = await answer.json().catch(() => ({}));
    return answer.ok ? `verify report: ${body.stored ?? 0} verdict(s) changed of ${rows.length} sent` : `verify report: refused (${answer.status} ${body.error || ''})`;
  } catch (error) { return `verify report: not sent (${String(error?.message || error).slice(0, 80)})`; }
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(new URL(import.meta.url).pathname)) {
  const [planFile, dir] = process.argv.slice(2);
  if (!planFile || !dir) { console.error('usage: node verify-report.mjs <plan.json> <verdicts folder> [--dry]'); process.exit(2); }
  const rows = rowsOf(json(planFile), readVerdicts(dir));
  console.log(await uploadVerify(rows, (process.env.GITHUB_SHA || '').slice(0, 7) || 'local000', {dry: process.argv.includes('--dry')}));
  for (const row of rows) console.log(`  ${row.kind} ${row.row}: ${row.verdict}${row.why ? ` (${row.why})` : ''}`);
}
