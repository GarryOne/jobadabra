// How a finding was found, as data (lib/replay.mjs): every suite writes replay.json, every issue says how it was found with the command that walks the same path again, and the same
// facts are one hidden JSON line; the run summary adds up the paths a run walked.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {test} from 'node:test';
import {writeReplay} from '../../lib/artifacts.mjs';
import {buildReplay, eventOf, parseReplay, pathSummary, replayBlock, replayComment, replayCommand, replayFromSeed} from '../../lib/replay.mjs';
import {runSummary, totalRuns} from '../../lib/run-summary.mjs';
import {issueBody} from '../../lib/triage.mjs';

const CI = {GITHUB_EVENT_NAME: 'schedule', GITHUB_SHA: '3806ebee7cc568adda2aaf0c85f2fd76abf', GITHUB_RUN_ID: '37304870238', GITHUB_REPOSITORY: 'GarryOne/jobadabra', CI: 'true'};
const trail = [{name: 'focus: stays still once it has loaded', status: 'passed', seconds: '8.1'}, {name: 'jobs: every safe control does something', status: 'failed'}];

test('a seeded run says its seed, window, place, theme, commit and run page; the command replays it', () => {
  const replay = buildReplay({suite: 'interactions', env: CI, vary: {seed: 2798083162, fixed: false}, place: {zone: 'Asia/Tokyo', locale: 'ja-JP'}, window: [1024, 640], theme: 'dark', platform: 'darwin', trail,
    path: {pages: ['focus', 'jobs'], pressed: [{view: 'focus', name: 'Dismiss', effects: 'card removed'}]}});
  assert.deepEqual([replay.mode, replay.seed, replay.window, replay.zone, replay.locale, replay.theme, replay.platform, replay.commit, replay.event],
    ['seeded', 2798083162, [1024, 640], 'Asia/Tokyo', 'ja-JP', 'dark', 'mac', '3806ebe', 'schedule']);
  assert.equal(replay.run, 'https://github.com/GarryOne/jobadabra/actions/runs/37304870238');
  assert.equal(replayCommand(replay), 'cd desktop/e2e && E2E_SEED=2798083162 node suite.mjs interactions');
});

test('the gate\'s fixed path is said too, and its command needs no seed', () => {
  const replay = buildReplay({suite: 'calendar', env: {GITHUB_EVENT_NAME: 'workflow_run'}, vary: {seed: 0, fixed: true}, platform: 'win32'});
  assert.deepEqual([replay.mode, replay.seed, replay.platform, replay.runType], ['fixed', 0, 'windows', 'release gate (fixed path)']);
  assert.equal(replayCommand(replay), 'cd desktop/e2e && node suite.mjs calendar');
  assert.equal(eventOf({}), 'local');
  assert.equal(eventOf({CI: '1'}), 'ci');
});

