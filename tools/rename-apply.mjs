// Rewrites the old-name tokens that tools/rename-map.json assigns to the given steps (3 prose, 4 in-page, 5 env/header/telemetry/package, 6 Keychain), file by file.
//   node tools/rename-apply.mjs --step 3 [--step 4 …] [--dry]    --dry prints the diff stat only
// Files in the map's `skip` list and every `keep` / `owner` rule are never touched. Step 3 also renames files that carry the old name.
import {execFileSync} from 'node:child_process';
import fs from 'node:fs';
import {loadMap, trackedFiles, occurrences, classify, skipped, renamed} from './lib/rename-scan.mjs';

const args = process.argv.slice(2), dry = args.includes('--dry');
const steps = new Set(args.flatMap((a, i) => (a === '--step' ? [Number(args[i + 1])] : [])));
if (!steps.size) { console.error('usage: node tools/rename-apply.mjs --step N [--step M …] [--dry]'); process.exit(2); }
const map = loadMap();
let files = 0, hits = 0;
for (const file of trackedFiles()) {
  if (skipped(map, file)) continue;
  const mine = occurrences(file).filter(occ => { const rule = classify(map, occ); return rule && steps.has(rule.step); });
  if (!mine.length) continue;
  const lines = fs.readFileSync(file, 'utf8').split('\n');
  for (const occ of mine.sort((a, b) => b.line - a.line || b.col - a.col)) {   // right to left: earlier columns stay valid
    const text = lines[occ.line - 1];
    lines[occ.line - 1] = text.slice(0, occ.col) + renamed(occ.token) + text.slice(occ.col + occ.token.length);
  }
  files++; hits += mine.length;
  if (!dry) fs.writeFileSync(file, lines.join('\n'));
}
console.log(`${dry ? 'would rewrite' : 'rewrote'} ${hits} hit(s) in ${files} file(s) for step(s) ${[...steps].join(', ')}`);
if (steps.has(3) && !dry) {
  for (const file of trackedFiles()) {
    if (skipped(map, file) || !/job[-_]?pilotto/i.test(file)) continue;
    const to = renamed(file);
    execFileSync('git', ['mv', file, to]); console.log(`renamed ${file} -> ${to}`);
  }
}
