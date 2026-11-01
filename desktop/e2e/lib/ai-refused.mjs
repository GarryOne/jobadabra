// When the AI refuses every call (the key's spend limit, a bad key: 400 BadRequestError / "usage limits" / "credit balance"), a failed step says so instead of a
// downstream symptom ("listed: nothing", "0 new jobs"). Read from the engine's log in the test profile; used by every suite through lib/runner.mjs. Guarded by test/ai-refused.test.mjs.
import fs from 'node:fs';
import path from 'node:path';
import {STUBBED} from './ai-proxy.mjs';

const REFUSED = /BadRequestError|invalid_request_error|specified API usage limits|credit balance is too low/;   // the engine's own error names and the API's messages for a refused call
const LIMIT = /specified API usage limits|credit balance is too low/;   // the two messages that name the account's money or limit as the cause, not a malformed request of ours
const RUN_HEADER = /^(\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d+)?Z)\s+----/;   // "<time> ---- python -m src …": the run a line belongs to

// engine.log text → {count: lines that report a refused AI call, firstAt: the time of the run header above the first one ('' when none), limit: lines that name the spend limit or credit}.
export function aiRefusals(text) {
  let count = 0, firstAt = '', at = '', limit = 0;
  for (const line of String(text || '').split('\n')) {
    const header = RUN_HEADER.exec(line);
    if (header) { at = header[1]; continue; }
    if (!REFUSED.test(line)) continue;
    if (!count) firstAt = at;
    count++;
    if (LIMIT.test(line)) limit++;
  }
  return {count, firstAt, limit};
}

// The sentence a failed step leads with, or '' (no profile, no log, no refusal).
export function refusalNote(profile, stubbed = STUBBED) {
  if (!profile) return '';
  let text = '';
  try { text = fs.readFileSync(path.join(profile, 'logs', 'engine.log'), 'utf8'); } catch { return ''; }
  const {count, firstAt, limit} = aiRefusals(text);
  if (!count) return '';
  const stub = stubbed.size ? ` (the suite armed the stub ${[...stubbed].join(', ')} on purpose: these refusals are by design, not the account's money or limit)` : '';
  // Why (28 Oct 2026, Gitar on #2415): tools/pr-verdict.py greys a job only when the failure line names the cause; a bare "(400)" can be a request of ours that is wrong, so the
  // phrase "spend limit or credit" is added only when EVERY refusal line carried the limit or credit message (round 2, Gitar: one such line must not excuse bare 400s next to it), and never under an armed stub.
  // A real out-of-credit log whose refusals do not each carry the message stays red, as before this grey existed; a recorded log of one decides whether to relax it.
  const cause = limit === count && !stubbed.size ? ', spend limit or credit' : '';
  return `the AI refused (400) ${count} time${count === 1 ? '' : 's'}${firstAt ? `, first at ${firstAt}` : ''}${cause}${stub}`;
}
