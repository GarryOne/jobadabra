// Replay candidates (owner, 10 Oct 2026, after a form filled 4 of 13 and nothing was kept to fix it from): when a nightly smoke run fails, its final page is saved, scrubbed, with what the run saw, as
// the start of a fixed-site replay. It owns: which results are worth saving, and the folder written per failing shape. Used by record-sites.mjs after each site; the page itself is snapshotted in the live
// run (apply-live.mjs, structure only, scrubbed). The folder is on this Mac (<QA folder>/replay-candidates/<day>/<shape>/), never the public repo: a person promotes a candidate to
// desktop/e2e/recorded/ only when they fix the shape, with the AI answers of the failing run, and it must fail on the build before the fix (skill fix-recorded-sites). Guard: test/replay/replay-candidate.test.mjs.
import fs from 'node:fs';
import path from 'node:path';
import {seedVersion} from './applicant-seed.mjs';
import {stepFilesIn} from './step-shots.mjs';

// A failure worth keeping: a form reached with a shortfall, or a run that stopped before the form (not a documented hold: a code or bot check, nor a posting gone).
export const worthSaving = result => !!result && !result.note && (!!result.short || ['none', 'posting', 'account'].includes(result.reached));

export const slug = text => String(text).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60) || 'site';

// Writes <dir>/<day>/<slug>/{page.html, case.json}; returns the folder, or null when there is no page. The address keeps no query or fragment.
// captureDir (the live run's capture, lib/capture-journey.mjs): every page under its own address (journey.json + pages/), the stylesheets (styles.har.json) and the
// model answers (model-memo.json) are copied; the journey then replaces the single last page. Without it: the last page, as before.
// The extension's presses in the app's log (our own wording: "pressed ..." and "closed a popup"), in order. -> [{at (ms), what, label}]
const PRESS = /^(\S+Z) \[extension\] [a-z-]+: ((?:pressed [^{:]*?|closed a popup))(?::[^{]*)?\s*(\{.*\})?\s*$/;   // words-ok: our own log's wording, not page text
export function livePresses(appLog) {
  return String(appLog || '').split('\n').map(line => line.match(PRESS)).filter(Boolean).map(([, at, what, fields]) => {
    let label = '';
    try { label = String(JSON.parse(fields || '{}').label || ''); } catch { /* a line cut at its limit */ }
    return {at: Date.parse(at), what: what.trim(), label};
  });
}

export function saveCandidate({dir, day, shape, result, html, output = '', aiCalls = '', captureDir = '', appLog = '', always = false}) {   // always: a passing row too (RECORD_KEEP_CANDIDATES=1: a row replay's trust check needs rows that pass)
  const journey = (() => { try { return JSON.parse(fs.readFileSync(path.join(captureDir, 'journey.json'), 'utf8')); } catch { return null; } })();
  if ((!html && !journey?.length) || (!always && !worthSaving(result))) return null;
  const folder = path.join(dir, day, slug(shape)), address = String(result.url || '').replace(/[?#].*$/, '');
  fs.rmSync(folder, {recursive: true, force: true});   // a capture again starts from an empty folder: a page, presses or answers of an older run (Lever pages/4.html from 16:25 beside a new 1-3) never mix in
  fs.mkdirSync(folder, {recursive: true});
  if (journey?.length) {
    fs.rmSync(path.join(folder, 'page.html'), {force: true});
    fs.cpSync(path.join(captureDir, 'pages'), path.join(folder, 'pages'), {recursive: true});
    for (const name of ['styles.har.json', 'model-memo.json']) if (fs.existsSync(path.join(captureDir, name))) fs.copyFileSync(path.join(captureDir, name), path.join(folder, name));
  } else fs.writeFileSync(path.join(folder, 'page.html'), html);
  if (captureDir && fs.existsSync(path.join(captureDir, 'end.png'))) fs.copyFileSync(path.join(captureDir, 'end.png'), path.join(folder, 'end.png'));
  for (const name of captureDir ? stepFilesIn(captureDir) : []) fs.copyFileSync(path.join(captureDir, name), path.join(folder, name));   // and its step pictures, in order   // the live run's last picture, beside the replay's end-replay.png (local QA folder, never uploaded)
  const presses = livePresses(appLog);   // what the live run pressed, in order: a row replay follows the live run's states after each (lib/row-replay.mjs)
  if (presses.length) fs.writeFileSync(path.join(folder, 'presses.json'), `${JSON.stringify(presses, null, 1)}\n`);
  try { if (Array.isArray(JSON.parse(aiCalls))) fs.writeFileSync(path.join(folder, 'ai-calls.json'), aiCalls); } catch { /* the app kept none (no LIVE_CAPTURE_DIR, or an unreadable file): none kept */ }   // the app's live page-kind calls, scrubbed where they were written
  const pageKinds = String(output).split('\n').filter(line => /page kind/.test(line)).map(line => line.trim().slice(0, 400)).slice(0, 20);
  const item = {
    origin: 'captured',   // the pages a live run saved (scrubbed): a case made from it keeps it (lib/recorded-origin.mjs)
    shape: `${shape}: ${result.short ? `a form reached with ${(result.short.miss || 0) + (result.short.noSuggestion || 0)} unexplained of ${result.short.total} asked fields` : `a run that stopped at the ${result.reached}`} (auto-saved, TODO: the shape in words)`,
    why: `auto-saved by the smoke run of ${day}: reached ${result.reached}${result.filled != null ? `, ${result.filled} filled, ${result.left} left` : ''}`,
    sample: address ? new URL(address).host : '',
    pages: journey?.length ? journey : [{url: address, file: 'page.html'}],
    ai: {},   // TODO when promoted: the AI's real answers of the failing run (from evidence.pageKinds), never written to fit a fix
    expect: {},
    run: {day, reached: result.reached, filled: result.filled, left: result.left, short: result.short || null, path: result.path || [], fields: result.fieldList || []},
    evidence: {pageKinds},
    seed: seedVersion(),   // the applicant the run's app held (lib/applicant-seed.mjs): a replay names a capture made with another
  };
  fs.writeFileSync(path.join(folder, 'case.json'), `${JSON.stringify(item, null, 1)}\n`);
  return folder;
}

// Keeps the day's folder to the failing shapes of today's runs only (a shape that passed on a later run drops its older candidate).
export function dropCandidate({dir, day, shape}) { fs.rmSync(path.join(dir, day, slug(shape)), {recursive: true, force: true}); }
