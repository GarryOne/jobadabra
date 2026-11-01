// node pool-ci-state.mjs prepare <states folder> <baseline file> | save <smoke reports folder> <state file>: the CI pool run's hand-over (lib/pool-ci-state.mjs).
// prepare: the earlier runs' states (downloaded by .github/workflows/record-sites.yml) -> today's CI-wide site ledger in JOBADABRA_SITE_LEDGER_DIR and each row's
// baseline; save: this run's ledger and the rows it ran -> its state, uploaded for the next runs.
import fs from 'node:fs';
import path from 'node:path';
import {baselines, mergeLedgers, stateOf} from './lib/pool-ci-state.mjs';
import {dayOf, ledgerDir} from './lib/site-ledger.mjs';

const [mode, from, to] = process.argv.slice(2);
const read = file => { try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return null; } };
const branch = process.env.GITHUB_HEAD_REF || process.env.GITHUB_REF_NAME || '', run = process.env.GITHUB_RUN_ID || '';
const ledgerFile = path.join(ledgerDir(), 'ledger.json');

if (mode === 'prepare') {
  const states = (fs.existsSync(from) ? fs.readdirSync(from, {recursive: true}) : []).filter(name => path.basename(String(name)) === 'state.json').map(name => read(path.join(from, String(name)))).filter(Boolean);
  const day = dayOf(), ledger = mergeLedgers(states, day), base = baselines(states, {branch, run, applicant: process.env.JP_APPLICANT || 'thin'});
  fs.mkdirSync(path.dirname(ledgerFile), {recursive: true});
  fs.writeFileSync(ledgerFile, JSON.stringify(ledger, null, 1));
  fs.mkdirSync(path.dirname(to), {recursive: true});
  fs.writeFileSync(to, JSON.stringify(base, null, 1));
  const visits = Object.entries(ledger[day] || {}).map(([site, entry]) => `${site} x${entry.visits.length}${entry.blocked ? ' (blocked: rests today)' : ''}`);
  console.log(`pool-ci: ${states.length} earlier CI run state(s) read; today's CI visits: ${visits.join(', ') || 'none'}; a last CI run for: ${Object.keys(base).join('; ') || 'no row'}`);
} else if (mode === 'save') {
  const days = fs.existsSync(from) ? fs.readdirSync(from).filter(name => /^\d{4}-\d\d-\d\d\.json$/.test(name)).sort() : [];
  const report = days.length ? read(path.join(from, days.at(-1))) || {} : {};
  const state = stateOf({run, branch, sha: process.env.GITHUB_SHA || '', at: new Date().toISOString(), ledger: read(ledgerFile) || {}, report});
  fs.mkdirSync(path.dirname(to), {recursive: true});
  fs.writeFileSync(to, JSON.stringify(state, null, 1));
  console.log(`pool-ci: state of run ${run} (${branch}): ${Object.keys(state.results).length} row(s), the ledger of ${Object.keys(state.ledger).length} day(s)`);
} else {
  console.error('usage: node pool-ci-state.mjs prepare <states folder> <baseline file> | save <smoke reports folder> <state file>');
  process.exit(2);
}
