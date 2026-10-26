// The persona search check: a fictional new user through the app's own path, CV -> strategy draft -> first "Find jobs" -> more presses, with the
// numbers after each press (spec docs/superpowers/specs/2026-10-18-search-learns-sources.md; owner, 18 Oct 2026: finance in Amsterdam, music in
// Berlin, a driver in Nuremberg, and the SRE control). By hand only: it reads live public job sites (never past a login wall), and its AI runs
// on this Mac's Claude Code plan ($0), never an API key. Its folder is <os temp>/jp-persona-<name>[-<tag>]: never the person's app folder,
// Keychain, Notion or Telegram; telemetry and pool sharing are off.
//   python3 tools/persona-search/personas.py <out>            (the CVs: <out>/<name>/cv.pdf)
//   node tools/persona-search/run.mjs <name> <out> [--presses 5] [--tag before] [--fresh] [--draft <draft.json>]
//        [--tape <folder> --record | --replay [--wait-scale 1] [--no-live]] [--judge] [--first-only] [--note <file>] [--change-field <file>]
// --note: the wizard's "What should the AI know?" text (e.g. "First Officer jobs anywhere in Europe"), given to the strategy draft as a person types it.
// --change-field: a JSON list of role titles; before press 2 they replace the roles through the Strategy page's own edit (lib/strategy-edit.js editLists,
//   which redrafts the old field's words), and the search is marked changed: the owner's path, a field change on an existing install then Find jobs again (26 Oct 2026).
// Each press's row also has its funnel (funnel.py: employers picked, sites and boards read, web searches, jobs listed) for the search robot's alarm.
// --first-only: stop after the first-jobs step (boards read, local jobs listed; ~6 min instead of 20-25): the discover, light run and scout steps are skipped (24 Oct 2026, the beyond-Moldova checks).
// --judge: after each press, how many of the top 10 are right for the persona (judge.py, plan engine only; never on --engine api).
// Writes <out>/<name>/draft.json, run-<press>.log and presses.jsonl (one JSON line per press: tools/persona-search/metrics.py + time).
// --draft: the strategy from an earlier run (no AI), so two runs search for the same thing. --tape (src/search_tape.py, change 0 of the search
// plan): --record keeps every web and AI answer of the search; --replay serves them offline after their recorded time times --wait-scale (1 = as recorded, 0 = no wait, 0.1 = ten times faster), so a change
// is measured on the same sources: nothing leaves the computer, and an AI question the tape lacks goes to the plan and is added (--no-live: it is counted and fails instead, as on CI).
// tools/persona-search/ttfr.py <run-1.log> <data dir>: the seconds to the 1st and 10th relevant job and to the first 70+.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {execFileSync} from 'node:child_process';

const ROOT = path.resolve(import.meta.dirname, '..', '..');
const [name, outArg] = process.argv.slice(2);
const option = (flag, fallback) => { const at = process.argv.indexOf(flag); return at > 0 ? process.argv[at + 1] : fallback; };
if (!name || !outArg) { console.error('usage: node tools/persona-search/run.mjs <name> <out> [--presses 5] [--tag t] [--fresh]'); process.exit(2); }
const out = path.resolve(outArg, name), presses = Number(option('--presses', 5)), tag = option('--tag', '');
const dir = path.join(os.tmpdir(), `jp-persona-${name}${tag ? `-${tag}` : ''}`);
if (process.argv.includes('--fresh')) fs.rmSync(dir, {recursive: true, force: true});
fs.mkdirSync(dir, {recursive: true});
fs.copyFileSync(path.join(out, 'cv.pdf'), path.join(dir, 'cv.pdf'));
const tape = option('--tape', '');
// How a tape is replayed (tape/replay.json, written by the heal: {engine, wait_scale}): a tape recorded on the API engine asks other questions than the plan engine would, and its search only repeats at the recorded pace
// (18 Oct 2026: the same tape missed 59 AI requests on the plan engine at wait scale 0, 30 on its own engine). An explicit flag wins; no file = the plan engine, no wait for an offline replay (--no-live), as recorded otherwise.
const how = (() => { try { return tape && process.argv.includes('--replay') ? JSON.parse(fs.readFileSync(path.join(tape, 'replay.json'), 'utf8')) : {}; } catch { return {}; } })();
const waitScale = option('--wait-scale', String(how.wait_scale ?? (process.argv.includes('--no-live') ? 0 : 1)));
const engineName = option('--engine', how.engine || 'cli');
if (process.argv.includes('--speed')) { console.error('--speed is gone (it multiplied the waits, so 20 meant 20x slower): use --wait-scale, 0 = no wait'); process.exit(2); }
if (tape) {   // read by the engine (desktop/lib/pipeline-env.js passes these three on)
  if (process.argv.includes('--record') === process.argv.includes('--replay')) { console.error('--tape needs --record or --replay'); process.exit(2); }
  Object.assign(process.env, {JOB_PILOTTO_SEARCH_TAPE: path.resolve(tape), JOB_PILOTTO_SEARCH_TAPE_MODE: process.argv.includes('--record') ? 'record' : 'replay',
    JOB_PILOTTO_TAPE_WAIT_SCALE: waitScale});
  if (process.argv.includes('--no-live')) process.env.JOB_PILOTTO_TAPE_LIVE = '0';   // CI has no AI account: a question the tape lacks is counted and raises (src/search_tape.py)
}

