// The automatic refill's first question (.github/workflows/replay-refill.yml, a push to main): did this merge change what the AI is asked? Prints the reasons, then "changed" or "same" as the LAST line.
//   node refill-trigger.mjs <ladder-baseline.json before the merge | -> <ladder-baseline.json now> [<commit before the merge>]
// Two ways to change it: a ladder prompt fingerprint differs (a score update alone does not), or a file that builds the ask (lib/prompt-sources.mjs: the worker's instructions, fact rule, field list, CV facts)
// differs between the commit before and HEAD. No commit given or known: only the baseline is compared. Guard: e2e/test/filling/refill.test.mjs.
import fs from 'node:fs';
import {fingerprintChanged} from './lib/refill.mjs';
import {blobsAt, sourcesChanged} from './lib/prompt-sources.mjs';

const [beforeFile, afterFile, before] = process.argv.slice(2), read = file => { try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return null; } };
if (!beforeFile || !afterFile) { console.error('usage: node refill-trigger.mjs <baseline before | -> <baseline now> [<commit before>]'); process.exit(2); }
const reasons = [];
if (fingerprintChanged(beforeFile === '-' ? null : read(beforeFile), read(afterFile))) reasons.push('a ladder prompt fingerprint changed');
if (before && !/^0+$/.test(before)) {
  const was = blobsAt(before), now = blobsAt('HEAD'), files = Object.values(was).every(blob => blob === null) ? [] : sourcesChanged(was, now);   // an unknown commit reads all null: not a change by itself
  if (files.length) reasons.push(`what the AI is asked changed in ${files.join(', ')}`);
}
for (const reason of reasons) console.log(reason);
console.log(reasons.length ? 'changed' : 'same');
