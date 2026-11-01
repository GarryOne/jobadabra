// The rules of the CI refill (.github/workflows/replay-refill.yml; owner, 15 Oct 2026: "a separate CI workflow only for that, with a separate Anthropic API Key"): which pinned rows
// to refill, what it may cost, which key it may use, and which PRs may start it. Pure parts; guard: e2e/test/refill.test.mjs. The key REPLAY_REFILL_ANTHROPIC_KEY has NO fallback
// (no Tests key, no live-pool key): missing = the job says so and stops. Fake applicant only, a replay of the network record (no site visit), never Submit.
import {askChanged, keptOutcome, outdated} from '../replay-gate.mjs';

export const SECRET = 'REPLAY_REFILL_ANTHROPIC_KEY';
export const FLAG = 'JP_REFILL_CI';   // set by the workflow only: the fill replay may ask the API on CI (lib/ai/model-memo.js fillOn, lib/offline-app.mjs)
export const MAX_ASKS = 40;           // a run refuses to start above this many asks (workflow input max_asks lowers or raises it by hand)
export const PER_ASK_USD = 0.001;     // the estimate printed before it starts: the API's measured price (15 Oct 2026, the by-hand refill of PR 824: $0.0012 in 3 calls, $0.0016 in 4, ~$0.0004 a call) with a margin; the plan path's $0.06 was 100x too high
export const MAX_USD = 3;
export const MAIN_MAX_ASKS = 200;     // the automatic run on main covers every recorded row (about 4 asks a row): its own ask cap; the dollar cap and the 30 calls a row stay
export const ASKS_PER_ROW_MAIN = 4;   // measured 15 Oct 2026: 2-5 answers filled a row after a page-kind prompt change
export const ROW_MAX_CALLS = 30;     // one row's paid calls: the proxy refuses the next one (lib/ai-proxy.mjs maxCalls)
export const refillCap = (env = process.env) => Number(env.REFILL_ROW_MAX_CALLS) || ROW_MAX_CALLS;             // a run stops asking above this (the org's prepaid credits are small; the key's workspace has its own monthly limit)

// The key, or '' (never another key's value).
export const refillKey = (env = process.env) => String(env[SECRET] || '');
export const keyRefusal = (env = process.env) => (refillKey(env) ? '' : `refill: no ${SECRET} secret: nothing was asked (this workflow never runs on another key)`);

// A PR from a fork never gets the key (isCrossRepository from `gh pr view --json isCrossRepository`; a missing answer counts as a fork).
export const forkRefusal = pr => (pr && pr.isCrossRepository === false ? '' : `refill: PR ${pr?.number ?? '?'} is from a fork or unknown: the key is never given to it`);

// A replay record the refill is for: the ask changed (page-side), or the prompt changed (instructions only): the gate's own two verdicts (replay-gate.mjs).
export const needsRefill = (record, {worseOnly = false} = {}) => !!record && !record.deferred && (outdated(record.firstMiss) || askChanged(record)) && !(worseOnly && keptOutcome(record));

// The automatic refill a PR starts itself (owner, 17 Oct 2026: "Auto-refill PRs under a cap"): only rows a refill could turn green (the outcome fell: keptOutcome is the gate's rule), $0.50 a run, $5 a calendar month.
export const AUTO_RUN_USD = 0.5, AUTO_MONTH_USD = 5;
// (this run's estimate, the month's refill spend so far) -> '' (go) or why it does not run.
export const autoRefusal = (estimate, month, {runUsd = AUTO_RUN_USD, monthUsd = AUTO_MONTH_USD} = {}) => (!Number.isFinite(month) ? 'refill (auto): this month\'s refill spend could not be read: nothing was asked'
  : estimate > runUsd ? `refill (auto): about $${estimate.toFixed(3)} is above the $${runUsd} a run`
  : month + estimate > monthUsd ? `refill (auto): this month's refill spend $${month.toFixed(2)} + about $${estimate.toFixed(3)} would pass the $${monthUsd} a month` : '');
