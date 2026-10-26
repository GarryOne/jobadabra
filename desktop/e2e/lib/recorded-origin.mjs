// Where a recorded case's page came from (owner, 12 Oct 2026, via job-pilotto-cc: a green replay proves a mechanism on a small page, not a site): every case.json says
// `origin`: 'captured' (the markup came from a real page: saved by a run or copied, then scrubbed or reduced) or 'hand-cut' (written by hand: invented, reconstructed from a sketch or
// a screenshot, rebuilt small). /admin/form-filling/lab shows it per case (site/src/applying-cases.js). Guard: desktop/test/recorded-origin.test.js fails a case without it.
import fs from 'node:fs';
import path from 'node:path';

export const ORIGINS = ['captured', 'hand-cut'];
export const originOf = item => (ORIGINS.includes(item?.origin) ? item.origin : null);

// A case's origin read from its case.json (the replays' report job attaches it to each row: the replay itself never reads a label key, so a label edit
// cannot change a verdict: tools/recorded-cases.mjs LABEL_KEYS, desktop/test/recorded-cases.test.js). '' when the file or the word is missing.
export function originOfCase(dir, name) {
  try { return originOf(JSON.parse(fs.readFileSync(path.join(dir, String(name).replace(/[^\w.-]/g, ''), 'case.json'), 'utf8'))) || ''; } catch { return ''; }
}
