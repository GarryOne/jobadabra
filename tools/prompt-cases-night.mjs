#!/usr/bin/env node
// The nightly prompt-case replay, REPORT ONLY (owner via mac-07, 1 Nov 2026: "Let the prompts being checked nightly and report"; "It should be part of the measurements / Quality AI"):
// last night's per-case right/wrong of the live "form" set (tools/prompt-cases.json) against tonight's main, asked on the Codex plan through the broker (tools/prompt-cases-codex.mjs).
// Called from e2e.yml's night pass 1 (prompt-cases-night.yml) beside clock-moved and coverage-report; never a PR check, a beta gate or a by-hand run's step. Exit 0 always: the report says what happened.
// No live prompt changed since the baseline's commit: nothing is asked, the baseline is carried forward ($0). Otherwise every case is asked once; a case right last night and wrong now is asked once
// more: wrong twice = "flipped" (a regression of the prompt), right on the re-ask = "model noise" (the model varied, the prompt did not). Not asked (no token, broker said no) = said, baseline kept.
// Usage: node tools/prompt-cases-night.mjs --out <dir> [--baseline <prompt-cases-night.json>] [--max-calls 160] [--jobs 6]   writes <dir>/prompt-cases-night.json (the next night's baseline).
// Guard: desktop/test/prompt-cases-night.test.js.
import {execFileSync} from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const SET = 'form';   // the one live set tools/prompt-cases-live.mjs can build cases for today
const short = sha => String(sha || '').slice(0, 7);

/**
 * Tonight's answers against the baseline's. first/again: [{id, right}] (again = the re-ask of the cases that flipped on the first ask).
 * @param {Object<string, boolean>|null} baseline last night's right/wrong by case id, null on the first night
 * @returns {{cases: number, right: number, flipped: string[], noise: string[], newWrong: string[], results: Object<string, boolean>}}
 */
export function compareNight(baseline, first, again = []) {
  const retried = new Map(again.map(row => [row.id, row.right === true]));
  const results = {}, flipped = [], noise = [], newWrong = [];
  for (const row of first) {
    const before = baseline ? baseline[row.id] : undefined;
    const settled = row.right === true || retried.get(row.id) === true;
    results[row.id] = settled;
    if (before === undefined) { if (baseline && !settled) newWrong.push(row.id); }
    else if (before && !row.right) (settled ? noise : flipped).push(row.id);
  }
  return {cases: first.length, right: Object.values(results).filter(Boolean).length, flipped, noise, newWrong, results};
}

/** The one line of the report (the ::notice, the log). */
export function reportLine(report) {
  const at = short(report.sha);
  if (report.status === 'carried') return `Prompt cases (${SET}): no prompt changed since ${at}: baseline carried, $0`;
  if (report.status === 'not-asked') return `Prompt cases (${SET}): NOT asked (${report.reason}); baseline ${at || 'none'} kept`;
  const head = `Prompt cases (${SET}, Codex): ${report.total} cases, ${report.flipped.length} flipped, ${report.noise.length} model noise${report.unconfirmed?.length ? `, ${report.unconfirmed.length} unconfirmed (call cap)` : ''}`;
  return report.status === 'first' ? `${head}; first night, baseline stored (${report.right} right); ${report.calls} calls`
    : `${head}${report.newWrong.length ? `, ${report.newWrong.length} new wrong` : ''}; ${report.calls} calls`;
}

/**
 * The numbers of one night as one machine-readable log line, so a reader never parses the prose of reportLine(). The planned reader is the jobadabra-web collector (jobs/e2e-intel.mjs).
 * TODO(AI): the site PR reads this line onto the Quality AI card; until it lands nothing reads it (#2851)
 * @returns {string} `PROMPT_CASES_NIGHT {"set","status","sha","total","right","flipped","noise","newWrong","unconfirmed","calls"}`: counts only, never case texts
 */
export function factsLine(report) {
  const count = list => (Array.isArray(list) ? list.length : 0);
  return `PROMPT_CASES_NIGHT ${JSON.stringify({set: SET, status: report.status, sha: short(report.sha), total: report.total || 0, right: report.right || 0,
    flipped: count(report.flipped), noise: count(report.noise), newWrong: count(report.newWrong), unconfirmed: count(report.unconfirmed), calls: report.calls || 0})}`;
}

/**
 * Runs the night. All I/O is injected so a test plays it offline. The returned report is also the next night's baseline file:
 * `sha` is the commit its `results` (right/wrong by case id) reflect, so a carried or not-asked night keeps the baseline's own sha.
 * @param {{baseline: object|null, sha: string, changed: boolean, cases: object[], ask: Function, pool: Function, jobs?: number, maxCalls?: number}} options
 *   changed: a live prompt, case file or asker changed since baseline.sha (unknown counts as changed); ask(item) -> {id, right}, throws when the broker refuses
 * @returns {Promise<object>} {version, set, status: asked|first|carried|not-asked, reason?, sha, ranOn, calls, total, right, flipped, noise, newWrong, results}
 */
