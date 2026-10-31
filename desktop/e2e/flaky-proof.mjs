// After a red suite passed on its second try (e2e.yml, desktop.yml): exits 1 when a step of the first try failed on a wrong value, not timing (lib/flaky-proof.mjs).
// Job: run the backbone
//   node flaky-proof.mjs <first try's suite-failures.json>
//   node flaky-proof.mjs --grey <first> [<second>]   exit 0 = grey; with GREY_RECORD_FILE and GREY_SUITE it writes the job's trend record (lib/grey-record.mjs)
// Prints one line per step: flaky (with its proof) or intermittent (why). Missing, empty or unreadable evidence cannot prove timing and keeps the job red.
import fs from 'node:fs';
import {flakyProof, greyProof} from './lib/flaky-proof.mjs';
import {writeGreyRecord} from './lib/grey-record.mjs';

if (process.argv[2] === '--grey') {
  try {
    const proof = greyProof(...process.argv.slice(3, 5).map(file => JSON.parse(fs.readFileSync(file, 'utf8'))));
    console.log(proof.why);
    // The one place a grey job is recorded for the e2e trend (GREY_RECORD_FILE + GREY_SUITE set by the retry step); a record that cannot be written never changes the verdict.
    if (proof.grey && process.env.GREY_RECORD_FILE) {
      try { writeGreyRecord(process.env.GREY_RECORD_FILE, process.env.GREY_SUITE, proof.reason); } catch (error) { console.log(`::warning::grey record not written: ${error.message.split('\n')[0]}`); }
    }
    process.exit(proof.grey ? 0 : 1);
  } catch (error) {
    console.log(`grey-proof: failures unreadable: ${error.message.split('\n')[0]}`);
    process.exit(1);
  }
}

let failures = null;
try { failures = JSON.parse(fs.readFileSync(process.argv[2], 'utf8')); } catch (error) { console.log(`flaky-proof: no first-try failures read (${error.message.split('\n')[0]}): no timing proof`); process.exit(1); }
// Why (30 Oct 2026, owner-approved design; run 40996297795): an out-of-step answer refusal left [] and a clean retry falsely proved it flaky.
if (!Array.isArray(failures) || failures.length === 0) { console.log('flaky-proof: no first-try failures recorded: no timing proof'); process.exit(1); }
let bad = 0, harness = 0;
for (const failure of failures) {
  const proof = flakyProof(failure.message);
  if (proof.harness) harness++; else if (!proof.flaky) bad++;
  console.log(`${proof.harness ? '🧰 harness' : proof.flaky ? '🎲 flaky' : '🔁 intermittent'}: ${failure.step}: ${proof.why}`);
}
if (harness) console.log(`${harness} step(s) failed a check of the test harness itself (e.g. its isolation from the live app) and passed on the second try: the harness's red, not the app's. The job stays red until the harness is fixed.`);
if (bad) console.log(`${bad} step(s) failed on a wrong value and passed on the second try: that is a bug that shows sometimes, not a flake. The job stays red (gate G5).`);
process.exit(bad || harness ? 1 : 0);
