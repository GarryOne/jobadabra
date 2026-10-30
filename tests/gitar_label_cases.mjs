// Cases for tools/gitar-label.mjs, run by tests/test_gitar_label.py: Gitar's real verdict lines map to one label, and a verdict older than the head commit gets none.
import test from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {mkdtempSync, readFileSync, rmSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {addLabel, awaitComment, readForRun, converge, fromGraphql, readPr, reviewSince, setLabels, verdictKind, wantedLabel, wantedLabels, LABELS, WAITING, WORKING} from '../tools/gitar-label.mjs';
const wrap = kbd => `<details>\n<summary><b>Code Review</b> ${kbd}</summary>\n\nBody\n</details>`;
const APPROVED = wrap('<kbd>✅ Approved</kbd>');   // #2377, #2380
const SUGGEST = wrap('<kbd>👍 Approved with suggestions</kbd> <kbd>2 closed / 3 findings</kbd>');   // #2381
const CHANGES = wrap('<kbd>⚠️ Changes requested</kbd> <kbd>0 closed / 3 findings</kbd>');   // #2382
const REVIEWED_AT = '2026-10-28T20:06:00Z';   // Gitar's review in the event payload; its comment (20:05 by default) is edited after it

/** Runs the CLI with gh replaced by a fake PR. `later` makes Gitar's comment change after that many GraphQL reads (its edit after the review);
 * `missing` lists labels the repo does not have yet (adding one fails "not found"). */
function runCliCase(t, {event = 'pull_request_review', body = APPROVED, labels = [], failure = '', legacy = false, eventFile = 'present', working = false,
  later = null, missing = [], reviewer = 'gitar-bot[bot]'} = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'gitar-label-'));
  t.after(() => rmSync(dir, {recursive: true, force: true}));
  const stateFile = join(dir, 'state.json'), preload = join(dir, 'fake-gh.mjs'), payloadFile = join(dir, 'event.json');
  writeFileSync(stateFile, JSON.stringify({calls: 0, reads: 0, creates: 0, labels, body, updatedAt: '2026-10-28T20:05:00Z', later, missing}));
  writeFileSync(preload, `// Replaces only gh so this CLI test cannot access GitHub or credentials.
import childProcess from 'node:child_process';
import {syncBuiltinESMExports} from 'node:module';
import {readFileSync, writeFileSync} from 'node:fs';
childProcess.execFileSync = (file, args) => {
  if (file !== 'gh') throw new Error('unexpected executable: ' + file);
  const state = JSON.parse(readFileSync(process.env.FAKE_GH_STATE, 'utf8'));
  state.calls++;
  const save = () => writeFileSync(process.env.FAKE_GH_STATE, JSON.stringify(state));
  save();
  if (process.env.FAKE_GH_FAILURE) throw new Error(process.env.FAKE_GH_FAILURE);
  const names = state.labels.map(name => ({name}));
  if (args[0] === 'api' && args[1] === 'graphql') {
    state.reads++;
    const edited = state.later && state.reads > state.later.after ? state.later : state;
    save();
    return JSON.stringify({data: {repository: {pullRequest: {
      state: 'OPEN', headRefOid: 'head',
      comments: {pageInfo: {hasPreviousPage: false}, nodes: [{author: {login: 'gitar-bot'}, body: edited.body, updatedAt: edited.updatedAt}]},
      labels: {nodes: names},
      timelineItems: {nodes: [{label: {name: 'Working on PR comments'}, createdAt: state.workedAt || '2026-10-28T20:05:00Z'}]},
      commits: {nodes: [{commit: {committedDate: process.env.FAKE_HEAD_TIME, checkSuites: {nodes: []}}}]},
    }}}});
  }
  if (args[0] === 'label' && args[1] === 'create') { state.creates++; state.missing = state.missing.filter(name => name !== args[2]); save(); return ''; }
  if (args[0] !== 'pr' || args[1] !== 'edit') throw new Error('unexpected gh args: ' + args);
  const add = args.indexOf('--add-label'), remove = args.indexOf('--remove-label');
  // gh's own words for a label the repo lacks (run 40981811862: "'Merge conflict' not found"), never a made-up wording.
  if (add >= 0 && state.missing.includes(args[add + 1])) throw new Error("'" + args[add + 1] + "' not found");
  state.edits = [...(state.edits || []), args[add >= 0 ? add : remove]];
  if (add >= 0) { state.labels.push(args[add + 1]); state.workedAt = '2026-10-28T20:15:00Z'; }
  else if (remove >= 0) state.labels = state.labels.filter(name => name !== args[remove + 1]);
  else throw new Error('unexpected label edit: ' + args);
  save();
  return '';
};
syncBuiltinESMExports();
`);
  const payload = event === 'pull_request_review' ? {review: {user: {login: reviewer}, submitted_at: REVIEWED_AT}, pull_request: {number: 1}}
    : event === 'issue_comment' ? {comment: {user: {login: 'gitar-bot[bot]'}}, issue: {number: 1, pull_request: {}}}
    : {pull_request: {number: 1}};
  writeFileSync(payloadFile, JSON.stringify(payload));
  const eventPath = legacy || eventFile === 'unset' ? '' : eventFile === 'missing' ? join(dir, 'missing.json') : eventFile === 'unreadable' ? dir : payloadFile;
  const done = spawnSync(process.execPath, ['--import', preload, fileURLToPath(new URL('../tools/gitar-label.mjs', import.meta.url)), ...(working ? ['working', '1'] : ['1'])], {
    encoding: 'utf8',
    env: {PATH: process.env.PATH, GITHUB_REPOSITORY: 'o/r', GITHUB_EVENT_NAME: event, GITAR_LABEL_WAIT_MS: '1',
      GITHUB_EVENT_PATH: eventPath, FAKE_GH_STATE: stateFile,
      FAKE_HEAD_TIME: event === 'pull_request_review' ? '2026-10-28T20:00:00Z' : '2026-10-28T20:10:00Z', FAKE_GH_FAILURE: failure},   // a push or a new comment: the head moved at 20:10
  });
  assert.ifError(done.error);
  return {...done, ...JSON.parse(readFileSync(stateFile, 'utf8'))};
}

