// Cases for tools/gitar-label.mjs, run by tests/test_gitar_label.py: Gitar's real verdict lines map to one label, and a verdict older than the head commit gets none.
import test from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {mkdtempSync, readFileSync, rmSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {canSkipFromPayload, converge, fromGraphql, readPr, setLabels, verdictKind, wantedLabel, wantedLabels, LABELS, WAITING, WORKING} from '../tools/gitar-label.mjs';
const wrap = kbd => `<details>\n<summary><b>Code Review</b> ${kbd}</summary>\n\nBody\n</details>`;
const APPROVED = wrap('<kbd>✅ Approved</kbd>');   // #2377, #2380
const SUGGEST = wrap('<kbd>👍 Approved with suggestions</kbd> <kbd>2 closed / 3 findings</kbd>');   // #2381
const CHANGES = wrap('<kbd>⚠️ Changes requested</kbd> <kbd>0 closed / 3 findings</kbd>');   // #2382

const payloadCases = [
  {name: 'approved already held', body: APPROVED, labels: [LABELS.approved.name], skip: true, before: 5},
  {name: 'suggestions already held', body: SUGGEST, labels: [LABELS.suggestions.name], skip: true, before: 5},
  {name: 'changes already held', body: CHANGES, labels: [LABELS.changes.name], skip: true, before: 5},
  {name: 'still reviewing', body: 'Gitar is reviewing…', labels: [WAITING.name], skip: true, before: 5},
  {name: 'different verdict', body: APPROVED, labels: [LABELS.changes.name], skip: false, before: 13},
  {name: 'working plus approval', body: APPROVED, labels: [LABELS.approved.name, WORKING.name], skip: false, before: 12},
  {name: 'push clears stale approval', event: 'pull_request_target', body: APPROVED, labels: [LABELS.approved.name], skip: false, before: 13},
];

test('payload skips only matching comment verdicts or reviewing without any verdict label', () => {
  const canSkip = (body, labels, event = 'issue_comment', login = 'gitar-bot[bot]') => canSkipFromPayload({event, comment: {body, user: {login}}, labels});
  for (const c of payloadCases) assert.equal(canSkip(c.body, c.labels, c.event), c.skip, c.name);
  for (const label of Object.values(LABELS)) {
    assert.equal(canSkip('still analysing', [WAITING.name, label.name]), false, 'a verdict label still needs clearing');
    assert.equal(canSkip(APPROVED, [label.name], 'pull_request_target'), false, 'pushes always read live state');
  }
  assert.equal(canSkip('still analysing', []), false, 'missing reviewing label needs adding');
  assert.equal(canSkip('still analysing', [WAITING.name, WORKING.name]), true);
  assert.equal(canSkip(CHANGES, [LABELS.changes.name, WORKING.name]), true);
  assert.equal(canSkip(SUGGEST, [LABELS.suggestions.name, WORKING.name]), true, 'suggestions keep working under the existing policy');
  assert.equal(canSkip(APPROVED, [LABELS.approved.name], 'issue_comment', 'someone-else'), false);
  assert.equal(canSkipFromPayload({event: 'pull_request_target'}), false);
});

/** Runs the real CLI with only gh replaced; the fake records calls and persists label writes for convergence reads. */
function runCliCase(t, {event = 'issue_comment', body = APPROVED, labels = [], failure = '', legacy = false, eventFile = 'present', issueBody = ''} = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'gitar-label-'));
  t.after(() => rmSync(dir, {recursive: true, force: true}));
  const stateFile = join(dir, 'state.json'), preload = join(dir, 'fake-gh.mjs'), payloadFile = join(dir, 'event.json');
  writeFileSync(stateFile, JSON.stringify({calls: 0, labels, body}));
  writeFileSync(preload, `// Replaces only gh so this CLI test cannot access GitHub or credentials.
import childProcess from 'node:child_process';
import {syncBuiltinESMExports} from 'node:module';
import {readFileSync, writeFileSync} from 'node:fs';
childProcess.execFileSync = (file, args) => {
  if (file !== 'gh') throw new Error('unexpected executable: ' + file);
  const state = JSON.parse(readFileSync(process.env.FAKE_GH_STATE, 'utf8'));
  state.calls++;
  writeFileSync(process.env.FAKE_GH_STATE, JSON.stringify(state));
  if (process.env.FAKE_GH_FAILURE) throw new Error(process.env.FAKE_GH_FAILURE);
  const names = state.labels.map(name => ({name}));
  let result;
  if (args[0] === 'api') {
    const path = args[1];
    if (path === 'repos/o/r/pulls/1') result = {state: 'open', head: {sha: 'head'}};
    else if (path === 'repos/o/r/commits/head') result = {commit: {committer: {date: process.env.FAKE_HEAD_TIME}}};
    else if (path.endsWith('/check-suites')) result = {check_suites: []};
    else if (path.endsWith('/comments')) result = [[{user: {login: 'gitar-bot[bot]'}, body: state.body, updated_at: '2026-10-28T20:05:00Z'}]];
    else if (path.endsWith('/labels')) result = [names];
    else if (path.endsWith('/events')) result = [[{event: 'labeled', label: {name: 'Working on PR comments'}, created_at: '2026-10-28T20:05:00Z'}]];
    else throw new Error('unexpected API path: ' + path);
    return JSON.stringify(result);
  }
  if (args[0] === 'label' && args[1] === 'create') return '';
  if (args[0] !== 'pr' || args[1] !== 'edit') throw new Error('unexpected gh args: ' + args);
  const add = args.indexOf('--add-label'), remove = args.indexOf('--remove-label');
  if (add >= 0) state.labels.push(args[add + 1]);
  else if (remove >= 0) state.labels = state.labels.filter(name => name !== args[remove + 1]);
  else throw new Error('unexpected label edit: ' + args);
  writeFileSync(process.env.FAKE_GH_STATE, JSON.stringify(state));
  return '';
};
syncBuiltinESMExports();
`);
  const labelObjects = labels.map(name => ({name}));
  const payload = event === 'issue_comment'
    ? {comment: {body, user: {login: 'gitar-bot[bot]'}}, issue: {body: issueBody, labels: labelObjects}}
    : {pull_request: {labels: labelObjects}};
  writeFileSync(payloadFile, JSON.stringify(payload));
  const eventPath = legacy || eventFile === 'unset' ? '' : eventFile === 'missing' ? join(dir, 'missing.json') : eventFile === 'unreadable' ? dir : payloadFile;
  const done = spawnSync(process.execPath, ['--import', preload, fileURLToPath(new URL('../tools/gitar-label.mjs', import.meta.url)), '1'], {
    encoding: 'utf8',
    env: {PATH: process.env.PATH, GITHUB_REPOSITORY: 'o/r', GITHUB_EVENT_NAME: event,
      GITHUB_EVENT_PATH: eventPath, FAKE_GH_STATE: stateFile,
      FAKE_HEAD_TIME: event === 'pull_request_target' ? '2026-10-28T20:10:00Z' : '2026-10-28T20:00:00Z', FAKE_GH_FAILURE: failure},
  });
  assert.ifError(done.error);
  return {...done, ...JSON.parse(readFileSync(stateFile, 'utf8'))};
}

