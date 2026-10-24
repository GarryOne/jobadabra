import assert from 'node:assert/strict';
import {test} from 'node:test';
import * as history from '../lib/run-history.js';
import {fromRecord} from '../lib/run-rows.js';

const row = (id, props, extra = {}) => ({id, url: `https://www.notion.so/${id}`, created_time: '2026-09-28T10:00:00.000Z', ...extra, properties: {
  Started: {date: {start: props.started}}, Mode: {select: {name: props.mode}}, Status: {select: {name: props.status}},
  Trigger: {select: {name: props.trigger}}, Summary: {rich_text: [{plain_text: props.summary || ''}]},
  'Duration (s)': {number: props.seconds ?? null}, 'New jobs': {number: props.fresh ?? 0}, 'AI cost (USD)': {number: 0.01},
  'Run URL': {url: props.runUrl || null}, ...(props.where ? {Where: {select: {name: props.where}}} : {}),
  'Run id': props.runId ? {rich_text: [{plain_text: props.runId}]} : {rich_text: []}}});
const NOW = Date.parse('2026-09-28T12:10:00Z');

test('a Notion ⏱️ Search runs row reads as an activity record, wherever it ran', () => {
  const gh = history.fromRow(row('r1', {started: '2026-09-28T12:00:00Z', mode: 'insight', status: 'OK', trigger: 'Schedule', seconds: 50,
    summary: 'Insight sent: Skills — Go is in 40% (AI cost $0.012)', runUrl: 'https://github.com/me/p/actions/runs/1', runId: 'abc123def456'}), NOW);
  assert.equal(gh.kind, 'insight');
  assert.equal(gh.runId, 'abc123def456');
  assert.equal(gh.where, 'github');
  assert.equal(gh.trigger, 'schedule');
  assert.equal(gh.ok, true);
  assert.equal(gh.result, 'Insight sent: Skills — Go is in 40%');
  assert.equal(gh.endedAt, '2026-09-28T12:00:50.000Z');
  const search = history.fromRow(row('r2', {started: '2026-09-28T11:00:00Z', mode: 'scheduled', status: 'OK', trigger: 'Mac schedule', seconds: 200, fresh: 3}), NOW);
  assert.deepEqual([search.kind, search.where, search.result], ['search', 'mac', '3 new jobs']);
});

test('a job running anywhere shows its progress line; one "Running" for hours never finished', () => {
  const live = history.fromRow(row('r3', {started: '2026-09-28T12:08:00Z', mode: 'run', status: 'Running', trigger: 'Manual',
    summary: '⏳ Scoring 12 new jobs', runUrl: 'https://github.com/x'}), NOW);
  assert.equal(live.live, true);
  assert.equal(live.step, 'Scoring 12 new jobs');
  const lost = history.fromRow(row('r4', {started: '2026-09-28T02:00:00Z', mode: 'mail', status: 'Running', trigger: 'Schedule'}), NOW);
  assert.equal(lost.live, undefined);
  assert.equal(lost.ok, false);
  assert.equal(lost.result, 'never finished (see the log)');
});

test('merge: Notion is the history; this Mac\'s record of the same run keeps its full log; a job sent to GitHub waits for its row', () => {
  const notion = [history.fromRow(row('r5', {started: '2026-09-28T12:00:00Z', mode: 'mail', status: 'OK', trigger: 'Mac (you)', seconds: 30,
    summary: 'Gmail check: 2 new email(s) read, 1 update(s) recorded; AI cost $0.002.'}), NOW)];
  const local = [{id: Date.parse('2026-09-28T12:00:00.500Z'), kind: 'mail', notionUrl: 'https://www.notion.so/r5', log: ['full', 'log'], ok: true},
    {id: Date.parse('2026-09-28T12:05:00Z'), kind: 'insight', log: ['not in Notion yet']}];
  const pending = [{id: NOW, mode: 'weekly', live: true, step: 'Starting on GitHub…'}];
  const {runs, live, waiting} = history.merge(notion, local, pending);
  assert.equal(runs.length, 2);
  const mail = runs.find(r => r.kind === 'mail');
  assert.deepEqual(mail.log, ['full', 'log']);
  assert.equal(mail.pageId, 'r5');
  assert.equal(mail.result, 'Gmail check: 2 new email(s) read, 1 update(s) recorded');
  assert.equal(live.step, 'Starting on GitHub…');
  assert.equal(waiting.length, 1);
  // The run's own URL clears the placeholder even when the row's start is outside the one-minute window.
  const late = [{...pending[0], runUrl: 'https://github.com/me/p/actions/runs/20'}];
  const found = history.fromRow(row('r7', {started: '2026-09-28T11:00:00Z', mode: 'weekly', status: 'OK', trigger: 'Manual', seconds: 40,
    runUrl: 'https://github.com/me/p/actions/runs/20'}), NOW);
  assert.equal(history.merge([found], [], late).waiting.length, 0);
  // Once the weekly report's row exists, it's no longer waiting.
  const started = history.fromRow(row('r6', {started: new Date(NOW + 30000).toISOString(), mode: 'weekly', status: 'Running', trigger: 'Manual'}), NOW + 40000);
  assert.equal(history.merge([started, ...notion], local, pending).waiting.length, 0);
});

