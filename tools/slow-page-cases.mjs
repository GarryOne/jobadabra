// Writes desktop/e2e/slow-cases.json: the slowest recorded cases, left to main and the daily run on a pull request (desktop/e2e/lib/replay-slow.mjs).
// Measured: node tools/slow-page-cases.mjs <replay-results-*.json from a FULL run (main or the daily one)>; each entry holds the case's seconds in its browser.
// It also writes case-seconds.json (every measured case), consumed only by check-fill.mjs for its quick selection. With no results it estimates from each case's declared window (lib/replay-shard.mjs caseCost) and says so in the file. Keeps the 40 slowest.
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {loadCases} from '../desktop/e2e/lib/page-replay.mjs';
import {caseCost} from '../desktop/e2e/lib/replay-shard.mjs';
import {isRowCase} from '../desktop/e2e/lib/row-case-run.mjs';

const KEEP = 40, files = process.argv.slice(2);
const measured = new Map();
for (const file of files) for (const row of JSON.parse(fs.readFileSync(file, 'utf8'))) if (typeof row.seconds === 'number') measured.set(row.name, Math.max(measured.get(row.name) || 0, row.seconds));
const cases = loadCases().filter(item => !isRowCase(item));
const seconds = item => (measured.size ? measured.get(item.name) ?? caseCost(item) : caseCost(item));   // a case a results file lacks (it was re-run alone, so its seconds were not kept) falls back to its declared window
const slow = [...cases].sort((a, b) => seconds(b) - seconds(a) || a.name.localeCompare(b.name)).slice(0, KEEP).map(item => item.name).sort();
const out = {basis: measured.size ? `measured seconds of ${measured.size} cases (${files.length} results files)` : 'estimated from each case\'s declared window; regenerate from a full run\'s replay-results (node tools/slow-page-cases.mjs <files>)', slow};
fs.writeFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'desktop', 'e2e', 'slow-cases.json'), JSON.stringify(out, null, 2) + '\n');
if (measured.size) fs.writeFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'desktop', 'e2e', 'case-seconds.json'), JSON.stringify({basis: out.basis, seconds: Object.fromEntries([...measured].sort(([a], [b]) => a.localeCompare(b)))}, null, 1) + '\n');   // quick-selector timings only; CI shard weights are owned by fixtures/slice-ci-seconds.json
console.log(`slow-cases.json: ${slow.length} cases, ${out.basis}; case-seconds.json (when measured): check:fill quick selection only`);
console.log('CI shard weights: desktop/e2e/fixtures/slice-ci-seconds.json, measured from first-try steps.json by tools/e2e-step-timings.mjs; this tool does not change them.');
