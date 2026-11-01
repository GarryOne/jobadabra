// A ratchet against tests that read the real date (owner, 31 Oct 2026: "No test reads the real date/clock unpinned; add a guard for new ones"). It counts, per test file, the lines that read
// "now" as a calendar value (`Date.now()`, `new Date()`, `datetime.now()`, `date.today()`, `time.time()`) when the file does not pin the clock. Durations (`Date.now() - started`, `while (now < end)`, a poll deadline) are not counted.
// are durations and are not counted. The reads of today are the debt in tools/unpinned-clock-allowed.txt (one `<count><TAB><path>` line per file, so PRs that fix different files never conflict) and may only shrink:
// a new read fails desktop/test/unpinned-clock.test.js and tests/test_unpinned_clock.py. Fix: pin the clock (`t.mock.timers.enable({apis: ['Date'], now})` in node, a fixed `now=` argument in python), or say `// clock: relative <why>` on the line (`# clock: relative <why>` in python).
import {execFileSync} from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(import.meta.dirname, '..');
const TOP = ['desktop/test', 'desktop/e2e/test', 'desktop/integration/extension', 'tests'];
const READ = /\bDate\.now\(\)|\bnew Date\(\)|\bdatetime\.(?:utc)?(?:now|today)\(|\bdate\.today\(\)|\btime\.time\(\)/;
const NOW = String.raw`(?:Date\.now\(\)|time\.time\(\))`;
// Why (31 Oct 2026, a8; Gitar on #2734): a span is one reading minus an earlier one, a comparison against a deadline, the anchor a span starts from, or a poll deadline set from now: all measure a duration and cannot depend on the calendar day.
// A date built from now plus or minus a number (`new Date(Date.now() - 3600e3)`, `time.time() - 3600` as a file's time) and a stored timestamp (`seenAt = Date.now()`) are calendar values and are counted.
const ELAPSED = [new RegExp(`(?:-|(?<!=)[<>]=?)\\s*${NOW}`), new RegExp(`${NOW}\\s*(?:-\\s*[A-Za-z_]|(?<!=)[<>])`), new RegExp(`\\b(?:start|began|begin|t0)\\w*\\s*=\\s*(?:await\\s+)?${NOW}`, 'i'), new RegExp(`\\b(?:deadline|end|until|timeout|limit|stop)\\w*\\s*=.*${NOW}\\s*\\+\\s*\\d`, 'i')];
const PINS = /mock\.timers|JOB_PILOTTO_NOW/;

/** The number of lines of `text` that read the real clock as a calendar value; 0 when the file pins the clock. */
export function countLines(text) {
  if (PINS.test(text)) return 0;
  let count = 0;
  for (const line of text.split('\n')) {
    if (/clock: relative/.test(line) || /^\s*(\/\/|#|\*|\/\*)/.test(line)) continue;
    if (READ.test(line) && !ELAPSED.some(shape => shape.test(line))) count++;
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

/** The files that read the clock more often than `allowed` records, as `path: count (allowed n)` lines. */
export function worse(found, allowed) {
  return Object.entries(found).filter(([file, count]) => count > (allowed[file] || 0)).map(([file, count]) => `${file}: ${count} (allowed ${allowed[file] || 0})`);
}

if (process.argv[1] === import.meta.filename && process.argv.includes('--write')) {
  fs.writeFileSync(ALLOWED, allowedText(scan()));
  console.log(`wrote ${ALLOWED}`);
} else if (process.argv[1] === import.meta.filename && process.argv.includes('--check')) {
  const found = worse(scan(), readAllowed());
  if (found.length) console.error(`unpinned-clock: a test reads the real clock: pin it, or say \`clock: relative <why>\` on the line\n  ${found.join('\n  ')}`);
  process.exitCode = found.length ? 1 : 0;
}
