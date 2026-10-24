// One live job search of a fictional candidate on demand, on this Mac's Claude plan ($0, never an API key): the engine behind the skill check-job-search-locally.
//   node tools/persona-search/search-check.mjs <finance|music|driver|sre|cluj|chisinau|random> [--seed <text>] [--dry] [--quick]
// --quick: only the first-jobs step (~6 min): boards and local jobs, no light run, no scout (run.mjs --first-only).
// A throwaway install (run.mjs: its own folder under the OS temp folder, no Keychain, Notion or Telegram; claude is the real install, never a wrapper that carries the owner's
// identity: desktop/e2e/lib/real-claude.mjs). Prints the numbers of the first "Find jobs" and sets them next to this candidate's earlier local runs (~/jp-search-check/history.jsonl,
// outside the app's folder). --dry prints the plan and touches nothing. Guard: tests/test_search_check.py.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {execFileSync} from 'node:child_process';
import {pathToFileURL} from 'node:url';

const ROOT = path.resolve(import.meta.dirname, '..', '..');
export const CANDIDATES = ['finance', 'music', 'driver', 'sre', 'cluj', 'chisinau'];
export const HISTORY = path.join(os.homedir(), 'jp-search-check', 'history.jsonl');
// Every variable that would put an API account or a Lab upload behind the run.
export const FORBIDDEN_ENV = ['ANTHROPIC_API_KEY', 'LAB_HEAL_ANTHROPIC_KEY', 'RANDOM_DRAWS_ANTHROPIC_KEY', 'OPENAI_API_KEY', 'REPLAYS_PUBLISH_KEY', 'NET_RECORD_KEY'];

export const cleanEnv = env => Object.fromEntries(Object.entries(env).filter(([key]) => !FORBIDDEN_ENV.includes(key)));

// -> the steps of one check: the CV, then the one press on the plan engine (no --engine api: that is the CI draw).
// The process id is in the folder's name: two checks started in the same second (a browser-on/off pair) never share an install.
export function plan(args, now = new Date(), tmp = os.tmpdir(), pid = process.pid) {
  const [who, ...rest] = args, seedAt = rest.indexOf('--seed');
  if (!who || !(who === 'random' || CANDIDATES.includes(who))) throw new Error(`usage: search-check.mjs <${[...CANDIDATES, 'random'].join('|')}> [--seed <text>] [--dry]`);
  const stamp = `${now.toISOString().replace(/[-:]/g, '').slice(0, 15)}-${pid}`, out = path.join(tmp, `jp-search-check-${stamp}`);
  const random = who === 'random', seed = random ? (seedAt >= 0 ? rest[seedAt + 1] : `local-${stamp}`) : null, name = random ? 'draw' : who;
  return {who, name, seed, out, tag: `check-${stamp}`,
    cv: random ? ['python3', 'tools/persona-search/draw.py', seed, out] : ['python3', 'tools/persona-search/personas.py', out],
    run: ['node', 'tools/persona-search/run.mjs', name, out, '--presses', '1', '--fresh', '--tag', `check-${stamp}`, ...(rest.includes('--quick') ? ['--first-only'] : [])]};
}

const median = list => { const sorted = list.filter(value => value != null).sort((a, b) => a - b); return sorted.length ? sorted[Math.floor((sorted.length - 1) / 2)] : null; };
const clock = value => (value == null ? 'not reached' : value < 60 ? `${value} s` : `${Math.floor(value / 60)}:${String(value % 60).padStart(2, '0')}`);

// -> lines: this run's numbers, each beside the median of the earlier local runs of the same kind (a fixed candidate; for random, the same role family).
export function summary(row, history) {
  const before = history.filter(item => (row.candidate === 'random' ? item.candidate === 'random' && item.family === row.family : item.candidate === row.candidate));
  const line = (name, field, show = value => String(value ?? '–')) => {
    const was = median(before.map(item => item[field]));
    return `${name}: ${show(row[field])}${was == null ? ' (no earlier local run)' : ` (earlier median ${show(was)} over ${before.length} run${before.length === 1 ? '' : 's'})`}`;
  };
  return [`${row.label}${row.state === 'failed' ? ` FAILED at ${row.failed_step}` : ''}`, line('Time to first job', 'first_s', clock), line('Time to 10th job', 'tenth_s', clock),
    line('Time to first 70+ job', 'fit_s', clock), line('Jobs in your places', 'in_places'), line('Scored', 'scored'), line('Scoring 70+', 'fit70')];
}

export function rowFrom(step, info, press, now = new Date()) {
  const ttfr = press.ttfr || {}, crash = (press.crashes || [])[0];
  return {at: now.toISOString(), candidate: step.who, label: step.who === 'random' ? `Random draw ${info.family} · ${info.city}, ${info.country}` : step.who, family: info.family ?? null,
    state: crash ? 'failed' : 'ok', failed_step: crash?.step ?? null, first_s: ttfr.first_in_places_s ?? null, tenth_s: ttfr.tenth_in_places_s ?? null, fit_s: ttfr.first_fit70_s ?? null,
    in_places: press.in_places ?? null, scored: press.scored_in_places ?? null, fit70: press.fit70_in_places ?? null, seconds: press.seconds ?? null};
}

if (import.meta.url === pathToFileURL(process.argv[1] || '').href) {
  let step;
  try { step = plan(process.argv.slice(2)); } catch (error) { console.error(error.message); process.exit(2); }
  if (process.argv.includes('--dry')) { console.log(JSON.stringify({...step, engine: 'cli (the Claude plan)', env_removed: FORBIDDEN_ENV}, null, 2)); process.exit(0); }
  const env = {...cleanEnv(process.env), JOB_PILOTTO_NO_DOTENV: '1'};
  console.log(`Check: ${step.who}${step.seed ? ` (seed ${step.seed})` : ''}, folder ${step.out}, on the Claude plan; takes about 5-12 minutes`);
  fs.mkdirSync(step.out, {recursive: true});
  const made = execFileSync(step.cv[0], step.cv.slice(1), {cwd: ROOT, env, encoding: 'utf8'}).trim().split('\n').pop();
  const info = made.startsWith('{') ? JSON.parse(made) : {};   // draw.py prints its draw as JSON; personas.py prints the names
  execFileSync(step.run[0], step.run.slice(1), {cwd: ROOT, env, stdio: 'inherit'});
  const press = JSON.parse(fs.readFileSync(path.join(step.out, step.name, 'presses.jsonl'), 'utf8').split('\n').filter(Boolean)[0]);
  const row = rowFrom(step, info, press);
  const history = fs.existsSync(HISTORY) ? fs.readFileSync(HISTORY, 'utf8').split('\n').filter(Boolean).map(line => JSON.parse(line)) : [];
  console.log(`\n${summary(row, history).join('\n')}`);
  fs.mkdirSync(path.dirname(HISTORY), {recursive: true});
  fs.appendFileSync(HISTORY, `${JSON.stringify(row)}\n`);
  console.log('\nSEARCH CHECK DONE');
}
