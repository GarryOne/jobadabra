// The reads behind the flaky verdict (lib/flaky-verdict.mjs): recent runs' step tables, the git diff between a green's commit and the red's, the coverage map.
// Used by the gate (tools/red-main-gate.sh via tools/flaky-verdict.mjs), the Telegram alert (ci-alert.mjs) and the PR verdict (tools/pr-verdict.py); tools/suspend-flip.mjs proposes the suspension from it.
// Why (31 Oct 2026, owner: "You detect flakiness and immediately treat the flakiness root cause"): the evidence is searched by the tool on every red, from runs of every kind
// (main after-merge, nightly, beta, re-checks, PR runs), because a green on a PR head is as good a "same code passed" as one on main (trees are compared, not ancestry).
// Why (31 Oct 2026, owner: "Never suspend safety steps"; found on #2703): the red 41200878403 ran the Notion stand-in store and its "green on the same commit" 41200737331 ran sqlite,
// so the verdict said flaky for two different inputs and suspended a safety step. A green counts only from a view artifact on the red's own store (io.storesOf: per artifact, because a gate run holds
// both stores of a suite, Gitar on #2726); other-store greens are counted, not compared.
// Invariants: every read is injected (`io`), so tests never reach GitHub; a read that fails leaves that green uncomparable ("unknown"), never "changed" or "flaky". Without io.storesOf the store is not looked at.
// Why (1 Nov 2026, mac-07: apply-3of3 red 4 times, the tool said "Unknown" for every step on 2 runs and printed nothing in 150 s on 5): (1) the red's store was read per SUITE, so a gate/night red
// (sqlite leg + stand-in leg) or an unsuffixed key with no coverage artifact was "unknown" for every step: the store is now the store of the JOB(s) a step failed on (the cause's `job`),
// and an unsuffixed key next to its own "-standin" sibling is the sqlite leg (plan-run.mjs legs()); (2) the run window was the newest 100 runs, so a red 14 h old had no neighbours
// (41253960704): runs are now taken around the red's time; (3) a failed shard's e2e-view artifact holds its kept traces (1,045,025,600 bytes for apply-3of3) and the whole zip was downloaded
// for a 2 KB steps.json (143 s measured): steps.json is read by byte ranges (lib/zip-peek.mjs); (4) no line and no hang guard: a progress line and one deadline for the whole read.
// Not covered: Mac vs Linux (a suite moves runners only when the run sets all_on_mac; the artifacts do not record the OS); Windows lanes are keyed apart (windows-<suite>).
// Tests: test/flaky-evidence.test.mjs, test/zip-peek.test.mjs
// Job: report health
import {execFile, execFileSync} from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {judge, stepFiles, touched} from './flaky-verdict.mjs';
import {suiteOfKey} from './suite-shards.mjs';
import {zipEntry} from './zip-peek.mjs';

export const WINDOW_RUNS = 100;   // runs of e2e.yml looked at (one API page: about a day of main plus PR runs); the ones nearest the red in time are compared first
export const LOOK_AHEAD = 6;    // listings asked for before their run is judged
export const MAX_GREENS = 12;    // greens compared per step before "changed" is the answer
const NOT_EVIDENCE = /^(Mutant|Bisect) /;   // a mutant's green is on purpose-broken code
// "E2E after merge · 5b63233 · linkedin,settings" and "E2E for PR · settings,apply · branch" name the suites the run ran (e2e.yml run-name); the other kinds (night, gate, cron) run them all.
const SUITE_LIST = /^E2E (?:after merge · [0-9a-f]{7,40} · |for PR · )([a-z0-9:,_-]+)(?: · |$)/;
/** false only when the run's title names its suites and this one is not among them (a run that did not run the suite has no step of it: opening it costs an API call for nothing). */
export const mayHoldSuite = (title, suite) => { const listed = SUITE_LIST.exec(String(title || ''))?.[1]; return !listed || listed.split(',').some(item => item.split(':')[0] === suite); };

/**
 * Verdicts for red steps of one suite. redAt: when the red run started; greens are compared nearest in time first, on either side (a green much newer than the red may already
 * carry the fix, which would read "changed" for a red that was flaky when it happened; the nearest greens are the fair comparison). io: {runs(limit, {redAt}) -> [{id, sha, at, title, url}], viewNames(runId) -> [artifact name], stepsOf(runId, name) -> steps.json | null,
 * changedNames(greenSha, redSha) -> [path] | null, readAt(sha, path) -> text | null, coverageMap() -> map | null}.
 * redJobs: {step: [job key]}, the jobs a step failed on (a cause's `job`); a green counts on the store of those jobs. Without it every step takes the one store the red run's artifacts agree on.
 * deadlineAt (ms since epoch): the one hang guard for the whole read; the runs not read by then are said, never guessed. say(line): progress lines.
 * @returns {Promise<{step: string, redSha: string, verdict: string, green?: object, files?: string[], compared: number, reason?: string}[]>}
 */
