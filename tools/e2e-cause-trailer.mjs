#!/usr/bin/env node
// The e2e cause trailer (owner, 27 Oct 2026: "let's close the gaps. Let's improve the process"): a push that changes an e2e suite or its lib (desktop/e2e/suites/, desktop/e2e/lib/)
// says in a commit message of the pushed range why the suite was red, in the words /admin/operations/e2e uses, so the page reads the cause from the fix instead of guessing:
//   E2E-cause: <drift | test | product | flake | timing | ai | ci | picker | runner> [suite, suite]   (no suite: every suite the fix touches)
//   E2E-cause: none <why>                                                                         (no red behind it: a new step, a refactor, a log line)
// A product fix for a red suite (only app files) adds it too ("E2E-cause: product apply"); there it is asked by the skill fix-failing-e2e, not by this gate.
// Measured 27 Oct 2026: of 279 red suites since 13 Oct, the fix's files alone named drift, test bug or product bug for none; an AI reading the diff agreed with a hand reading on 15 of 23.
// Usage: node tools/e2e-cause-trailer.mjs [--base origin/main]   exit 1 with the reason when an e2e push lacks it. Guard: desktop/test/e2e-cause-trailer.test.js.
import {execFileSync} from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

// The same ids as the site's admin/e2e-causes.js (CAUSES): the page drops any other word.
export const E2E_CAUSES = ['drift', 'test', 'product', 'flake', 'timing', 'ai', 'ci', 'picker', 'runner'];
const E2E_CODE = /^desktop\/e2e\/(suites|lib)\//;
const LINE = /^E2E-cause:[ \t]*(.*)$/gm;
const HOW = `Add to a commit message of the push (skill fix-failing-e2e, step 7):
  E2E-cause: <${E2E_CAUSES.join(' | ')}> [suite, suite]
  E2E-cause: none <why>   (no red suite behind it: a new step, a refactor)
drift = the app changed on purpose and the test follows it; test = the test was wrong on its own; product = the app was wrong.`;

export const isE2ePush = changed => changed.some(file => E2E_CODE.test(file));
export const causeValues = messages => messages.flatMap(message => [...String(message).matchAll(LINE)].map(found => found[1].trim()));

// What is wrong with the values (presence is missingCause's, it needs the push's files). suites: the suite names of desktop/e2e/suites/ ([] = not checked).
export function causeProblems(values, suites = []) {
  const problems = [];
  for (const value of values) {
    const [word = '', ...rest] = value.split(/[\s,]+/).filter(Boolean);
    if (word.toLowerCase() === 'none') { if (rest.join(' ').length < 3) problems.push('"E2E-cause: none" needs a reason ("E2E-cause: none <why>")'); continue; }
    if (!E2E_CAUSES.includes(word)) { problems.push(`"E2E-cause: ${value}" starts with "${word}", not one of ${E2E_CAUSES.join(', ')} or none <why>`); continue; }
    const unknown = suites.length ? rest.filter(name => !suites.includes(name.replace(/-\d+of\d+$/, ''))) : [];
    if (unknown.length) problems.push(`"E2E-cause: ${value}": no suite ${unknown.map(name => `"${name}"`).join(', ')} in desktop/e2e/suites/`);
  }
  return problems;
}

// -> '' when fine, else the message. changed: the push's files; messages: its commit messages.
export function missingCause(changed, messages, suites = []) {
  if (!isE2ePush(changed)) return '';
  const values = causeValues(messages);
  if (!values.length) return `this push changes an e2e suite or its lib but no commit says why the suite was red.\n${HOW}`;
  const problems = causeProblems(values, suites);
  return problems.length ? `${problems.join('\n')}\n${HOW}` : '';
}

export const suiteNames = root => { try { return fs.readdirSync(path.join(root, 'desktop/e2e/suites')).filter(file => file.endsWith('.mjs')).map(file => file.slice(0, -4)); } catch { return []; } };

function main() {
  const args = process.argv.slice(2), base = args.includes('--base') ? args[args.indexOf('--base') + 1] : 'origin/main';
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
  const git = (...rest) => execFileSync('git', ['-C', root, ...rest], {encoding: 'utf8', maxBuffer: 64 << 20});
  const changed = git('diff', '--name-only', `${base}...HEAD`).split('\n').filter(Boolean);
  const problem = missingCause(changed, git('log', '--format=%B%x00', `${base}..HEAD`).split('\0'), suiteNames(root));
  if (problem) { console.log(problem); return 1; }
  return 0;
}
if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) process.exit(main());
