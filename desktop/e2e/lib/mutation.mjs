// Mutation testing of the Finder (5 Oct 2026): planted page elements only test the detectors, so they cannot say whether the suites catch a real bug in the
// app's own code. A mutant is one such bug written into critical-path code (mutants.json: a file, an exact text, what replaces it, the test that should
// catch it). mutation.yml plants each one and runs its test; a red test KILLS the mutant, a green one lets it SURVIVE: a serious bug no test would catch.
// Each test also runs once unmutated (`baseline`): a test that is red anyway says nothing, so its mutants are "unknown". Pure.
// Why (1 Nov 2026, owner via mac-07, tg's report §7 item 4; JOB-177): the screens moved from e2e suites to integration and unit tests that day, and mutants.json
// was emptied with them (12 mutants on 31 Oct, 0 after). A mutant now names a `test` (a unit or integration file, run in seconds by mutate-tests.mjs) or,
// for a bug only a journey shows, a `suite` (an e2e.yml dispatch, as before). Report only: no gate, the weekly schedule unchanged.
// Job: report health
export const BASELINE = 'baseline';
// A mutant runs on the store its bug lives on (mutants.json `store`, 27 Oct 2026), and is judged against its suite's baseline on that same store.
export const baselineKey = (suite, store = '') => `${BASELINE}:${suite}${store ? `:${store}` : ''}`;
// A test mutant is judged against its own test file run unmutated.
export const testBaselineKey = test => `${BASELINE}:test:${test}`;
// Takes one mutants.json entry; returns true when it names a unit or integration `test` file (run by mutate-tests.mjs), false for a suite mutant or a malformed entry.
export const isTestMutant = mutant => typeof mutant?.test === 'string' && mutant.test.length > 0;
// What the e2e part of a mutation run does, in order: one baseline per suite and store, then every suite mutant. -> [{mutant, suite, store}]
export function plan(mutants) {
  const suites = mutants.filter(item => !isTestMutant(item));
  const legs = [...new Map(suites.map(item => [`${item.suite}:${item.store || ''}`, {mutant: BASELINE, suite: item.suite, store: item.store || ''}])).values()];
  return [...legs, ...suites.map(item => ({mutant: item.id, suite: item.suite, store: item.store || ''}))];
}