test('a review run waits until Gitar\'s comment is newer than the review, then labels from it (#2516: the comment trails the review)', t => {
  // Gitar requested changes earlier; it now approves: the review event arrives while the comment still says "Changes requested", edited two reads later.
  const done = runCliCase(t, {body: CHANGES, labels: [LABELS.changes.name], later: {after: 2, body: APPROVED, updatedAt: '2026-10-28T20:06:05Z'}});
  assert.equal(done.status, 0, done.stderr);
  assert.deepEqual(done.labels, [LABELS.approved.name], 'the verdict of the comment written after the review, never the older one');
  assert.equal(done.reads, 4, 'two reads before the edit, the one that sees it, and converge\'s check that nothing is left to change');
});

test('a comment that never catches up ends the wait after 12 re-reads, labels from what it read and goes red, so a re-run corrects it (Gitar on #2525)', t => {
  const done = runCliCase(t, {body: SUGGEST, labels: []});
  assert.equal(done.status, 1, 'a green run would hide a stale label');
  assert.equal(done.reads, 13 + 1, 'the first read, 12 re-reads, then converge\'s check after its write');
  assert.ok(done.stdout.includes('::error::'), 'a wait that runs out says so on the run');
  assert.deepEqual(done.labels, [LABELS.suggestions.name]);
});

test('after a push with an unchanged verdict Gitar posts a new comment and no review: the push says reviewing, the comment labels it (#2516, 9 of 60 PRs)', t => {
  const pushed = runCliCase(t, {event: 'pull_request_target', labels: [LABELS.approved.name]});
  assert.equal(pushed.status, 0, pushed.stderr);
  assert.deepEqual(pushed.labels, [WAITING.name], 'the approval was for the old head');
  const commented = runCliCase(t, {event: 'issue_comment', labels: [WAITING.name], later: {after: 0, body: APPROVED, updatedAt: '2026-10-28T20:12:00Z'}});
  assert.equal(commented.status, 0, commented.stderr);
  assert.deepEqual(commented.labels, [LABELS.approved.name], 'the new comment is the verdict for the new head');
  assert.ok(commented.reads <= 2, `a new comment needs no wait: ${commented.reads} reads`);
  const reply = runCliCase(t, {event: 'issue_comment', labels: [WAITING.name]});   // a thread reply: no newer verdict
  assert.deepEqual(reply.labels, [WAITING.name]);
});

test('a push or another reviewer\'s review reads at once, with no wait', t => {
  for (const c of [{event: 'pull_request_target', labels: [LABELS.approved.name]}, {reviewer: 'someone', labels: [LABELS.approved.name]}, {eventFile: 'unreadable'}]) {
    const done = runCliCase(t, c);
    assert.equal(done.status, 0, done.stderr);
    assert.ok(done.reads <= 2, `${JSON.stringify(c)}: ${done.reads} reads`);
  }
  assert.equal(reviewSince('issue_comment', {comment: {user: {login: 'gitar-bot[bot]'}}}), null);
  assert.equal(reviewSince('pull_request_review', {review: {user: {login: 'gitar-bot[bot]'}, submitted_at: REVIEWED_AT}}), REVIEWED_AT);
  assert.equal(reviewSince('pull_request_review', {review: {user: {login: 'someone'}, submitted_at: REVIEWED_AT}}), null);
  assert.equal(reviewSince('pull_request_target', {}), null);
});

