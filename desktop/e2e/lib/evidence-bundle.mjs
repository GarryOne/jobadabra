// The evidence bundle of a smoke run: everything a fixer needs to name the blocker without a re-run (jobadabra-cc's post-mortem, 11 Oct 2026: about 40% of every
// fix was a wrong first guess because the first run did not show what the AI was asked, what it answered and what was pressed). One folder per day and shape:
// evidence.md (the four lines that matter), run.log, app.log (the app's whole log) and ai-calls.json (the live page-kind calls and the form-answer calls: fields asked and answer kinds, desktop/lib/live-capture.js).
// Also: a run that was killed or cut short did not finish, and records and uploads nothing (eb's killed Datadog run left a 23 s row). Guard: test/evidence-bundle.test.mjs.
// Job: keep the scorecard
import fs from 'node:fs';
import path from 'node:path';
import {stepFilesIn} from './step-shots.mjs';
import {slug} from './replay-candidate.mjs';
import {WORKER_CONSOLE} from './worker-console.mjs';
import {STATUS_FILE, dropSteps} from './evidence-clean.mjs';

// The capture files a fixer reads, kept by both bundle writers (the plain run's and the Electron leg's): the app's log, its AI calls, the extension's console.
export const CAPTURE_FILES = ['app.log', 'ai-calls.json', WORKER_CONSOLE];

// The run's watch ended by itself (apply-live.mjs prints this line at the end of the watch): a killed or cut-short run never prints it.
export const runFinished = ({output = '', signal = null} = {}) => !signal && /live .{0,14}: watched \d+s; frames in/.test(output);

const CUT = 320, EACH = 8;
const cut = line => line.replace(/^\S+T(\d\d:\d\d:\d\d)\.\d+Z\s*/, '$1 ').replace(/\s+/g, ' ').trim().slice(0, CUT);
// Lines of OUR OWN app's log (never page words): what was asked (page kind, with frames and the digest flag), the digest's validated answer, what was pressed, where the page went.
const PAGE_KIND = /\[extension\] page kind:/, DIGEST = /\[extension\] digest:/;
const PRESSED = /\[extension\] fill: (pressed |closed a popup|no Apply button to press|after the press)/;   // words-ok: our own log's wording, not page text
const WENT_TO = /\[extension\] (fill: (no form on this page|account page|register control|watch ended|form frame)|can't reach the form|page kind: (account|form|account-form))/;   // words-ok: our own log's wording

// The fill's end with the AI's own eligibility verdict and what passed a "no" (extension/eligibility-verdict.js): "judged eligible" is told from "skipped".
const VERDICT = /\[extension\] fill: (filled the form|did not fill)/;   // words-ok: our own log's wording

// -> {pageKind, digest, pressed, wentTo, verdict}: each a list of at most EACH lines, cut and shown from their time.
export function evidenceLines(appLog) {
  const lines = String(appLog || '').split('\n'), pick = pattern => lines.filter(line => pattern.test(line)).map(cut).slice(0, EACH);
  return {pageKind: pick(PAGE_KIND), digest: pick(DIGEST), pressed: pick(PRESSED), wentTo: pick(WENT_TO), verdict: pick(VERDICT)};
}

const section = (title, list) => `## ${title}\n${list.length ? list.map(line => `- ${line}`).join('\n') : '- (none in the app log)'}\n`;

// -> the folder. A part that is missing (no app log, no AI calls) is skipped, never an empty file.
export function writeBundle({dir, day, shape, output = '', appLog = '', aiCalls = '', result = {}, captureDir = '', keepSteps = true, state = ''}) {
  const folder = path.join(dir, day, slug(shape)), lines = evidenceLines(appLog);
  fs.mkdirSync(folder, {recursive: true});
  const shot = captureDir && fs.existsSync(path.join(captureDir, 'end.png')) ? path.join(captureDir, 'end.png') : '';   // the last picture of the application tab (apply-live.mjs): fake applicant only, local, never uploaded
  const step = `reached ${result.reached || 'none'}${result.filled != null ? `, ${result.filled} filled, ${result.left} left` : ''}`;
  const stepShots = captureDir && keepSteps ? stepFilesIn(captureDir) : [];   // a run that works or is held keeps end.png only (lib/evidence-clean.mjs)
  const pictures = `${shot ? `Pictures are full page (the whole page, also a panel that scrolls inside it; a cut says "cut at <n> px" in run.log), local only, with the extension's own panel in them as the person sees it. ${stepShots.length ? `Look at ${stepShots.join(', ')} in order, then end.png (where it stopped).` : 'end.png is the last picture of the application tab: look at it first.'}` : ''}`;
  const text = [`# ${shape}: ${day}`, '', `${step}. Files here: run.log (the run's output), app.log (the app's whole log), ai-calls.json (the page-kind asks and answers, and which fields the AI was asked to answer). ${pictures}`.trim(), '',
    section('Page kind (what was asked, with frames and the digest flag)', lines.pageKind), section('The digest\'s validated answer', lines.digest),
    section('What was pressed', lines.pressed), section('Where the page went', lines.wentTo),
    section('The eligibility verdict (the AI\'s own: aiEligible; what passed a "no": forced)', lines.verdict)].join('\n');
  fs.writeFileSync(path.join(folder, 'evidence.md'), text);
  fs.writeFileSync(path.join(folder, 'run.log'), output);
  if (state) fs.writeFileSync(path.join(folder, STATUS_FILE), JSON.stringify({state}));   // the row's status word, read by the cleanup (lib/evidence-clean.mjs)
  if (appLog) fs.writeFileSync(path.join(folder, 'app.log'), appLog);
  if (aiCalls) fs.writeFileSync(path.join(folder, 'ai-calls.json'), aiCalls);
  if (captureDir) for (const name of CAPTURE_FILES.filter(name => !fs.existsSync(path.join(folder, name)))) { try { fs.copyFileSync(path.join(captureDir, name), path.join(folder, name)); } catch { /* the run did not leave it */ } }
  if (shot) fs.copyFileSync(shot, path.join(folder, 'end.png'));
  for (const name of stepShots) fs.copyFileSync(path.join(captureDir, name), path.join(folder, name));
  if (!keepSteps) dropSteps(folder);   // the Electron leg was saved before the verdict was known: its step pictures go here, once
  return folder;
}

// The paired Electron leg's own evidence (the app log and the end picture its capture folder holds), kept beside the plain run's bundle in <bundle>/electron/, so a row whose
// plain run was refused shows what Electron saw (jobadabra-cc, 11 Oct 2026: the H&M settle dropped a hold and the Electron output was gone). -> the folder, or '' when nothing was kept.
export function saveElectronLeg({dir, day, shape, output = '', captureDir = ''}) {
  const folder = path.join(dir, day, slug(shape), 'electron');
  fs.mkdirSync(folder, {recursive: true});
  fs.writeFileSync(path.join(folder, 'run.log'), output);
  for (const name of [...CAPTURE_FILES, 'end.png', ...stepFilesIn(captureDir)]) {
    try { fs.copyFileSync(path.join(captureDir, name), path.join(folder, name)); } catch { /* the leg did not get that far */ }
  }
  return folder;
}