test('CLI gh calls before (unchanged live path) and after payload guard', t => {
  t.diagnostic('Case | Before gh calls | After gh calls');
  for (const c of payloadCases) {
    const before = runCliCase(t, {...c, legacy: true}), after = runCliCase(t, c);
    assert.equal(before.status, 0, before.stderr);
    assert.equal(after.status, 0, after.stderr);
    assert.equal(before.calls, c.before, c.name);
    assert.equal(after.calls, c.skip ? 0 : c.before, c.name);
    assert.deepEqual(after.labels, before.labels, c.name);
    t.diagnostic(`${c.name} | ${before.calls} | ${after.calls}`);
  }
});

test('CLI reads event files over 128 KB and falls back to live reads for unavailable files', t => {
  const large = runCliCase(t, {labels: [LABELS.approved.name], issueBody: 'x'.repeat(160 * 1024)});
  assert.equal(large.status, 0, large.stderr);
  assert.equal(large.calls, 0, 'a large event file still skips without an oversized environment string');
  for (const eventFile of ['unset', 'missing', 'unreadable']) {
    const done = runCliCase(t, {labels: [LABELS.approved.name], eventFile});
    assert.equal(done.status, 0, done.stderr);
    assert.equal(done.calls, 5, `${eventFile}: no payload means the existing live path`);
    assert.deepEqual(done.labels, [LABELS.approved.name]);
  }
});

test('CLI notices rate limits but permission-denied 403 and server errors still fail', t => {
  for (const [failure, status] of [
    ['HTTP 403 API rate limit exceeded for installation', 0],
    ['HTTP 403 secondary rate limit exceeded', 0],
    ['HTTP 429 Too Many Requests', 0],
    ['rate limit exceeded', 0],
    ['HTTP 403 Resource not accessible by integration', 1],
    ['HTTP 500 Internal Server Error', 1],
  ]) {
    const done = runCliCase(t, {failure, labels: [WAITING.name]});
    assert.equal(done.status, status, done.stderr);
    assert.equal(done.calls, 1, 'never retry a failed gh call');
    assert.deepEqual(done.labels, [WAITING.name]);
    const notices = done.stdout.split('\n').filter(line => line.startsWith('::notice::'));
    assert.equal(notices.length, status === 0 ? 1 : 0);
    if (notices.length) assert.match(notices[0], /label.*left as it is/i);
    else assert.ok(done.stderr.includes(failure), done.stderr);
  }
});

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