// How CI runs a test file (repo-root path) -> {cwd (repo-relative), argv}: the unit and app-integration tests from desktop/ behind the no-live-site guard
// (integration.yml app job, package.json "test"), the store-integration tests from desktop/e2e (integration.yml store job), the engine's with unittest.
export function testCommand(test) {
  if (test.endsWith('.py')) return {cwd: '.', argv: ['python3', '-m', 'unittest', test.replace(/\.py$/, '').replace(/\//g, '.')]};
  if (test.startsWith('desktop/integration/store/')) return {cwd: 'desktop/e2e', argv: ['node', '--import', './test/stdout-to-stderr.mjs', '--test', '--test-timeout=180000', `../${test.slice('desktop/'.length)}`]};
  if (test.startsWith('desktop/e2e/')) return {cwd: 'desktop/e2e', argv: ['node', '--test', test.slice('desktop/e2e/'.length)]};
  if (test.startsWith('desktop/')) return {cwd: 'desktop', argv: ['node', '--import', './test/no-live-site.mjs', '--test', test.slice('desktop/'.length)]};
  throw new Error(`no way to run ${test}: a mutant's test is a file under desktop/ or a tests/*.py`);
}

// The mutated text, or an error that names why the mutant no longer applies (the code moved on: the mutant must be updated, never silently skipped).
export function applyMutant(source, mutant) {
  const at = source.indexOf(mutant.find);
  if (at < 0) throw new Error(`mutant ${mutant.id}: its text is no longer in ${mutant.file}`);
  if (source.indexOf(mutant.find, at + 1) >= 0) throw new Error(`mutant ${mutant.id}: its text is in ${mutant.file} more than once`);
  return source.slice(0, at) + mutant.replace + source.slice(at + mutant.find.length);
}

// runs: {[mutant id or `baseline:<suite>`]: {conclusion: 'success' | 'failure' | …, findings: ['kind|view', …]}} (a plain conclusion string is read too).
// A mutant is KILLED when its suite went red, or when a detector raised something the unmutated run did not (a truth check files a finding, it does not
// turn the suite red). -> {rows, killed, survived, unknown, score}
const read = value => (typeof value === 'string' ? {conclusion: value, findings: []} : {conclusion: value?.conclusion, findings: value?.findings || []});
// The unmutated run a mutant is judged against: its own test file's, or its suite's on the mutant's store (else the suite's default store).
const baselineOf = (mutant, runs) => read(isTestMutant(mutant) ? runs[testBaselineKey(mutant.test)]
  : runs[baselineKey(mutant.suite, mutant.store)] ?? runs[baselineKey(mutant.suite)]);
// killed: the mutant run went red, or green with a finding the baseline lacked; survived: green with nothing new; unknown: a red baseline or no clean end.
const outcomeOf = (base, own, raised) => {
  if (base.conclusion !== 'success') return 'unknown';
  if (own.conclusion === 'failure' || (own.conclusion === 'success' && raised.length)) return 'killed';
  return own.conclusion === 'success' ? 'survived' : 'unknown';
};
// The row's "why" in plain words, for the summary table and the issue.
const whyOf = (mutant, outcome, base, own, raised) => {
  const test = isTestMutant(mutant);
  if (base.conclusion !== 'success') return `${test ? mutant.test : `the ${mutant.suite} suite`} is not green without the planted bug (${base.conclusion || 'not run'})`;
  if (outcome === 'unknown') return `the mutant run ended "${own.conclusion || 'not run'}"`;
  if (outcome !== 'killed') return '';
  if (own.conclusion !== 'failure') return `found: ${raised.slice(0, 2).join(', ')}`;
  return test ? 'its test went red' : 'the suite went red';
};
// One summary row per mutant: {id, suite (the suite or test file), test?, file?, store, what, outcome, why}.
const rowOf = (mutant, runs) => {
  const base = baselineOf(mutant, runs), own = read(runs[mutant.id]);
  const raised = own.findings.filter(item => !base.findings.includes(item));
  const outcome = outcomeOf(base, own, raised);
  return {id: mutant.id, suite: isTestMutant(mutant) ? mutant.test : mutant.suite, ...(isTestMutant(mutant) ? {test: true, file: mutant.file} : {}),
    store: mutant.store || '', what: mutant.what, outcome, why: whyOf(mutant, outcome, base, own, raised)};
};
export function score(mutants, runs) {
  const rows = mutants.map(mutant => rowOf(mutant, runs));
  const count = outcome => rows.filter(row => row.outcome === outcome).length;
  const judged = count('killed') + count('survived');
  return {rows, killed: count('killed'), survived: count('survived'), unknown: count('unknown'), score: judged ? Math.round(100 * count('killed') / judged) : null};
}

export function summary(result) {
  const icon = {killed: '✅ caught', survived: '🔴 missed', unknown: '⚪ unknown'};
  return [`## 🧬 Planted code bugs: ${result.score === null ? 'no result' : `${result.score}% caught`} (${result.killed} caught, ${result.survived} missed, ${result.unknown} unknown)`, '',
    '| Planted bug | Suite or test | The bug | Result |', '|---|---|---|---|',
    ...result.rows.map(row => `| \`${row.id}\` | ${row.suite} | ${row.what} | ${icon[row.outcome]}${row.why ? ` (${row.why})` : ''} |`)].join('\n');
}

// The issues a scored run leaves (mutation-score.mjs): one per missed mutant (a comment on its open one), and the open issue of a mutant caught now is closed.
// An unknown outcome (its suite red without the mutant) changes nothing. open: [{number, title}] -> {create: [row], comment: [{number, row}], close: [{number, row}]}
// Visible words say "planted code bug", never "mutation"/"mutant" (owner, 27 Oct 2026: "Visible names only"); code and file names keep the standard term.
export const issueTitle = id => `[planted bug] ${id}: no suite caught it`;
const oldTitle = id => `[mutation] ${id} survived: no suite caught it`;   // issues filed before 27 Oct 2026
// The new issue's body: what was planted, where, and how to replay it.
export const issueBody = (row, run) => {
  const replay = row.test ? `\`node desktop/e2e/mutate.mjs ${row.id}\`, then \`(cd ${testCommand(row.suite).cwd} && ${testCommand(row.suite).argv.join(' ')})\`, then \`git checkout -- ${row.file || '<the planted file>'}\``
    : `\`gh workflow run e2e.yml -f suite=${row.suite} -f store=${row.store || 'alternate'} -f mutant=${row.id}\``;
  return [`> [!WARNING]`, `> A serious bug was written into the app on purpose and ${row.test ? `its test \`${row.suite}\`` : `the \`${row.suite}\` suite`} stayed green.`, '',
    `**The bug:** ${row.what}`, `**Planted bug:** \`${row.id}\` in \`desktop/e2e/mutants.json\``, `**Run:** ${run}`, '',
    `**Next:** add the check that would have caught it (${row.test ? `a test in \`${row.suite}\` that fails while the bug is planted` : `a truth check, a step in \`${row.suite}\``}), then the next planted-bug run catches it. Replay: ${replay}.`].join('\n');
};
export function issueActions(result, open) {
  const known = row => open.find(issue => issue.title === issueTitle(row.id) || issue.title === oldTitle(row.id));
  const survived = result.rows.filter(row => row.outcome === 'survived'), killed = result.rows.filter(row => row.outcome === 'killed' && known(row));
  return {create: survived.filter(row => !known(row)), comment: survived.filter(known).map(row => ({number: known(row).number, row})),
    close: killed.map(row => ({number: known(row).number, row}))};
}