test('a run\'s page gives its result and technical log', async () => {
  const para = (type, content) => ({type, [type]: {rich_text: [{plain_text: content}]}});
  const fetcher = async url => Response.json(url.includes('blocks/toggle-1/') ? {results: [para('code', 'line 1\nline 2')]}
    : {results: [para('heading_3', 'Report'), para('bulleted_list_item', 'Insight sent: Skills'), para('heading_3', 'Result'),
      para('paragraph', '💡 Skills'), para('paragraph', 'Go is in 40%'),
      {id: 'toggle-1', type: 'toggle', has_children: true, toggle: {rich_text: [{plain_text: 'Technical log (last 2 lines)'}]}}]});
  const storage = {secret: () => 'secret_x', settings: () => ({})};
  assert.deepEqual(await history.detail(storage, 'r1', {fetcher}), {message: '💡 Skills\nGo is in 40%', log: ['line 1', 'line 2'], report: ['Insight sent: Skills']});
});

test('every finished job is a notification wherever it ran; a quiet Gmail check and a button action are not', () => {
  assert.deepEqual(history.notice({kind: 'insight', where: 'github', ok: true, result: 'Insight sent: Skills — Go is in 40%'}),
    {title: 'Insight done (on GitHub)', body: 'Insight sent: Skills — Go is in 40%'});
  assert.deepEqual(history.notice({kind: 'search', trigger: 'schedule', ok: true, new: 3}), {title: 'Scheduled job search done', body: '3 jobs added to your list.'});
  assert.deepEqual(history.notice({ok: true, new: 0}), {title: 'Find jobs done', body: 'No jobs added this time.'});  // an older record without kind
  // A run that worked but warned is not "done" (UI loop #51, #52: a green "Jobs check done" over a refused AI call).
  assert.deepEqual(history.notice({ok: true, new: 1, warned: true}), {title: 'Find jobs finished with warnings', body: '1 job added to your list. Open Jobadabra to see what it said.'});
  assert.equal(history.notice({kind: 'insight', ok: true, result: 'Written', warned: true}).title, 'Insight finished with warnings');
  assert.equal(history.notice({ok: false, warned: true}).title, 'Find jobs had problems', 'a failure stays a failure');
  assert.equal(history.notice({kind: 'weekly', where: 'github', ok: false}).title, 'Search analysis had problems (on GitHub)');
  assert.deepEqual(history.notice({kind: 'mail', ok: true, updates: ['Grafana Labs: Rejected']}),
    {title: 'Gmail: 1 application update', body: 'Grafana Labs: Rejected'});
  assert.equal(history.notice({kind: 'mail', where: 'github', ok: true, result: 'Gmail check: 4 new email(s) read, 2 update(s) recorded'}).title,
    'Gmail: 2 application updates (on GitHub)');
  assert.equal(history.notice({kind: 'mail', ok: true, updates: []}), null);
  assert.equal(history.notice({kind: 'mail', ok: true, result: 'Gmail check: 3 new email(s) read, 0 update(s) recorded'}), null);
  assert.equal(history.notice({kind: 'action', ok: true}), null);
});

test('two runs started in the same minute keep apart (the activity list selects one, not both)', () => {
  const props = {started: '2026-09-29T12:50:00Z', mode: 'mail', status: 'OK', trigger: 'Schedule', seconds: 5};
  const a = history.fromRow(row('3ea62be8-fd86-8145-b7a4-f8301f01b089', props), NOW);
  const b = history.fromRow(row('3ea62be8-fd86-81c2-9d33-01e5c7a2c4d1', props), NOW);
  assert.notEqual(a.id, b.id);
  assert.ok(Math.abs(a.id - Date.parse(props.started)) < 1000 && Math.abs(b.id - Date.parse(props.started)) < 1000);
});

