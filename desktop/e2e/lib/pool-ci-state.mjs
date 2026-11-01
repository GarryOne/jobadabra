// What CI pool runs hand each other (.github/workflows/record-sites.yml): each run uploads a small state artifact, its site ledger and the results of the rows it ran.
// GitHub's cache is per branch (a PR's saves are invisible to main and to other PRs), so the next run reads the states of every branch instead:
//   mergeLedgers  today's CI-wide ledger (lib/site-ledger.mjs format): every run's visits of today, each counted once; a block page rests the host for all
//   baselines     each row's newest usable CI result on main or on this PR, of the same test applicant (never another PR's build, never this run)
//   fallsBelow    this run's row against its baseline, by lib/record-sites.mjs compare; a bot wall or refusal on the CI IP, a gone posting or a run without AI never counts
// CLI: pool-ci-state.mjs. Guard: e2e/test/pool/pool-ci-state.test.mjs.
import {SITE_REFUSED, compare} from './record-sites.mjs';

export function mergeLedgers(states, day) {
  const out = {};
  for (const state of states) for (const [site, entry] of Object.entries(state?.ledger?.[day] || {})) {
    const into = ((out[day] ||= {})[site] ||= {visits: []});
    for (const visit of entry?.visits || []) if (!into.visits.some(seen => seen.at === visit.at && seen.who === visit.who)) into.visits.push(visit);
    if (entry?.blocked && (!into.blocked || entry.blocked.at < into.blocked.at)) into.blocked = entry.blocked;
  }
  for (const entry of Object.values(out[day] || {})) entry.visits.sort((a, b) => a.at - b.at);
  return out;
}

// A result that says nothing about the build: the runner's IP met a bot wall or a refusal, or the AI was refused.
const unusable = item => item.reached === 'code/bot' || item.note === SITE_REFUSED || !!item.aiRefused;

// applicant: only runs of the same test applicant compare (a result without one was the thin applicant); none named = thin.
export function baselines(states, {branch = '', run = '', applicant = 'thin'} = {}) {
  const usable = states.filter(state => state && String(state.run) !== String(run) && (state.branch === 'main' || state.branch === branch))
    .sort((a, b) => String(a.at).localeCompare(String(b.at)));
  const out = {};
  for (const state of usable) for (const [row, result] of Object.entries(state.results || {})) {
    if (!unusable(result) && (result.applicant || 'thin') === applicant) out[row] = {...result, run: state.run, branch: state.branch, at: state.at};
  }
  return out;
}

// -> '' or why this run's row fell below its baseline ("reached posting, form in run 3 (main)").
export function fallsBelow(base, now) {
  if (!base || !now || unusable(base) || unusable(now)) return '';
  const [fall] = compare({row: base}, {row: now});   // the pool's own rule: an earlier step, or fewer fields on the same posting; a note on either side never
  return fall ? fall.why.replace(/last time (.+)$/, `$1 in run ${base.run} (${base.branch})`) : '';
}

const KEPT = ['reached', 'filled', 'left', 'url', 'note', 'blocked', 'aiRefused', 'tripped', 'applicant'];

// The state a run hands the next ones: its ledger and the rows it ran (the day's report may hold other runs' rows), trimmed to what is compared.
export function stateOf({run, branch, sha, at, ledger, report = {}}) {
  const results = report.results || {}, ran = report.thisRun?.ran || Object.keys(results);
  return {run, branch, sha, at, ledger, results: Object.fromEntries(ran.filter(row => results[row]).map(row => [row,
    Object.fromEntries(KEPT.filter(key => results[row][key] !== undefined).map(key => [key, results[row][key]]))]))};
}