export async function verdictsFor({suite, steps, redSha, redRun, redAt, io, window = WINDOW_RUNS, maxGreens = MAX_GREENS, redJobs, deadlineAt, say = () => {}}) {
  const map = await io.coverageMap().catch(() => null);
  const texts = new Map();
  const read = file => { if (!texts.has(file)) texts.set(file, io.readAt(redSha, file)); return texts.get(file); };
  const sets = Object.fromEntries(steps.map(step => [step, stepFiles({suite, step, map, read})]));
  const compared = Object.fromEntries(steps.map(step => [step, []]));
  const diffs = new Map();
  const otherStore = Object.fromEntries(steps.map(step => [step, 0]));
  const storesOn = storeReader(io, suite);
  const redStores = io.storesOf ? redStoresOf({steps, redJobs, byName: await storesOn(redRun)}) : {};   // step -> Set of stores, or null when it cannot be told
  const pending = new Set(steps.filter(step => !io.storesOf || redStores[step]));   // nothing can be compared with an unknown store (Gitar on #2726: no 100-run scan for a sure "unknown")
  const state = {suite, io, pending, redStores, storesOn, compared, otherStore, maxGreens, sets, redSha, diffs};
  const candidates = pending.size ? nearestFirst(await io.runs(window, {redAt}), redRun, redAt).filter(run => mayHoldSuite(run.title, suite)).slice(0, window) : [];
  if (candidates.length) say(`reading ${candidates.length} runs of ${suite} around ${redAt || 'the red'}…`);
  let done = 0, cut = null, failed = 0;
  // Why (1 Nov 2026): a run costs about 2 s of waiting (listing, step tables, stores), so the next LOOK_AHEAD runs are read at the same time and applied in the order of nearness. Their reads
  // use the steps pending when they start, a superset of the ones pending when they are applied (pending only shrinks), and walkRun filters by the current set.
  const reading = new Map();
  // Why (1 Nov 2026): the look-ahead promise's rejection is read again, and counted, when the loop awaits that run's turn; this catch only stops an unhandled-rejection exit before then.
  const ahead = index => { for (const run of candidates.slice(index, index + LOOK_AHEAD)) if (!reading.has(run.id)) { const started = readRun(run, state); started.catch(() => {}); reading.set(run.id, started); } };
  for (const [index, run] of candidates.entries()) {
    if (!pending.size) break;
    if (deadlineAt && Date.now() >= deadlineAt) { cut = {done, of: candidates.length}; break; }
    ahead(index);
    try { await walkRun(run, state, reading.get(run.id)); } catch (error) {
      if (deadlineAt && Date.now() >= deadlineAt) { cut = {done, of: candidates.length}; break; }   // a call ended by the guard is the guard, not a failure of the run
      failed++; say(`run ${run.id} could not be read: ${error.message}`);
    }
    if (++done % 10 === 0) say(`…${done} of ${candidates.length} runs read`);
  }
  if (cut) say(`unknown: read cut at ${cut.done} of ${cut.of} runs`);
  const since = candidates.slice(0, done).map(run => run.at).filter(Boolean).sort()[0];
  return steps.map(step => resultOf(step, {redSha, compared: compared[step], files: sets[step].files, diffs, withStores: Boolean(io.storesOf), redStores: redStores[step] ?? null, otherStore: otherStore[step], cut, done, since, failed}));
}

/** step -> the Set of stores the red failed on, or null when a job's store is unknown (a store that cannot be told says nothing about a green). byName: {artifact name: store | null}. */
function redStoresOf({steps, redJobs, byName}) {
  const sole = soleStore(byName);
  return Object.fromEntries(steps.map(step => {
    if (!redJobs?.[step]?.length) return [step, sole == null ? null : new Set([sole])];
    const stores = redJobs[step].map(job => byName[`e2e-view-${job}`]);
    return [step, stores.some(store => store == null) ? null : new Set(stores)];
  }));
}