// The run's title: one automatic refill per PR commit (the gate looks for it before it starts another).
export const autoRunName = (pr, head) => `Replay refill PR ${pr} @ ${String(head).slice(0, 7)}`;

// (pinned names, the PR gate's replay records {name, network:{extra}, firstMiss}, all) -> {rows: [{name, asks}], asks, usd}
// all: every pinned row (the PR gate replays one row per kind, so a pinned row it did not replay is unknown); else only the pinned rows the gate saw needing it.
export function pickRefill({pins = [], records = [], all = false, worseOnly = false} = {}) {
  const byName = new Map(records.map(record => [record.name, record])), rows = [];
  for (const name of [...pins].sort()) {
    const record = byName.get(name);
    if (all || needsRefill(record, {worseOnly})) rows.push({name, asks: Math.max(1, Number(record?.network?.extra) || 0)});
  }
  const asks = rows.reduce((sum, row) => sum + row.asks, 0);
  return {rows, asks, usd: Math.round(asks * PER_ASK_USD * 1000) / 1000};
}

// -> '' (go ahead) or why the run refuses to start.
export const capRefusal = ({asks, usd}, {maxAsks = MAX_ASKS, maxUsd = MAX_USD} = {}) => (asks > maxAsks ? `refill: ${asks} asks (about $${usd.toFixed(3)}) is above the cap of ${maxAsks}: raise max_asks by hand if that is meant`
  : usd > maxUsd ? `refill: about $${usd.toFixed(3)} is above the $${maxUsd} cap` : '');

// The API's answer for an empty balance or a spent limit (lib/ai-meter.mjs countError keys: "<status> <type>: <message>").
export const outOfCredits = errors => Object.keys(errors || {}).some(key => /credit balance is too low|spend limit|usage limits/i.test(key));
export const creditsLine = `refill: OUT OF CREDITS: the API refused the refill key's calls (the org's prepaid balance or the workspace's monthly limit); add credit in the Anthropic console, then run it again`;

// The workflow's group split: one row per runner.
export const matrixOf = rows => rows.map(row => row.name);

// The automatic refill on main (owner, 15 Oct 2026: when a merge changes the ladder prompt fingerprint, every recorded row is refilled, pinned or not, through the guard).
// Did any rung's prompt hash change? (the {rung: hash} objects of desktop/e2e/ladder-baseline.json promptFingerprint; a score update changes the file but not this)
export const fingerprintChanged = (before, after) => {
  const now = after?.promptFingerprint;
  if (!now) return false;
  const was = before?.promptFingerprint;
  if (!was) return true;
  return Object.keys({...was, ...now}).some(rung => was[rung] !== now[rung]);
};

// (every recorded row's name, the deferred rows by name, the pool rows' names) -> {rows: [{name, asks}], asks, usd}: each once, sorted, only real pool rows (an old record named by its address is no row), none put aside on purpose.
export function pickMain({names = [], deferred = {}, known = null, only = []} = {}) {   // only: just these rows (the daily replay's flagged ones); empty = all
  const rows = [...new Set(names)].filter(name => (!only.length || only.includes(name)) && !(name in deferred) && (!known || known.has(name))).sort().map(name => ({name, asks: ASKS_PER_ROW_MAIN}));
  const asks = rows.reduce((sum, row) => sum + row.asks, 0);
  return {rows, asks, usd: Math.round(asks * PER_ASK_USD * 1000) / 1000};
}

// records-publish.mjs refuses more than 3 rows at once (its guard replays each twice): rows go to the publish step in groups of at most 3, one runner each. -> [[names]]
export const PUBLISH_GROUP = 3;
export const groupsOf = (names, size = PUBLISH_GROUP) => Array.from({length: Math.ceil(names.length / size)}, (_, at) => names.slice(at * size, (at + 1) * size));
