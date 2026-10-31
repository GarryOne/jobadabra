#!/usr/bin/env node
// Rule E on the lane registry (docs/superpowers/specs/2026-10-28-e2e-reliability-design.md): a suite leaves the backbone only by naming what its result depends on.
// Suite names are checked for every entry of desktop/e2e/lanes.json; field rules only for entries this push adds or changes. A removed entry brings a suite back.
// tolerant needs `input` (ai | clock | outside), `why` (a sentence of 8+ words) and `since` (a date); suspended and retired need `why` and `since`. Every lane needs `returns` (a non-empty string).
// Backbone defaults to zero misses; an entry may pin aiMissesMax to 0 or name an aiMissesException reason.
// Every suite named in the head registry must have a file in desktop/e2e/suites.
// Why (28 Oct 2026, spec rule E): 5395279 ("allowance for model noise (1 in 9)") loosened a test to get green; a suite listed as tolerant with no named
// input is the same move one level up, so the entry itself carries the input and the reason, and a test that cannot name one stays in the backbone (our own races are bugs).
// Usage: node tools/lanes-check.mjs [--base origin/main]   exit 1 with the entries and what each lacks. Guard: desktop/test/lanes-check.test.js.
import {execFileSync} from 'node:child_process';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

export const FILE = 'desktop/e2e/lanes.json';
export const LANES = ['tolerant', 'suspended', 'retired'];
export const INPUTS = ['ai', 'clock', 'outside'];
const WHY_WORDS = 8;   // a mechanical floor for "a sentence": "flaky" and "model noise" are not one; whether the reason is true is Gitar's and the owner's to read
const words = text => String(text || '').trim().split(/\s+/).filter(Boolean).length;
const HOW = 'A suite leaves the backbone only by naming what its result depends on (ai, clock or outside) and why; a test that cannot name one stays in the backbone: our own races are bugs, not tolerance.\nEvery entry names when it returns or retires in returns. To bring a suite back, delete its entry. (spec 2026-10-28-e2e-reliability-design.md, rules D and E)';

// One entry -> what it lacks, as short phrases ([] when it is complete). Takes the parsed entry of `suites`.
export function entryProblems(entry) {
  if (!entry || typeof entry !== 'object' || Array.isArray(entry)) return ['is not an entry (an object with lane, why and since)'];
  const lacks = [];
  const ceiling = Object.hasOwn(entry, 'aiMissesMax'), exception = Object.hasOwn(entry, 'aiMissesException');
  if (ceiling && entry.aiMissesMax !== 0) lacks.push('aiMissesMax must be 0; name a reason in aiMissesException when zero is not possible');
  if (exception && (typeof entry.aiMissesException !== 'string' || words(entry.aiMissesException) < WHY_WORDS)) lacks.push('aiMissesException must name the reason in a sentence (8+ words)');
  if (exception && (ceiling || Object.hasOwn(entry, 'lane'))) lacks.push('aiMissesException cannot accompany a ceiling or a non-backbone lane');
  if ((ceiling || exception) && !Object.hasOwn(entry, 'lane')) return lacks;
  if (!LANES.includes(entry.lane)) lacks.push(`lane must be one of ${LANES.join(', ')} (a suite not listed is the backbone)`);
  if (entry.lane === 'tolerant' && !INPUTS.includes(entry.input)) lacks.push(`input must be one of ${INPUTS.join(', ')}: the non-deterministic thing its result depends on`);
  if (words(entry.why) < WHY_WORDS) lacks.push(`why must say in a sentence what the result depends on (${WHY_WORDS}+ words)`);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(entry.since || ''))) lacks.push('since must be a date (YYYY-MM-DD)');
  // Why (30 Oct 2026, owner): every grey suite names what brings it back or retires it, for the page and weekly review.
  if (typeof entry.returns !== 'string' || !entry.returns.trim()) lacks.push('returns must be a non-empty string naming when the suite returns or retires');
  return lacks;
}

const parse = text => { try { return {suites: JSON.parse(text).suites || {}}; } catch (error) { return {error: error.message}; } };

// The registry as it was (text or null) and as it is -> the lines for each added or changed entry that lacks something; one line for a file that does not parse.
export function lanesProblems(baseText, headText) {
  if (headText === null || headText === baseText) return [];
  const head = parse(headText);
  if (head.error) return [`${FILE} is not valid JSON (${head.error})`];
  const base = baseText === null ? {suites: {}} : parse(baseText);
  const was = base.error ? {} : base.suites;
  const found = [];
  for (const [suite, entry] of Object.entries(head.suites)) {
    if (JSON.stringify(entry) === JSON.stringify(was[suite])) continue;
    for (const lack of entryProblems(entry)) found.push(`${suite}: ${lack}`);
  }
  return found;
}

// -> '' or the message for the push base..HEAD of the repo at root.
export function checkPush({root, base = 'origin/main'}) {
  const git = (...rest) => execFileSync('git', ['-C', root, ...rest], {encoding: 'utf8', maxBuffer: 16 << 20, stdio: ['ignore', 'pipe', 'ignore']});
  const show = rev => { try { return git('show', `${rev}:${FILE}`); } catch { return null; } };
  let from;
  try { from = git('merge-base', base, 'HEAD').trim(); } catch { return ''; }   // no base to compare with (a fresh clone without origin/main): nothing to say
  const head = show('HEAD');
  const found = lanesProblems(show(from), head);
  const messages = found.length ? [`this push changes the lane registry ${FILE}, and:\n  ${found.join('\n  ')}\n${HOW}`] : [];
  // Why (30 Oct 2026): a ceiling for the nonexistent review suite reached CI; check every head key, even an unchanged entry.
  for (const suite of Object.keys(head === null ? {} : parse(head).suites || {})) {
    try { git('cat-file', '-e', `HEAD:desktop/e2e/suites/${suite}.mjs`); }
    catch { messages.push(`${suite}: ${FILE} lists it but desktop/e2e/suites/${suite}.mjs is not in this push; remove the entry or restore the suite`); }
  }
  return messages.join('\n');
}

function main() {
  const base = process.argv.includes('--base') ? process.argv[process.argv.indexOf('--base') + 1] : 'origin/main';
  const message = checkPush({root: path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..'), base});
  if (message) { console.error(message); return 1; }
  return 0;
}
if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) process.exit(main());