export async function runNight({baseline, sha, changed, cases, ask, pool, jobs = 6, maxCalls = 160}) {
  const keep = (status, reason, calls = 0) => ({...(baseline || {version: 1, set: SET, results: {}, total: 0, right: 0}), status, reason, ranOn: sha, calls, flipped: [], noise: [], newWrong: [], unconfirmed: []});
  if (baseline && !changed) return keep('carried');
  if (cases.length > maxCalls) return keep('not-asked', `${cases.length} cases is over the cap of ${maxCalls} calls`);
  let calls = 0, refusal = null;
  const guarded = async item => {
    if (refusal) return null;
    calls += 1;
    try { return await ask(item); } catch (error) { refusal ||= error.message; return null; }
  };
  const first = await pool(cases, jobs, guarded);
  if (refusal || first.some(row => !row)) return keep('not-asked', refusal || 'the broker gave no answer', calls);
  const before = baseline?.results || null;
  const retry = new Set(first.filter(row => !row.right && before?.[row.id]).map(row => row.id));
  const toAsk = cases.filter(item => retry.has(item.id)).slice(0, Math.max(0, maxCalls - calls));   // Why (Gitar on #2851): the cap holds for the re-asks too
  const again = (await pool(toAsk, jobs, guarded)).filter(Boolean);
  if (refusal) return keep('not-asked', refusal, calls);
  const unconfirmed = [...retry].filter(id => !toAsk.some(item => item.id === id));   // wrong once, no call left to ask again: never called "flipped" (wrong twice)
  const {results, ...counts} = compareNight(before, first, again);
  for (const id of unconfirmed) results[id] = before[id];   // Why (Gitar on #2851): not confirmed tonight = last night's verdict stays, so tomorrow judges it again instead of losing the regression
  counts.right = Object.values(results).filter(Boolean).length;
  counts.flipped = counts.flipped.filter(id => !unconfirmed.includes(id));
  return {version: 1, set: SET, engine: 'codex (broker, small tier)', status: baseline ? 'asked' : 'first', sha, ranOn: sha, calls, total: counts.cases, right: counts.right,
    flipped: counts.flipped, noise: counts.noise, newWrong: counts.newWrong, unconfirmed, results};
}

const git = (root, ...rest) => execFileSync('git', ['-C', root, ...rest], {encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe']});

/**
 * Did a live prompt, case file or asker change between the baseline's commit and HEAD? Unknown (a commit git does not know, unrelated history, no tool) counts as changed: not judged = asked,
 * never read on a guess. Why (Gitar on #2851): tools/prompt-cases.mjs --live prints nothing and exits 0 when git cannot compare, so an unknown sha must be refused here first, by git.
 */
export function liveChanged(root, baselineSha) {
  try {
    execFileSync('git', ['-C', root, 'merge-base', baselineSha, 'HEAD'], {stdio: 'ignore'});
    return execFileSync('node', [path.join(root, 'tools/prompt-cases.mjs'), '--live', '--base', baselineSha], {cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore']}).split('\n').includes(SET);
  } catch { return true; }
}

async function main(argv) {
  const option = (name, fallback) => { const i = argv.indexOf(`--${name}`); return i >= 0 ? argv[i + 1] : fallback; };
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..'), out = option('out');
  if (!out) throw new Error('--out <dir> is required');
  const file = option('baseline', ''), found = file && fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : null;
  const baseline = found?.version === 1 && found.set === SET && found.results && found.sha ? found : null;
  const sha = git(root, 'rev-parse', 'HEAD').trim();
  const changed = baseline ? liveChanged(root, baseline.sha) : true;   // a baseline file from another set or version is no baseline
  const {buildCases, pool} = await import('./prompt-cases-live.mjs');
  const {evaluate} = await import('./free-ai-eval.mjs');
  const {codexRun, MODEL} = await import('./prompt-cases-codex.mjs');
  const run = codexRun({});
  const cases = baseline && !changed ? [] : buildCases(root);
  const report = await runNight({baseline, sha, changed, cases, jobs: Number(option('jobs', 6)), maxCalls: Number(option('max-calls', 160)), pool,
    ask: async item => { const [row] = await evaluate([item], MODEL, run); if (row.error && /^(capped|no-token|unreachable|\d+):/.test(row.error)) throw new Error(row.error); return {id: row.id, right: row.right === true}; }});
  fs.mkdirSync(out, {recursive: true});
  fs.writeFileSync(path.join(out, 'prompt-cases-night.json'), JSON.stringify(report, null, 1) + '\n');
  const line = reportLine(report);
  console.log(line);
  console.log(factsLine(report));
  for (const id of report.flipped || []) console.log(`FLIPPED ${id}: right last night, wrong twice tonight`);
  console.log(`::${report.status === 'not-asked' ? 'warning' : 'notice'} title=Prompt cases (nightly, report only)::${line}`);
  return 0;
}
if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) process.exit(await main(process.argv.slice(2)).catch(error => { console.error(`::warning title=Prompt cases (nightly, report only)::not run: ${error.message}`); return 0; }));