/** The names that changed between a green's commit and the red's, read once per commit; null when they cannot be read. */
async function changedSince(sha, {diffs, io, redSha}) {
  if (!diffs.has(sha)) diffs.set(sha, await Promise.resolve(io.changedNames(sha, redSha)).catch(() => null));
  return diffs.get(sha);
}

/** Records one green of a step: the step's files that differ between it and the red (null when the two cannot be compared); a step with no difference, or enough greens, is done. */
async function compareGreen(run, step, state) {
  const changed = await changedSince(run.sha, state);
  const files = changed ? touched(changed, state.sets[step]) : null;
  state.compared[step].push({green: {sha: run.sha, run: run.id, url: run.url}, files});
  if (files?.length === 0 || state.compared[step].length >= state.maxGreens) state.pending.delete(step);
}

/** The I/O of one run of the window: its passes of the pending steps, `same` on a store the red failed on, `left` on another (see passesOf). */
function readRun(run, state) {
  const {suite, io, pending, redStores, storesOn} = state;
  return passesOf(run, {suite, io, pending, redStores, storesFor: io.storesOf ? names => storesOn(run.id, names) : null});
}

/** One run of the window: compare its passes on the red's store; count the ones that passed only on another store (a step with enough of them is done). `reading` is readRun's promise. */
async function walkRun(run, state, reading) {
  const {pending, otherStore, maxGreens} = state;
  const {same, left} = await reading;
  for (const step of same) if (pending.has(step)) await compareGreen(run, step, state);
  for (const step of left) if (pending.has(step) && !same.has(step) && ++otherStore[step] >= maxGreens) pending.delete(step);
}

/** One step's verdict with its evidence: for flaky, how many files moved between the green and the red and how many of them the step runs (the numbers an owner issue quotes); with stores, the red's stores and the greens left out for another one; an unknown says why. */
function resultOf(step, {redSha, compared, files, diffs, withStores, redStores, otherStore, cut, done, since, failed}) {
  const verdict = judge(compared);
  const moved = verdict.verdict === 'flaky' ? {movedFiles: diffs.get(verdict.green.sha)?.length ?? 0, stepFileCount: files.length} : {};
  const store = redStores ? [...redStores].join('+') : null;
  return {step, redSha, ...verdict, ...(withStores ? {store, otherStore} : {}), ...moved, ...(verdict.verdict === 'unknown' ? {reason: unknownReason({withStores, redStores, cut, done, since, failed, uncomparable: verdict.uncomparable})} : {})};
}

/** Why a step has no verdict, in the words of the line: the store of the red could not be told, the read was cut by its hang guard, the greens could not be compared, or there is none. */
function unknownReason({withStores, redStores, cut, done, since, failed, uncomparable}) {
  if (withStores && !redStores) return "the red's store cannot be told, so no green is comparable";
  if (cut) return `read cut at ${cut.done} of ${cut.of} runs`;
  if (uncomparable) return `${uncomparable} green(s) found, but their commits could not be compared with the red's`;
  if (failed) return `${failed} of ${done} runs could not be read, and no green in the others${since ? ` since ${since.slice(0, 16).replace('T', ' ')} UTC` : ''}`;
  return `no green in ${done} runs${since ? ` since ${since.slice(0, 16).replace('T', ' ')} UTC` : ''}`;
}

/** A run's stores ({artifact: store}) read once per run and artifact (names: only these artifacts; the coverage download behind an unsuffixed key costs seconds); a failed read is "no stores" (every store unknown). */
function storeReader(io, suite) {
  const stores = new Map();
  return async (id, names) => {
    const keys = names?.length ? names : [''];
    for (const key of keys) if (!stores.has(`${id}|${key}`)) stores.set(`${id}|${key}`, Promise.resolve(io.storesOf?.(id, suite, key ? [key] : undefined)).catch(() => ({})));
    return Object.assign({}, ...await Promise.all(keys.map(key => stores.get(`${id}|${key}`))));
  };
}

const passedIn = (table, step) => Boolean(table?.results?.some(result => result.name === step && result.status === 'passed'));

/** The step tables (steps.json) of a run's e2e-view artifacts for one suite, every shard and store leg, each with its artifact name; an unreadable one is left out. */
async function stepTables(run, suite, io) {
  const names = (await io.viewNames(run.id)).filter(name => name.startsWith('e2e-view-') && suiteOfKey(name.slice('e2e-view-'.length)) === suite);
  return Promise.all(names.map(async name => ({name, table: await io.stepsOf(run.id, name).catch(() => null)})));
}