const lib = file => import(path.join(ROOT, 'desktop', 'lib', file));
const {createStorage} = await lib('storage.js');
const {ensureConfig, python} = await lib('pipeline-env.js');
const {searchSteps} = await lib('search-steps.js');
const {run: searchRun} = await lib('pipeline-run.js');
const strategy = await lib('strategy.js');
const {titlesOf} = await lib('target-roles.js');
const claudeCode = await lib('claude-code.js');
const {realClaude} = await import(path.join(ROOT, 'desktop', 'e2e', 'lib', 'real-claude.mjs'));
const storage = createStorage(dir, {encrypt: value => value, decrypt: value => value});   // its own folder: nothing reaches the Keychain
ensureConfig(storage);
// --engine api (the daily CI draw, tools/persona-search/draw.py): the Anthropic API on the key in LAB_HEAL_ANTHROPIC_KEY (a tape re-record, own workspace and cap) or else RANDOM_DRAWS_ANTHROPIC_KEY, there being no plan-path Claude on a runner.
const api = engineName === 'api', replayOnly = api && process.argv.includes('--replay') && process.argv.includes('--no-live');   // an offline replay builds the API client but never calls it
const apiKey = process.env.LAB_HEAL_ANTHROPIC_KEY || process.env.RANDOM_DRAWS_ANTHROPIC_KEY || (replayOnly ? 'replay-only' : '');
if (api && !apiKey) { console.error('--engine api needs LAB_HEAL_ANTHROPIC_KEY or RANDOM_DRAWS_ANTHROPIC_KEY'); process.exit(2); }
if (api) storage.setSecret('ANTHROPIC_API_KEY', apiKey);
storage.saveSettings({aiEngine: api ? 'api' : 'cli', ...(api ? {} : {claudeCode: {path: realClaude() || (process.env.JOB_PILOTTO_TAPE_LIVE === '0' ? process.execPath : '')}}), store: 'sqlite', telemetry: false, shareEmployers: false});

const metrics = (script = 'metrics.py', ...args) => JSON.parse(execFileSync(python(), [path.join(ROOT, 'tools', 'persona-search', script), ...args], {cwd: ROOT, env: {
  ...process.env, PYTHONPATH: ROOT, JOB_PILOTTO_NO_DOTENV: '1', JOB_PILOTTO_FOLLOW_APP: '0',
  JOB_PILOTTO_CONFIG_DIR: storage.path('config'), JOB_PILOTTO_DATA_DIR: storage.path('data')}}).toString().trim().split('\n').pop());

function judged() {
  const env = {...process.env, PYTHONPATH: ROOT, JOB_PILOTTO_NO_DOTENV: '1', JOB_PILOTTO_FOLLOW_APP: '0', JOB_PILOTTO_AI_ENGINE: 'cli',
    JOB_PILOTTO_CONFIG_DIR: storage.path('config'), JOB_PILOTTO_DATA_DIR: storage.path('data')};
  for (const key of Object.keys(env)) if (key.startsWith('JOB_PILOTTO_SEARCH_TAPE') || key === 'JOB_PILOTTO_TAPE_WAIT_SCALE' || key === 'JOB_PILOTTO_TAPE_LIVE') delete env[key];
  try {
    return JSON.parse(execFileSync(python(), [path.join(ROOT, 'tools', 'persona-search', 'judge.py'), out, name], {cwd: ROOT, env}).toString().trim().split('\n').pop());
  } catch (error) { console.log(`${name}: top 10 not judged: ${String(error.message).split('\n')[0]}`); return null; }
}

