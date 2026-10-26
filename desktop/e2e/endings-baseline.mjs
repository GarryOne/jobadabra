// node endings-baseline.mjs <reports folder>... [--platforms <admin/applying?json file>] [--json <out>]: the outcome contract's baseline from pool reports that ALREADY exist
// (spec 2026-10-12-one-next-move.md, phase 1a; no new run). Every row run of each folder's day reports (record-sites.mjs `<day>.json`; a CI artifact's own run's rows only), classified by
// lib/ending.mjs with the row's app log when it was kept (`<day>-<row>.app.log`). Prints the unresolved rows first (the work list, each with its cause), the rows held by the test
// (not measured), the endings, and the resolution share raw and weighted by real demand (each platform's match share on /admin/form-filling/lab's scorecard, from --platforms).
import fs from 'node:fs';
import path from 'node:path';
import {ENDINGS} from '../../extension/ladder/endings.js';
import {endingOf, tally} from './lib/ending.mjs';

const args = process.argv.slice(2), flag = name => { const at = args.indexOf(name); return at >= 0 ? args[at + 1] : ''; };
const jsonFile = flag('--json'), platformsFile = flag('--platforms');
const dirs = args.filter((arg, index) => !arg.startsWith('--') && !['--json', '--platforms'].includes(args[index - 1]));
const read = file => { try { return fs.readFileSync(file, 'utf8'); } catch { return ''; } };
const admin = (() => { try { return JSON.parse(read(platformsFile)); } catch { return {}; } })();
const platformOf = new Map((admin.pool || []).map(row => [row.name, row.platform || 'Custom']));
const shareOf = new Map((admin.scorecard || []).map(row => [row.platform, Number(row.matchShare) || 0]));

const rows = [];
for (const dir of dirs) {
  const ci = /(^|\/)ci-\d+(\/|$)/.test(dir);
  for (const name of (() => { try { return fs.readdirSync(dir).filter(one => /^\d{4}-\d\d-\d\d\.json$/.test(one)).sort(); } catch { return []; } })()) {
    let report = {};
    try { report = JSON.parse(read(path.join(dir, name))); } catch { continue; }
    const day = report.day || name.slice(0, 10), ran = ci && Array.isArray(report.thisRun?.ran) ? new Set(report.thisRun.ran) : null;   // a CI artifact: only that run's rows
    for (const [row, result] of Object.entries(report.results || {})) {
      if (ran && !ran.has(row)) continue;
      const found = endingOf(result, read(path.join(dir, `${day}-${row.replace(/\W+/g, '-')}.app.log`)), {ci});
      rows.push({source: ci ? 'ci' : 'mac', day, row, platform: platformOf.get(row) || 'Custom', reached: result?.reached || 'none', ...found,
        evidence: result?.evidence ? path.join(dir, result.evidence) : ''});
    }
  }
}
const latest = new Map(); for (const one of [...rows].sort((a, b) => a.day.localeCompare(b.day))) latest.set(one.row, one);   // a row's newest run (CI or Mac)
const runs = tally(rows), last = tally([...latest.values()]);
const pct = n => `${Math.round(n * 100)}%`;
// Weighted by real demand: each platform's resolution (its rows' newest runs) times its match share; platforms with no share (Custom) or no counted row weigh nothing.
const weighted = (() => {
  let sum = 0, weight = 0;
  const samples = [];   // each platform's share and how many rows it rests on: the number is only as precise as these
  for (const [platform, share] of [...shareOf].sort((a, b) => b[1] - a[1])) {
    const mine = tally([...latest.values()].filter(one => one.platform === platform));
    if (share > 0) samples.push(`${platform} ${share}%: ${mine.counted} row${mine.counted === 1 ? '' : 's'}`);
    if (share > 0 && mine.counted) { sum += share * mine.resolution; weight += share; }
  }
  return weight ? {value: sum / weight, covered: weight, samples} : null;
})();
const unresolved = [...latest.values()].filter(one => one.ending === 'unresolved');
console.log(`UNRESOLVED (the work list, newest run per row): ${unresolved.length}${last.aiMiss ? ` (the AI declined or was unsure: ${last.aiMiss})` : ''}`);
for (const one of unresolved) console.log(`- ${one.row} [${one.platform}, ${one.source} ${one.day}]: ${one.aiMiss ? 'the AI declined: ' : ''}${one.why}`);
const held = [...latest.values()].filter(one => one.held);
console.log(`HELD BY THE TEST, not measured: ${held.length} (${[...new Set(held.map(one => one.held))].map(kind => `${held.filter(one => one.held === kind).length} ${kind}`).join(', ')})`);
console.log(`\n| Ending | Row runs | Newest per row |\n|---|---|---|\n${['unresolved', ...ENDINGS.filter(one => one !== 'unresolved')].map(one => `| ${one} | ${runs.endings[one]} | ${last.endings[one]} |`).join('\n')}`);
console.log(`| held by the test | ${runs.held} | ${last.held} |\n| not counted (harness, tripwire, AI refused) | ${runs.uncounted} | ${last.uncounted} |`);
console.log(`\nresolution, raw: ${pct(last.resolution)} of ${last.counted} rows (row runs: ${pct(runs.resolution)} of ${runs.counted}); weighted by real demand: ${weighted ? `${pct(weighted.value)} (platforms covering ${weighted.covered}% of matches; rows per platform: ${weighted.samples.join(', ')})` : 'no scorecard given'}; ready ${pct(last.endings.ready / (last.counted || 1))}`);
for (const one of ENDINGS.filter(ending => !['ready', 'unresolved'].includes(ending))) {
  const list = [...latest.values()].filter(item => item.ending === one);
  if (list.length) console.log(`${one}: ${list.map(item => `${item.row} (${item.why})`).join('; ')}`);
}
if (jsonFile) fs.writeFileSync(jsonFile, `${JSON.stringify(rows, null, 1)}\n`);
