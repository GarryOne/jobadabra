// The files a recorded replay loads, found by structure (owner, 12 Oct 2026): the extension's files reached from its manifest (service worker, content scripts,
// pages) through imports and the file lists it names (PAGE_FILES), and the app modules the offline app runs (desktop/lib reached from desktop/e2e/lib/offline-app-child.mjs).
// tools/recorded-cases.mjs asks a recorded page for a change to any of them. No hand list: a new file is covered once something imports it. Guard: desktop/test/recorded-cases.test.js.
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath, pathToFileURL} from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

// Every quoted string in a source that names a code file; the caller resolves it.
const quoted = text => [...text.matchAll(/['"`]([\w@./-]+\.(?:m?js|json))['"`]/g)].map(found => found[1]);

// -> Set of repo-relative files reached from `roots` (repo-relative). resolve(spec, fromFile) -> candidate repo-relative paths.
function closure(root, roots, resolve, keep) {
  const seen = new Set(), todo = [...roots];
  while (todo.length) {
    const file = todo.pop();
    if (seen.has(file) || !fs.existsSync(path.join(root, file)) || !fs.statSync(path.join(root, file)).isFile()) continue;
    seen.add(file);
    if (!/\.m?js$/.test(file)) continue;
    for (const spec of quoted(fs.readFileSync(path.join(root, file), 'utf8'))) for (const next of resolve(spec, file)) if (keep(next) && !seen.has(next)) todo.push(next);
  }
  return seen;
}

export function manifestFiles(manifest) {
  const scripts = [manifest.background?.service_worker, ...(manifest.content_scripts || []).flatMap(one => one.js || [])];
  const pages = [manifest.action?.default_popup, manifest.options_page, manifest.options_ui?.page].filter(Boolean);
  return [...scripts, ...pages].filter(Boolean);
}

export function replayFiles(root = ROOT) {
  const manifest = JSON.parse(fs.readFileSync(path.join(root, 'extension/manifest.json'), 'utf8'));
  const inExtension = spec => (spec.startsWith('.') ? null : `extension/${spec}`);
  const extension = closure(root, manifestFiles(manifest).filter(file => /\.m?js$/.test(file)).map(file => `extension/${file}`), (spec, from) => [
    inExtension(spec), path.posix.join(path.posix.dirname(from), spec)].filter(Boolean), file => file.startsWith('extension/') && !/manifest\.json$|fingerprint\.json$/.test(file));
  const app = closure(root, ['desktop/e2e/lib/offline-app-child.mjs'], (spec, from) => (spec.startsWith('.') ? [path.posix.join(path.posix.dirname(from), spec)] : []), file => file.startsWith('desktop/lib/') || file === 'desktop/e2e/lib/offline-app-child.mjs');
  app.delete('desktop/e2e/lib/offline-app-child.mjs');
  return new Set([...extension, ...app]);
}

// The harness files a runner reaches from `entry` (desktop/e2e/...): what it imports and the scripts it starts by path, found the same way.
export function harnessFiles(entry, root = ROOT) {
  // A bare name is tried beside the file too (offline-app.mjs starts path.join(here, 'offline-app-child.mjs')), and as a repo path.
  return closure(root, [entry], (spec, from) => [path.posix.join(path.posix.dirname(from), spec), ...(spec.startsWith('.') ? [] : [spec])], file => file.startsWith('desktop/'));
}

// FLOW_FILES as written in desktop/e2e/flows.mjs (read, not imported: this file stays synchronous): every quoted repo path of the list.

// What each replay job of a pull request loads (a folder ends with /): the whole extension (its manifest and data files load too),
// the app modules above, the job's pages and its runner's files. A change to none of them cannot change what the job replays.
export function jobFiles(job, root = ROOT) {
  const loaded = ['extension/', ...replayFiles(root)];
  if (job === 'replays') return new Set([...loaded, 'desktop/e2e/recorded/', ...harnessFiles('desktop/e2e/test/recorded-pages.test.mjs', root)]);
  if (job === 'zoo') return new Set([...loaded, 'desktop/e2e/widget-zoo/', ...harnessFiles('desktop/e2e/widget-zoo.mjs', root)]);
  if (job === 'sites') return new Set(loaded);   // the recordings come from the release, not the repo; the steps' scripts are added below
  throw new Error(`no replay job ${job}: replays, zoo or sites`);
}

// A replay workflow's files (owner, 14 Oct 2026: a PR that changed the recorder and the upload ran every page case, `desktop/e2e/**`): its job's files plus every script
// its steps start with `node` (read from the workflow, in the step's working-directory). Its `on: pull_request: paths:` lists exactly these, as written by pathEntries.
// The PR site replays too (owner, 14 Oct 2026: a PR that changes the replay machinery, e.g. net-record.mjs or replay-gate.mjs, starts them as well as the apply flow's code).
export const WORKFLOW_JOB = {'page-cases.yml': 'replays'};   // control-tests.yml: off PRs since 26 Oct 2026 (no paths to keep)
export function workflowFiles(workflow, root = ROOT) {
  const files = new Set(jobFiles(WORKFLOW_JOB[workflow], root));
  let dir = '';
  for (const line of fs.readFileSync(path.join(root, '.github/workflows', workflow), 'utf8').split('\n')) {
    const at = line.match(/working-directory:\s*(\S+)/);
    if (at) dir = at[1];
    const run = !line.includes('replay-files.mjs --check') && line.match(/\b(?:node (?:--\S+\s+)*([\w./-]+\.mjs)|bash ([\w./-]+\.sh))\b/);   // its own list check is not what it replays
    if (run) run[1] ||= run[2];
    if (run) for (const file of harnessFiles(path.posix.join(dir, run[1]), root)) files.add(file);
  }
  return withSharedSources(files, root);
}

// desktop/shared is generated (stage.mjs, gitignored): present in CI, maybe not here. Its sources stand in: shared/worker/<f> is worker/src/<f> (and what it imports),
// the rest are extension files (extension/** is listed whole).
export function withSharedSources(files, root = ROOT) {
  const texts = [...files].filter(file => /\.m?js$/.test(file) && fs.existsSync(path.join(root, file))).map(file => fs.readFileSync(path.join(root, file), 'utf8')).join('\n');
  const worker = [...texts.matchAll(/shared\/worker\/([\w./-]+\.js)/g)].map(found => `worker/src/${found[1]}`);
  for (const file of [...files]) if (file.startsWith('desktop/shared/')) files.delete(file);
  for (const file of closure(root, worker, (spec, from) => [path.posix.join(path.posix.dirname(from), spec)], file => file.startsWith('worker/src/'))) files.add(file);
  return files;
}

// The `paths:` entries for a set of files: the extension and the app modules as whole folders (all of them load), a folder as `<folder>**`, any other file by name.
export function pathEntries(files) {
  const entries = new Set([...files].map(file => (/^(extension|desktop\/lib)\//.test(file) ? file.split('/').slice(0, file.startsWith('extension') ? 1 : 2).join('/') + '/**' : file.endsWith('/') ? `${file}**` : file)));
  return [...entries].sort();
}

// A workflow's `on: pull_request: paths:` as written (the install files beside the generated list: package.json/lock, the workflow itself).
export const INSTALL = /^(desktop\/(e2e\/)?package(-lock)?\.json|\.github\/workflows\/[\w-]+\.yml|\.github\/actions\/playwright-browser\/\*\*)$/;
export function listedPaths(workflow, root = ROOT) {
  const text = fs.readFileSync(path.join(root, '.github/workflows', workflow), 'utf8');
  const start = text.indexOf('  pull_request:'), end = text.slice(start).search(/\n  [a-z_]+:/);
  return [...text.slice(start, end < 0 ? undefined : start + end).matchAll(/^\s+- '([^']+)'/gm)].map(found => found[1]);
}

const [flag, value] = process.argv.slice(2);
const MAIN = Boolean(process.argv[1]) && import.meta.url === pathToFileURL(process.argv[1]).href;   // run directly (a file URL, so Windows paths compare too)
const entries = workflow => pathEntries(workflowFiles(workflow));
if (MAIN && flag === '--job') console.log([...jobFiles(value)].sort().join('\n'));
// --check <workflow>: the workflow's first step (owner, 14 Oct 2026: "wouldn't we miss newly added modules?"). A new file loads only through an edit to a
// listed one, which starts the workflow, which then checks its own list: missing or extra entries fail with the line to run.
if (MAIN && flag === '--check') {
  const listed = listedPaths(value), wanted = entries(value);
  const missing = wanted.filter(entry => !listed.includes(entry)), extra = listed.filter(entry => !wanted.includes(entry) && !INSTALL.test(entry));
  if (missing.length || extra.length) {
    console.log(`${value}: its pull_request paths drifted from what it loads. Missing: ${missing.join(', ') || 'none'}. Extra: ${extra.join(', ') || 'none'}.\nRun: node tools/replay-files.mjs --paths ${value} and put the list in its paths.`);
    process.exit(1);
  }
  console.log(`${value}: its pull_request paths list everything it loads (${wanted.length} entries)`);
}
if (MAIN && flag === '--paths') console.log(entries(value).map(entry => `      - '${entry}'`).join('\n'));
