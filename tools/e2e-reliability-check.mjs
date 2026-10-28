#!/usr/bin/env node
// Enforce the reliability design's expectation citation and plumbing job on the committed PR diff.
// Invariants: base lanes decide protection; only touched files need labels; no browser, network or applicant data.
import {execFileSync} from 'node:child_process';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

export const JOBS = ['run the backbone', 'serve stored answers', 'wait on state', 'pick the suites', 'run tolerant suites as rates', 'keep the scorecard', 'report health'];
const REGISTRY = 'desktop/e2e/lanes.json';
const SUITE = /^desktop\/e2e\/suites\/([^/]+)\.mjs$/;
const EXPECTATIONS = /^desktop\/e2e\/(?:.*(?:baseline|expectations?)\.json|fixtures\/.*\/truth\.json)$/;
// Why (28 Oct 2026, a8): rule F's "every workflow" is the workflows that run or judge e2e; label, mail and site workflows have no e2e design job to name. Add a workflow here when it starts to.
const E2E_WORKFLOWS = '(?:e2e|e2e-windows|e2e-bisect|main-steps|pr-suites|pr-verdict|page-cases|stable-canary)';
const HARNESS = new RegExp(`^(?:\\.github\\/workflows\\/${E2E_WORKFLOWS}\\.ya?ml|desktop\\/e2e\\/(?:lib\\/.*|[^/]+)\\.(?:[cm]?js|py|sh))$`);
const citation = messages => messages.some(message => /^(?:Expect-changed-by|Test-was-wrong):[ \t]*\S[^\n]*$/m.test(message));

// Keep source positions while hiding comments and strings; diagnostic messages are not expectations.
function mask(text) {
  return text.replace(/\/\*[\s\S]*?\*\/|\/\/[^\n]*|"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|`(?:\\.|[^`\\])*`/g,
    value => value.replace(/[^\n]/g, ' '));
}

function callEnd(text, start) {
  let depth = 0;
  for (let i = start; i < text.length; i++) {
    if (text[i] === '(') depth++;
    if (text[i] === ')' && --depth === 0) return i + 1;
  }
  return text.length;
}

function signatures(raw) {
  const text = mask(raw), out = [];
  for (const match of text.matchAll(/\b(assert(?:\.\w+)*|expect|(?:\w+\.)?(?:waitFor\w*|setTimeout))\s*\(/g)) {
    let end = callEnd(text, match.index + match[0].lastIndexOf('('));
    if (match[1] === 'expect') {
      const chain = /^(?:\s*\.\s*\w+)*\s*\(/.exec(text.slice(end));
      if (chain) end = callEnd(text, end + chain[0].lastIndexOf('('));
    }
    const body = text.slice(match.index, end);
    const numbers = body.match(/\b(?:0[xX][\da-fA-F]+|\d[\d_]*(?:\.\d+)?(?:e[+-]?\d+)?)\b/g) || [];
    // Why (28 Oct 2026, owner): even removing a nonnumeric assertion weakens protection; added checks stay free.
    if (match[1].startsWith('assert') || match[1] === 'expect' || numbers.length) out.push(`${match[1]}:${numbers.join(',')}`);
  }
  for (const match of text.matchAll(/\btimeout\s*:\s*([\d_]+)/g)) out.push(`timeout:${match[1]}`);
  return out;
}

// Old/new JS source -> mechanical expectation changes; extra assertions alone are free. Semantic rewrites need review.
export function expectationChanges(before, after) {
  const available = signatures(after), changes = [];
  for (const signature of signatures(before)) {
    const at = available.indexOf(signature);
    if (at < 0) changes.push(`removed or changed ${signature}`);
    else available.splice(at, 1);
  }
  const skips = text => [...mask(text).matchAll(/\b(?:test|it)\s*\.\s*skip\s*\(/g)].length;
  if (skips(after) > skips(before)) changes.push('added test.skip/it.skip');
  return changes;
}

// Changed {file, after|null} records plus commit messages -> missing/invalid Job lines and harness trailer problems.
export function harnessProblems(changes, messages) {
  const touched = changes.filter(change => HARNESS.test(change.file));
  if (!touched.length) return [];
  const found = [];
  for (const {file, after} of touched) {
    if (after === null) continue;
    const jobs = [...after.matchAll(/^\s*(?:\/\/|#)[ \t]*Job:[ \t]*([^\n]*)/gm)].map(match => match[1].trim());
    if (jobs.length !== 1 || !JOBS.includes(jobs[0])) found.push(`${file}: needs exactly one Job: line naming one of: ${JOBS.join('; ')}`);
  }
  const values = messages.flatMap(message => [...message.matchAll(/^Harness-job:[ \t]*([^\n]*)/gm)].map(match => match[1].trim()));
  const red = messages.some(message => /^Fixes-backbone-red:[ \t]*(?:\d+|https:\/\/github\.com\/[^/]+\/[^/]+\/actions\/runs\/\d+)[ \t]*$/m.test(message));
  if ((!values.length || values.some(value => !JOBS.includes(value))) && !red) found.push('Harness changes need Harness-job: <design job> or Fixes-backbone-red: <run ID or URL> in a commit message.');
  return found;
}

// Repo/base -> blocking message (empty on success). Git errors fail closed; callers must supply a fetched base.
export function checkPush({root, base = 'origin/main'}) {
  const git = (...args) => execFileSync('git', ['-C', root, ...args], {encoding: 'utf8', maxBuffer: 64 << 20, stdio: ['ignore', 'pipe', 'pipe']});
  const from = git('merge-base', base, 'HEAD').trim();
  const show = (revision, file) => {
    if (!git('ls-tree', revision, '--', file).trim()) return null;
    return git('show', `${revision}:${file}`);
  };
  const changes = git('diff', '--name-only', '--no-renames', '-z', `${from}..HEAD`).split('\0').filter(Boolean)
    .map(file => ({file, before: show(from, file), after: show('HEAD', file)}));
  const messages = git('log', '--format=%B%x00', `${from}..HEAD`).split('\0');
  const lanes = JSON.parse(show(from, REGISTRY) || '{"suites":{}}').suites || {};
  const needsCitation = [];
  for (const {file, before, after} of changes) {
    const suite = SUITE.exec(file)?.[1];
    if (suite && !lanes[suite] && before !== null && (after === null || expectationChanges(before, after).length)) needsCitation.push(file);
    if (EXPECTATIONS.test(file) && before !== null) needsCitation.push(file);
    if (file === REGISTRY && after !== null) {
      const next = JSON.parse(after).suites || {};
      for (const [name, entry] of Object.entries(next)) {
        if (!lanes[name] && ['tolerant', 'suspended', 'retired'].includes(entry.lane)) needsCitation.push(`${REGISTRY}: ${name} leaves backbone`);
      }
    }
  }
  const found = harnessProblems(changes, messages).map(problem => `Rule F: ${problem}`);
  if (needsCitation.length && !citation(messages)) found.unshift(`Rule E: expectation changes need Expect-changed-by: <sha or owner's request> or Test-was-wrong: <why> in a commit message:\n  ${needsCitation.join('\n  ')}`);
  return found.join('\n');
}

function main() {
  const at = process.argv.indexOf('--base');
  try {
    const message = checkPush({root: path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..'), base: at < 0 ? 'origin/main' : process.argv[at + 1]});
    if (message) { console.error(message); return 1; }
    return 0;
  } catch (error) { console.error(`Reliability check could not read the committed diff: ${error.message}`); return 1; }
}
if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) process.exit(main());
