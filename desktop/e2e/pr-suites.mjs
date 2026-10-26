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

const here = path.dirname(fileURLToPath(import.meta.url));
const base = process.argv[process.argv.indexOf('--base') + 1] || 'origin/main';
const git = args => execFileSync('git', args, {cwd: here, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024});
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
    const plan = planPrSuites({pointed: suitesFor(changedFiles, facts.all, {...facts, uses: suitesUsing(here)}), hits: suitesExpecting(strings, sources), linux: suite => linux[suite], cadence: facts.cadence});
    console.log(`suites=${plan.suites.join(',')}\nleft=${plan.left.join(',')}`);
    if (process.env.GITHUB_OUTPUT) fs.appendFileSync(process.env.GITHUB_OUTPUT, `suites=${plan.suites.join(',')}\nleft=${plan.left.join(',')}\n`);
  }
  if (process.env.GITHUB_STEP_SUMMARY) fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, `### E2E suites that quote removed UI text\n\n${out.text}\n`);
} catch (error) {
  console.log(`pr-suites: could not read the diff (${error.message.split('\n')[0]}); nothing reported`);
}
