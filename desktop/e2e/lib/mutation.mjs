// Mutation testing of the Finder (5 Oct 2026): planted page elements only test the detectors, so they cannot say whether the suites catch a real bug in the
// app's own code. A mutant is one such bug written into critical-path code (mutants.json: a file, an exact text, what replaces it, the suite that should
// catch it). mutation.yml runs each mutant's suite on the mutated app (e2e.yml input `mutant`); a red suite KILLS the mutant, a green one lets it SURVIVE:
// a serious bug the Finder would miss. Each suite also runs once unmutated (`baseline`): a suite that is red anyway says nothing, so its mutants are "unknown". Pure.
export const BASELINE = 'baseline';
// A mutant runs on the store its bug lives on (mutants.json `store`, 27 Oct 2026), and is judged against its suite's baseline on that same store.
export const baselineKey = (suite, store = '') => `${BASELINE}:${suite}${store ? `:${store}` : ''}`;
// What a mutation run does, in order: one baseline per suite and store, then every mutant. -> [{mutant, suite, store}]
export function plan(mutants) {
  const legs = [...new Map(mutants.map(item => [`${item.suite}:${item.store || ''}`, {mutant: BASELINE, suite: item.suite, store: item.store || ''}])).values()];
  return [...legs, ...mutants.map(item => ({mutant: item.id, suite: item.suite, store: item.store || ''}))];
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
export function score(mutants, runs) {
  const rows = mutants.map(mutant => {
    const base = read(runs[baselineKey(mutant.suite, mutant.store)] ?? runs[baselineKey(mutant.suite)]), own = read(runs[mutant.id]);
    const raised = own.findings.filter(item => !base.findings.includes(item));
    const outcome = base.conclusion !== 'success' ? 'unknown' : own.conclusion === 'failure' || (own.conclusion === 'success' && raised.length) ? 'killed'
      : own.conclusion === 'success' ? 'survived' : 'unknown';
    const why = base.conclusion !== 'success' ? `the ${mutant.suite} suite is not green without the mutant (${base.conclusion || 'not run'})` : outcome === 'unknown' ? `the mutant run ended "${own.conclusion || 'not run'}"`
      : outcome === 'killed' ? (own.conclusion === 'failure' ? 'the suite went red' : `found: ${raised.slice(0, 2).join(', ')}`) : '';
    return {id: mutant.id, suite: mutant.suite, store: mutant.store || '', what: mutant.what, outcome, why};
  });
  const count = outcome => rows.filter(row => row.outcome === outcome).length;
  const judged = count('killed') + count('survived');
  return {rows, killed: count('killed'), survived: count('survived'), unknown: count('unknown'), score: judged ? Math.round(100 * count('killed') / judged) : null};
}

export function summary(result) {
  const icon = {killed: '✅ caught', survived: '🔴 missed', unknown: '⚪ unknown'};
  return [`## 🧬 Planted code bugs: ${result.score === null ? 'no result' : `${result.score}% caught`} (${result.killed} caught, ${result.survived} missed, ${result.unknown} unknown)`, '',
    '| Planted bug | Suite | The bug | Result |', '|---|---|---|---|',
    ...result.rows.map(row => `| \`${row.id}\` | ${row.suite} | ${row.what} | ${icon[row.outcome]}${row.why ? ` (${row.why})` : ''} |`)].join('\n');
}

// The issues a scored run leaves (mutation-score.mjs): one per missed mutant (a comment on its open one), and the open issue of a mutant caught now is closed.
// An unknown outcome (its suite red without the mutant) changes nothing. open: [{number, title}] -> {create: [row], comment: [{number, row}], close: [{number, row}]}
// Visible words say "planted code bug", never "mutation"/"mutant" (owner, 27 Oct 2026: "Visible names only"); code and file names keep the standard term.
export const issueTitle = id => `[planted bug] ${id}: no suite caught it`;
const oldTitle = id => `[mutation] ${id} survived: no suite caught it`;   // issues filed before 27 Oct 2026
// The new issue's body: what was planted, where, and how to replay it.
export const issueBody = (row, run) => [`> [!WARNING]`, `> A serious bug was written into the app on purpose and the \`${row.suite}\` suite stayed green.`, '',
  `**The bug:** ${row.what}`, `**Planted bug:** \`${row.id}\` in \`desktop/e2e/mutants.json\``, `**Run:** ${run}`, '',
  `**Next:** add the check that would have caught it (a truth check, a step in \`${row.suite}\`), then the next planted-bug run catches it. Replay: \`gh workflow run e2e.yml -f suite=${row.suite} -f store=${row.store || 'alternate'} -f mutant=${row.id}\`.`].join('\n');
export function issueActions(result, open) {
  const known = row => open.find(issue => issue.title === issueTitle(row.id) || issue.title === oldTitle(row.id));
  const survived = result.rows.filter(row => row.outcome === 'survived'), killed = result.rows.filter(row => row.outcome === 'killed' && known(row));
  return {create: survived.filter(row => !known(row)), comment: survived.filter(known).map(row => ({number: known(row).number, row})),
    close: killed.map(row => ({number: known(row).number, row}))};
}
