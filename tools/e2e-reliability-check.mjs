#!/usr/bin/env node
// Enforce the reliability design's step clock, expectation citation and plumbing job on the committed PR diff.
// Invariants: base lanes decide protection; only touched files need labels; no browser, network or applicant data.
import {execFileSync} from 'node:child_process';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {isBackbone} from '../desktop/e2e/lib/suite-shards.mjs';

export const JOBS = ['run the backbone', 'serve stored answers', 'wait on state', 'pick the suites', 'run tolerant suites as rates', 'keep the scorecard', 'report health'];
const REGISTRY = 'desktop/e2e/lanes.json';
const SUITE = /^desktop\/e2e\/suites\/([^/]+)\.mjs$/;
const CHECK_LIB = /^desktop\/e2e\/lib\/[^/]*(?:check|problems|quality|judge|baseline|truth)[^/]*\.mjs$/;
const EXPECTATIONS = /^desktop\/e2e\/(?:.*(?:baseline|expectations?)\.json|fixtures\/.*\/truth\.json)$/;
// Why (28 Oct 2026, a8; e2e-revert #2424; e2e-flip 29 Oct 2026, owner): rule F covers workflows that run, judge or report e2e; label, mail and site workflows have no e2e design job to name. Add a workflow here when it starts to; pr-suites left the list on 1 Nov 2026 (owner, "No e2e on PRs"): the workflow is deleted.
const E2E_WORKFLOWS = '(?:e2e|e2e-windows|e2e-bisect|e2e-revert|e2e-flip|main-steps|pr-verdict|page-cases|stable-canary)';
const HARNESS = new RegExp(`^(?:\\.github\\/workflows\\/${E2E_WORKFLOWS}\\.ya?ml|desktop\\/e2e\\/(?:lib\\/.*|[^/]+)\\.(?:[cm]?js|py|sh))$`);
const citation = messages => messages.some(message => /^(?:Expect-changed-by|Test-was-wrong):[ \t]*\S[^\n]*$/m.test(message));

