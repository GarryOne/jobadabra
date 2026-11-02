// The captures library (capture once, measure many: spec docs/superpowers/specs/2026-10-13-capture-once-measure-many.md): EVERY live pool visit, passing or
// failing, keeps its whole journey (lib/replay-candidate.mjs saveCandidate: pages, styles, model answers, presses, AI calls) plus its app log, the build that
// made it and the live result, under <root>/<day>/<row>/, so `npm run measure` can re-run any build on it offline, with no site visit. Mac: <QA folder>/captures
// (outside the repo); CI: RECORD_CAPTURES, uploaded as the 30-day artifact pool-captures-<run> (owner, 13 Oct 2026). Days older than 30 are pruned (owner).
// Used by record-sites.mjs and live.mjs. Guard: e2e/test/capture-library.test.mjs.
// Job: serve stored answers
import {execFileSync} from 'node:child_process';
import {recordVar} from '../../../tools/record-env.mjs';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {extensionVersion} from './applying-report.mjs';
import {saveCandidate, slug} from './replay-candidate.mjs';

export const KEEP_DAYS = 30;
export const capturesRoot = () => recordVar('CAPTURES') || path.join(os.homedir(), 'Library/Application Support/Job Pilotto QA', 'captures');
const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');

// The build a capture was made with: the commit (CI's GITHUB_SHA first) and the extension's stamped version.
export function buildStamp(top = repo) {
  let commit = process.env.GITHUB_SHA || '';
  if (!commit) { try { commit = execFileSync('git', ['-C', top, 'rev-parse', 'HEAD'], {encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore']}).trim(); } catch { /* not a checkout */ } }
  return {commit, extension: extensionVersion()};   // the version this checkout's build stamps (lib/applying-report.mjs)
}

// Removes the day folders (YYYY-MM-DD) older than `days` before `today`. -> the days removed.
export function pruneCaptures(root, {today = new Date().toISOString().slice(0, 10), days = KEEP_DAYS} = {}) {
  const limit = Date.parse(today) - days * 86400000, gone = [];
  let names = [];
  try { names = fs.readdirSync(root); } catch { return gone; }
  for (const name of names.filter(one => /^\d{4}-\d\d-\d\d$/.test(one) && Date.parse(one) < limit)) { fs.rmSync(path.join(root, name), {recursive: true, force: true}); gone.push(name); }
  return gone;
}

// One live visit's capture into the library, whatever its result. -> the folder, or null when the run kept no page.
// The run settings a live visit is made with: a replay must use the same ones to give the same asks (13 Oct 2026: a grown-applicant capture replayed as the thin one missed
// its form answer). Each: how a live run's env records it, and the env a replay sets from it (null: shown only, a kept answer stands for it; `only`: the one value a replay can use).
export const RUN_SETTINGS = {
  applicant: {recorded: env => env.JP_APPLICANT || 'thin', replayEnv: 'JP_APPLICANT'},
  model: {recorded: env => env.JOBADABRA_MODEL_OVERRIDE || 'default', replayEnv: 'JOBADABRA_MODEL_OVERRIDE'},
  engine: {recorded: env => env.LIVE_ENGINE || (env.CI ? 'api' : 'cli'), replayEnv: null},
  store: {recorded: env => env.JOBADABRA_STORE || 'sqlite', replayEnv: null, only: 'sqlite'},
};
export const runSettings = (env = process.env) => Object.fromEntries(Object.entries(RUN_SETTINGS).map(([name, setting]) => [name, setting.recorded(env)]));

export function keepCapture({root = capturesRoot(), day, shape, result, output = '', aiCalls = '', captureDir, appLog = '', build = buildStamp(), settings = runSettings(), at = new Date().toISOString()}) {
  // Each visit its own folder (<row>-<hhmmss>): a row visited twice in a day keeps both (saveCandidate empties a folder it writes again).
  const folder = saveCandidate({dir: root, day, shape: `${slug(shape).slice(0, 50)}-${at.slice(11, 19).replace(/:/g, '')}`, result, html: '', output, aiCalls, captureDir, appLog, always: true});
  if (!folder) return null;
  if (appLog) fs.writeFileSync(path.join(folder, 'app.log'), appLog);   // the live side of the positive control: measure parses it as it parses a replay's
  fs.writeFileSync(path.join(folder, 'capture.json'), `${JSON.stringify({row: shape, at, build, settings, result: result || null}, null, 1)}\n`);
  pruneCaptures(root, {today: day});
  return folder;
}

// A downloaded CI artifact (pool-captures-<run>: <day>/<row>/ with capture.json) merged into the library: a capture already there is kept as it is. -> the rows added (<day>/<row>)
export function mergePulled(from, root = capturesRoot()) {
  const added = [];
  let days = [];
  try { days = fs.readdirSync(from).filter(name => /^\d{4}-\d\d-\d\d$/.test(name)); } catch { return added; }
  for (const day of days) for (const name of fs.readdirSync(path.join(from, day))) {
    const source = path.join(from, day, name), target = path.join(root, day, name);
    if (!fs.existsSync(path.join(source, 'capture.json')) || fs.existsSync(target)) continue;
    fs.mkdirSync(path.dirname(target), {recursive: true});
    fs.cpSync(source, target, {recursive: true});
    added.push(`${day}/${name}`);
  }
  return added;
}
