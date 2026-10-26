// What the Windows e2e (e2e-windows.yml) runs. In the release run (desktop.yml, "E2E · Windows", GATE_TAG) the gate's own plan: plan-run.mjs planRun, exactly as the Mac + Linux
// gate plans it (its suites, its AI review), so the Windows lane never waits for the Mac lane (7 Oct 2026).
// After a scheduled Mac run (e2e.yml, job "Windows follows"), when it tested something: the same suites
// on the same commit, with the AI screenshot review where the Mac run had it, so Windows has the Mac's coverage (4 Oct 2026: it ran 7 of 13
// suites, weekly). A commit Windows already tested is not run again (the Mac looks at an unchanged commit up to three times; Windows once).
//   node plan-windows.mjs     (GH_TOKEN, REPO, MAC_RUN, SHA, REVIEW from e2e.yml; or ONLY=<suites> for a run by hand) -> GITHUB_OUTPUT lines
import {execFileSync} from 'node:child_process';
import {fileURLToPath, pathToFileURL} from 'node:url';
import {suiteOfKey, windowsMatrix} from './lib/suite-shards.mjs';

const NOT_SUITES = new Set(['plan', 'promote', 'promote-dry-run', 'Windows follows']);

// The Mac run's jobs -> the suites that ran there (not skipped or cancelled).
// all: the suites that exist. Only those count: the Mac run's other jobs (HTML report, Telegram alert, Nothing tested, Code → suite map…) are not suites, and a list of
// them to leave out fell behind (26 Oct 2026: "HTML report" and "Telegram alert" were planned as Windows suites).
export function macSuites(jobs, all = null) {
  return [...new Set(jobs.filter(job => !NOT_SUITES.has(job.name) && !['skipped', 'cancelled'].includes(job.conclusion))
    .map(job => suiteOfKey(job.name.replace(/ \(.*\)$/, ''))))].filter(suite => !all?.length || all.includes(suite)).sort();   // a slice's job (recorded-2of4) is its suite: the Windows plan slices it again
}

// The title e2e-windows.yml's run-name gives a run started after a Mac run. It was "Windows <sha>" until 7 Oct 2026; matching that old title meant a commit
// already tested on Windows was never recognised (test/plan-windows.test.mjs reads the workflow's run-name).
export const macRunTitle = sha => `E2E Windows · the Mac run's suites · ${sha}`;
// Earlier Windows runs that already tested this commit: finished, not cancelled, with at least one suite run.
export const testedBefore = (runs, sha, current) => runs.filter(run => String(run.id) !== String(current) && run.title === macRunTitle(sha)
  && ['success', 'failure'].includes(run.conclusion) && run.suitesRan > 0);

export function plan({only = '', all = [], mac = null, sha = '', review = false, previous = []}) {
  // Named suites: by hand (no review asked), or the release run's Windows gate, which passes the Mac + Linux gate's suites and its review (7 Oct 2026).
  if (only.trim()) return {suites: only.split(',').map(name => name.trim()).filter(Boolean), review};
  if (!mac) return {suites: all, review: false};
  if (previous.length) return {suites: [], review: false, why: `commit ${sha.slice(0, 7)} was already tested on Windows (run ${previous[0].id}): nothing new to run`};
  return {suites: macSuites(mac.jobs || [], all), review};
}

if (import.meta.url === pathToFileURL(process.argv[1] || '').href) {
  const gh = args => execFileSync('gh', args, {encoding: 'utf8'});
  (await import('./lib/ensure-staged.mjs')).ensureStaged(fileURLToPath(new URL('..', import.meta.url)));   // before anything loads a suite: its own imports below too (test/ensure-staged.test.mjs)
  const all = JSON.parse(execFileSync(process.execPath, ['suite.mjs', '--list'], {encoding: 'utf8'})).include.map(item => item.suite);
  const {MAC_RUN: id, SHA: sha = '', REPO: repo} = process.env;
  let mac = null, previous = [];
  if (id && !process.env.ONLY) {
    mac = {jobs: JSON.parse(gh(['api', `repos/${repo}/actions/runs/${id}/jobs?per_page=100`, '--jq', '.jobs']))};
    const runs = JSON.parse(gh(['run', 'list', '--repo', repo, '--workflow', 'e2e-windows.yml', '--limit', '50', '--json', 'databaseId,displayTitle,conclusion']))
      .filter(run => run.displayTitle === macRunTitle(sha) && String(run.databaseId) !== String(process.env.GITHUB_RUN_ID));
    previous = testedBefore(runs.map(run => ({id: run.databaseId, title: run.displayTitle, conclusion: run.conclusion,
      suitesRan: JSON.parse(gh(['api', `repos/${repo}/actions/runs/${run.databaseId}/jobs?per_page=100`, '--jq', '[.jobs[] | select(.name != "plan" and .conclusion != "skipped" and .conclusion != "cancelled")] | length']))})), sha, process.env.GITHUB_RUN_ID);
  }
  let result;
  if (process.env.GATE_TAG && !id && !process.env.ONLY) {   // the release run's Windows gate
    const {planRun, suiteFacts} = await import('./plan-run.mjs');
    const gate = await planRun({env: {EVENT: 'gate', REPO: repo, SHA: sha, TARGET_REF: process.env.GATE_TAG, GATE_TAG: process.env.GATE_TAG}, ...(await suiteFacts())});
    result = {suites: gate.suites ? gate.suites.split(',') : [], review: gate.review === '1', why: `the release gate for ${process.env.GATE_TAG}: ${gate.suites || 'no suites'}`};
  } else result = plan({only: process.env.ONLY || '', all, mac, sha, review: process.env.REVIEW === '1', previous});
  // A suite that judges what is the same on every OS (quality: the AI's answers) runs on the Mac lane only, unless named by hand (7 Oct 2026).
  if (!process.env.ONLY) {
    const same = [];
    for (const suite of result.suites) { if ((await import(`./suites/${suite}.mjs`).catch(() => ({}))).sameOnEveryOs) same.push(suite); }
    result.suites = result.suites.filter(suite => !same.includes(suite));
  }
  console.error(result.why || `Windows runs ${result.suites.length} suite(s)${mac ? ` after Mac run ${id}, commit ${sha.slice(0, 7)}` : ''}: ${result.suites.join(', ') || 'none'}; AI review: ${result.review ? 'yes' : 'no'}`);
  const shards = {};   // a suite with `shards` runs as one job per slice here too (lib/suite-shards.mjs)
  for (const suite of result.suites) { const count = (await import(`./suites/${suite}.mjs`).catch(() => ({}))).shards; if (count > 1) shards[suite] = count; }
  console.log(`matrix=${JSON.stringify(windowsMatrix(result.suites, shards))}`);
  console.log(`count=${result.suites.length}`);
  console.log(`review=${result.review ? '1' : '0'}`);
}
