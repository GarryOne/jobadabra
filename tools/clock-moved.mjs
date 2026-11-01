// Nightly time-bomb finder: runs every fast unit test file on the real clock, then with the clock moved +1 and +7 days (libfaketime), and reports the files that pass today and fail moved.
// Why (1 Nov 2026, owner via a8: "Nightly report"): 5 tests went red from the calendar alone in 2 days (4 on 31 Oct, night-pass.test.mjs on 1 Nov, no code change). tools/unpinned-clock.mjs reads only
// test files, so a default `Date.now()` inside library code that a test calls with fixed dates is invisible to it; 262 test files hold fixed 2026-10/11 timestamps. Only a moved clock finds them the night before.
// Report only: it never gates a PR or a beta (CI · Clock moved, called by night pass 1 of e2e.yml). A file red on the real clock is no time bomb and is left out; a file that does not fail the same way twice is "unstable", not reported.
// No faketime (or one that does not move the clock, proved by a probe in node and python before any test runs) = exit 2 saying so, never "no test depends on today's date". Guard: desktop/test/clock-moved.test.js.
// Use: node tools/clock-moved.mjs [--area desktop,e2e,python] [--shifts 1,7] [--json report.json]
import {spawn} from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const SHIFTS = [1, 7];   // days ahead; the smallest one that breaks a file is the one reported
const FILE_TIMEOUT_MS = 180000;
const DAY_MS = 86400000;

/** The fast unit folders CI's unit jobs run (tests-desktop.yml, harness.yml, tests-python.yml), one process per file. Integration needs browsers and Electron and is not here. */
export const AREAS = [
  {name: 'desktop', cwd: 'desktop', dir: 'test', match: /\.test\.js$/, command: file => ['node', '--import', './test/no-live-site.mjs', file]},
  {name: 'e2e', cwd: 'desktop/e2e', dir: 'test', nested: true, match: /\.test\.mjs$/, command: file => ['node', '--import', './test/stdout-to-stderr.mjs', file]},
  {name: 'python', cwd: '.', dir: 'tests', match: /^test_.*\.py$/, env: {PYTHONPATH: 'tests'},   // test_0_notion_ids sets the fake IDs every module imports against (tools/py-shards.py)
    command: file => ['python3', '-m', 'unittest', '-q', '-b', ...new Set(['test_0_notion_ids', path.basename(file, '.py')])]},
];

/** The faketime program: CLOCK_MOVED_FAKETIME names another one (the unit test's stand-in). */
const faketime = () => process.env.CLOCK_MOVED_FAKETIME || 'faketime';

/** Runs argv (moved `days` ahead when days > 0) -> {code, output}. FAKETIME_DONT_FAKE_MONOTONIC keeps timers and timeouts on the real monotonic clock. */
export function execute(argv, {cwd, env = {}, days = 0, timeoutMs = FILE_TIMEOUT_MS}) {
  return new Promise(resolve => {
    const data = fs.mkdtempSync(path.join(os.tmpdir(), 'clock-moved-'));
    const full = days ? [faketime(), '-f', `+${days}d`, ...argv] : argv;
    const child = spawn(full[0], full.slice(1), {cwd, env: {...process.env, ...env, JOB_PILOTTO_TEST_DATA_DIR: data, ...(days ? {FAKETIME_DONT_FAKE_MONOTONIC: '1'} : {})}, stdio: ['ignore', 'pipe', 'pipe']});
    let output = '';
    const timer = setTimeout(() => child.kill('SIGKILL'), timeoutMs);
    const done = result => { clearTimeout(timer); fs.rmSync(data, {recursive: true, force: true}); resolve(result); };
    child.stdout.on('data', chunk => { output += chunk; });
    child.stderr.on('data', chunk => { output += chunk; });
    child.on('error', error => done({code: 127, output: `${error.message}`}));
    child.on('close', code => done({code: code ?? 1, output}));
  });
}

/** The line that says why a run failed: the first error line, else the first "not ok", else the exit code. */
export function firstFailure({code, output}) {
  const lines = String(output).split('\n').map(line => line.trim()).filter(Boolean);
  const hit = lines.find(line => /(AssertionError|\bError\b|^FAIL:|^ERROR:|^Traceback)/.test(line) && !/node:internal/.test(line)) || lines.find(line => /^not ok/.test(line));
  return (hit || `exit ${code}`).slice(0, 160);
}

/** Runs `fn` over `items`, `limit` at a time, results in order. */
export async function pool(items, limit, fn) {
  const out = new Array(items.length);
  let next = 0;
  await Promise.all(Array.from({length: Math.min(limit, items.length)}, async () => { while (next < items.length) { const i = next++; out[i] = await fn(items[i]); } }));
  return out;
}

