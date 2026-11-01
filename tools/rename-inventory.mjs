// Counts every old-name token (job-pilotto in any spelling) by the rule of tools/rename-map.json that owns it, and fails on a token no rule owns.
//   node tools/rename-inventory.mjs            table: rule, step, hits, files; exit 1 if any hit has no rule
//   node tools/rename-inventory.mjs --tokens   every distinct token with its count and rule id (to write a new rule)
//   node tools/rename-inventory.mjs --step N   only the rules of step N
import {loadMap, trackedFiles, occurrences, classify, skipped} from './lib/rename-scan.mjs';

const args = process.argv.slice(2), step = args.includes('--step') ? Number(args[args.indexOf('--step') + 1]) : null;
const map = loadMap(), rows = new Map(), unowned = new Map(), tokens = new Map();
for (const file of trackedFiles()) {
  if (skipped(map, file)) continue;
  for (const occ of occurrences(file)) {
    const rule = classify(map, occ), id = rule ? rule.id : '(none)';
    const row = rows.get(id) || {id, step: rule ? (rule.step ?? (rule.keep ? 'keep' : 'owner')) : undefined, hits: 0, files: new Set()};
    row.hits++; row.files.add(file); rows.set(id, row);
    const t = tokens.get(occ.token) || {n: 0, id, example: `${file}:${occ.line}`}; t.n++; tokens.set(occ.token, t);
    if (!rule) unowned.set(`${occ.token}  ${file}:${occ.line}`, occ.before.slice(-20) + '«' + occ.token + '»' + occ.after.slice(0, 20));
  }
}
if (args.includes('--tokens')) { for (const [tok, t] of [...tokens].sort((a, b) => b[1].n - a[1].n)) console.log(`${String(t.n).padStart(5)}  ${tok}  [${t.id}]  ${t.example}`); process.exit(0); }
for (const r of [...rows.values()].filter(r => step === null || r.step === step).sort((a, b) => b.hits - a.hits)) console.log(`${String(r.hits).padStart(6)} hits ${String(r.files.size).padStart(4)} files  step ${r.step ?? '?'}  ${r.id}`);
if (unowned.size) { console.log(`\n${unowned.size} hit(s) no rule owns:`); for (const [k, v] of [...unowned].slice(0, 40)) console.log(`  ${k}\n      ${v}`); process.exit(1); }