test('a row reads the same with an old or a new title: the kind comes from Mode, never from the title', () => {
  const props = {started: '2026-09-30T09:44:00Z', mode: 'add', status: 'OK', trigger: 'Mac (you)', seconds: 20, summary: 'Tracked recruiter lead'};
  const titled = run => ({...row('3ea62be8-fd86-8145-b7a4-f8301f01b089', props), properties: {...row('x', props).properties, Run: {title: [{plain_text: run}]}}});
  const old = history.fromRow(titled('2026-09-30 11:44 · Logged activity'), NOW);
  const bare = history.fromRow(titled('add'), NOW);
  const fresh = history.fromRow(titled('2026-09-30 11:44 · Log activity · Duvo.ai — SRE'), NOW);
  assert.deepEqual(fresh, old);
  assert.deepEqual(bare, old);
  assert.equal(fresh.kind, 'add');
  assert.equal(fresh.mode, 'add');
});

test('an interview-insights run is named for what it is, not the daily "Insight" (owner, 30 Sep 2026: "confusing")', () => {
  const interview = history.fromRow(row('r9', {started: '2026-09-30T11:56:00Z', mode: 'insight', status: 'OK', trigger: 'Mac (you)', seconds: 40,
    summary: 'Interview insights updated from 2 interview(s): When a client names its key need… (AI cost $0.181)'}), NOW);
  assert.equal(interview.kind, 'interviewInsight');
  assert.equal(history.notice(interview).title, 'Interview insights done');
  const daily = history.fromRow(row('r10', {started: '2026-09-30T07:00:00Z', mode: 'insight', status: 'OK', trigger: 'Schedule', seconds: 40,
    summary: 'Software-titled jobs convert at 3%'}), NOW);
  assert.equal(daily.kind, 'insight');
});

test('merge: runs from before Notion was connected stay in Recent activity; an old run that had a row follows Notion\'s window', () => {
  const notion = [history.fromRow(row('r9', {started: '2026-10-06T21:00:00Z', mode: 'run', status: 'OK', trigger: 'Mac (you)', seconds: 60}), NOW)];
  const trying = [{id: Date.parse('2026-10-06T20:15:00Z'), kind: 'search', log: ['before Notion']},
    {id: Date.parse('2026-10-06T14:00:00Z'), kind: 'scout', log: ['before Notion']}];
  const outside = {id: Date.parse('2026-10-01T10:00:00Z'), kind: 'mail', notionUrl: 'https://www.notion.so/r1', log: ['old']};
  const {runs} = history.merge(notion, [...trying, outside], []);
  assert.deepEqual(runs.map(r => r.kind), ['search', 'search', 'scout']);   // Notion's row, then both Trying runs, newest first
});

test('merge: a run is the same run when its Notion page was renamed (the title slug in the URL changes, the page id does not)', () => {
  // The engine prints the page's address when it creates the row ("… Jobs check"); the row is renamed when the run ends ("… Jobs check, 3 new jobs"),
  // so Notion's address for the same page carries another slug. 2 Oct 2026: one check showed as two runs, with two "Jobs check done" pop-ups.
  const id = '3ed699c9deff8118b540e16c8bc7c54e';
  const found = history.fromRow(row(id, {started: '2026-10-02T12:49:00Z', mode: 'run', status: 'OK', trigger: 'Mac (you)', seconds: 20, fresh: 3, summary: '3 new job(s).'},
    {url: `https://app.notion.com/p/2026-10-02-14-49-Jobs-check-3-new-jobs-${id}`}), NOW);
  const local = [{id: Date.parse('2026-10-02T12:49:41Z'), kind: 'search', notionUrl: `https://app.notion.com/p/2026-10-02-14-49-Jobs-check-${id}`, log: ['x'], ok: true}];
  const {runs} = history.merge([found], local, []);
  assert.equal(runs.length, 1);
  assert.deepEqual(runs[0].log, ['x']);   // the local record is the one merged into the row
});

