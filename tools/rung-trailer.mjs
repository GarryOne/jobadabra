#!/usr/bin/env node
// The rung trailer (docs/flows/ladder.md): a push that touches the ladder's flow code (desktop/e2e/flows.mjs FLOW_FILES, desktop/lib/ladder/, the page-kind facade, the account and form judges, extension/ladder/)
// says in a commit message of the pushed range which rung it changes and which fixture shows it, like "Recorded-unneeded" (tools/recorded-cases.mjs):
//   Rung: <0-6 | router | judges>          (a list "2, 3" is fine; "none: <why>" for a flow edit no rung decides, e.g. a log line: then no Fixture)
//   Fixture: <fixture id of desktop/e2e/ladder-fixtures/, or several, or "none: <why>" for a pure move or refactor>
//   Pool-row: <the pool row this fixes, its exact name in the pool>   (optional, any commit: it fills the Fixed tab, desktop/e2e/lib/fix-ledger.mjs; never an address, a query string or a slug)
// Usage: node tools/rung-trailer.mjs [--base origin/main]   exit 1 with the reason when a flow push lacks them. Guard: desktop/test/rung-trailer.test.js.
import {execFileSync} from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {poolRowNames, rowNameProblem} from './pool-rows.mjs';

const FLOW_CODE = /^(desktop\/lib\/(ladder\/|page-kind\.js$|account-judge\.js$|form-judge\.js$)|extension\/ladder\/)/;
export const isFlowPush = (changed, flowFiles) => { const flows = new Set(flowFiles); return changed.some(file => flows.has(file) || FLOW_CODE.test(file)); };

const RUNG = /^Rung:[ \t]*(.*)$/gm, FIXTURE = /^Fixture:[ \t]*(.*)$/gm;
const RUNG_VALUE = /^(?:[0-6]|router|judges)(?:\s*,\s*(?:[0-6]|router|judges))*$/;
const HOW = 'Add to a commit message of the push:\n  Rung: <0-6 | router | judges | none: <why> (no rung decides it, e.g. a log line; then no Fixture)>\n  Fixture: <a fixture id of desktop/e2e/ladder-fixtures/ | none: <why> (a pure move or refactor)>\n(docs/flows/ladder.md, skill fix-site-at-its-rung)';

// "Pool-row:" is optional; when present it is a pool row's name exactly as the pool has it (tools/pool-rows.mjs; it is published on the owner page, and a capture
// folder's slug made a second Fixed row on 11 Oct 2026). pool: {names, complete} of poolRowNames(); without it, or with an incomplete pool (no own list on this
// machine), only the form is checked and a slug of a known row. -> '' or the problem.
export const poolRowProblem = (messages, pool = {names: [], complete: false}) => {
  const values = messages.flatMap(message => [...String(message).matchAll(/^Pool-row:[ \t]*(.*)$/gm)].map(found => found[1].trim()));
  const bad = values.filter(name => !name || name.length > 120 || /[?=@]|:\/\/|https?:/i.test(name));
  if (bad.length) return `"Pool-row: ${bad[0]}" must be a pool row's name as /admin/form-filling/lab shows it: no address, no query string, at most 120 characters`;
  return values.filter(name => !/^none\s+\S/i.test(name)).map(name => rowNameProblem(name, pool, 'Pool-row: ')).find(Boolean) || '';   // "none <why>": a hand-made case no row showed
};

const isNone = value => /^none\b/i.test(value);   // a flow edit no rung decides (a log line, a timing): "Rung: none: <why>", no fixture

// What is wrong with the VALUES of the Rung and Fixture lines (presence is missingTrailer's, it needs the push's files). Also run on one message at commit time (tools/commit-trailers.mjs).
export function valueProblems(rungs, fixtures, fixtureIds) {
  const problems = [];
  for (const value of rungs) {
    if (isNone(value)) { if (!/^none:\s*\S.{2,}/i.test(value)) problems.push('"Rung: none" needs a reason ("Rung: none: <why>")'); continue; }
    if (!RUNG_VALUE.test(value)) problems.push(`"Rung: ${value}" is not 0-6, router, judges or none: <why>`);
  }
  for (const value of fixtures) {
    if (isNone(value)) { if (!/^none:\s*\S.{2,}/i.test(value)) problems.push('"Fixture: none" needs a reason ("Fixture: none: <why>")'); continue; }
    for (const id of value.split(/\s*,\s*/).filter(Boolean)) if (!fixtureIds.includes(id)) problems.push(`no fixture "${id}" in desktop/e2e/ladder-fixtures/`);
  }
  return problems;
}

// -> '' when fine, else the message. changed: the push's files; messages: its commit messages; fixtureIds: the ids in desktop/e2e/ladder-fixtures/.
export function missingTrailer(changed, messages, flowFiles, fixtureIds) {
  if (!isFlowPush(changed, flowFiles)) return '';
  const rungs = messages.flatMap(message => [...String(message).matchAll(RUNG)].map(found => found[1].trim()));
  const fixtures = messages.flatMap(message => [...String(message).matchAll(FIXTURE)].map(found => found[1].trim()));
  const problems = [];
  if (!rungs.length) problems.push('no "Rung:" line');
  problems.push(...valueProblems(rungs, fixtures, fixtureIds));
  if (!fixtures.length && rungs.some(value => !isNone(value))) problems.push('no "Fixture:" line');
  return problems.length ? `this push changes the ladder's flow code and its commit messages have ${problems.join('; ')}.\n${HOW}` : '';
}

async function main() {
  const base = process.argv.includes('--base') ? process.argv[process.argv.indexOf('--base') + 1] : 'origin/main';
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
  const git = (...rest) => execFileSync('git', ['-C', root, ...rest], {encoding: 'utf8', maxBuffer: 64 << 20});
  let changed, messages;
  try { changed = git('diff', '--name-only', `${base}...HEAD`).split('\n').filter(Boolean); messages = git('log', '--format=%B%x00', `${base}..HEAD`).split('\0'); } catch { return 0; }
  const {FLOW_FILES} = await import(path.join(root, 'desktop/e2e/flows.mjs'));
  const ids = fs.readdirSync(path.join(root, 'desktop/e2e/ladder-fixtures')).filter(name => name.endsWith('.json')).map(name => name.slice(0, -5));
  const why = poolRowProblem(messages, poolRowNames({root})) || missingTrailer(changed, messages, FLOW_FILES, ids);
  if (why) { console.error(why); return 1; }
  return 0;
}
if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) process.exit(await main());
