// One suite, start to end: open its context, run its steps, leave its artifacts, close; -> {code, skipped}. Called by suite.mjs directly (E2E_REPORT=0) or inside
// Playwright's test runner (report/suite.spec.mjs), which passes `report` so each step is a step of the Playwright HTML report: {step, skipStep, attach}.
// It never exits the process: the caller does (a Playwright worker must not be killed from inside).
// Job: serve stored answers
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {ensureStaged} from './ensure-staged.mjs';
import {refusedQuestions} from './ai-answers.mjs';

export async function runSuite(name, report = null) {
  const {assertNothingQueued, traceFiles} = await import('./app.mjs');
  const {SUITES, openContext} = await import('./context.mjs');
  const {writeFindings, writeReplay, writeSuiteFailures} = await import('./artifacts.mjs');
  const {skipExitCode, skipMessage} = await import('./skip.mjs');
  if (!SUITES.includes(name)) { console.error(`usage: node suite.mjs ${SUITES.join('|')}`); return {code: 2}; }
  ensureStaged(path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..'));   // a suite may import app code that needs desktop/shared/ (apply.mjs: rung2-sketch), which a CI job never staged (21 Oct 2026)
  const suite = await import(`../suites/${name}.mjs`);
  let ctx, code = 0;
  try {
    // Start-up and close-down are one step each in the report, so its top level is the suite's own steps, not Playwright's calls.
    const {keychainChanges, snapshot} = await import('./keychain-guard.mjs');
    const keychainBefore = snapshot();   // the owner's real Keychain, names and dates only (lib/keychain-guard.mjs); null on CI
    const open = () => openContext(name, {engine: suite.engine, fresh: !!suite.fresh, env: suite.env, browser: !!suite.browser, light: !!suite.light, notionProxy: !!suite.notionProxy, telegram: !!suite.telegram, google: !!suite.google, budgetMinutes: suite.budgetMinutes || 0, stepNeeds: suite.stepNeeds ?? null, releases: !!suite.releases, notionStandIn: !!suite.notionStandIn, store: suite.store || '', newInstall: !!suite.newInstall, standInFromWizard: !!suite.standInFromWizard, notionTokenOf: suite.notionTokenOf || '', notionPage: suite.notionPage || '', notion: suite.notion !== false, keepGoing: !!suite.keepGoing, variesPlace: !!suite.variesPlace, report});
    ctx = await (report ? report.step('Start the app and its test services', open) : open());
    if (ctx.skipAll) {
      const message = skipMessage(name, ctx.needs.filter(item => !item.value).map(item => item.name));
      console.log(message);
      return {code: skipExitCode(), skipped: message};
    }
    const runAlways = ctx.run;   // a suite may wrap ctx.run with its own filter (suites/apply.mjs parts): the Keychain check runs whatever the suite picked
    await suite.run(ctx);
    if (keychainBefore) await runAlways('nothing in this Mac\'s real Keychain changed (a test run keeps its secrets in its own file)', async () => {
      const changes = keychainChanges(keychainBefore, snapshot() || new Map());
      if (changes.length) throw new Error(`the real Keychain changed during the run: ${changes.join('; ')}. A test reached it (desktop/lib/keychain.js isolation), or something else on this Mac saved a secret meanwhile: check, then re-run`);
    }, {critical: true});   // critical: an E2E_STEPS filter never skips it
    // A suite that declares `export const realAi = false` answers every AI call with a stand-in: one that reached a real model fails the run (lib/no-real-ai.mjs; test/suite-ai-mode.test.mjs).
    if (suite.realAi === false) await runAlways('no AI call of this suite reached a real model: the stand-in answered or refused every one', async () => { (await import('./no-real-ai.mjs')).assertNoRealAi(ctx); }, {critical: true});
    if (!suite.light) await ctx.run('nothing was queued to report to the product', async () => { assertNothingQueued(ctx.profile); });   // a light suite has no app
    // P7: a request the in-memory Notion does not know is a gap in the stand-in, and the app swallows many such errors (9 Oct 2026: a missing url filter
    // left a form without its kit, three layers away). Each one fails here by name, so the stand-in grows instead of hiding it (lib/notion-fake.mjs).
    if (ctx.standIn) await runAlways('the Notion stand-in answered every request the app made', async () => {
      if (ctx.standIn.stats.unknown.length) throw new Error(`the stand-in did not know: ${ctx.standIn.stats.unknown.join('; ')}`);
    }, {critical: true});
  } catch (error) {
    if (!ctx?.runner.results.some(result => result.status === 'failed')) console.log(`✗ the ${name} suite stopped: ${error.message}`);
    if (ctx) ctx.stopped = error.message;   // the trace is kept (lib/context.mjs)
    code = 1;
  } finally {
    // For the nightly loop, whatever happened: the layout findings so far, and the steps that failed (a suite that stops early used to leave neither).
    // Errors over the whole suite (lib/journey.mjs): added to its findings, so even a suite without layout checks reports a renderer exception.
    if (ctx && !ctx.skipAll && !suite.light) {
      const {journey, journeyFindings} = await import('./journey.mjs');
      const extra = journeyFindings(journey, {suite: name, expectsFailures: !!suite.env?.JOB_PILOTTO_E2E_EXPECTS_FAILURES});
      if (extra.length) { ctx.findings = [...(ctx.findings || []), ...extra]; console.log(`  journey: ${extra.map(item => item.detail).join(' | ')}`); }
      // Accessibility: one finding per axe rule over the suite's pages; a11y.json says what was checked, so the Finder can clear a rule that is gone.
      if (ctx.a11y?.checked) {
        const {a11yFindings} = await import('./a11y.mjs');
        const found = a11yFindings(ctx.a11y);
        if (found.length) ctx.findings = [...(ctx.findings || []), ...found];
        fs.writeFileSync(path.join(ctx.ARTIFACTS, 'a11y.json'), JSON.stringify({checked: ctx.a11y.checked, rules: Object.keys(ctx.a11y.rules || {})}, null, 2));
      }
    }
    if (ctx && !ctx.skipAll) {
      const closeDown = async () => {
      try { if (ctx.findings) writeFindings(ctx); writeSuiteFailures(ctx.ARTIFACTS, name, ctx.runner.results); } catch (error) { console.log(`  (artifacts not written: ${error.message})`); }
      try { await writeReplay(ctx, name); } catch (error) { console.log(`  (replay.json not written: ${error.message})`); }
      await ctx.close();
      };
      await (report ? report.step('Close the app, save the artifacts', closeDown) : closeDown()).catch(error => console.log(`  (close-down: ${error.message})`));
      try { (await import('./ai-meter.mjs')).writeUsage(ctx.ARTIFACTS); } catch (error) { console.log(`  (AI usage not written: ${error.message})`); }   // what this suite paid, for /ai-cost (e2e.yml reports it)
      const refused = refusedQuestions({...process.env, E2E_ARTIFACTS: ctx.ARTIFACTS});
      if (refused.length) { code = 1; ctx.stopped = refused.map(item => item.message).join('; '); console.error(`✗ ${ctx.stopped}`); }
      if (ctx.runner.summary()) code = 1;
      report?.decided?.(code);   // the exit code is known: lib/report.mjs stops a Playwright runner that stays open long after this (6 Oct 2026: wander hung 10 min)
      // The steps and the kept traces as data, for the owner's /admin/e2e page (site/src/e2e-report.js reads it out of the e2e-view-<suite> artifact).
      try { fs.writeFileSync(path.join(ctx.ARTIFACTS, 'steps.json'), JSON.stringify({v: 1, suite: name, results: ctx.runner.results, traces: traceFiles()}, null, 1)); } catch (error) { console.log(`  (steps.json not written: ${error.message})`); }
      // The HTML report: the trace (the report opens it in Playwright's viewer) and the app's logs, on the suite's test.
      if (report) {
        for (const file of traceFiles()) await report.attach('trace', {path: path.join(ctx.ARTIFACTS, file), contentType: 'application/zip'}).catch(() => {});
        for (const log of ['app.log', 'engine.log']) {
          const file = path.join(ctx.ARTIFACTS, 'logs', log);
          if (fs.existsSync(file)) await report.attach(log, {path: file, contentType: 'text/plain'}).catch(() => {});
        }
      }
    }
  }
  return {code, failed: (ctx?.runner?.results || []).filter(result => result.status === 'failed').map(result => `✗ ${result.name}: ${String(result.note || '').slice(0, 400)}`), stopped: ctx?.stopped || ''};
}
