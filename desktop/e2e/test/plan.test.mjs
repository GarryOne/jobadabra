// Which suites a push to main runs: only those whose files changed (the AI credit of the shared test key was spent by every test-file push running all suites).
// Schedules and manual runs still run everything.
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {autoSuites, noiseTripped, suitesFor, suitesNamed} from '../lib/plan.mjs';

const ALL = ['activity', 'apply', 'calendar', 'employers', 'focus', 'interviews', 'jobs', 'personas', 'settings', 'strategy', 'wizard'];

test('a changed suite file runs that suite, and only it', () => {
  assert.deepEqual(suitesFor(['desktop/e2e/suites/activity.mjs'], ALL), ['activity']);
  assert.deepEqual(suitesFor(['desktop/e2e/suites/jobs.mjs', 'desktop/e2e/suites/activity.mjs'], ALL), ['activity', 'jobs']);
});

test('a change to the extension runs the apply suite', () => {
  assert.deepEqual(suitesFor(['extension/content/fill.js', 'extension/manifest.json'], ALL), ['apply']);
});

test('a recorded case or the replay harness runs no e2e suite: CI · Integration · Page cases replays them (1 Nov 2026, the recorded suite left e2e)', () => {
  for (const file of ['desktop/e2e/recorded/workday-start-dialog-2/case.json', 'desktop/e2e/lib/page-replay.mjs']) assert.deepEqual(suitesFor([file], ALL), [], file);
  assert.ok(!suitesFor(['extension/background.js'], ALL).includes('recorded'));
});

test('shared test code runs the cheap, AI-free settings suite as a smoke test, not everything', () => {
  for (const file of ['desktop/e2e/lib/layout.mjs', 'desktop/e2e/suite.mjs', 'desktop/e2e/fixtures/feeds/acme.json', 'desktop/e2e/package.json', '.github/workflows/e2e.yml'])
    assert.deepEqual(suitesFor([file], ALL), ['settings'], file);
  assert.deepEqual(suitesFor(['desktop/e2e/lib/ai-proxy.mjs', 'desktop/e2e/suites/activity.mjs'], ALL), ['activity', 'settings']);
});

test('the unit tests of the tests and the docs run no suite (the plan job runs the unit tests itself)', () => {
  assert.deepEqual(suitesFor(['desktop/e2e/test/plan.test.mjs', 'desktop/e2e/README.md'], ALL), []);
  assert.deepEqual(suitesFor([], ALL), []);
});

test('a deleted or unknown suite file runs nothing by itself', () => {
  assert.deepEqual(suitesFor(['desktop/e2e/suites/gone.mjs'], ALL), []);
});

test('a manual run can name its suites; no name means all; an unknown name is refused', () => {
  assert.deepEqual(suitesNamed('', ALL), ALL);
  assert.deepEqual(suitesNamed('jobs, activity', ALL), ['activity', 'jobs']);
  assert.throws(() => suitesNamed('jobs,nope', ALL), /nope/);
});

test('watched files run a suite on a push, and a manual suite is never chosen by a push', () => {
  const watches = {quality: ['src/ai/score.py', 'desktop/e2e/fixtures/golden/'], personas: ['src/ai/hints.py']};
  const all = ['jobs', 'personas', 'quality', 'settings'], cadence = {personas: 'manual', quality: 'nightly'};
  assert.deepEqual(suitesFor(['src/ai/score.py'], all, {watches, cadence}), ['quality']);
  assert.deepEqual(suitesFor(['desktop/e2e/fixtures/golden/truth.json'], all, {watches, cadence}), ['quality', 'settings'], 'plus the settings smoke: any change under desktop/e2e runs it');
  assert.deepEqual(suitesFor(['src/ai/hints.py'], all, {watches, cadence}), [], 'a manual suite is not run by a push, watched or not');
  assert.deepEqual(suitesFor(['src/store.py'], all, {watches, cadence}), []);
});