test('labels are added with no REST create; a label the repo lacks is created once (#2516: the create met the exhausted budget)', t => {
  const usual = runCliCase(t, {event: 'pull_request_target', labels: []});
  assert.equal(usual.status, 0, usual.stderr);
  assert.deepEqual(usual.labels, [WAITING.name]);
  assert.equal(usual.creates, 0, 'labels exist after their first use: adding needs no create');
  const fresh = runCliCase(t, {event: 'pull_request_target', labels: [], missing: [WAITING.name]});
  assert.equal(fresh.status, 0, fresh.stderr);
  assert.deepEqual(fresh.labels, [WAITING.name]);
  assert.equal(fresh.creates, 1);
  const calls = [];
  assert.throws(() => addLabel('o/r', 1, LABELS.approved, (...args) => { calls.push(args[0]); throw new Error('HTTP 403 Resource not accessible by integration'); }), /403/);
  assert.deepEqual(calls, ['pr'], 'any other failure is not answered with a create');
});

test('every failure stays red and leaves the labels: a rate limit is not hidden any more (#2516)', t => {
  for (const failure of ['HTTP 403 API rate limit exceeded for installation', 'HTTP 429 Too Many Requests', 'HTTP 403 Resource not accessible by integration', 'HTTP 500 Internal Server Error']) {
    for (const event of ['pull_request_review', 'pull_request_target']) {
      const labels = [LABELS.approved.name];
      const done = runCliCase(t, {event, failure, labels});
      assert.equal(done.status, 1, `${event}: ${failure}`);
      assert.equal(done.calls, 1, 'never retry a failed gh call');
      assert.deepEqual(done.labels, labels);
      assert.ok(done.stderr.includes(failure), done.stderr);
      assert.ok(!done.stdout.includes('::notice::'), 'no quiet exit');
    }
  }
});

test('the wait itself: no review time, or a comment already newer, reads once', () => {
  let reread = 0;
  const read = at => ({review: {updated_at: at}});
  assert.equal(awaitComment(read('2026-10-28T20:05:00Z'), null, () => { reread++; return read('x'); }).review.updated_at, '2026-10-28T20:05:00Z');
  assert.equal(awaitComment(read('2026-10-28T20:07:00Z'), REVIEWED_AT, () => { reread++; return read('x'); }).review.updated_at, '2026-10-28T20:07:00Z');
  assert.equal(reread, 0);
  assert.equal(awaitComment({review: null}, REVIEWED_AT, () => { reread++; return {review: null}; }, {tries: 3}).review, null, 'no comment at all: bounded too');
  assert.equal(reread, 3);
  const long = {review: {updated_at: '2026-10-28T20:05:00Z'}, viaRest: true};   // Gitar on #2525: a thread past 100 comments is read by paged REST
  assert.equal(readForRun(long, REVIEWED_AT, () => { reread++; return long; }), long);
  assert.equal(reread, 3, 'the REST path never re-reads: each read is about 6 REST calls');
  assert.equal(readForRun(read('2026-10-28T20:05:00Z'), REVIEWED_AT, () => { reread++; return read('2026-10-28T20:07:00Z'); }).review.updated_at, '2026-10-28T20:07:00Z');
  assert.equal(reread, 4, 'the GraphQL path still waits');
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

 test('marking already active work leaves labels unchanged', t => {
  for (const [body, labels] of [[APPROVED, [LABELS.approved.name, WORKING.name]], [SUGGEST, [LABELS.suggestions.name, WORKING.name]]]) {
    const result = runCliCase(t, {working: true, body, labels, legacy: true});
    assert.equal(result.status, 0, result.stderr);
    assert.deepEqual(result.labels, labels);
    assert.equal(result.calls, 1, 'only the live state read; no label writes');
  }
});

test('starting work on an approved PR marks actual activity', t => {
  const result = runCliCase(t, {working: true, body: APPROVED, labels: [LABELS.approved.name], legacy: true});
  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(result.labels, [LABELS.approved.name, WORKING.name]);
});

test('work started after approval remains until a later approval or push', () => {
  assert.deepEqual(wantedLabels({verdict: LABELS.approved.name, workingSince: AFTER, headTime: HEAD, verdictTime: HEAD}), [LABELS.approved.name, WORKING.name]);
  assert.deepEqual(wantedLabels({verdict: LABELS.approved.name, workingSince: HEAD, headTime: HEAD, verdictTime: AFTER}), [LABELS.approved.name]);
});

test('starting work refreshes a label from before the latest push', t => {
  const result = runCliCase(t, {working: true, event: 'pull_request_target', body: SUGGEST, labels: [WORKING.name], legacy: true});
  assert.equal(result.status, 0, result.stderr);
  assert.ok(result.labels.includes(WORKING.name));
  assert.deepEqual(result.edits.slice(0, 2), ['--remove-label', '--add-label']);
  assert.ok(Date.parse(result.workedAt) > Date.parse('2026-10-28T20:10:00Z'));
});