/** One run's passes of the pending steps: `same` passed on a store the red step failed on (or any store when none is looked at), `left` passed only on another known store (counted, never compared; an unknown store proves nothing). */
async function passesOf(run, {suite, io, pending, redStores, storesFor}) {
  const same = new Set(), left = new Set();
  for (const {name, table} of await stepTables(run, suite, io)) {
    const passed = [...pending].filter(item => passedIn(table, item));
    if (!passed.length) continue;
    const byName = storesFor ? await storesFor([name]) : null;   // the store is read only for an artifact where a pending step passed (Gitar on #2726)
    const store = byName ? byName[name] : undefined;
    for (const step of passed) {
      if (!byName || redStores[step]?.has(store)) same.add(step);
      else if (store != null) left.add(step);
    }
  }
  return {same, left};
}

/** The one store a run's artifacts of a suite agree on, or null when they are unknown or differ. byName: {artifact name: store | null}. */
function soleStore(byName) {
  const found = new Set(Object.values(byName || {}));
  return found.size === 1 && !found.has(null) ? [...found][0] : null;
}

/** The runs that count as evidence (not the red itself, not a mutant), nearest the red in time first; the listed order when the red's time is unknown. */
function nearestFirst(listed, redRun, redAt) {
  const at = Date.parse(redAt || listed.find(item => String(item.id) === String(redRun))?.at || '');
  const candidates = listed.filter(item => String(item.id) !== String(redRun) && !NOT_EVIDENCE.test(item.title || ''));
  const apart = item => (item.at ? Math.abs(Date.parse(item.at) - at) : 0);
  return Number.isNaN(at) ? candidates : [...candidates].sort((a, b) => apart(a) - apart(b));
}

/**
 * Verdicts for the failed steps of a red run, from ci-alert's stepCauses ({suite, step, message}): steps never run (the suite's budget was spent before them) are
 * a consequence, not a red of their own, and get no verdict.
 */
export async function verdictsForCauses(causes, {redSha, redRun, io, ...options}) {
  const bySuite = new Map();
  for (const cause of causes.filter(item => !String(item.message).startsWith('not run: '))) {
    if (!bySuite.has(cause.suite)) bySuite.set(cause.suite, new Map());
    const steps = bySuite.get(cause.suite);
    if (!steps.has(cause.step)) steps.set(cause.step, {message: String(cause.message), jobs: new Set()});   // the first failure text of the step, for the owner issue
    steps.get(cause.step).jobs.add(cause.job);   // every job (store leg) the step failed on
  }
  const out = [];
  for (const [suite, steps] of bySuite) {
    const redJobs = Object.fromEntries([...steps].map(([step, {jobs}]) => [step, [...jobs]]).filter(([, jobs]) => jobs.every(Boolean)));
    out.push(...(await verdictsFor({suite, steps: [...steps.keys()], redSha, redRun, io, redJobs, ...options})).map(item => ({suite, message: steps.get(item.step).message, ...item})));
  }
  return out;
}

const gh = (args, options = {}) => execFileSync('gh', args, {encoding: 'utf8', maxBuffer: 64 << 20, stdio: ['ignore', 'pipe', 'pipe'], ...options});
const ghAsync = (args, options = {}) => new Promise((resolve, reject) => execFile('gh', args, {encoding: 'utf8', maxBuffer: 64 << 20, ...options}, (error, stdout) => (error ? reject(error) : resolve(stdout))));
const SMALL_ARTIFACT = 20 << 20;   // an artifact above this is never downloaded whole: its steps.json is read by ranges or not at all (the 1 GB one took 143 s)
const AFTER_RED_MS = 6 * 3600e3;   // runs after the red that count as neighbours

/** A zip source over an artifact's signed download URL: GitHub redirects /zip to blob storage, which answers explicit byte ranges with 206. */
export async function artifactZip({repo, id, size, token, timeoutMs = 30000}) {
  const hop = await fetch(`https://api.github.com/repos/${repo}/actions/artifacts/${id}/zip`, {headers: {Authorization: `Bearer ${token}`, Accept: 'application/vnd.github+json'}, redirect: 'manual', signal: AbortSignal.timeout(timeoutMs)});
  const url = hop.headers.get('location');
  if (!url) throw new Error(`artifact ${id}: no download URL (HTTP ${hop.status})`);
  return {length: size, range: async (start, end) => {
    const part = await fetch(url, {headers: {Range: `bytes=${start}-${end}`}, signal: AbortSignal.timeout(timeoutMs)});
    if (part.status !== 206) throw new Error(`artifact ${id}: range ${start}-${end} answered HTTP ${part.status}`);
    return Buffer.from(await part.arrayBuffer());
  }};
}