// The Strategy page's roles edit (lib/search-tuning-handlers.js 'editTargets'): the old titles out, the new ones in, the search marked changed. -> {from, to}
async function changeField(titles) {
  const before = titlesOf(JSON.parse(storage.readText('config/search.json') || '{}'));
  const notion = () => { throw new Error('a persona install has no Notion'); };
  const result = await strategy.editLists(storage, {roles: {add: titles, remove: before}}, {run: searchRun, ensurePage: notion, writePage: notion});
  if (result.changed?.length) storage.saveSettings({searchChangedAt: new Date().toISOString()});
  console.log(`${name}: field changed from ${before.slice(0, 3).join(', ')} to ${titles.slice(0, 3).join(', ')}`);
  return {from: before.length, to: titles.length};
}

if (!storage.settings().setupDone) {   // the wizard's strategy step: the app's own draft from the CV, kept as the review's "Save" does without Notion
  const started = Date.now(), kept = option('--draft', '');
  const note = option('--note', '') ? fs.readFileSync(option('--note', ''), 'utf8').trim() : '';
  const draft = kept ? JSON.parse(fs.readFileSync(kept, 'utf8')) : await strategy.draft(storage, note ? {anything_else: note} : {}, apiKey, api ? null : claudeCode.client(storage));
  if (!kept || path.resolve(kept) !== path.join(out, 'draft.json')) fs.writeFileSync(path.join(out, 'draft.json'), JSON.stringify(draft, null, 2));
  strategy.keepLocally(storage, draft);
  storage.saveSettings({setupDone: true, cvName: 'cv.pdf'});
  console.log(`${name}: strategy ${kept ? `from ${kept}` : 'drafted'} in ${Math.round((Date.now() - started) / 1000)} s`);
}
const failed = [];
const done = fs.existsSync(path.join(out, 'presses.jsonl')) ? fs.readFileSync(path.join(out, 'presses.jsonl'), 'utf8').trim().split('\n').filter(Boolean).length : 0;
const fieldFile = option('--change-field', '');
for (let press = done + 1; press <= presses; press++) {
  const changed = press === 2 && fieldFile ? await changeField(JSON.parse(fs.readFileSync(fieldFile, 'utf8'))) : null;
  const started = Date.now(), log = fs.createWriteStream(path.join(out, `run-${press}.log`));
  const firstOnly = process.argv.includes('--first-only');
  let calls = 0;
  const exec = (...args) => (firstOnly && calls++ > 0 ? Promise.resolve({code: 0}) : searchRun(...args));
  const {code} = await searchSteps(storage, line => log.write(`[${Math.round((Date.now() - started) / 1000)}s] ${line}\n`), 'run', press === 1 ? 'first' : 'you', exec);
  log.end();
  const crashes = metrics('crashes.py', path.join(out, `run-${press}.log`));   // a Traceback in the log: a step died, its numbers are thin
  const row = {press, code, crashes, seconds: Math.round((Date.now() - started) / 1000), ...metrics(), funnel: metrics('funnel.py', path.join(out, `run-${press}.log`), '--since', new Date(started).toISOString().slice(0, 19)),
    ...(changed ? {field_changed: changed} : {}),
    ...(press === 1 ? {ttfr: metrics('ttfr.py', path.join(out, 'run-1.log'))} : {})};
  fs.appendFileSync(path.join(out, 'presses.jsonl'), `${JSON.stringify(row)}\n`);
  const verdict = process.argv.includes('--judge') && !api ? judged() : null;   // its own AI call, off the tape: a replay neither records nor needs it
  if (verdict) fs.writeFileSync(path.join(out, `judge-${press}.json`), JSON.stringify(verdict, null, 2));
  const first = row.ttfr ? `; 1st/10th relevant at ${row.ttfr.first_in_places_s ?? '—'}/${row.ttfr.tenth_in_places_s ?? '—'} s, 1st 70+ at ${row.ttfr.first_fit70_s ?? '—'} s` : '';
  if (crashes.length) { failed.push(...crashes); console.log(`PRESS ${name} ${press} FAILED: ${crashes.map(crash => `${crash.step}: ${crash.error}`).join(' | ')}`); }
  console.log(`PRESS ${name} ${press}: ${row.in_places} in places, ${row.scored_in_places} scored, ${row.fit70_in_places} fit 70+ (${row.seconds} s${first})${verdict ? `; top 10: ${verdict.right} of ${verdict.of} right` : ''}`);
}
if (failed.length) { console.log(`PERSONA FAILED ${name}: ${failed.length} crash(es), the numbers above are not a clean run`); process.exitCode = 1; }
else console.log(`PERSONA DONE ${name}`);
