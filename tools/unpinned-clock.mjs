// A ratchet against tests that read the real date (owner, 31 Oct 2026: "No test reads the real date/clock unpinned; add a guard for new ones"). It counts, per test file, the lines that read
// "now" as a calendar value (`Date.now()`, `new Date()`, `datetime.now()`, `date.today()`, `time.time()`) when the file does not pin the clock. Elapsed-time shapes (`Date.now() - started`, `deadline = Date.now() + …`)
// are durations and are not counted. The reads of today are the debt in tools/unpinned-clock-allowed.txt (one `<count><TAB><path>` line per file, so PRs that fix different files never conflict) and may only shrink:
// a new read fails desktop/test/unpinned-clock.test.js. Fix: pin the clock (`pinClock` in desktop/test/helpers/pin-clock.mjs, `pin_clock` in tests/clock_pin.py), or say `// clock: relative <why>` on the line (`# clock: relative <why>` in python).
import {execFileSync} from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(import.meta.dirname, '..');
const TOP = ['desktop/test', 'desktop/e2e/test', 'tests'];
const READ = /\bDate\.now\(\)|\bnew Date\(\)|\bdatetime\.(?:utc)?(?:now|today)\(|\bdate\.today\(\)|\btime\.time\(\)/;
// Why (31 Oct 2026, a8): a span measured as one reading minus an earlier one, a deadline set from now, or a loop that runs until a time is reached all use the real clock for a duration and cannot depend on the calendar day.
const ELAPSED = /(?:[-<>]=?\s*(?:Date\.now\(\)|time\.time\(\)))|(?:(?:Date\.now\(\)|time\.time\(\))\s*(?:[-<>]|\+\s*\d))|(?:\b(?:start|began|begin|t0|deadline|end|since|tick|last)\w*\s*=\s*(?:await\s+)?(?:Date\.now\(\)|time\.time\(\)))/i;
const PINS = /\bpinClock\(|\bpin_clock\(|mock\.timers|JOB_PILOTTO_NOW/;

/** The number of lines of `text` that read the real clock as a calendar value; 0 when the file pins the clock. */
export function countLines(text) {
  if (PINS.test(text)) return 0;
  let count = 0;
  for (const line of text.split('\n')) {
    if (/clock: relative/.test(line) || /^\s*(\/\/|#|\*|\/\*)/.test(line)) continue;
    if (READ.test(line) && !ELAPSED.test(line)) count++;
  }
  return count;
}

/** `{path: count}` for every tracked test file that reads the real clock unpinned. */
export function scan(root = ROOT) {
  const found = {};
  const files = execFileSync('git', ['ls-files', '-z', ...TOP], {cwd: root}).toString().split('\0').filter(name => /\.(m?js|py)$/.test(name));
  for (const file of files) {
    if (!fs.existsSync(path.join(root, file))) continue;
    const count = countLines(fs.readFileSync(path.join(root, file), 'utf8'));
    if (count) found[file] = count;
  }
  return found;
}

export const ALLOWED = path.join(ROOT, 'tools/unpinned-clock-allowed.txt');

/** The recorded debt as `{path: count}`. */
export function readAllowed(file = ALLOWED) {
  const debt = {};
  for (const line of fs.readFileSync(file, 'utf8').split('\n')) {
    const [count, name] = line.split('\t');
    if (name) debt[name] = Number(count);
  }
  return debt;
}

/** The debt file's text for `found`: one sorted line per file. */
export function allowedText(found) {
  return Object.keys(found).sort().map(name => `${found[name]}\t${name}\n`).join('');
}

if (process.argv[1] === import.meta.filename && process.argv.includes('--write')) {
  fs.writeFileSync(ALLOWED, allowedText(scan()));
  console.log(`wrote ${ALLOWED}`);
}