/**
 * The real reads: gh for runs and artifacts, git for trees. `root` is the checkout; a commit it lacks (a shallow CI checkout, a PR head that is no ancestor) is fetched into a
 * private bare repo, never into the checkout (a depth-1 fetch would make a full clone shallow). remoteUrl defaults to the repo's public https URL.
 */
export function ghIo({repo, root = process.cwd(), run: runGh = gh, remoteUrl = `https://github.com/${repo}.git`, deadlineAt, zipSource = artifactZip, runAsync: injectedAsync}) {
  // Every gh call ends by the read's hang guard, so no single call outlives it; a call past it fails like any unreadable answer.
  const run = (args, options = {}) => runGh(args, deadlineAt ? {...options, timeout: Math.max(1000, deadlineAt - Date.now())} : options);
  let token;
  // Why (1 Nov 2026): the listings are asked ahead (verdictsFor reads viewNames of the next runs while it judges this one), so they must not block the process: async gh unless a sync `run` was injected.
  const runAsync = injectedAsync || (runGh === gh ? (args, options = {}) => ghAsync(args, deadlineAt ? {...options, timeout: Math.max(1000, deadlineAt - Date.now())} : options) : async (args, options) => run(args, options));
  const rows = new Map();   // runId -> Promise of [{id, size, name}], the run's live artifacts, listed once
  const artifactsOf = runId => {
    if (!rows.has(runId)) {
      const listing = runAsync(['api', '--paginate', `repos/${repo}/actions/runs/${runId}/artifacts?per_page=100`, '--jq', '.artifacts[] | select(.expired == false) | [.id, .size_in_bytes, .name] | @tsv']);
      rows.set(runId, Promise.resolve(listing).then(text => text.split('\n').filter(Boolean).map(line => { const [id, size, ...name] = line.split('\t'); return {id, size: Number(size), name: name.join('\t')}; })));
    }
    return rows.get(runId);
  };
  const git = (dir, ...args) => execFileSync('git', ['-C', dir, ...args], {encoding: 'utf8', maxBuffer: 64 << 20, stdio: ['ignore', 'pipe', 'pipe'], ...(deadlineAt ? {timeout: Math.max(1000, deadlineAt - Date.now())} : {})});
  const scratch = {}, have = new Set();
  // kind 'trees' (no blobs: enough to compare two commits) or 'files' (blobs too: enough to read a file at a commit); one private bare repo each, removed at exit.
  const fetched = (kind, shas) => {
    if (!scratch[kind]) {
      scratch[kind] = fs.mkdtempSync(path.join(os.tmpdir(), `flaky-${kind}-`));
      git(scratch[kind], 'init', '-q', '--bare');
      process.once('exit', () => fs.rmSync(scratch[kind], {recursive: true, force: true}));
    }
    const missing = shas.filter(sha => !have.has(`${kind}:${sha}`));
    if (missing.length) git(scratch[kind], 'fetch', '-q', '--no-tags', '--depth=1', ...(kind === 'trees' ? ['--filter=blob:none'] : []), remoteUrl, ...missing);
    for (const sha of missing) have.add(`${kind}:${sha}`);
    return scratch[kind];
  };
  const download = (runId, name) => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'flaky-art-'));
    try { run(['run', 'download', String(runId), '-R', repo, '-n', name, '-D', dir]); return dir; } catch (error) { fs.rmSync(dir, {recursive: true, force: true}); throw error; }
  };
  const readJson = (runId, name, file) => {
    const dir = download(runId, name);
    try { return JSON.parse(fs.readFileSync(path.join(dir, file), 'utf8')); } finally { fs.rmSync(dir, {recursive: true, force: true}); }
  };
  /** The "store" a coverage artifact records: its coverage-*.json read by ranges (one small request), else the plain download of a small artifact; null when unreadable. */
  const coverageStore = async (runId, name, listed) => {
    try {
      token ||= run(['auth', 'token']).trim();
      const source = await zipSource({repo, id: listed.id, size: listed.size, token, timeoutMs: deadlineAt ? Math.max(1000, deadlineAt - Date.now()) : 30000});
      return JSON.parse((await zipEntry(source, /^coverage-.*\.json$/)).toString('utf8')).store ?? null;
    } catch { /* ranges refused or no listing: the plain download below */ }
    const dir = download(runId, name);
    try {
      const file = fs.readdirSync(dir).find(item => /^coverage-.*\.json$/.test(item));
      return file ? JSON.parse(fs.readFileSync(path.join(dir, file), 'utf8')).store ?? null : null;
    } catch { return null; } finally { fs.rmSync(dir, {recursive: true, force: true}); }
  };
  return {
    /** The runs of e2e.yml nearest the red in time: the `limit` newest up to the red, and (for a red with a known time) the ones in the 6 h after it. Without redAt, the newest `limit`. */
    runs: async (limit, {redAt} = {}) => {
      const fields = '[.workflow_runs[] | {id, sha: .head_sha, at: .created_at, title: .display_title, url: .html_url}]';
      const page = (created, size = Math.min(limit, 100)) => JSON.parse(run(['api', `repos/${repo}/actions/workflows/e2e.yml/runs?status=completed&per_page=${size}${created ? `&created=${encodeURIComponent(created)}` : ''}`, '--jq', fields]));
      if (!redAt || Number.isNaN(Date.parse(redAt))) return page('');
      const until = new Date(Date.parse(redAt) + AFTER_RED_MS).toISOString().replace('.000Z', 'Z');
      const before = page(`<=${redAt}`), after = page(`${redAt}..${until}`, 100);   // Why (#2828, Gitar): GitHub lists newest first, so a `limit`-sized page of the after-window kept the runs 4-6 h away; nearestFirst + the caller's slice cut it down
      return [...before, ...after.filter(item => !before.some(known => known.id === item.id))];
    },
    viewNames: async runId => (await artifactsOf(runId)).map(item => item.name),
    stepsOf: async (runId, name) => {
      const found = (await artifactsOf(runId)).find(item => item.name === name);
      try {
        if (!found) throw new Error(`${name} is not among run ${runId}'s artifacts`);
        token ||= run(['auth', 'token']).trim();
        const source = await zipSource({repo, id: found.id, size: found.size, token, timeoutMs: deadlineAt ? Math.max(1000, deadlineAt - Date.now()) : 30000});
        return JSON.parse((await zipEntry(source, 'steps.json')).toString('utf8'));
      } catch (error) {
        if (!found || found.size > SMALL_ARTIFACT) throw new Error(`${name} (${found?.size ?? '?'} bytes) is read by ranges only: ${error.message}`);
        return readJson(runId, name, 'steps.json');   // a small artifact: the plain download does it
      }
    },
    /** The store of each of a run's e2e-view artifacts of one suite: {name: store}. Its store leg (-standin, -sqlite) when the key has one; else sqlite when the run holds the key's own -standin sibling (a gate/night run: plan-run.mjs legs() keeps the key for the sqlite leg);
     * else the "store" its coverage artifact records ('' when the suite uses none); null when unknown. */
    storesOf: async (runId, suite, only) => {
      const listed = await artifactsOf(runId), names = listed.map(item => item.name);
      const out = {};
      for (const name of names.filter(item => item.startsWith('e2e-view-') && suiteOfKey(item.slice('e2e-view-'.length)) === suite && (!only || only.includes(item)))) {
        const key = name.slice('e2e-view-'.length), leg = /-(standin|sqlite)$/.exec(key)?.[1];
        out[name] = leg || (names.includes(`e2e-view-${key}-standin`) ? 'sqlite' : names.includes(`e2e-coverage-${key}`) ? await coverageStore(runId, `e2e-coverage-${key}`, listed.find(item => item.name === `e2e-coverage-${key}`)) : null);
      }
      return out;
    },
    changedNames: async (green, red) => {
      const names = dir => git(dir, 'diff', '--name-only', '--no-renames', green, red).split('\n').filter(Boolean);
      try { return names(root); } catch {
        try { return names(fetched('trees', [green, red])); } catch { return null; }
      }
    },
    readAt: (sha, file) => {
      try { return git(root, 'show', `${sha}:${file}`); } catch { /* not in this checkout: try the snapshot */ }
      try { return git(fetched('files', [sha]), 'show', `${sha}:${file}`); } catch { return null; }
    },
    coverageMap: async () => {
      const id = run(['api', `repos/${repo}/actions/artifacts?name=e2e-coverage-map&per_page=1`, '--jq', '.artifacts[0].workflow_run.id // ""']).trim();
      return id ? readJson(id, 'e2e-coverage-map', 'coverage-map.json') : null;
    },
  };
}