// Keep source positions while hiding comments and strings; diagnostic messages are not expectations.
const TOKENS = /\/\*[\s\S]*?\*\/|\/\/[^\n]*|"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|`(?:\\.|[^`\\])*`/;
function mask(text) {
  return text.replace(new RegExp(TOKENS.source, 'g'),
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

const numbersIn = text => text.match(/[-+]?\b(?:0[xX][\da-fA-F]+|\d[\d_]*(?:\.\d+)?(?:e[+-]?\d+)?)\b/g) || [];

// Suite scheduling is plumbing too: a shard/budget patch must not bypass rules E/F because it changed no assertion.
const executionSettings = (raw = '', includeWeights = true) => {
  const text = mask(raw || '');
  return [...text.matchAll(/\bexport\s+const\s+(shards|budgetMinutes|minutes|stepSeconds|flowSeconds)\s*=\s*/g)]
    .filter(match => includeWeights || !['stepSeconds', 'flowSeconds'].includes(match[1])).map(match => {
    const start = match.index + match[0].length, end = text.indexOf(';', start);
    // Keep step names and literal whitespace: reassigning the same seconds to different journeys changes the split too.
    const value = (raw || '').slice(start, end < 0 ? undefined : end).replace(new RegExp(`${TOKENS.source}|\\s+`, 'g'),
      token => /^(?:\/|\s)/.test(token) ? '' : token);
    return `execution setting:${match[1]}:${value}`;
  });
};
const changedExecution = (before, after, includeWeights = true) => before != null && JSON.stringify(executionSettings(before, includeWeights).sort()) !== JSON.stringify(executionSettings(after, includeWeights).sort());

// Read one comparison operand, including nested calls/indexes, stopping at a surrounding expression boundary.
function operand(text, start, direction) {
  let depth = 0, end = start;
  for (; end >= 0 && end < text.length; end += direction) {
    const char = text[end];
    if ((direction === 1 ? '([' : ')]').includes(char)) depth++;
    else if ((direction === 1 ? ')]' : '([').includes(char)) {
      if (!depth) break;
      depth--;
    } else if (!depth && /[;{},?:=<>!&|]/.test(char)) break;
  }
  return direction === 1 ? text.slice(start, end) : text.slice(end + 1, start + 1);
}

function signatures(raw, file) {
  const text = mask(raw), out = [];
  for (const match of text.matchAll(/\b(assert(?:\.\w+)*|expect|(?:\w+\.)?(?:waitFor\w*|setTimeout))\s*\(/g)) {
    let end = callEnd(text, match.index + match[0].lastIndexOf('('));
    if (match[1] === 'expect') {
      const chain = /^(?:\s*\.\s*\w+)*\s*\(/.exec(text.slice(end));
      if (chain) end = callEnd(text, end + chain[0].lastIndexOf('('));
    }
    const body = text.slice(match.index, end);
    const numbers = numbersIn(body);
    // Why (28 Oct 2026, owner): even removing a nonnumeric assertion weakens protection; added checks stay free.
    if (match[1].startsWith('assert') || match[1] === 'expect' || numbers.length) out.push(`${match[1]}:${numbers.join(',')}`);
  }
  for (const match of text.matchAll(/\btimeout\s*:\s*([\d_]+)/g)) out.push(`timeout:${match[1]}`);
  for (const match of text.matchAll(/\bif\s*\(/g)) {
    const start = match.index + match[0].lastIndexOf('('), end = callEnd(text, start);
    if (/^\s*(?:\{\s*)?throw\b/.test(text.slice(end))) {
      // Preserve condition identity and multiplicity: swapping a strict guard for a verdict can keep its count and have no numbers (5395279).
      out.push(`throw guard:${text.slice(start + 1, end - 1).replace(/\s+/g, '')}`);
    }
  }
  for (const match of text.matchAll(/\b(\w*Problems)\s*\(/g)) out.push(`helper:${match[1]}`);
  if (CHECK_LIB.test(file)) {
    for (const match of text.matchAll(/===|!==|<=|>=|(?<![=<>])<(?![=<])|(?<![=<>])>(?![=>])/g)) {
      const numbers = numbersIn(operand(text, match.index - 1, -1) + ' ' + operand(text, match.index + match[0].length, 1));
      if (numbers.length) out.push(`comparison:${match[0]}:${numbers.join(',')}`);
    }
    // Include comma-separated declarations and default parameters (quality.mjs's tolerance = 8), not only the first const binding.
    for (const match of text.matchAll(/\b(\w*(?:ALLOW|MAX|MIN|LIMIT|THRESHOLD|TOLERANCE|BAND|RATE)\w*)\s*=(?!=|>)\s*/gi)) {
      const numbers = numbersIn(operand(text, match.index + match[0].length, 1));
      if (numbers.length) out.push(`limit:${match[1]}:${numbers.join(',')}`);
    }
  }
  return out;
}

// Rule B (owner, 30 Oct 2026, on #2612: "wait on the state, not on a specific time"): in step code, a step's only clock is its measured hang cap
// (desktop/e2e/hang-caps.json, which lib/runner.mjs hands to the step's waits). A bound written inline that is new or changed is refused, with no trailer
// to clear it (3 tries on late extension lines each raised one: 10 s, 45 s, 60 s); moving one unchanged or removing it is free.
const STEP_CODE = /^desktop\/e2e\/(?:lib\/.*|suites\/[^/]+)\.mjs$/;
const CLOCKS = [[/\bwaited\s*<=?\s*([\d_]+)/g, 'waited <'], [/\b(?:capMs|limitMs|timeout)\s*[:=]\s*([\d_]+)/g, 'cap'],
  [/\buntil\s*\([^;]*?,\s*([\d_]{3,})\s*\)/g, 'until(…, ms)'], [/\bDate\.now\(\)\s*-\s*\w+\s*<=?\s*([\d_]+)/g, 'elapsed <']];
const clockWaits = text => CLOCKS.flatMap(([pattern, kind]) => [...mask(text).matchAll(pattern)].map(match => `${kind} ${match[1].replace(/_/g, '')}`));

/** Changed {file, before, after} records -> "file: kind ms" for each inline wait bound in step code with no identical one before (across all changed files). */
export function newClockWaits(changes) {
  const step = changes.filter(change => STEP_CODE.test(change.file));
  const before = step.flatMap(change => (change.before === null ? [] : clockWaits(change.before))), found = [];
  for (const {file, after} of step) {
    for (const wait of after === null ? [] : clockWaits(after)) {
      const at = before.indexOf(wait);
      if (at < 0) found.push(`${file}: ${wait}`);
      else before.splice(at, 1);
    }
  }
  return found;
}

// Old/new JS source -> mechanical expectation changes; extra assertions alone are free. Semantic rewrites need review.
export function expectationChanges(before, after, file = '') {
  const available = signatures(after, file), changes = [];
  for (const signature of signatures(before, file)) {
    const at = available.indexOf(signature);
    if (at < 0) changes.push(`removed or changed ${signature}`);
    else available.splice(at, 1);
  }
  const skips = text => [...mask(text).matchAll(/\b(?:test|it)\s*\.\s*skip\s*\(/g)].length;
  if (skips(after) > skips(before)) changes.push('added test.skip/it.skip');
  if (SUITE.test(file) && changedExecution(before, after, false)) changes.push('changed suite execution setting (shards or budget)');
  return changes;
}

// Changed {file, after|null} records plus commit messages -> missing/invalid Job lines and harness trailer problems.
export function harnessProblems(changes, messages) {
  const touched = changes.filter(change => HARNESS.test(change.file) || (SUITE.test(change.file) && changedExecution(change.before, change.after)));
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
  const lanes = JSON.parse(show(from, REGISTRY) || '{"suites":{}}');
  const needsCitation = [];
  for (const {file, before, after} of changes) {
    const suite = SUITE.exec(file)?.[1];
    // Why (29 Oct 2026, a8 on Gitar #2419; 30 Oct, ratchet): tolerant results may be noisy, but their own bars still need a citation; suspended and retired suites stay free; a registry entry that only holds aiMissesMax is still backbone (isBackbone), so it is not free.
    if (((suite && (isBackbone(lanes, suite) || lanes.suites?.[suite]?.lane === 'tolerant')) || CHECK_LIB.test(file)) && before !== null && (after === null || expectationChanges(before, after, file).length)) needsCitation.push(file);
    if (EXPECTATIONS.test(file) && before !== null) needsCitation.push(file);
    if (file === REGISTRY && after !== null) {
      const next = JSON.parse(after);
      for (const name of Object.keys(next.suites || {})) {
        if (isBackbone(lanes, name) && !isBackbone(next, name)) needsCitation.push(`${REGISTRY}: ${name} leaves backbone`);
      }
      // Why (31 Oct 2026, Gitar on #2714): a step suspended in the `steps` map (#2706) leaves the backbone as surely as its suite would; a step already
      // listed with the same lane on the base is no new move.
      for (const [name, steps] of Object.entries(next.steps || {})) {
        for (const [step, entry] of Object.entries(steps || {})) {
          if (entry?.lane && entry.lane !== 'backbone' && lanes.steps?.[name]?.[step]?.lane !== entry.lane) needsCitation.push(`${REGISTRY}: ${name} · ${step} leaves backbone`);
        }
      }
      // Why (30 Oct 2026, a8 on Gitar #2568): the ceiling is read from the PR's own checkout, so raising or dropping it in the PR that adds the ask would pass; a threshold change is Rule E.
      for (const [name, entry] of Object.entries(lanes.suites || {})) {
        const was = entry.aiMissesMax, now = next.suites?.[name]?.aiMissesMax;
        if (was !== undefined && (now === undefined || now > was)) needsCitation.push(`${REGISTRY}: ${name} loosens its AI-ask ceiling (${was} -> ${now ?? 'none'})`);
      }
      // Why (31 Oct 2026, Gitar on #2664): an exception turns the zero-miss check off, so a new or reworded one is an expectation change too, new suites included.
      for (const [name, entry] of Object.entries(next.suites || {})) {
        if (entry?.aiMissesException !== undefined && entry.aiMissesException !== lanes.suites?.[name]?.aiMissesException) needsCitation.push(`${REGISTRY}: ${name} adds or changes its AI-ask exception`);
      }
    }
  }
  const found = harnessProblems(changes, messages).map(problem => `Rule F: ${problem}`);
  const clocks = newClockWaits(changes);
  if (clocks.length) found.unshift(`Rule B: a step's only clock is its measured hang cap (desktop/e2e/hang-caps.json); wait on the state with pollUntil or waitForDecisions (lib/wait-on-state.mjs), with no bound of its own. No trailer clears this:\n  ${clocks.join('\n  ')}`);
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
