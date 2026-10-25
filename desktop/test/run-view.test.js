// One run view (owner, 25 Oct 2026): the drawer shows one run, Actions → Runs shows every run, and both show the same run panel. Which run shows
// (renderer/run-pick.js), the list's filters (renderer/run-filters.js), every entry point, and the one panel shared by both places (no second design).
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {test} from 'node:test';
import {defaultRun, findRun, pickRun, queueWords} from '../renderer/run-pick.js';
import {filterBy, statusOf} from '../renderer/run-filters.js';

const read = file => readFileSync(new URL(`../renderer/${file}`, import.meta.url), 'utf8');
const KINDS = [...read('pages/activity-basics.js').matchAll(/(\w+): \{icon: '[^']+', line: '[\w-]+', name: ("[^"]+"|'[^']+')\}/g)].map(match => match[1]);
const at = minutes => new Date(Date.UTC(2026, 9, 25, 12, minutes)).toISOString();

test('every run kind is listed (the loops below cover a new kind by themselves)', () => {
  assert.ok(KINDS.length >= 17, `found ${KINDS.length} kinds`);
  for (const kind of ['search', 'mail', 'visits', 'tailor', 'kits', 'insight', 'weekly', 'interview', 'add']) assert.ok(KINDS.includes(kind), kind);
});

test('the generic Details opens the running task, else the next queued one, else the latest finished run', () => {
  const runs = [{id: 3, kind: 'mail'}, {id: 2, kind: 'search'}];
  const queued = [{id: 'q2', kind: 'tailor'}, {id: 'q3', kind: 'weekly'}];
  assert.equal(defaultRun({running: {id: 9, kind: 'search'}, queued, runs}).id, 9);
  assert.equal(defaultRun({running: null, queued, runs}).id, 'q2');
  assert.equal(defaultRun({running: null, queued: [], runs}).id, 3);
  assert.equal(defaultRun({running: null, queued: [], runs: []}), null);
});

test('a picked run stays picked through queued → running → done, for every kind', () => {
  for (const kind of KINDS) {
    const queued = {queued: [{id: 'q1', kind: 'search'}, {id: 'q2', kind}], runs: [{id: 1, kind: 'mail'}]};
    assert.equal(pickRun(queued, 'q2').run.waiting, true, `${kind}: queued`);
    const running = {running: {id: 50, ticket: 'q2', kind}, queued: [], runs: [{id: 1, kind: 'mail'}]};
    const live = pickRun(running, 'q2');
    assert.equal(live.run.live, true, `${kind}: running`);
    assert.equal(live.keep, '50', `${kind}: the selection becomes the run's own id once it starts`);
    const done = {running: {id: 70, ticket: 'q9', kind: 'search'}, queued: [], runs: [{id: 50, ticket: 'q2', kind, ok: true}, {id: 1, kind: 'mail'}]};
    assert.equal(pickRun(done, '50').run.id, 50, `${kind}: done, and another run started: still the same run`);
    assert.equal(pickRun(done, 'q2').run.id, 50, `${kind}: finished between two redraws: found by its ticket`);
  }
});

test('a finished run picked stays picked when a new run starts or ends', () => {
  const before = {running: null, queued: [], runs: [{id: 2, kind: 'mail'}, {id: 1, kind: 'search'}]};
  assert.equal(pickRun(before, '1').run.id, 1);
  const after = {running: {id: 3, kind: 'search'}, queued: [{id: 'q5', kind: 'mail'}], runs: [{id: 4, kind: 'weekly'}, ...before.runs]};
  assert.equal(pickRun(after, '1').run.id, 1);
  assert.equal(findRun(after, 'gone'), null, 'a run that left the history: the caller falls back to the default');
});

test('a queued run says what it waits for and its place, never a start-time guess', () => {
  const data = {running: {id: 9, kind: 'search'}, queued: [{id: 'q2', kind: 'mail'}, {id: 'q3', kind: 'tailor'}]};
  const name = kind => ({search: 'Find jobs', mail: 'Gmail check'}[kind]);
  assert.deepEqual(queueWords(findRun(data, 'q2'), data, name), {waiting: 'Waiting for Find jobs to finish', place: '1 of 2 in the queue'});
  assert.deepEqual(queueWords(findRun(data, 'q3'), data, name), {waiting: 'Waiting for Gmail check to finish', place: '2 of 2 in the queue'});
  const alone = {running: null, queued: [{id: 'q1', kind: 'mail'}]};
  assert.deepEqual(queueWords(findRun(alone, 'q1'), alone, name), {waiting: 'Waiting to start', place: ''});
});

test('the Task, Status and Date filters keep the runs they name', () => {
  const now = new Date(at(0));
  const runs = [{id: 1, kind: 'search', ok: true, endedAt: at(-10)}, {id: 2, kind: 'mail', ok: false, endedAt: at(-60 * 24 * 3)},
    {id: 3, kind: 'mail', ok: true, warned: true, endedAt: at(-60 * 24 * 40)}, {id: 'q1', kind: 'tailor', waiting: true}, {id: 4, kind: 'search', live: true}];
  const toneOf = run => (!run.ok ? 'bad' : run.warned ? 'warn' : 'good');
  const ids = filter => filterBy(runs, filter, {toneOf, now}).map(run => run.id);
  assert.deepEqual(ids({kind: 'mail'}), [2, 3]);
  assert.deepEqual(ids({status: 'failed'}), [2]);
  assert.deepEqual(ids({status: 'warn'}), [3]);
  assert.deepEqual(ids({status: 'queued'}), ['q1']);
  assert.deepEqual(ids({status: 'running'}), [4]);
  assert.deepEqual(ids({date: 'today'}), [1, 'q1', 4], 'queued and running are always in range');
  assert.deepEqual(ids({date: '7'}), [1, 2, 'q1', 4]);
  assert.equal(statusOf({ok: true}, () => 'neutral'), 'ok');
});

