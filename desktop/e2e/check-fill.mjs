// `npm run check:fill`: the fast local pass/fail of the form filler. One process, one browser, offline: the widget zoo plus the recorded pages that are not slow (slow-cases.json),
// by default the cases measured at 6 s or less (case-seconds.json; the zoo has no measure and always runs), --all every non-slow case (~5 min); each case scored right / wrong / empty / not reached (lib/check-fill-score.mjs) and compared with main's numbers (check-fill-baseline.json). Last line: `CHECK fill PASS|FAIL <numbers vs main>`.
// --update writes the baseline (on main's build only); --baseline <file> compares with that file, --write <file> saves a green --all run as the next baseline; --only <part of a name> runs those cases; --json <file> keeps every case's verdict. Guard: e2e/test/check-fill.test.mjs.
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {loadCases} from './lib/page-replay.mjs';
import {loadZoo} from './lib/widget-zoo.mjs';
import {replayInTabs} from './lib/replay-browser.mjs';
import {readSlow} from './lib/replay-slow.mjs';
import {bucketOf, compare, summarize} from './lib/check-fill-score.mjs';

const BASELINE = path.join(path.dirname(fileURLToPath(import.meta.url)), 'check-fill-baseline.json');
const args = process.argv.slice(2), flag = name => (args.includes(name) ? args[args.indexOf(name) + 1] : '');
const only = flag('--only'), started = Date.now();
const slow = new Set(readSlow().slow), seconds_ = JSON.parse(fs.readFileSync(path.join(path.dirname(BASELINE), 'case-seconds.json'), 'utf8')).seconds, QUICK_MAX = 6;   // Why (27 Oct 2026, owner's ask): a session's loop is under 2 min on a loaded Mac; the measured-fast half of the pages keeps that
const items = [...loadZoo().map(one => ({...one, set: 'zoo'})), ...loadCases().filter(one => !slow.has(one.name) && (args.includes('--all') || (seconds_[one.name] ?? 99) <= QUICK_MAX)).map(one => ({...one, set: 'recorded'}))].filter(one => one.name.includes(only));
let results = [], error = '';
try { results = await replayInTabs(items, {tabs: Number(process.env.JP_REPLAY_TABS || 4), extensionDir: process.env.REAL_EXTENSION_DIR || undefined}); } catch (e) { error = String(e?.message || e).replace(/\s+/g, ' ').slice(0, 200); }
// Why (27 Oct 2026, as test/recorded-pages.test.mjs): a case that fails among parallel tabs counts only if it fails alone too; a case main already had not right is not re-run. A pass alone is said as FLAKY.
// Why (owner, 27 Oct 2026: "Main, red on regression"): main's build compares with the baseline its last green run wrote (--baseline, an artifact) and writes the next one (--write).
//   No baseline yet (the first run, an expired artifact): the run only counts, it never goes red on a guess.
const baseFile = flag('--baseline') || BASELINE, readBase = () => (fs.existsSync(baseFile) ? JSON.parse(fs.readFileSync(baseFile, 'utf8')) : null);
const RERUN_MAX = 6, base0 = (!args.includes('--update') && readBase()) || {cases: {}}, flaky = [];
let reruns = 0;   // Why (27 Oct 2026): a broad break fails dozens of cases; re-running each alone would take minutes to say what is already red. Past RERUN_MAX failing cases it is a real regression, said at once.
for (const [i, one] of items.entries()) {
  if (results[i]?.ok || base0.cases[one.name] !== 'right' || ++reruns > RERUN_MAX) continue;
  const again = (await replayInTabs([one], {tabs: 1, extensionDir: process.env.REAL_EXTENSION_DIR || undefined}).catch(() => []))[0];
  if (again?.ok) { flaky.push(one.name); results[i] = again; }
}
if (flaky.length) console.log(`  FLAKY (failed among parallel tabs, passed alone): ${flaky.join(', ')}`);
const verdicts = items.map((one, i) => ({name: one.name, set: one.set, bucket: bucketOf(results[i]), failures: results[i]?.failures || []}));
if (flag('--json')) fs.writeFileSync(flag('--json'), JSON.stringify(verdicts, null, 1));
const seconds = Math.round((Date.now() - started) / 1000);
if (!results.length || verdicts.every(one => one.bucket === 'not reached' && one.failures.some(line => /^(error|isolation)/.test(line)))) {   // a harness that replayed nothing is not a finding
  console.log(`CHECK fill FAIL harness error: replayed 0 of ${items.length} cases${error ? ` (${error})` : ''}`);
  process.exit(1);
}
for (const one of verdicts.filter(v => v.bucket !== 'right')) console.log(`  ${one.bucket.padEnd(11)} ${one.name}: ${one.failures.slice(0, 2).join(' | ').slice(0, 160)}`);
const now = summarize(verdicts);
if (args.includes('--update')) {
  if (only || !args.includes('--all')) { console.log('CHECK fill FAIL --update needs the whole set (--all, no --only)'); process.exit(1); }
  fs.writeFileSync(BASELINE, JSON.stringify({...now, writtenFrom: 'main'}, null, 1) + '\n');
  console.log(`CHECK fill PASS baseline written: ${now.right}/${now.total} right, ${seconds} s`);
} else {
  const base = readBase() || {cases: {}}, verdict = compare(base, now);
  if (flag('--write') && !verdict.red.length) {
    if (only || !args.includes('--all')) { console.log('CHECK fill FAIL --write needs the whole set (--all, no --only)'); process.exit(1); }
    fs.writeFileSync(flag('--write'), JSON.stringify({...now, writtenFrom: 'main'}, null, 1) + '\n');
  }
  if (!Object.keys(base.cases).length) console.log(`  no baseline in ${path.basename(baseFile)}: this run only counts`);
  console.log(`CHECK fill ${verdict.red.length ? 'FAIL' : 'PASS'} right ${now.right}/${now.total} (main ${verdict.main.right}/${now.total}), wrong ${now.wrong} (main ${verdict.main.wrong}), empty ${now.empty} (main ${verdict.main.empty}), not reached ${now['not reached']} (main ${verdict.main['not reached']}), ${seconds} s${verdict.red.length ? `; dropped: ${verdict.red.join(', ')}` : ''}`);
  process.exit(verdict.red.length ? 1 : 0);
}
