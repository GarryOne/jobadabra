// Sends the "Replay vs live (prototype)" records of a step-4 folder (one JSON per pool row, or {rows: [...]}) to /admin/form-filling/lab in ONE PUT (site/src/applying-fidelity.js).
// Bearer REPLAYS_PUBLISH_KEY from the environment, never printed. A prototype's numbers: send only after the site deploy with migration 0064 is green. Run: node fidelity-report.mjs <step-4 folder> [--dry]
import fs from 'node:fs';
import path from 'node:path';
import {needsRefill} from './lib/refill.mjs';

export const FIDELITY = 'https://www.jobpilotto.top/applying/fidelity';

// -> every record of the folder's .json files, a file holding one record or {rows: [...]}.
export function readRecords(dir) {
  return fs.readdirSync(dir).filter(file => file.endsWith('.json')).sort().flatMap(file => {
    const body = JSON.parse(fs.readFileSync(path.join(dir, file), 'utf8'));
    return Array.isArray(body?.rows) ? body.rows : [body];
  });
}

// A row measured against answers older than this build's prompt (its ask changed or is out of date: the refill has not filled it yet): marked, so /admin labels it and never lets it replace good numbers (site/src/applying-fidelity.js).
export const markStale = rows => rows.map(row => (needsRefill(row) ? {...row, answersStale: true} : row));

// -> one line: what was sent, or why not.
export async function uploadFidelity(rows, {env = process.env, fetcher = fetch, dry = false} = {}) {
  if (!rows.length) return 'fidelity report: not sent (no records in the folder)';
  if (dry) return `fidelity report: dry run: would send ${rows.length} record(s)`;
  if (!env.REPLAYS_PUBLISH_KEY) return 'fidelity report: not sent (REPLAYS_PUBLISH_KEY is not in the environment)';
  try {
    const answer = await fetcher(FIDELITY, {method: 'PUT', headers: {Authorization: `Bearer ${env.REPLAYS_PUBLISH_KEY}`, 'Content-Type': 'application/json', 'X-Caller': 'fidelity-upload'},
      body: JSON.stringify({rows: markStale(rows)}), signal: AbortSignal.timeout(20000)});
    const body = await answer.json().catch(() => ({}));
    return answer.ok ? `fidelity report: ${body.stored ?? 0} record(s) stored of ${rows.length} sent` : `fidelity report: refused (${answer.status} ${body.error || ''})`;
  } catch (error) { return `fidelity report: not sent (${String(error?.message || error).slice(0, 80)})`; }
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(new URL(import.meta.url).pathname)) {
  const [dir, flag] = process.argv.slice(2);
  if (!dir) { console.log('usage: node fidelity-report.mjs <step-4 folder> [--dry]'); process.exit(1); }
  console.log(await uploadFidelity(readRecords(dir), {dry: flag === '--dry'}));
}