test('the block reads in a few seconds: a table, the path, and folded steps and probe path', () => {
  const replay = buildReplay({suite: 'interactions', env: CI, vary: {seed: 77, fixed: false}, place: {zone: 'Asia/Tokyo', locale: 'ja-JP'}, window: [1024, 640], theme: 'dark', trail,
    path: {pages: ['focus', 'jobs'], pressed: [{view: 'focus', name: 'Dismiss', effects: 'card removed', flagged: true}]}});
  const block = replayBlock(replay, {platform: 'Mac'});
  assert.match(block, /### How it was found/);
  assert.match(block, /\| Run \| scheduled run \(three a day, a new path each time\) · suite `interactions` · Mac \|/);
  assert.match(block, /\| Path \| seeded: `E2E_SEED=77` shuffles the pages/);
  assert.match(block, /\| Window \| 1024×640 px · dark theme · Asia\/Tokyo, ja-JP \|/);
  assert.match(block, /E2E_SEED=77 node suite.mjs interactions/);
  assert.match(block, /✓ focus: stays still once it has loaded \(8.1s\)[^]*✗ jobs: every safe control does something/);
  assert.match(block, /The probe's path: 2 page\(s\), 1 control\(s\) pressed[^]*Pages, in order: focus → jobs[^]*focus: "Dismiss" → card removed ⚑/);
  assert.doesNotMatch(replayBlock(replay, {withCommand: false}), /```sh/);
});

test('the hidden JSON line round-trips, survives "--" in a step name, and an unknown version is ignored', () => {
  const replay = buildReplay({suite: 'focus', env: CI, vary: {seed: 5, fixed: false}, trail: [{name: 'Dismiss -- twice', status: 'passed'}]});
  const comment = replayComment(replay);
  assert.ok(!comment.slice(5, -4).includes('--'), 'a double hyphen would end the HTML comment');
  assert.deepEqual(parseReplay(`text\n${comment}\n<!-- fingerprint: x -->`).trail, [{name: 'Dismiss -- twice', status: 'passed'}]);
  assert.equal(parseReplay('<!-- replay: {"v":2} -->'), null);
  assert.equal(parseReplay('nothing here'), null);
});

test('an older artifact with only seed.json still says its path, and never claims the producer\'s run type', () => {
  const replay = replayFromSeed({seed: 4242, fixed: false, window: [1024, 700], detail: 'tasks: weekly, scout'}, {suite: 'activity', env: CI});
  assert.deepEqual([replay.mode, replay.seed, replay.window, replay.event, replay.detail], ['seeded', 4242, [1024, 700], 'unknown', 'tasks: weekly, scout']);
  assert.match(replay.runType, /not recorded/);
  assert.equal(replayFromSeed({seed: 0, fixed: true}, {suite: 'x'}).mode, 'fixed');
  assert.equal(replayFromSeed(null, {suite: 'x'}), null);
});

test('an issue carries the block and the hidden line when the run has a replay, and keeps its old shape when it has none', () => {
  const finding = {view: 'calendar', severity: 'medium', kind: 'text', title: 't', detail: 'd', source: 'ai-review'};
  const replay = buildReplay({suite: 'calendar', env: CI, vary: {seed: 9, fixed: false}, window: [1100, 720], theme: 'light'});
  const body = issueBody(finding, 'https://x/runs/1', {suite: 'calendar', platform: 'mac', build: 'main @ 3806ebe', replay});
  assert.match(body, /### Reproduce\n```sh\ncd desktop\/e2e && E2E_SEED=9 node suite.mjs calendar\n```/);
  assert.match(body, /### How it was found/);
  assert.match(body, /<!-- replay: \{"v":1,"suite":"calendar"/);
  assert.ok(body.indexOf('<!-- replay:') < body.indexOf('<!-- fingerprint:'), 'the fingerprint still ends the body');
  assert.equal(parseReplay(body).seed, 9);
  const old = issueBody(finding, 'https://x/runs/1', {suite: 'calendar', platform: 'mac', build: 'main @ 3806ebe', seed: 4242, window: [1024, 700]});
  assert.doesNotMatch(old, /How it was found/);
  assert.match(old, /Variation of this run: seed 4242, window 1024x700/);
});

test('a suite run writes replay.json with its steps, window, theme and the probe\'s path', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'replay-'));
  fs.writeFileSync(path.join(dir, 'seed.json'), JSON.stringify({seed: 31, fixed: false, window: [1100, 720], detail: 'time zone Asia/Tokyo, language ja-JP'}));
  const ctx = {ARTIFACTS: dir, runner: {results: trail}, place: {zone: 'Asia/Tokyo', locale: 'ja-JP'}, replayPath: {pages: ['focus'], pressed: [{view: 'focus', name: 'Dismiss'}]},
    page: {evaluate: async () => ({w: 1100, h: 720, theme: 'dark'})}, vary: {seed: 31, fixed: false}};
  const replay = await writeReplay(ctx, 'interactions', CI);
  const written = JSON.parse(fs.readFileSync(path.join(dir, 'replay.json'), 'utf8'));
  assert.deepEqual([written.suite, written.mode, written.seed, written.window, written.theme, written.zone, written.trail.length, written.path.pages], ['interactions', 'seeded', 31, [1100, 720], 'dark', 'Asia/Tokyo', 2, ['focus']]);
  assert.equal(replay.event, 'schedule');
  const closed = await writeReplay({ARTIFACTS: fs.mkdtempSync(path.join(os.tmpdir(), 'replay-')), runner: {results: []}, page: {evaluate: async () => { throw new Error('closed'); }}}, 'focus', {});   // a closed page loses nothing else
  assert.equal(closed.mode, 'fixed');
});

test('a producer run adds up the paths its suites walked: fixed and seeded, windows, places, themes, steps', () => {
  const a = buildReplay({suite: 'a', env: CI, vary: {seed: 1, fixed: false}, window: [1024, 640], theme: 'dark', place: {zone: 'Asia/Tokyo', locale: 'ja-JP'}, trail}), b = buildReplay({suite: 'b', env: {GITHUB_EVENT_NAME: 'workflow_run'}, vary: {seed: 0, fixed: true}, window: [1280, 820], theme: 'light'});
  const one = pathSummary([a, b, null]);
  assert.deepEqual([one.suites, one.fixed, one.seeded, one.windows, one.zones, one.themes, one.events, one.steps, one.failedSteps],
    [2, 1, 1, {'1024x640': 1, '1280x820': 1}, {'Asia/Tokyo': 1}, {dark: 1, light: 1}, {schedule: 1, workflow_run: 1}, 2, 1]);
  const summary = runSummary({findings: [], filed: [], again: [], gone: [], closed: [], paths: one});
  const total = totalRuns([summary, summary]);
  assert.deepEqual([total.paths.suites, total.paths.fixed, total.paths.seeded, total.paths.windows['1024x640'], total.paths.events.schedule], [4, 2, 2, 2, 2]);
});

// 7 Oct 2026: the gates run inside the release run (desktop.yml) and arrive with its event: `schedule` for the GitHub-scheduled nightly. E2E_RUN_KIND names them.
test('a gate inside a scheduled release run is named a release gate, not a three-a-day run', () => {
  const replay = buildReplay({suite: 'jobs', env: {GITHUB_EVENT_NAME: 'schedule', E2E_RUN_KIND: 'gate'}});
  assert.equal(replay.runType, 'release gate (fixed path)');
  assert.equal(buildReplay({suite: 'jobs', env: {GITHUB_EVENT_NAME: 'schedule', E2E_RUN_KIND: ''}}).runType, 'scheduled run (three a day, a new path each time)');
});

test('writeReplay keeps a seen-passing.json that grows across runs, so a later filtered run does not erase an earlier pass', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'replay-seen-'));
  const run = results => writeReplay({ARTIFACTS: dir, runner: {results}, page: {evaluate: async () => { throw new Error('closed'); }}}, 'apply', {});
  await run([{name: 'the first new step, long enough to count', status: 'passed'}, {name: 'a step that failed in run one', status: 'failed'}]);
  await run([{name: 'the second step, passed only in the later run', status: 'passed'}]);
  const seen = JSON.parse(fs.readFileSync(path.join(dir, 'seen-passing.json'), 'utf8'));
  assert.deepEqual(Object.keys(seen).sort(), ['the first new step, long enough to count', 'the second step, passed only in the later run']);
  assert.equal(JSON.parse(fs.readFileSync(path.join(dir, 'replay.json'), 'utf8')).trail.length, 1, 'replay.json is only the last run; the ledger is the memory');
});
