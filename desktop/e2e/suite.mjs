// Runs one suite of the end-to-end tests:   node suite.mjs wizard|jobs|interviews|settings
// A suite may export `env` (extra environment for the app) and `fresh` (empty its Notion page first).
// Each suite has its own Notion test page and starts from its own state (see README.md), so suites can run at the same time.
const name = process.argv[2];
// The CI matrix is built from the suites that exist:   node suite.mjs --list
if (name === '--list') {
  const {default: path} = await import('node:path'), {fileURLToPath} = await import('node:url');
  (await import('./lib/ensure-staged.mjs')).ensureStaged(path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..'));   // suites/apply.mjs loads app code that needs the gitignored desktop/shared/: without it every Windows run on main died here (24-25 Oct 2026)
  const {SUITES: all} = await import('./lib/context.mjs');
  const {suitesFor, suitesNamed} = await import('./lib/plan.mjs');
  const option = flag => { const at = process.argv.indexOf(flag); return at < 0 ? null : process.argv[at + 1] || ''; };
  // --changed: the changed files, one per line on stdin (a push); --only a,b: a manual run's choice; neither: every suite.
  const {autoSuites, cadenceOf} = await import('./lib/plan.mjs');
  const cadence = {}, watches = {};
  for (const suite of all) { const module = await import(`./suites/${suite}.mjs`); if (cadenceOf(suite, module)) cadence[suite] = cadenceOf(suite, module); if (module.watches) watches[suite] = module.watches; }
  const named = option('--only');
  const chosen = process.argv.includes('--changed') ? suitesFor((await import('node:fs')).readFileSync(0, 'utf8').split('\n'), all, {watches, cadence}) : named ? suitesNamed(named, all) : autoSuites(all, cadence);
  const include = [];
  const {runnerOf} = await import('./lib/plan.mjs');
  for (const suite of chosen) { const module = await import(`./suites/${suite}.mjs`); include.push({suite, minutes: module.minutes || 15, os: runnerOf(module)}); }
  console.log(JSON.stringify({include}));
  process.exit(0);
}
// One heavy run at a time on this Mac (tools/heavy-lock.sh). This outer process takes the lock's status only when the run behind it left its done marker (lib/suite-done.mjs).
const done = await import('./lib/suite-done.mjs');
if (!process.env.JP_HEAVY_HELD) done.clearDone();
(await import('./lib/heavy.mjs')).heavy(`e2e-${name}`, import.meta.url, {exit: status => process.exit(done.verdict(status))});
process.env.JOB_PILOTTO_E2E_SUITE = name;   // the app tags its Sentry reports with it (lib/sentry.js e2eTags)
process.env.JOB_PILOTTO_E2E_PLANTED_FILE ||= (await import('node:path')).join((await import('node:os')).tmpdir(), `jp-e2e-planted-${name}-${process.pid}.log`);   // the fakes write here when they plant a failure (lib/planted.mjs); the app's Sentry reporter reads it
process.env.E2E_SUITE = name;   // read when lib/app.mjs loads: each suite writes its own artifacts folder
// A hard stop for the whole process (6 Oct 2026: a Windows jobs suite ran 14+ min after its last step failed: something outside the steps hung, closing the app
// or a test server). The runner cuts steps at the 7-minute budget; nothing may outlive it by more than 3 minutes. unref: a suite that ends earlier exits as usual.
{
  const {budgetMsOf} = await import('./lib/runner.mjs');
  const stopAt = budgetMsOf(await import(`./suites/${name}.mjs`).catch(() => null)) + 3 * 60000;   // the suite's own budget (budgetMinutes) + 3 min
  setTimeout(() => {
    console.log(`✗ the ${name} suite was still running ${Math.round(stopAt / 60000)} min after it started: stopped by force (something outside the steps hung: closing the app, a test server, or writing artifacts)`);
    process.exit(1);
  }, stopAt).unref();
}
// The Playwright HTML report (6 Oct 2026, owner: the GitHub logs and our own page did not help to debug): the suite runs inside Playwright's test runner
// (lib/report.mjs, report/suite.spec.mjs), each step a step of the report with a screenshot, the trace and the logs attached; the exit code is the suite's own,
// so run-all.mjs and the workflows are unchanged. E2E_REPORT=0 runs it directly, as before.
if (process.env.E2E_REPORT !== '0' && !process.env.E2E_IN_REPORT) {
  const {runInReport} = await import('./lib/report.mjs');
  const reported = await runInReport(name);
  done.markDone(reported);
  process.exit(reported);
}
const {runSuite} = await import('./lib/suite-main.mjs');
const {code} = await runSuite(name);
done.markDone(code);
// The app and Playwright can leave handles open: exit explicitly, never hang a CI job.
process.exit(code);