// 7 Oct 2026 (Windows wander suite): the app was killed mid-run, the engine died printing its traceback, and the row stayed "Running" with that line as its
// Summary; Recent activity showed "Running now · Traceback (most recent call last):". A crash line is never the step, from any row (an older engine wrote it).
test('a running row whose last line is a crash shows "Running", not the traceback', () => {
  for (const summary of ['⏳ Traceback (most recent call last):', '⏳ KeyboardInterrupt', '⏳ BrokenPipeError: [Errno 32] Broken pipe']) {
    const live = history.fromRow(row('r9', {started: '2026-09-28T12:08:00Z', mode: 'scout', status: 'Running', trigger: 'Mac (you)', summary}), NOW);
    assert.deepEqual([live.live, live.step], [true, 'Running'], summary);
  }
  const fine = history.fromRow(row('r9', {started: '2026-09-28T12:08:00Z', mode: 'scout', status: 'Running', trigger: 'Mac (you)', summary: '⏳ Scout: checking 7 employer(s)…'}), NOW);
  assert.equal(fine.step, 'Scout: checking 7 employer(s)…');
});

test('merge: a run this Mac saw end is not live, even while its Notion row still says Running (stopped from outside)', () => {
  const url = 'https://app.notion.com/p/2026-10-07-12-01-Search-for-new-jobs-3f2b1a9cbb8a8199b2b6f8c09cc827bd';
  const notion = [{id: 1, notionUrl: url, live: true, status: 'Running', step: 'Reading new jobs with AI: 31 of 100'}];
  const ended = [{id: 2, kind: 'search', notionUrl: url, startedAt: '2026-10-07T10:01:20Z', endedAt: '2026-10-07T10:23:06Z', ok: false, log: ['…']}];
  const {runs, live} = history.merge(notion, ended);
  assert.equal(live, null, 'nothing is running');
  assert.equal(runs.length, 1);
  assert.equal(runs[0].ok, false);
  assert.equal(runs[0].live, false);
  const stillGoing = history.merge(notion, []);
  assert.equal(stillGoing.live?.status, 'Running', 'without an ended record on this Mac, Notion says it runs');
});

// 7 Oct 2026: a run killed hard (SIGKILL: a GitHub force-cancel, a dead runner) cannot close its row, and it showed as running for 3 h. A running
// engine edits its row at least every 5 minutes (src/notion/cron_runs.py HEARTBEAT_S), so a "Running" row unedited for 30 minutes lost its job.
test('a "Running" row nobody edited for 30 minutes is a lost run; one edited recently is still running', () => {
  const started = '2026-09-28T11:20:00Z';   // 50 minutes before NOW: well inside the 3-hour limit
  const beating = history.fromRow(row('r8', {started, mode: 'run', status: 'Running', trigger: 'Schedule', summary: '⏳ Scoring jobs'},
    {last_edited_time: '2026-09-28T12:07:00Z'}), NOW);
  assert.equal(beating.live, true, 'positive control: a row its engine still edits is running');
  const silent = history.fromRow(row('r9', {started, mode: 'run', status: 'Running', trigger: 'Schedule', summary: '⏳ Scoring jobs'},
    {last_edited_time: '2026-09-28T11:30:00Z'}), NOW);
  assert.equal(silent.live, undefined);
  assert.equal(silent.ok, false);
});

// The store writes Where (src/stores/notion_cron_runs.py): a run made on this Mac and moved to Notion keeps "this Mac", whatever its Trigger
// says (9 Oct 2026, the storemove e2e: it read as GitHub). A row from before the column still reads its Run URL and Trigger.
test('a row\'s Where column says where it ran; a row without one is read from its Run URL and Trigger', () => {
  const moved = history.fromRow(row('w1', {started: '2026-09-28T12:00:00Z', mode: 'mail', status: 'OK', trigger: 'button', where: 'mac'}), NOW);
  const github = history.fromRow(row('w2', {started: '2026-09-28T12:00:00Z', mode: 'mail', status: 'OK', trigger: 'Schedule', where: 'github'}), NOW);
  const older = history.fromRow(row('w3', {started: '2026-09-28T12:00:00Z', mode: 'mail', status: 'OK', trigger: 'Schedule', runUrl: 'https://github.com/me/p/actions/runs/9'}), NOW);
  const olderMac = history.fromRow(row('w4', {started: '2026-09-28T12:00:00Z', mode: 'mail', status: 'OK', trigger: 'Mac schedule'}), NOW);
  const unknown = history.fromRow(row('w5', {started: '2026-09-28T12:00:00Z', mode: 'mail', status: 'OK', trigger: 'Manual'}), NOW);
  assert.deepEqual([moved.where, github.where, older.where, olderMac.where, unknown.where], ['mac', 'github', 'github', 'mac', 'elsewhere']);
});

