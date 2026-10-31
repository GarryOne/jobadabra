// Counts declared timing debt so suite steps can only move toward state waits.
// Job: wait on state

import {parse} from 'acorn';

// Invariants: syntax counts only; never execute suites, infer a wait's purpose, or update the baseline.
// Ignore quoted prose and comments. This tripwire covers the declared syntax, not arbitrary JS data flow.
const executable = source => source.replace(/\/\/[^\n]*|\/\*[\s\S]*?\*\/|'(?:\\[\s\S]|[^'\\])*'|"(?:\\[\s\S]|[^"\\])*"|`(?:\\[\s\S]|[^`\\])*`/g,
  text => text.replace(/[^\n]/g, ' '));
const matches = (text, pattern) => [...text.matchAll(pattern)];
const elapsedComparison = condition => /[<>]/.test(condition)
  && /\b(?:took|elapsed\w*|duration\w*|seconds|silence)\b|\.at\b/i.test(condition);

const children = node => Object.values(node).flatMap(value => Array.isArray(value) ? value : [value]).filter(value => value && typeof value.type === 'string');
const has = (node, check) => !!node && (check(node) || children(node).some(child => has(child, check)));
const clockReference = node => node.type === 'MemberExpression' && ['Date', 'performance'].includes(node.object.name) && node.property.name === 'now';
const clockRead = node => (node.type === 'CallExpression' && clockReference(node.callee)) || (node.type === 'NewExpression' && node.callee.name === 'Date' && !node.arguments.length);
const comparison = node => node.type === 'BinaryExpression' && ['<', '>', '<=', '>='].includes(node.operator);
const functionNode = node => /^(?:FunctionDeclaration|FunctionExpression|ArrowFunctionExpression)$/.test(node.type);
const nameOf = node => node?.name || node?.property?.name || '';
const inScope = (node, check) => check(node) || children(node).some(child => !functionNode(child) && inScope(child, check));
const waitCall = node => node.type === 'CallExpression' && /^(?:waitOn|waitFor\w*|pollUntil|until)$/.test(nameOf(node.callee));

// Local aliases are debt at their declaration, so later calls cannot hide the clock from a wait.
const clockAlias = node => node.type === 'VariableDeclarator' && node.init && (clockReference(node.init) ||
  (functionNode(node.init) && ['BinaryExpression', 'LogicalExpression', 'UnaryExpression'].includes(node.init.body.type) && has(node.init.body, clockRead) && has(node.init.body, comparison)));
const movesClock = node => node.type === 'CallExpression' && /^(?:advancePastDue|moveBackgroundWaitClock)$/.test(nameOf(node.callee));
function startsUnmovedWait(node, scope) {
  if (node.type !== 'CallExpression' || !['startJob', 'startAuto'].includes(nameOf(node.callee))) return false;
  const options = node.arguments.find(arg => arg.type === 'ObjectExpression');
  const field = key => options?.properties.find(property => nameOf(property.key) === key)?.value;
  const automatic = nameOf(node.callee) === 'startAuto' || field('mode')?.value === 'auto';
  const wait = field('waitMin');
  return automatic && !(wait?.type === 'Literal' && wait.value === 0) && !inScope(scope, movesClock);
}

// Count a whole wait once, including a clock read returned as an object and compared in accepts.
// Own deadline loops count too; only the caller excludes wait-on-state.mjs's shared runner cap.
function clockWaits(source) {
  const tree = parse(source, {ecmaVersion: 'latest', sourceType: 'module', allowAwaitOutsideFunction: true});
  let count = 0;
  const visit = (node, scope = tree) => {
    if (functionNode(node)) scope = node;
    const test = ['WhileStatement', 'DoWhileStatement', 'ForStatement', 'IfStatement'].includes(node.type) ? node.test : null;
    const timedCondition = test && has(test, clockRead) && has(test, comparison);
    const timedCall = waitCall(node) && node.arguments.some(arg => has(arg, clockRead)) && node.arguments.some(arg => has(arg, comparison));
    if (timedCondition || timedCall) {
      count++;
      for (const branch of [node.body, node.consequent, node.alternate].filter(Boolean)) visit(branch, scope);
      return;
    }
    if (clockAlias(node)) { count++; return; }
    if (startsUnmovedWait(node, scope)) count++;
    for (const child of children(node)) visit(child, scope);
  };
  visit(tree);
  return count;
}

/** Count the declared fixed-wait forms and direct elapsed-time failure assertions. */
export function timingCounts(source) {
  const code = executable(source);
  const fixedWaits = matches(code, /\bwaitForTimeout\s*\(|\bawait\s+sleep\s*\(|\bnew\s+Promise\s*\(\s*(?:\(\s*)?\w+\s*\)?\s*=>\s*\{?\s*setTimeout\s*\(/g).length;
  // Assertion matchers have no place in state-wait caps. Direct failure branches also cover the
  // suite's current seconds/silence checks and timestamp differences, rather than polling conditions.
  const matchers = matches(code, /\.toBe(?:Less|Greater)Than(?:OrEqual)?\s*\(/g).length;
  const failures = matches(code, /\bif\s*\(([^;{}]*?)\)\s*(?:\{\s*)?(?:throw\b|\w+\.push\s*\()/g)
    .filter(([, condition]) => elapsedComparison(condition)).length;
  const assertions = matches(code, /\bassert(?:\.\w+)*\s*\(([^;{}]*?)\)/g)
    .filter(([, condition]) => elapsedComparison(condition)).length;
  return {fixedWaits, elapsedAssertions: matchers + failures + assertions, clockWaits: clockWaits(source)};
}

/** Report timing debt changes; new suites start at zero and the checker never edits data. */
export function timingViolations(sources, baseline, lanes = {}, dependencies = {}) {
  const errors = [];
  for (const [suite, source] of Object.entries(sources)) {
    const actual = timingCounts(source), declared = baseline[suite];
    actual.clockWaits += (dependencies[suite] || []).reduce((sum, helper) => sum + clockWaits(helper), 0);
    for (const metric of Object.keys(actual)) {
      if (metric === 'elapsedAssertions' && lanes[suite]?.input === 'clock') continue;
      const expected = declared?.[metric] ?? 0;
      if (!Number.isSafeInteger(expected) || expected < 0) {
        errors.push(`${suite}: ${metric} baseline must be a nonnegative integer`);
      } else if (actual[metric] > expected) {
        errors.push(`${suite}: ${metric} ${actual[metric]} > baseline ${expected}${declared ? '' : ' (baseline 0 for a new suite)'}: wait on state instead`);
      } else if (actual[metric] < expected) {
        errors.push(`${suite}: ${metric} ${actual[metric]} < baseline ${expected}: lower the baseline`);
      }
    }
  }
  for (const suite of Object.keys(baseline)) if (!(suite in sources)) errors.push(`${suite}: remove the baseline for the deleted suite`);
  return errors;
}