/** Proves the clock really moves in every language the areas use: a moved `Date.now()` / `time.time()` must read `days` ahead (±10 min). Throws a message saying what is wrong. */
export async function probe({run = execute, areas = AREAS, days = SHIFTS[0], cwd = ROOT} = {}) {
  const probes = [['node', ['node', '-e', 'console.log(Date.now())'], 1], ['python', ['python3', '-c', 'import time; print(int(time.time() * 1000))'], areas.some(area => area.name === 'python') ? 1 : 0]];
  for (const [language, argv, needed] of probes) {
    if (!needed && language === 'python') continue;
    const real = Date.now(), moved = await run(argv, {cwd, days});
    const seen = Number(String(moved.output).trim().split('\n').pop());
    if (moved.code !== 0 || !Number.isFinite(seen)) throw new Error(`faketime did not run ${language}: ${String(moved.output).trim().slice(0, 200) || `exit ${moved.code}`} (install it: apt-get install -y faketime)`);
    if (Math.abs(seen - (real + days * DAY_MS)) > 600000) throw new Error(`faketime ran ${language} but the clock did not move ${days} d (read ${new Date(seen).toISOString()}, now ${new Date(real).toISOString()}): nothing was measured`);
  }
}

/** The test files of an area, relative to its cwd. */
// Why (c27, 1 Nov 2026, area folders): the e2e harness tests sit one folder down (test/<area>/x.test.mjs); `fixtures` holds stand-ins, never tests.
export const filesOf = (root, area) => {
  const base = path.join(root, area.cwd, area.dir);
  const folders = ['', ...(area.nested ? fs.readdirSync(base, {withFileTypes: true}).filter(item => item.isDirectory() && item.name !== 'fixtures').map(item => item.name).sort() : [])];
  return folders.flatMap(folder => fs.readdirSync(path.join(base, folder)).filter(name => area.match.test(name)).sort().map(name => path.posix.join(area.dir, folder, name)));
};

/**
 * The files that pass on the real clock and fail with it moved ahead. Pass 1 on the real clock; each shift runs only the files still standing, so a file is reported at the smallest shift that breaks it;
 * a second look at the real and the moved clock confirms each (a file that does not repeat is `unstable`). -> {judged, redToday, bombs: [{area, file, days, why}], unstable, seconds}
 */
export async function findTimeBombs({root = ROOT, areas = AREAS, shifts = SHIFTS, run = execute, concurrency = Math.max(2, os.availableParallelism()), log = () => {}} = {}) {
  const started = Date.now();
  const jobs = areas.flatMap(area => filesOf(root, area).map(file => ({area, file, cwd: path.join(root, area.cwd), argv: area.command(file), env: area.env || {}, label: path.posix.join(area.cwd === '.' ? '' : area.cwd, file)})));
  const attempt = (job, days) => run(job.argv, {cwd: job.cwd, env: job.env, days});
  const real = await pool(jobs, concurrency, job => attempt(job, 0));
  let standing = jobs.filter((_, i) => real[i].code === 0);
  const redToday = jobs.length - standing.length;
  log(`real clock: ${standing.length} of ${jobs.length} files pass (${redToday} red today are left out)`);
  const candidates = [];
  for (const days of shifts) {
    const results = await pool(standing, concurrency, job => attempt(job, days));
    const broke = standing.flatMap((job, i) => (results[i].code !== 0 ? [{job, days, why: firstFailure(results[i])}] : []));
    candidates.push(...broke);
    standing = standing.filter((_, i) => results[i].code === 0);
    log(`+${days} d: ${broke.length} files fail that pass today`);
  }
  const bombs = [], unstable = [];
  for (const {job, days, why} of candidates) {
    const [today, moved] = [await attempt(job, 0), await attempt(job, days)];
    (today.code === 0 && moved.code !== 0 ? bombs : unstable).push({area: job.area.name, file: job.label, days, why: today.code === 0 && moved.code !== 0 ? firstFailure(moved) : why});
  }
  return {judged: jobs.length - redToday, redToday, bombs, unstable, seconds: Math.round((Date.now() - started) / 1000)};
}

/** The report as Markdown: one line per time bomb (file, shift, first failure), or the one clean line. */
export function reportText({judged, redToday, bombs, unstable, seconds}) {
  const facts = `${judged} test files judged (${redToday} red on today's clock left out, ${unstable.length} unstable not reported), ${seconds} s.`;
  if (!bombs.length) return `✅ No test depends on today's date.\n\n${facts}\n`;
  return `⚠️ ${bombs.length} test file${bombs.length > 1 ? 's' : ''} pass today and fail with the clock moved:\n\n${bombs.map(b => `- \`${b.file}\` · +${b.days} d · ${b.why}`).join('\n')}\n\n${facts}\n`;
}

async function main(argv) {
  const value = flag => { const at = argv.indexOf(flag); return at >= 0 ? argv[at + 1] : ''; };
  const names = value('--area') ? value('--area').split(',') : AREAS.map(area => area.name);
  const areas = AREAS.filter(area => names.includes(area.name));
  const shifts = value('--shifts') ? value('--shifts').split(',').map(Number) : SHIFTS;
  try { await probe({areas, days: shifts[0]}); } catch (error) { console.error(`clock-moved: ${error.message}`); return 2; }
  const result = await findTimeBombs({areas, shifts, log: line => console.log(`clock-moved: ${line}`)});
  const text = reportText(result);
  console.log(text);
  if (value('--json')) fs.writeFileSync(value('--json'), JSON.stringify(result, null, 2));
  return 0;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) process.exitCode = await main(process.argv.slice(2));