test('one run panel in the window: the drawer and Actions → Runs share it, never a second template', () => {
  const html = read('index.html');
  for (const id of ['activity-selected', 'activity-card', 'activity-log', 'activity-warnings']) assert.equal(html.split(`id="${id}"`).length, 2, `one #${id}`);
  assert.equal(html.split('class="ap-detail"').length, 2, 'one run panel');
  const tab = read('pages/runs-tab.js');
  assert.match(tab, /host\.append\(grid\)/, 'the panel is moved between the drawer and the tab');
  assert.match(tab, /scrollTop = top/, 'the log and list keep their scroll when the panel moves');
  for (const file of ['pages/runs-tab.js', 'pages/runs-page.js', 'pages/activity-render.js']) assert.doesNotMatch(read(file), /'ap-detail'|cloneNode/, `${file} builds no second panel`);
  // A panel style written for the drawer only would make the two places drift apart: every one is shared, except the few that make the drawer the drawer.
  const DRAWER_ONLY = /^\.activity-panel (\.ap-grid|\.ap-list) /;
  const css = read('style.css') + read('runs-tab.css');
  const drawerOnly = css.split('\n').filter(line => /^\.activity-panel [.#a-z]/.test(line) && !DRAWER_ONLY.test(line));
  assert.deepEqual(drawerOnly, [], 'run panel styles apply in both places (:is(.activity-panel, .actions-runs))');
});

test('the drawer shows one run (no list); Runs shows the list, the schedule above it, and list → detail when narrow', () => {
  const css = read('runs-tab.css'), html = read('index.html');
  assert.match(css, /\.activity-panel \.ap-list \{ display: none; \}/);
  assert.match(css, /@container runs \(max-width: \d+px\)[\s\S]*?\.is-detail \.ap-list/);
  assert.ok(html.indexOf('id="activity-schedule"') < html.indexOf('id="actions-runs-body"') && html.indexOf('id="activity-schedule"') > html.indexOf('id="actions-runs"'),
    'Upcoming runs is above the list in Runs, never inside a run');
  for (const id of ['activity-filter', 'activity-filter-status', 'activity-filter-date', 'activity-back', 'activity-open-runs', 'activity-queue', 'activity-unqueue']) assert.match(html, new RegExp(`id="${id}"`), id);
  assert.match(html, />View all runs</);
  assert.match(html, />Load more</);
});

test('every entry point opens the right run in the right place', () => {
  const runsPage = read('pages/runs-page.js'), nav = read('pages/nav.js'), panel = read('pages/activity-panel.js'), activity = read('pages/activity.js'), tab = read('pages/runs-tab.js');
  assert.match(runsPage, /li\.addEventListener\('click', \(\) => showRunsTab\(run\.id\)\)/, 'a Recent runs row: Runs, on that run');
  assert.match(runsPage, /'runs-all'\)\.addEventListener\('click', event => \{ event\.preventDefault\(\); showRunsTab\(\); \}\)/, 'View all runs');
  assert.match(runsPage, /'View all runs →'/, 'the status card');
  assert.match(nav, /'Open Runs'[\s\S]{0,200}showRunsTab\(\)/, '⌘K: Runs');
  assert.match(nav, /'Open the current run'[\s\S]{0,250}shared\.selectedRun = null; openActivity\(true\)/, '⌘K: the drawer, generic');
  assert.match(activity, /if \(\$\('activity-panel'\)\.hidden\) shared\.selectedRun = null; openActivity/, 'the bottom bar: generic, then kept');
  assert.match(panel, /if \(open && runsTabShown\(\)\) \{ showRunsTab\(shared\.selectedRun \?\? undefined\); return; \}/, 'with Runs on screen, a named run opens there');
  assert.match(panel, /if \(open\) \{ mountInDrawer\(\); pinDefault\(\); \}/, 'the drawer picks once and keeps it');
  assert.match(tab, /'activity-open-runs'\)\.addEventListener\('click', event => \{ event\.preventDefault\(\); showRunsTab\(shared\.selectedRun\); \}\)/, 'Open in Runs keeps the run');
  assert.match(tab, /showRunsTab\(undefined, \{filter: \{status: 'queued'\}\}\)/, 'View queue → Runs filtered to queued');
  assert.match(read('../lib/pipeline-queue.js'), /ticket: ticket\.id/, 'a run keeps the ticket it was queued with');
});

test('a queued run: no empty log, a Cancel, and the row can be picked; the keyboard reaches queued rows too', () => {
  const render = read('pages/activity-render.js');
  assert.match(render, /show\(\$\('activity-log'\), !run\?\.waiting\)/);
  assert.match(render, /show\(\$\('activity-unqueue'\), !!run\?\.waiting/);
  assert.doesNotMatch(render, /if \(run\.waiting\) return;/, 'a queued row opens its run');
  assert.match(read('pages/runs-tab.js'), /focus\(\{preventScroll: true\}\)/, 'Back to runs and a picked row move the focus');
});
