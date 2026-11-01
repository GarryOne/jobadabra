// How check:fill scores one replayed case like the form benchmark (right / wrong / empty / not reached) and compares a run with main's stored numbers. Pure; guard: e2e/test/check-fill.test.mjs.
// Why (27 Oct 2026, owner): "We fixed the form filling hundreds of times and it's still regressing": a session needs one pass/fail line before any PR, not a CI wait.

export const BUCKETS = ['right', 'wrong', 'empty', 'not reached'];
// A check kind that names a box left unfilled, a wrong value, or a page the fill never got to; first match in this order wins (a wrong value is worse than an empty box).
const WRONG = /^(valueIs|notTold|notJudged|notPending|traced|notTraced|truth|truthful|atMost|maxTabs|maxNewTabs|agreement|false)/;
const EMPTY = /^(filled|kept|attached|pressed|chosen|valueHas|present|gone|empty|pending|panelHas)/;
const NOT_REACHED = /^(error|isolation|asked|judged|told|stuck|ending|onTop)/;

/** One case's result ({ok, failures}) -> its bucket. A missing result (the browser died) is not reached. */
export function bucketOf(result) {
  if (!result) return 'not reached';
  if (result.ok) return 'right';
  const kinds = (result.failures || []).map(line => line.split(/[:\s]/)[0]);
  if (kinds.some(kind => WRONG.test(kind))) return 'wrong';
  if (kinds.some(kind => NOT_REACHED.test(kind) && !EMPTY.test(kind))) return 'not reached';
  if (kinds.some(kind => EMPTY.test(kind))) return 'empty';
  return 'wrong';
}

/** verdicts [{name, bucket}] -> {total, right, wrong, empty, 'not reached', cases: {name: bucket}} */
export function summarize(verdicts) {
  const out = {total: verdicts.length, right: 0, wrong: 0, empty: 0, 'not reached': 0, cases: {}};
  for (const one of verdicts) { out[one.bucket]++; out.cases[one.name] = one.bucket; }
  return out;
}

/** now against main's stored numbers, over the cases this run has (a quick run is a part of the stored whole): red when a case main had right is not right. -> {red, main: main's counts over those cases}. A case main never saw is only counted. */
export function compare(base, now) {
  const main = {right: 0, wrong: 0, empty: 0, 'not reached': 0};
  for (const name of Object.keys(now.cases)) if (base.cases[name]) main[base.cases[name]]++;
  const red = Object.entries(now.cases).filter(([name, bucket]) => base.cases[name] === 'right' && bucket !== 'right').map(([name, bucket]) => `${name} (${bucket})`);
  return {red, main};
}

/** A run whose harness replayed nothing (no result, or every case stopped at an error or isolation line) is not a finding about the filler: check:fill fails it as a harness error. */
export const replayedNothing = (results, verdicts) => !results.length || verdicts.every(one => one.bucket === 'not reached' && one.failures.some(line => /^(error|isolation)/.test(line)));
