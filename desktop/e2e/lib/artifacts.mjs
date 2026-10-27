/* global document */
// What a suite leaves behind for the UI loop (ui-findings.yml), written even when the suite stops at a failing step: its layout findings so far, and which steps failed.
import fs from 'node:fs';
import path from 'node:path';

// The layout findings collected so far (a suite that stops early used to leave none, hiding that night's findings).
export function writeFindings(ctx) {
  fs.writeFileSync(path.join(ctx.ARTIFACTS, 'ui-findings.json'), JSON.stringify(ctx.findings || [], null, 2));
}

// replay.json, every run, every suite (lib/replay.mjs): how this run walked, so each issue it files can say how it was found and how to walk the same path again. Called before the app
// closes, so the window and the theme are the ones the run ended with; whatever is missing (a closed page, a light suite) is left out, never a reason to lose the file.
export async function writeReplay(ctx, suite, env = process.env) {
  const {buildReplay, replayFromSeed} = await import('./replay.mjs');
  const {createVariation} = await import('./variation.mjs');
  let seedFile = null;
  try { seedFile = JSON.parse(fs.readFileSync(path.join(ctx.ARTIFACTS, 'seed.json'), 'utf8')); } catch { seedFile = null; }
  let window = seedFile?.window || null, theme = '';
  try {
    const seen = await ctx.page?.evaluate(() => ({w: window.innerWidth, h: window.innerHeight, theme: document.documentElement.dataset.theme || (window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light')}));
    if (seen) { window = window || [seen.w, seen.h]; theme = seen.theme; }
  } catch { /* the page is gone: the window of the seed file, if any */ }
  const vary = ctx.vary || createVariation(env);
  const fromSeed = seedFile ? replayFromSeed(seedFile, {suite, env}) : null;
  const replay = buildReplay({suite, env, vary: seedFile ? {seed: fromSeed.seed, fixed: fromSeed.mode === 'fixed'} : vary, place: ctx.place || null, window, theme, trail: ctx.runner?.results || [], path: ctx.replayPath || null, detail: seedFile?.detail || ''});
  fs.mkdirSync(ctx.ARTIFACTS, {recursive: true});
  fs.writeFileSync(path.join(ctx.ARTIFACTS, 'replay.json'), JSON.stringify(replay, null, 2));
  // seen-passing.json: every step this suite ever passed here; replay.json holds only the last run, so a later filtered run would erase the proof the push hook asks for.
  try {
    const {mergeSeen} = await import('./new-steps.mjs');
    const file = path.join(ctx.ARTIFACTS, 'seen-passing.json');
    let old = {};
    try { old = JSON.parse(fs.readFileSync(file, 'utf8')); } catch { old = {}; }
    fs.writeFileSync(file, JSON.stringify(mergeSeen(old, replay.trail), null, 2));
  } catch (error) { console.log(`  (seen-passing.json not written: ${error.message})`); }
  return replay;
}

// The steps that failed, as records the loop files as issues (message cut to a readable length).
export const failureRecords = (suite, results) => results.filter(result => result.status === 'failed')
  .map(result => ({suite, step: result.name, message: String(result.note || '').slice(0, 600), ...(result.where ? {where: result.where} : {}), ...(result.environment ? {environment: true} : {})}));

// Why (#2266, 27 Oct 2026): apply's last step threw "Unexpected end of JSON input" once and the record named no file, so its source stayed unknown.
/**
 * Where an unexpected error (a SyntaxError, TypeError…, never a step's own `Error`) came from: its first frame in our code, repo-relative.
 * @param {unknown} error  @returns {string} e.g. "desktop/e2e/lib/seed-data.mjs:30:25", or '' for a plain Error or no frame of ours
 */
export function codeLine(error) {
  if (!(error instanceof Error) || error.constructor === Error) return '';
  const frame = String(error.stack || '').split('\n').map(line => /\/((?:desktop|extension|worker|tools|src)\/[^\s):]+:\d+:\d+)/.exec(line)?.[1]).find(Boolean);
  return frame || '';
}

// GitHub annotation lines for the failed steps (at most 3), titled "<suite> · <step>" with the step's first line: ci-alert.mjs stepCauses quotes them.
// Why (27 Oct 2026, 6e): main's quality red alerted "the steps merge e7ab156 touched" while its step said "AI question(s) had no recorded answer" (#2234).
const escapeData = text => String(text).replace(/%/g, '%25').replace(/\r/g, '%0D').replace(/\n/g, '%0A');
const escapeProperty = text => escapeData(text).replace(/:/g, '%3A').replace(/,/g, '%2C');
export const annotationLines = records => records.slice(0, 3)
  .map(record => `::error title=${escapeProperty(`${record.suite} · ${record.step}`)}::${escapeData(String(record.message || '').split('\n')[0].slice(0, 300) || 'failed')}`);

// suite-failures.json, every run: the failed steps, or an empty list; on GitHub also one annotation per failed step.
export function writeSuiteFailures(dir, suite, results, env = process.env) {
  fs.mkdirSync(dir, {recursive: true});
  const records = failureRecords(suite, results);
  fs.writeFileSync(path.join(dir, 'suite-failures.json'), JSON.stringify(records, null, 2));
  if (env.GITHUB_ACTIONS === 'true') for (const line of annotationLines(records)) console.log(line);
}
