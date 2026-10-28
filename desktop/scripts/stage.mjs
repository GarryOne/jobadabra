// Build staging: copies the worker, recipe format and (with --app) the pipeline, config and extension into the app.
//   node scripts/stage.mjs          copy worker/src into shared/worker and the recipe format into shared/ (the app imports them; also run by
//                                   npm start and npm test, so dev and packaged use the same files)
//   node scripts/stage.mjs --files-only   only the plain copies, nothing removed first, no bundle: for code that imports shared/ where the app's
//                                   dependencies are not installed (the e2e tests' own tests on CI's plan job, 9 Oct 2026: esbuild missing failed them)
//   node scripts/stage.mjs --app    also stage build/pilot: what a packaged app runs (the Python
//                                   pipeline, config, tools, docs, the Chrome extension, requirements)
import {execFileSync} from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {forBuild, stamp} from './extension-stamp.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const desktop = path.resolve(here, '..');
const repo = path.resolve(desktop, '..');
const copy = (from, to) => fs.cpSync(path.join(repo, from), to, {recursive: true, filter: src => !/__pycache__|node_modules|\.DS_Store/.test(src)});

const filesOnly = process.argv.includes('--files-only');
// A full staging builds into its own temporary folder and swaps it in at the end (11 Oct 2026: the Stop hook's npm test re-staged while ship.sh's push
// gate ran in the same worktree; the gate's tests saw a half-deleted shared/ and failed in 0 s). --files-only copies over, as before.
const shared = path.join(desktop, 'shared');
const out = filesOnly ? shared : path.join(desktop, `.shared-staging-${process.pid}`);
if (!filesOnly) fs.rmSync(out, {recursive: true, force: true});
copy('worker/src', path.join(out, 'worker'));
// The recipe format, one source for the site, the extension and the app (extension/recipe-schema.js).
fs.copyFileSync(path.join(repo, 'extension', 'recipe-schema.js'), path.join(out, 'recipe-schema.js'));
// The label meanings format (extension/alias-schema.js): the app validates the aliases it passes on and cleans question wording with it.
fs.copyFileSync(path.join(repo, 'extension', 'alias-schema.js'), path.join(out, 'alias-schema.js'));
// The ladder's signals and router (extension/ladder/core.js): the app decides the next rung the same way the extension does.
fs.copyFileSync(path.join(repo, 'extension', 'ladder', 'core.js'), path.join(out, 'ladder-core.js'));
// The fixed endings and the reason class of a control the fill left (extension/ladder/endings.js, control-ending.js): the app turns the panel's cause words into the person card's reason line.
fs.mkdirSync(path.join(out, 'ladder'), {recursive: true});
for (const file of ['endings.js', 'control-ending.js']) fs.copyFileSync(path.join(repo, 'extension', 'ladder', file), path.join(out, 'ladder', file));
if (filesOnly) { console.log('Staged shared/ (files only, no bot bundle)'); process.exit(0); }
// The Telegram bot as ONE file (its Anthropic dependency inside), which the app uploads to the user's own
// Cloudflare account for "Telegram buttons, always on" (lib/telegram-cloud.js).
await (await import('esbuild')).build({entryPoints: [path.join(repo, 'worker', 'src', 'index.js')], bundle: true,
  format: 'esm', platform: 'browser', conditions: ['workerd', 'worker', 'browser'], target: 'es2022', minify: true,
  nodePaths: [path.join(desktop, 'node_modules')], outfile: path.join(out, 'bot-worker.js'), logLevel: 'warning'});
// The swap: two renames, so a reader never sees a half-built shared/ (only the instant between them); the old copy is removed afterwards.
const old = `${shared}.old-${process.pid}`;
if (fs.existsSync(shared)) fs.renameSync(shared, old);
fs.renameSync(out, shared);
fs.rmSync(old, {recursive: true, force: true});

if (process.argv.includes('--app')) {
  const pilot = path.join(desktop, 'build', 'pilot');
  const python = path.join(pilot, 'python');
  const keepPython = fs.existsSync(python) ? fs.mkdtempSync(path.join(desktop, 'build', 'py-')) : null;
  if (keepPython) fs.renameSync(python, path.join(keepPython, 'python')); // the Python runtime is staged separately (CI)
  fs.rmSync(pilot, {recursive: true, force: true});
  fs.mkdirSync(pilot, {recursive: true});
  for (const item of ['src', 'config', 'tools', 'extension', 'templates', 'requirements.txt', 'requirements-transcribe.txt']) copy(item, path.join(pilot, item));
  for (const file of ['extension-copy.mjs', 'extension-storage.mjs', 'live.mjs']) copy(`hosted/ready-fill/${file}`, path.join(pilot, 'hosted', 'ready-fill', file));
  // The extension's version is stamped here, never in a PR (scripts/extension-stamp.mjs): a shallow clone without EXTENSION_VERSION fails the build.
  const extensionVersion = forBuild();
  stamp(path.join(pilot, 'extension'), extensionVersion);
  console.log(`Extension version ${extensionVersion}`);
  for (const doc of ['notion-profile-template.md', 'job-pilotto-guide.md']) copy(`docs/${doc}`, path.join(pilot, 'docs', doc));
  // The skill Apply with Claude sessions follow: they start in this folder, where Claude Code finds .claude/skills.
  copy('.claude/skills/apply-to-job', path.join(pilot, '.claude', 'skills', 'apply-to-job'));
  if (keepPython) { fs.renameSync(path.join(keepPython, 'python'), python); fs.rmSync(keepPython, {recursive: true}); }
  // AudioTee (scripts/audiotee.sh): the call's audio recorder, at pilot/bin/audiotee in the app.
  const audiotee = path.join(desktop, 'build', 'bin', 'audiotee');
  if (fs.existsSync(audiotee)) {
    fs.mkdirSync(path.join(pilot, 'bin'), {recursive: true});
    fs.copyFileSync(audiotee, path.join(pilot, 'bin', 'audiotee'));
    fs.chmodSync(path.join(pilot, 'bin', 'audiotee'), 0o755);
    const license = `${audiotee}.LICENSE`;
    if (fs.existsSync(license)) fs.copyFileSync(license, path.join(pilot, 'bin', 'audiotee.LICENSE'));
  } else console.log('AudioTee not built (scripts/audiotee.sh): the app records the call through screen capture');
  console.log(`Staged ${pilot}`);
  // Which build this is, for the About box and the sidebar: CI's run number (the release's build N) and commit.
  let commit = (process.env.GITHUB_SHA || '').slice(0, 7);
  try { commit ||= execFileSync('git', ['rev-parse', '--short=7', 'HEAD'], {cwd: repo}).toString().trim(); } catch {}
  const info = {build: process.env.GITHUB_RUN_NUMBER || 'local', commit, date: new Date().toISOString().slice(0, 10), at: new Date().toISOString()};
  fs.writeFileSync(path.join(desktop, 'build-info.json'), JSON.stringify(info, null, 2) + '\n');
  console.log(`Build info: build ${info.build}, ${info.commit}`);
}
console.log('Staged shared/worker');
