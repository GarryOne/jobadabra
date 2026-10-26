// Builds the code → suite map from one e2e run's coverage files (gate G1b): e2e.yml's coverage-map job, after a scheduled main run or an after-merge run.
//   node coverage-map.mjs --artifacts <dir with coverage-*.json, any depth> [--previous <coverage-map.json>] [--repo <git checkout with both commits>] --out <coverage-map.json>
// A suite this run recorded whole replaces its entry; the others keep the previous map's (an exploring run records only the suites that vary). A suite run for some
// steps only refreshes those, the rest moved to its commit by `git diff` in --repo (default: this checkout). Logic: lib/coverage-pick.mjs. Tests: test/coverage-merge.test.mjs.
import {execFileSync} from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {mergeMap} from './lib/coverage-pick.mjs';

const arg = name => { const i = process.argv.indexOf(name); return i > 0 ? process.argv[i + 1] : ''; };
const walk = dir => (fs.existsSync(dir) ? fs.readdirSync(dir, {withFileTypes: true}).flatMap(e => (e.isDirectory() ? walk(path.join(dir, e.name)) : [path.join(dir, e.name)])) : []);
const read = file => { try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return null; } };

const files = walk(arg('--artifacts')).filter(file => /coverage-.*\.json$/.test(path.basename(file))).map(read).filter(Boolean);
const previous = arg('--previous') ? read(arg('--previous')) : null;
const repo = arg('--repo') || path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const diff = (from, to, paths) => {
  try { return execFileSync('git', ['-C', repo, 'diff', '-U0', '--no-renames', '--no-color', '--no-ext-diff', from, to, '--', ...paths], {encoding: 'utf8', maxBuffer: 256 << 20, stdio: ['ignore', 'pipe', 'pipe']}); }
  catch (error) { console.log(`no diff ${String(from).slice(0, 7)}..${String(to).slice(0, 7)} (${String(error.stderr || error.message).split('\n')[0]}): that suite keeps its entry`); return null; }
};
const map = mergeMap(previous, files, undefined, {diff});
const some = [...new Set(files.filter(file => file.partial).map(file => file.suite))];
if (some.length) console.log(`some steps only (their steps refreshed, the others moved to the run's commit): ${some.join(', ')}`);
fs.mkdirSync(path.dirname(arg('--out')), {recursive: true});
fs.writeFileSync(arg('--out'), JSON.stringify(map));
const suites = Object.keys(map.suites);
console.log(`coverage map: ${files.length} file(s) from this run; ${suites.length} suite(s): ${suites.join(', ')}`);
