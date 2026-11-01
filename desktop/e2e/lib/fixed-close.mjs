// A Finder issue closed by a fix: "Fixes #N" in a commit or a merged pull request closes it as completed with no verdict, so the stats never counted it
// as a real bug (12 Oct 2026: #360 and #400). The labels a verdict would have set. Pure; fixed-close.mjs (issue-fixed.yml) applies them. Guarded by test/pool/fixed-close.test.mjs.

// A path a test fix touches: the tests, their harness and fixtures, the docs. A fix touching nothing else proves neither way: a test mistake (#350), or a real
// bug whose product fix landed in another commit that did not name it (#400, e61e334). Left for a verdict.
const TEST_OR_DOC = /^(?:desktop\/e2e\/|desktop\/test\/|tests\/|worker\/test\/|docs\/)|\.md$|\.test\.[cm]?[jt]s$/;
export const testOnly = files => Array.isArray(files) && files.length > 0 && files.every(file => TEST_OR_DOC.test(file));

// {labels: [names], stateReason: 'COMPLETED' | 'NOT_PLANNED' | …, closer: the ClosedEvent's closer (a Commit or a PullRequest) or null,
//  files: the paths the fix changed, when known}
// -> {add: [labels], comment} or null (not a Finder issue, not closed by a fix, or a verdict already said why).
export function labelsForClose({labels = [], stateReason = '', closer = null, files} = {}) {
  if (!labels.includes('auto-ui') || stateReason !== 'COMPLETED') return null;
  if (labels.some(name => name.startsWith('resolution:'))) return null;   // apply-verdict.sh labels before it closes
  const fix = closer?.__typename === 'Commit' ? `commit ${String(closer.oid || '').slice(0, 7)}`
    : closer?.__typename === 'PullRequest' && closer.merged ? `pull request #${closer.number}` : '';
  if (!fix) return null;
  const link = closer.url ? `: ${closer.url}` : '';
  if (testOnly(files)) {
    return {add: labels.includes('needs-human') ? [] : ['needs-human'],
      comment: `🧪 Closed by a change to the test (${fix}${link}): it changed only tests or docs, so it is not counted yet. Was the test wrong (verdict \`harness\`), or was the product fixed in another commit (verdict \`fixed\`, naming it)? Give it a verdict with desktop/e2e/apply-verdict.sh.`};
  }
  return {add: [...(labels.includes('confirmed') ? [] : ['confirmed']), 'resolution:fixed'],
    comment: `✅ Closed by a fix (${fix}${link}), so it counts as a real bug, fixed. A wrong call? Reopen it and give it a verdict (desktop/e2e/apply-verdict.sh).`};
}
