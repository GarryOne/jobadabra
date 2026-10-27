// Writes one mutant into the checkout (e2e.yml, input `mutant`): node mutate.mjs <id>. `baseline` changes nothing. The suites/order a run needs: node mutate.mjs --plan.
import fs from 'node:fs';
import path from 'node:path';
import {applyMutant, BASELINE, plan} from './lib/mutation.mjs';

const mutants = JSON.parse(fs.readFileSync(new URL('./mutants.json', import.meta.url), 'utf8'));
const root = path.resolve(new URL('../..', import.meta.url).pathname);
const id = process.argv[2];
if (id === '--plan') {   // baselines first (one per suite and store), then the mutants: [{mutant, suite, store}]
  console.log(JSON.stringify(plan(mutants)));
  process.exit(0);
}
if (!id || id === BASELINE) { console.log('baseline: the app is not changed'); process.exit(0); }
const mutant = mutants.find(item => item.id === id);
if (!mutant) { console.error(`unknown mutant: ${id}`); process.exit(2); }
const file = path.join(root, mutant.file);
fs.writeFileSync(file, applyMutant(fs.readFileSync(file, 'utf8'), mutant));
console.log(`mutant ${id} written into ${mutant.file}: ${mutant.what}`);
