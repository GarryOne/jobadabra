// The compact run on Actions (owner, 25 Oct 2026: "the compact version should be always something like this" — the running banner; "in Actions, we shouldn't
// show such a detailed card report"): every kind, queued or finished, is the same one-line banner (renderer/run-compact.js, pages/run-banner.js), and the
// Actions page never draws a run's detailed card. The detailed version is the run panel (test/run-view.test.js).
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {test} from 'node:test';
import {compactRun} from '../renderer/run-compact.js';

const read = file => readFileSync(new URL(`../renderer/${file}`, import.meta.url), 'utf8');
const KINDS = [...read('pages/activity-basics.js').matchAll(/(\w+): \{icon: '[^']+', line: '[\w-]+', name: ("[^"]+"|'[^']+')\}/g)].map(match => match[1]);
const ENDS = {
  completed: {ok: true, result: 'what it did'},
  warned: {ok: true, warned: true, result: 'what it did'},
  unsaved: {ok: true},
  failed: {ok: false, problem: 'Claude Code is not ready: sign in again'},
  unexpected: {ok: false},
  interrupted: {ok: false, interrupted: true},
  stopped: {ok: false, stopped: 'you'},
};

test('every kind, in every end, is one compact banner: name, pill, one line, at most one next step, View run and Dismiss', () => {
  assert.ok(KINDS.length >= 17, `found ${KINDS.length} kinds`);
  for (const kind of KINDS) {
    for (const [end, run] of Object.entries(ENDS)) {
      const model = compactRun({id: 1, kind, ...run}, {name: 'Task', kind, outcome: 'what it did', at: 'Sun 13:55', took: '2 min 5 s'});
      const where = `${kind}, ${end}`;
      assert.equal(model.title, 'Task', where);
      assert.equal(model.pill.length, 2, where);
      assert.ok(['good', 'warn', 'bad', 'neutral', 'info'].includes(model.tone), `${where}: tone ${model.tone}`);
      assert.equal(model.line, 'Finished Sun 13:55 · took 2 min 5 s · what it did', where);   // the Recent runs row's line, as the caller gives it
      if (end === 'unsaved') assert.deepEqual(model.pill, ['No result', 'neutral'], where);
      assert.ok(!model.line.includes('\n'), `${where}: one line`);
      assert.equal(model.close.label, 'Dismiss', where);
      if (model.next) assert.ok(model.next.view || model.next.rerun, `${where}: a next step the banner can do`);
    }
  }
});

test('the pill and the tone follow the run, as everywhere else (run-status.js runPill)', () => {
  const pillOf = run => compactRun({kind: 'mail', ...run}, {name: 'Check Gmail'}).pill;
  assert.deepEqual(pillOf(ENDS.completed), ['Completed', 'good']);
  assert.deepEqual(pillOf(ENDS.warned), ['Completed with warnings', 'warn']);
  assert.deepEqual(pillOf(ENDS.failed), ['Failed', 'bad']);
  assert.deepEqual(pillOf(ENDS.stopped), ['Stopped by you', 'neutral']);
});

test('a finished run with nothing saved says No result, never Completed · done (the owner\'s 25 Oct 2026 shot)', () => {
  const model = compactRun({kind: 'search', ok: true}, {name: 'Find jobs', outcome: 'its result was not saved', at: 'Sun 14:11'});
  assert.deepEqual(model.pill, ['No result', 'neutral']);
  assert.equal(model.line, 'Finished Sun 14:11 · its result was not saved');
  assert.equal(model.next, null, 'Read again and the log are in its run panel (View run)');
  assert.deepEqual(compactRun({kind: 'search', ok: true, new: 0}, {name: 'Find jobs'}).pill, ['Completed', 'good'], 'a count of 0 is a result');
  // One rule for every place a run is drawn: the pill (runPill) and the row's line (activity-basics.js outcome) say it, so the drawer header, Recent runs and Runs agree.
  assert.match(read('run-status.js'), /return unsavedRun\(run\) \? \['No result', 'neutral'\] : \['Completed', 'good'\];/);
  assert.match(read('pages/activity-basics.js'), /if \(unsavedRun\(run\)\) return 'its result was not saved';/);
  assert.match(read('pages/activity-render.js'), /unsavedRun\(run\);\n\s+if \(unsaved\) renderNoResult\(/, 'its run panel offers Read again and the log');
});

test('the next step: a failure\'s own fix, or the new jobs a find added; nothing else', () => {
  assert.deepEqual(compactRun({kind: 'search', ok: true, new: 14}, {name: 'Find jobs'}).next, {label: 'See the 14 new jobs', view: 'jobs'});
  assert.equal(compactRun({kind: 'visits', ok: true, new: 1}, {name: 'Find jobs using your browser'}).next.label, 'See the 1 new job');
  assert.equal(compactRun({kind: 'search', ok: true, new: 0}, {name: 'Find jobs'}).next, null);
  assert.equal(compactRun({kind: 'mail', ok: true}, {name: 'Check Gmail'}).next, null);
  assert.deepEqual(compactRun({kind: 'mail', ...ENDS.failed}, {name: 'Check Gmail'}).next, {label: 'Open AI settings', view: 'settings'});
  assert.equal(compactRun({kind: 'weekly', ...ENDS.unexpected}, {name: 'Analyze'}).next.rerun, true);
});

test('a queued run: Queued, what it waits for and its place, Cancel, no next step', () => {
  const model = compactRun({id: 'q2', kind: 'mail', waiting: true}, {name: 'Check Gmail', waiting: 'Waiting for Find jobs to finish', place: '1 of 2 in the queue'});
  assert.deepEqual(model.pill, ['Queued', 'neutral']);
  assert.equal(model.line, 'Waiting for Find jobs to finish · 1 of 2 in the queue');
  assert.equal(model.close.label, 'Cancel');
  assert.equal(model.next, null);
  assert.equal(compactRun({kind: 'mail', waiting: true}, {name: 'Check Gmail'}).line, 'Waiting to start');
});

test('Actions draws runs only as banners: no detailed card, no skeleton, no page read; it never switches an open drawer', () => {
  const html = read('index.html');
  const actions = html.slice(html.indexOf('id="actions-tasks"'), html.indexOf('<h2 class="action-section">Run a task</h2>'));
  assert.doesNotMatch(actions, /id="actions-card"|run-card/, 'no detailed card on Actions');
  for (const id of ['run-banner', 'actions-queued', 'actions-result']) assert.match(actions, new RegExp(`class="card run-banner[^"]*" id="${id}"`), id);
  const results = read('pages/activity-results.js');
  const awaited = results.slice(results.indexOf('function showActionsResult'), results.indexOf('// The status bar'));
  assert.doesNotMatch(awaited, /cardFor|renderCardSkeleton|renderNoResult|runDetail|selectedRun = run\.id; renderActivity/);
  assert.match(awaited, /drawBanner\(\$\('actions-result'\), model/);
});

test('one look: the running, queued and finished banners share the .run-banner styles', () => {
  const css = read('run-banner.css');
  for (const tone of ['good', 'warn', 'bad', 'neutral']) assert.match(css, new RegExp(`\\.run-banner\\.tone-${tone} \\{`), tone);
  assert.doesNotMatch(read('style.css'), /\.run-banner|\.actions-result/, 'the banner is styled in one file');
});