test('autoSuites: the schedule takes the always suites, anything else everything that is not manual', () => {
  const all = ['a', 'b', 'c', 'd'], cadence = {b: 'nightly', c: 'manual'};
  assert.deepEqual(autoSuites(all, cadence, true), ['a', 'd']);
  assert.deepEqual(autoSuites(all, cadence, false), ['a', 'b', 'd']);
  assert.deepEqual(autoSuites(all, {}, true), all, 'no cadence means always');
});

test('a watched suite (it costs real AI money and judges one piece of code) runs only on a push that touches its files, never on a schedule or in the nightly gate', () => {
  const all = [...ALL, 'watchedeval'];
  const cadence = {watchedeval: 'watched'}, watches = {watchedeval: ['src/ai/mail.py', 'tests/fixtures/mail_eval.json']};
  assert.deepEqual(autoSuites(all, cadence), ALL);                                                    // not in the schedule or the nightly gate
  assert.deepEqual(autoSuites(all, cadence, true), ALL);
  assert.deepEqual(suitesFor(['src/ai/mail.py'], all, {watches, cadence}), ['watchedeval']);          // its own code changed
  assert.deepEqual(suitesFor(['tests/fixtures/mail_eval.json'], all, {watches, cadence}), ['watchedeval']);
  assert.deepEqual(suitesFor(['src/ai/score.py', 'desktop/lib/pipeline.js'], all, {watches, cadence}), []);   // anything else leaves it alone
  assert.deepEqual(suitesFor(['desktop/e2e/suites/watchedeval.mjs'], all, {watches, cadence}), ['watchedeval']);   // so does a change to the suite itself
});

// The noise breaker (4 Oct 2026): the AI review stops spending tokens when most of its recent issues were noise.
test('the noise breaker trips when most judged review issues since the new prompt were noise, and only then', () => {
  const issue = (number, kind, extra = {}) => ({number, state: 'CLOSED', stateReason: 'NOT_PLANNED', createdAt: '2026-10-10T05:00:00Z', labels: [{name: 'source:ai-review'}], comments: [], ...extra});
  const noisy = Array.from({length: 6}, (_, n) => issue(n));
  assert.equal(noiseTripped(noisy).tripped, true);
  const real = Array.from({length: 6}, (_, n) => issue(100 + n, 'x', {stateReason: 'COMPLETED', labels: [{name: 'source:ai-review'}, {name: 'confirmed'}]}));
  assert.equal(noiseTripped([...noisy.slice(0, 3), ...real]).tripped, false, '3 noise of 9 judged is under half');
  assert.equal(noiseTripped(noisy.slice(0, 5)).tripped, false, 'too few judged issues to say');
  assert.equal(noiseTripped(noisy.map(item => ({...item, createdAt: '2026-10-08T12:00:00Z'}))).tripped, false, 'issues from before the new prompt do not count against it');
  assert.equal(noiseTripped(noisy.map(item => ({...item, labels: [{name: 'source:suite-failure'}]}))).tripped, false, 'only the AI review is judged by this');
  // 9 Oct 2026: the recent record decides, so a better review recovers; a tie does not trip it.
  const at = (list, day) => list.map(item => ({...item, createdAt: `2026-10-${day}T12:00:00Z`}));
  assert.equal(noiseTripped([...at(noisy, '05'), ...at([...real, ...real], '08')]).tripped, false, 'ten recent real findings outweigh older noise');
  assert.equal(noiseTripped([...at(noisy.slice(0, 3), '08'), ...at(real.slice(0, 3), '08')]).tripped, false, 'half and half is not mostly noise');
});

test('a suite runs on Linux unless it needs the Mac, and the Mac suites stay within the 5 macOS slots of the Free plan', async () => {
  const {runnerOf} = await import('../lib/plan.mjs');
  const fs = await import('node:fs');
  assert.equal(runnerOf({}), 'ubuntu-24.04');
  assert.equal(runnerOf({macos: true}), 'macos-latest');
  const dir = new URL('../suites/', import.meta.url);
  const mac = fs.readdirSync(dir).filter(file => /^export const macos = true;/m.test(fs.readFileSync(new URL(file, dir), 'utf8')));
  assert.ok(mac.length <= 5, `${mac.length} suites need a macOS runner: ${mac.join(', ')}`);
});
