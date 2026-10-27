#!/usr/bin/env node
// Commit-time check of the trailer VALUES in the message being committed (tools/githooks/commit-msg), so a wrong "Rung: 1" fails in a second, not at the push gate.
// Checks only the lines that are present (whether a push needs them depends on its files: that stays the push gate's, tools/rung-trailer.mjs, recorded-cases.mjs, e2e-issue-links.mjs):
//   Rung / Fixture (rung-trailer.mjs valueProblems), Pool-row (poolRowProblem: a row name of the pool), Recorded-unneeded: <why>, Recorded-pins: <why>, E2E-issue: none <why>, E2E-cause: <cause> [suites] | none <why>, Why-changed: <which> — <why>.
// Usage: node tools/commit-trailers.mjs <message-file>   exit 1 with the reasons. Guard: desktop/test/commit-trailers.test.js, tests/test_commit_msg_hook.py.
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {poolRowNames} from './pool-rows.mjs';
import {poolRowProblem, valueProblems} from './rung-trailer.mjs';
import {causeProblems} from './e2e-cause-trailer.mjs';

const lines = (message, name) => [...message.matchAll(new RegExp(`^${name}:[ \\t]*(.*)$`, 'gm'))].map(found => found[1].trim());

// -> the problems (empty when fine). fixtureIds: the ids in desktop/e2e/ladder-fixtures/; pool: {names, complete} of tools/pool-rows.mjs poolRowNames().
export function messageProblems(raw, fixtureIds, pool) {
  const message = String(raw).split('\n').filter(line => !line.startsWith('#')).join('\n');   // git's own comment lines are not the message
  const problems = valueProblems(lines(message, 'Rung'), lines(message, 'Fixture'), fixtureIds);
  const row = poolRowProblem([message], pool);
  if (row) problems.push(row);
  if (lines(message, 'Recorded-unneeded').some(value => !value)) problems.push('"Recorded-unneeded:" needs a reason ("Recorded-unneeded: <why>")');
  if (lines(message, 'Recorded-pins').some(value => !value)) problems.push('"Recorded-pins:" needs a reason ("Recorded-pins: <why>")');
  if (lines(message, 'Why-changed').some(value => value.length < 10)) problems.push('"Why-changed:" names the Why and the reason ("Why-changed: <which Why> — <reason>", tools/why-changed.mjs)');
  if (lines(message, 'E2E-issue').some(value => !/^none\s+\S/i.test(value))) problems.push('"E2E-issue:" must read "E2E-issue: none <why>" (a fix names its issue as "Fixes #N" or "Refs #N")');
  problems.push(...causeProblems(lines(message, 'E2E-cause')));   // tools/e2e-cause-trailer.mjs; suite names are checked at the push
  return problems;
}

function main() {
  const file = process.argv[2];
  if (!file) { console.error('usage: node tools/commit-trailers.mjs <message-file>'); return 2; }
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
  let ids = [];
  try { ids = fs.readdirSync(path.join(root, 'desktop/e2e/ladder-fixtures')).filter(name => name.endsWith('.json')).map(name => name.slice(0, -5)); } catch { /* no fixtures folder: ids stay empty */ }
  const problems = messageProblems(fs.readFileSync(file, 'utf8'), ids, poolRowNames({root}));
  if (problems.length) { console.error(`Commit blocked: wrong trailer value${problems.length > 1 ? 's' : ''}:\n  ${problems.join('\n  ')}\n(COMMIT_TRAILERS_OK=1 or --no-verify skips this check; the push gate checks them again)`); return 1; }
  return 0;
}
if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) process.exit(main());
