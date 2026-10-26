// Which e2e suites a PR runs (lib/pr-suites.mjs): the table of suites that quote UI text it removes, and with --plan the suites pr-suites.yml starts and waits for (they block the merge since 26 Oct 2026, gate G1a). Always exits 0: the e2e run decides.
//   node pr-suites.mjs --base origin/main          the table
//   node pr-suites.mjs --base origin/main --plan   also: `suites=a,b` for the PR run (workflow pr-suites.yml; needs the staged app files and installs, like e2e.yml's plan)
import fs from 'node:fs';
import path from 'node:path';
import {execFileSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {removedStrings, suitesExpecting, report, planPrSuites} from './lib/pr-suites.mjs';
import {suitesFor} from './lib/plan.mjs';
import {suitesUsing} from './lib/import-graph.mjs';
import {hunksFromDiff, mapShas, suitesCovering} from './lib/coverage-pick.mjs';
import os from 'node:os';

const here = path.dirname(fileURLToPath(import.meta.url));
const base = process.argv[process.argv.indexOf('--base') + 1] || 'origin/main';
const git = args => execFileSync('git', args, {cwd: here, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024});
// The code → suite map (gate G1b): --map <file>, else the newest `e2e-coverage-map` artifact (e2e.yml's coverage-map job after a scheduled main run). None yet: {}.
function loadMap() {
  const file = process.argv.includes('--map') ? process.argv[process.argv.indexOf('--map') + 1] : '';
  try {
    if (file) return JSON.parse(fs.readFileSync(file, 'utf8'));
    const repo = process.env.GITHUB_REPOSITORY;
    if (!repo) return {};
    const run = execFileSync('gh', ['api', `repos/${repo}/actions/artifacts?name=e2e-coverage-map&per_page=1`, '--jq', '.artifacts[0].workflow_run.id // ""'], {encoding: 'utf8'}).trim();
    if (!run) return {};
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'jp-coverage-'));
    execFileSync('gh', ['run', 'download', run, '-R', repo, '-n', 'e2e-coverage-map', '-D', dir], {stdio: 'ignore'});
    return JSON.parse(fs.readFileSync(path.join(dir, 'coverage-map.json'), 'utf8'));
  } catch (error) { console.log(`pr-suites: no coverage map (${error.message.split('\n')[0]}): the other picks only`); return {}; }
}
// The suites whose recorded lines this PR changes: the diff from each suite's recorded commit to the PR's head, for the files the PR changes (a superset when main moved on).
function covered(changedFiles) {
  const map = loadMap(), bySha = {};
  for (const sha of mapShas(map)) { try { bySha[sha] = hunksFromDiff(git(['-C', '../..', 'diff', '-U0', sha, 'HEAD', '--', ...changedFiles])); } catch { /* commit not here: that suite is not picked by lines */ } }
  return suitesCovering(map, bySha);
}
try {
  const changedFiles = git(['diff', '--name-only', `${base}...HEAD`]).split('\n').filter(Boolean);
  const strings = removedStrings(git(['diff', '-U0', `${base}...HEAD`, '--', '../']));
  const sources = {};
  for (const dir of ['suites', 'lib']) for (const name of fs.readdirSync(path.join(here, dir))) if (name.endsWith('.mjs')) sources[`${dir}/${name}`] = fs.readFileSync(path.join(here, dir, name), 'utf8');
  const out = report({strings, hits: suitesExpecting(strings, sources), changedFiles, sources});
  console.log(out.text);
  if (process.argv.includes('--plan')) {
    const {suiteFacts} = await import('./plan-run.mjs');
    const facts = await suiteFacts();
    const linux = {};
    for (const suite of facts.all) linux[suite] = (await facts.os(suite)) === 'ubuntu-24.04';
    const covering = Object.fromEntries(Object.entries(covered(changedFiles)).filter(([suite]) => facts.all.includes(suite)));   // a suite removed since the map was made: gone
    const plan = planPrSuites({pointed: suitesFor(changedFiles, facts.all, {...facts, uses: suitesUsing(here)}), hits: suitesExpecting(strings, sources), covering, linux: suite => linux[suite], cadence: facts.cadence});
    const why = Object.entries(covering).map(([suite, reason]) => `| \`${suite}\` | ${reason} |`).join('\n');
    if (why) console.log(`\n### Suites that run the lines this PR changes (coverage map)\n\n| Suite | Why |\n|---|---|\n${why}\n`);
    console.log(`suites=${plan.suites.join(',')}\nleft=${plan.left.join(',')}`);
    if (process.env.GITHUB_OUTPUT) fs.appendFileSync(process.env.GITHUB_OUTPUT, `suites=${plan.suites.join(',')}\nleft=${plan.left.join(',')}\n`);
  }
  if (process.env.GITHUB_STEP_SUMMARY) fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, `### E2E suites that quote removed UI text\n\n${out.text}\n`);
} catch (error) {
  console.log(`pr-suites: could not read the diff (${error.message.split('\n')[0]}); nothing reported`);
}