// The same run read from this Mac's store and from Notion says the same place (9 Oct 2026: "· GitHub" on Notion, nothing on this Mac).
test('a run started by you on this Mac reads as this Mac from a store record and from a Notion row', () => {
  const record = fromRecord({id: 'x1', kind: 'mail', where: 'mac', trigger: 'button', status: 'OK', started_at: '2026-09-28T12:00:00Z', finished_at: '2026-09-28T12:01:00Z'}, NOW);
  const page = history.fromRow(row('x1', {started: '2026-09-28T12:00:00Z', mode: 'mail', status: 'OK', trigger: 'button', where: 'mac'}), NOW);
  assert.deepEqual([record.where, page.where], ['mac', 'mac']);
  const older = fromRecord({id: 'x2', kind: 'mail', trigger: 'Mac schedule', status: 'OK', started_at: '2026-09-28T12:00:00Z'}, NOW);
  const github = fromRecord({id: 'x3', kind: 'mail', where: 'github', status: 'OK', started_at: '2026-09-28T12:00:00Z'}, NOW);
  assert.deepEqual([older.where, github.where], ['mac', 'github']);
});

// 18 Oct 2026: a Find jobs run with nothing new wrote no Result block, so its Actions card read an empty page and stayed skeleton bars.
test('every run kind\'s Mac row has a Result block, even a run with no message', () => {
  for (const kind of Object.keys(history.MODE)) {
    for (const ok of [true, false]) {
      const {children} = history.localRow({kind, ok, trigger: 'you', startedAt: '2026-10-17T22:20:00Z', endedAt: '2026-10-17T22:21:00Z', new: 0, log: []});
      const at = children.findIndex(block => block.type === 'heading_3' && block.heading_3.rich_text[0].text.content === 'Result');
      assert.ok(at >= 0, `${kind} (ok: ${ok}) has no Result block`);
      assert.ok(children[at + 1].paragraph.rich_text[0].text.content.trim(), `${kind}'s Result is empty`);
    }
  }
});

test('a run that finished with warning lines in its log is recorded "Warnings", the same word the list and the panel derive', () => {
  const base = {kind: 'search', ok: true, trigger: 'you', startedAt: '2026-10-24T11:35:00Z', endedAt: '2026-10-24T11:35:23Z', new: 1};
  const status = run => history.localRow({...base, ...run}).properties.Status.select.name;
  // The AI answered 429 to every call: the engine's summary named no warning, the log did.
  assert.equal(status({log: ['Scoring 1 job', 'RateLimitError: Error code: 429 - rate_limit_error', 'Done']}), 'Warnings');
  assert.equal(status({log: ['Warning: place names were not translated (the AI call failed)']}), 'Warnings');
  assert.equal(status({log: ['Scoring 1 job', 'Enriched 1 of 1 job(s); 0 failed']}), 'OK');
  assert.equal(status({log: []}), 'OK');
  assert.equal(status({ok: false, log: ['Warning: x']}), 'Failed');
  // And read back, the row says warned: the list pill and the panel pill agree with the record.
  const back = history.fromRow({properties: {Run: {title: [{plain_text: 'Job search · on this Mac'}]}, Status: {select: {name: 'Warnings'}}}, id: 'x', created_time: base.startedAt});
  assert.equal(back.warned, true);
});

// Owner, 24 Oct 2026: a finished run's notification carries one number (the jobs added to the list) and no scoring words.
test('a finished search notification says the jobs added, with no other number and no scoring words', () => {
  for (const run of [{kind: 'search', ok: true, new: 0}, {kind: 'search', ok: true, new: 1}, {kind: 'search', ok: true, new: 12, scored: 30, good: 4, log: ['Run counts: looked=9 matches=40 scored=30 good=4']}]) {
    const {body} = history.notice(run);
    assert.ok((body.match(/\d+/g) || []).length <= 1, body);
    assert.doesNotMatch(body, /scor|strong|70|waiting|queue/i, body);
  }
});
