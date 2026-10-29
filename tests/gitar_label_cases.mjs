// Cases for tools/gitar-label.mjs, run by tests/test_gitar_label.py: Gitar's real verdict lines map to one label, and a verdict older than the head commit gets none.
import test from 'node:test';
import assert from 'node:assert/strict';
import {converge, fromGraphql, readPr, setLabels, verdictKind, wantedLabel, wantedLabels, LABELS, WAITING, WORKING} from '../tools/gitar-label.mjs';
const wrap = kbd => `<details>\n<summary><b>Code Review</b> ${kbd}</summary>\n\nBody\n</details>`;
const APPROVED = wrap('<kbd>✅ Approved</kbd>');   // #2377, #2380
const SUGGEST = wrap('<kbd>👍 Approved with suggestions</kbd> <kbd>2 closed / 3 findings</kbd>');   // #2381
const CHANGES = wrap('<kbd>⚠️ Changes requested</kbd> <kbd>0 closed / 3 findings</kbd>');   // #2382

test('real verdict lines map to their kind', () => {
  assert.equal(verdictKind(APPROVED), 'approved');
  assert.equal(verdictKind(SUGGEST), 'suggestions');
  assert.equal(verdictKind(CHANGES), 'changes');
});
test('no verdict line, no label; an unknown state is red, never green', () => {
  assert.equal(verdictKind('Gitar is reviewing…'), null);
  assert.equal(verdictKind(''), null);
  assert.equal(verdictKind(wrap('<kbd>🔄 Reviewing</kbd>')), 'changes');
});
test('a verdict written before the head commit is stale', () => {
  assert.equal(wantedLabel(APPROVED, '2026-10-28T19:59:08Z', '2026-10-28T19:56:45Z'), LABELS.approved.name);
  assert.equal(wantedLabel(APPROVED, '2026-10-28T19:50:00Z', '2026-10-28T19:56:45Z'), null);
  assert.equal(wantedLabel('no verdict', '2026-10-28T19:59:08Z', '2026-10-28T19:56:45Z'), null);
});
const HEAD = '2026-10-28T20:00:00Z', BEFORE = '2026-10-28T19:00:00Z', AFTER = '2026-10-28T20:05:00Z';
test('no current verdict shows "reviewing"; working ends with a push or an approval, never with a red verdict', () => {
  const w = (verdict, workingSince) => wantedLabels({verdict, workingSince, headTime: HEAD});
  assert.deepEqual(w(null, null), [WAITING.name]);
  assert.deepEqual(w(LABELS.changes.name, AFTER), [LABELS.changes.name, WORKING.name]);
  assert.deepEqual(w(null, BEFORE), [WAITING.name]);   // set before the head was pushed: the push ended it, even if no push event ran
  assert.deepEqual(w(LABELS.approved.name, AFTER), [LABELS.approved.name]);
  assert.deepEqual(w(LABELS.suggestions.name, AFTER), [LABELS.suggestions.name, WORKING.name]);
});

test('overlapping runs: the run that read a stale verdict and wrote last re-reads and ends on the current label (#2404, Gitar)', () => {
  // Run A read "no verdict for the new head" before Gitar approved; run B read "approved" while the PR still held approved, so it changed nothing.
  // A then wrote "reviewing" last. The real setLabels writes through a fake gh that keeps the PR's labels; converge re-reads until nothing changes.
  const pr = {verdict: LABELS.approved.name, labels: new Set([WAITING.name])};   // the live state after A's stale write
  const fakeGh = (...args) => {
    const at = args.indexOf('--add-label'), off = args.indexOf('--remove-label');
    if (at >= 0) pr.labels.add(args[at + 1]);
    if (off >= 0) pr.labels.delete(args[off + 1]);
    return '';
  };
  const syncOnce = () => setLabels('o/r', 1, wantedLabels({verdict: pr.verdict, workingSince: null, headTime: '2026-10-28T21:00:00Z'}), [...pr.labels], fakeGh) > 0;
  assert.equal(converge(syncOnce), 2, 'one round that writes, then a fresh read that wants no change');
  assert.deepEqual([...pr.labels], [LABELS.approved.name]);
  assert.equal(setLabels('o/r', 1, [LABELS.approved.name], [WAITING.name], () => ''), 2, 'a stale label is removed and the wanted one added: 2 changes');
  assert.equal(setLabels('o/r', 1, [LABELS.approved.name], [LABELS.approved.name], () => ''), 0, 'nothing to change: 0');
  let rounds = 0;
  assert.equal(converge(() => { rounds++; return true; }), 3, 'a state that keeps moving stops after 3 rounds');
  assert.equal(rounds, 3);
});

// Cost (29 Oct 2026): a label run read the PR with six REST calls and ran ~125 times an hour at peak, over half of Actions' 1,000-an-hour GITHUB_TOKEN quota: 403s on unrelated PRs.
const GQL = {repository: {pullRequest: {
  state: 'OPEN', headRefOid: 'abc1234',
  comments: {pageInfo: {hasPreviousPage: false}, nodes: [
    {author: {login: 'someone'}, body: 'hi', updatedAt: '2026-10-29T01:00:00Z'},
    {author: {login: 'gitar-bot'}, body: '<summary><b>Code Review</b> <kbd>✅ Approved</kbd>', updatedAt: '2026-10-29T01:10:00Z'}]},
  labels: {nodes: [{name: 'Gitar: reviewing'}, {name: 'Working on PR comments'}]},
  timelineItems: {nodes: [{createdAt: '2026-10-29T01:05:00Z', label: {name: 'Working on PR comments'}}, {createdAt: '2026-10-29T00:50:00Z', label: {name: 'Gitar: reviewing'}}]},
  commits: {nodes: [{commit: {committedDate: '2026-10-29T00:30:00Z', checkSuites: {nodes: [{createdAt: '2026-10-29T00:45:00Z'}, {createdAt: '2026-10-29T00:40:00Z'}]}}}]},
}}};

test('one GraphQL answer carries everything a label run needs (#api-quota)', () => {
  const read = fromGraphql(GQL);
  assert.equal(read.state, 'open');
  assert.equal(read.headTime, '2026-10-29T00:40:00Z', 'the later of the commit date and the first check suite created for the head');
  assert.equal(read.review.updated_at, '2026-10-29T01:10:00Z');
  assert.deepEqual(read.labels, ['Gitar: reviewing', 'Working on PR comments']);
  assert.equal(read.workingSince, '2026-10-29T01:05:00Z', 'the newest "working" label event, not another label');
});

test('Gitar\'s comment cut off by a long thread is not "no verdict": the caller must fall back', () => {
  const cut = structuredClone(GQL);
  cut.repository.pullRequest.comments = {pageInfo: {hasPreviousPage: true}, nodes: [{author: {login: 'someone'}, body: 'x', updatedAt: '2026-10-29T01:00:00Z'}]};
  assert.equal(fromGraphql(cut), null);
});

test('a label run asks GitHub once, not once per fact', () => {
  const asked = [];
  const read = readPr('o/r', 7, (...args) => { asked.push(args); return JSON.stringify({data: GQL}); });
  assert.equal(asked.length, 1);
  assert.equal(read.labels.length, 2);
});

test('a "working" label event with the label gone is not "working" (Gitar, #2445): a removed label must not come back', () => {
  const gone = structuredClone(GQL);
  gone.repository.pullRequest.labels.nodes = [{name: 'Gitar: reviewing'}];   // the label event is still in the timeline
  assert.equal(fromGraphql(gone).workingSince, null, 'the REST path only looks the time up while the label is on the PR');
});
