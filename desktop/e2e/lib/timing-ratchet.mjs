// Counts declared timing debt so suite steps can only move toward state waits.
// Job: wait on state

// Invariants: lexical counts only, never execute suites, infer a wait's purpose, or update the baseline.
// Ignore quoted prose and comments. This tripwire covers the declared syntax, not arbitrary JS data flow.
const executable = source => source.replace(/\/\/[^\n]*|\/\*[\s\S]*?\*\/|'(?:\\[\s\S]|[^'\\])*'|"(?:\\[\s\S]|[^"\\])*"|`(?:\\[\s\S]|[^`\\])*`/g,
  text => text.replace(/[^\n]/g, ' '));
const matches = (text, pattern) => [...text.matchAll(pattern)];
const elapsedComparison = condition => /[<>]/.test(condition)
  && /\b(?:took|elapsed\w*|duration\w*|seconds|silence)\b|\.at\b/i.test(condition);

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
  return {fixedWaits, elapsedAssertions: matchers + failures + assertions};
}

/** Report timing debt changes; new suites start at zero and the checker never edits data. */
export function timingViolations(sources, baseline, lanes = {}) {
  const errors = [];
  for (const [suite, source] of Object.entries(sources)) {
    const actual = timingCounts(source), declared = baseline[suite];
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
