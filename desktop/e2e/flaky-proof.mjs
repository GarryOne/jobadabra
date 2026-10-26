// After a red suite passed on its second try (e2e.yml, desktop.yml): exits 1 when a step of the first try failed on a wrong value, not timing (lib/flaky-proof.mjs).
//   node flaky-proof.mjs <first try's suite-failures.json>
// Prints one line per step: flaky (with its proof) or intermittent (why). A missing or unreadable file proves nothing either way: exit 0, said.
import fs from 'node:fs';
import {flakyProof} from './lib/flaky-proof.mjs';

let failures = null;
try { failures = JSON.parse(fs.readFileSync(process.argv[2], 'utf8')); } catch (error) { console.log(`flaky-proof: no first-try failures read (${error.message.split('\n')[0]}): nothing to judge`); process.exit(0); }
let bad = 0;
for (const failure of failures) {
  const proof = flakyProof(failure.message);
  if (!proof.flaky) bad++;
  console.log(`${proof.flaky ? '🎲 flaky' : '🔁 intermittent'}: ${failure.step}: ${proof.why}`);
}
if (bad) console.log(`${bad} step(s) failed on a wrong value and passed on the second try: that is a bug that shows sometimes, not a flake. The job stays red (gate G5).`);
process.exit(bad ? 1 : 0);
