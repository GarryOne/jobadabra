// "Flaky" needs proof (gate G5, owner's yes 26 Oct 2026): a step that failed and then passed on the same commit is flaky only when its failure was timing or the
// test's environment (a wait that ran out, a dropped connection, an HTML error page). A wrong value that came right on the second try is INTERMITTENT: the
// product or the test behaves differently between two runs of the same code (a race), a bug that shows sometimes. It keeps its rank, goes to the fixer, and only
// a fix closes it; in CI it keeps the job red (e2e.yml / desktop.yml "once more" step, node flaky-proof.mjs).
// Why: #1897 (25 Oct): failuresnotion's "the list says Completed and the panel Completed with warnings" failed, passed on the rerun, was labelled flaky
// ("the test is the problem"), ranked last, closed after two clean runs, and failed beta 2; it was a product bug (bd368f8 fixed it).
// Only the failure message is read, never the step's name: that step is called "Notion is busy (429) …", which reads like an environment failure.
// Tests: test/flaky-proof.test.mjs
import {isEnvironment} from './environment.mjs';
import {FLAKY, TIMEOUT_FAILURE, flakyComment} from './triage-match.mjs';

export const INTERMITTENT = 'intermittent';

// message: the failed step's note (suite-failures.json `message`), without the step's name → {flaky, why}
// The harness's own guards (the extension not on the stand-in app): never a product bug and never flaky (a run that may have reached the owner's live app stays
// red), named "harness: <which>" so a red main reads as the harness's (6e, 27 Oct 2026: a false NOT ISOLATED was announced as "a wrong value", like a product bug).
const HARNESS = [[/NOT ISOLATED:/, 'isolation']];
export function flakyProof(message = '') {
  const text = String(message || '');
  const harness = HARNESS.find(([pattern]) => pattern.test(text));
  if (harness) return {flaky: false, harness: harness[1], why: `harness: ${harness[1]}: "${text.split('\n')[0].slice(0, 140)}"`};
  const timing = TIMEOUT_FAILURE.exec(text);
  if (timing) return {flaky: true, why: `timing: "${timing[0]}"`};
  if (isEnvironment(text)) return {flaky: true, why: 'the test environment answered badly'};
  return {flaky: false, why: `a wrong value, not timing: "${text.split('\n')[0].slice(0, 140)}"`};
}

// The failed steps of a first try (suite-failures.json) that passed on the second try without proof of being flaky.
export const unproved = failures => (failures || []).map(failure => ({...failure, proof: flakyProof(failure.message)})).filter(failure => !failure.proof.flaky);

export const intermittentComment = (sha7, runUrl, why) => `🔁 **Intermittent, not flaky:** this step failed and then passed on the same commit \`${sha7}\` (${runUrl}), but on ${why}. `
  + 'Same code, two results: the product or the test behaves differently between runs (a race), a bug that shows sometimes. Labelled `intermittent`: it keeps its rank, '
  + 'goes to the fixer, and only a fix closes it ("not seen" proves nothing here).';

// Triage's label for a step that failed and passed on the same commit: `flaky` with its proof, or `intermittent`. gh and out (the run's tallies) are triage's.
export function labelRerun({gh, number, message, sha7, runUrl, out}) {
  const proof = flakyProof(message);
  const [label, color, description, comment, tally] = proof.flaky
    ? [FLAKY, 'FEF2C0', 'A test step that failed on timing and passed on the same commit', flakyComment(sha7, runUrl, proof.why), 'flaky']
    : [INTERMITTENT, 'D93F0B', 'Failed on a wrong value and passed on the same commit: a bug that shows sometimes', intermittentComment(sha7, runUrl, proof.why), 'intermittent'];
  gh(['label', 'create', label, '--force', '--color', color, '--description', description]);
  gh(['issue', 'edit', String(number), '--add-label', label]);
  gh(['issue', 'comment', String(number), '--body', comment]);
  out[tally] = [...(out[tally] || []), number];
  return label;
}
