// A PR runs its picked steps on the store they were recorded on (27 Oct 2026, #2156: the map held steps recorded on the Notion stand-in, the PR ran on SQLite,
// settings' "the app is seeded … from the existing workspace" and strategy's two "written on the Notion page" steps were "not found", both first tries went red
// and both suites ran whole again). The map keeps each step's stores, the picker chooses the store, plan-run.mjs puts it in the matrix, e2e.yml runs it.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {test} from 'node:test';
import {mergeMap, storeFor} from '../lib/coverage-pick.mjs';
import {saveCoverage, SETUP} from '../lib/coverage.mjs';
import {planRun, prSteps, suiteFacts} from '../plan-run.mjs';
import {STORES, WHY, whyLines} from '../lib/pick-why.mjs';

const lines = (...ranges) => ({loaded: true, lines: ranges});
const file = (store, steps, partial = false) => ({suite: 'settings', sha: 'S', files: {'a.js': lines([1, 9])}, steps: Object.fromEntries(steps.map(name => [name, {'a.js': lines([1, 2])}])), partial, store});

test('the map keeps the stores each step ran on: a whole run replaces them, a run of some steps adds its store', () => {
  const night = mergeMap({}, [file('standin', ['every Settings section renders', 'seeded from the existing workspace', SETUP])], 'T1');
  assert.deepEqual(night.suites.settings.stores, {'every Settings section renders': ['standin'], 'seeded from the existing workspace': ['standin']}, 'no store for the setup gaps');
  const merged = mergeMap(night, [file('sqlite', ['every Settings section renders', 'set up on this Mac\'s store'], true)], 'T2');
  assert.deepEqual(merged.suites.settings.stores, {'every Settings section renders': ['sqlite', 'standin'], 'seeded from the existing workspace': ['standin'], 'set up on this Mac\'s store': ['sqlite']});
  const whole = mergeMap(merged, [file('sqlite', ['every Settings section renders'])], 'T3');
  assert.deepEqual(whole.suites.settings.stores, {'every Settings section renders': ['sqlite']}, 'a whole run is the suite as it is now');
  assert.equal(mergeMap({}, [file('', ['x'])]).suites.settings.stores, undefined, 'a coverage file from before stores: unknown');
});

test('a coverage file names the store under test', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'jp-store-'));
  const saved = await saveCoverage({number: 1, steps: {}, window: null, main: false}, dir, {E2E_SUITE: 'settings', E2E_STORE_UNDER_TEST: 'standin', E2E_PY_COVERAGE_DIR: ''});
  assert.equal(JSON.parse(fs.readFileSync(saved, 'utf8')).store, 'standin');
  assert.match(fs.readFileSync(new URL('../lib/context.mjs', import.meta.url), 'utf8'), /process\.env\.E2E_STORE_UNDER_TEST = store/, 'the context sets it for the coverage file');
});

test('#2156: settings stays on SQLite without the stand-in-only setup step; strategy runs on the stand-in, where its picked steps are', () => {
  const settings = {stores: {'every Settings section renders': ['sqlite', 'standin'], 'Automatic backup: Back up now': ['sqlite', 'standin'],
    'the app is set up on this Mac\'s store': ['sqlite'], 'the app is seeded as a set-up install from the existing workspace': ['standin']}};
  const picked = ['every Settings section renders', 'Automatic backup: Back up now', 'the app is set up on this Mac\'s store', 'the app is seeded as a set-up install from the existing workspace'];
  const one = storeFor(settings, picked);
  assert.equal(one.store, 'sqlite');
  assert.deepEqual(one.steps, picked.slice(0, 3));
  assert.deepEqual(one.dropped, [{step: picked[3], stores: ['standin']}]);
  const strategy = {stores: {'before any change': ['standin'], 'the next check keeps': ['standin'], 'an edit made directly on the Notion page': ['standin'], 'a region word written on the Notion page': ['standin']}};
  const two = storeFor(strategy, Object.keys(strategy.stores));
  assert.equal(two.store, 'standin');
  assert.deepEqual(two.dropped, []);
  assert.equal(storeFor({}, ['x', SETUP]).store, 'sqlite', 'no stores recorded: SQLite, as before');
  assert.deepEqual(storeFor({stores: {x: ['notion']}}, ['x']).steps, ['x'], 'the real workspace pins its own store: never a reason to drop');
});

test('a PR run puts the picked store in the matrix; without one the job falls back to SQLite', async () => {
  const SHA = 'a'.repeat(40), gh = args => (args[0] === 'api' && /commits\//.test(args.join(' ')) ? SHA : '[]');
  const steps = JSON.stringify({strategy: ['before any change'], settings: ['x'], [STORES]: {strategy: 'standin'}, [WHY]: ['strategy [standin] · "before any change" ← runs a.js:1']});
  const out = await planRun({env: {REPO: 'o/r', SHA, EVENT: 'workflow_dispatch', ONLY: 'strategy,settings', PR_SUITES: 'strategy,settings', PR_STEPS: steps}, gh, ...(await suiteFacts())});
  const store = Object.fromEntries(JSON.parse(out.matrix).include.map(item => [item.suite, item.store]));
  assert.deepEqual(store, {settings: '', strategy: 'standin'});
  assert.deepEqual(prSteps({PR_STEPS: 'not json'}), {});
  const workflow = fs.readFileSync(new URL('../../../.github/workflows/e2e.yml', import.meta.url), 'utf8');
  assert.match(workflow, /E2E_STORE: \$\{\{ matrix\.store \|\| \(inputs\.pr_suites != '' && 'sqlite'\)/, 'the matrix store wins; a PR without one runs SQLite');
  assert.match(workflow, /PR_STEPS: \$\{\{ inputs\.pr_steps \}\}/, 'the plan job reads the stores and the reasons');
});

test('the reasons: one line per picked step with the changed line that reached it, one per whole suite with the file that kept it whole', () => {
  const out = whyLines({suites: ['wander', 'apply', 'settings', 'jobs'], steps: {settings: ['every Settings section renders', 'quoted'], jobs: ['own']},
    stores: {settings: 'sqlite'}, dropped: {settings: [{step: 'seeded', stores: ['standin']}]},
    picked: {settings: {reach: {'every Settings section renders': 'desktop/lib/ai/anthropic-api.js:30'}}}, pointedBy: {wander: 'desktop/lib/ai-caps.js'},
    hits: {apply: new Set(['Claude is off']), settings: new Set(['Gone'])}, quoting: {apply: {whole: true, steps: []}, settings: {steps: ['quoted']}}, own: {jobs: ['own']}});
  assert.deepEqual(out, [
    'wander · whole suite ← desktop/lib/ai-caps.js (the suite watches or imports it, and its recorded run never loaded it)',
    'apply · whole suite ← quotes text this PR removes outside a named step ("Claude is off")',
    'settings [sqlite] · "every Settings section renders" ← runs desktop/lib/ai/anthropic-api.js:30',
    'settings [sqlite] · "quoted" ← quotes text this PR removes ("Gone")',
    'settings [sqlite] · not run: "seeded" (recorded only on standin: no such step on sqlite)',
    'jobs · "own" ← its own step changed in this PR']);
  assert.equal(whyLines({suites: Array.from({length: 200}, (_, i) => `s${i}`)}).length, 151, 'capped, so the dispatch input keeps room for the steps');
});

test('#2137: a quoted step another suite runs is picked in that suite, not in the file\'s own suite', async () => {
  const {rehomeQuotes, stepHomes} = await import('../lib/pr-suites.mjs');
  const step = 'with Telegram connected, a Jobs check sends one readable digest to the person\'s chat';
  const map = {suites: {activityfailures: {steps: {'the AI never answers': {}}}, failureschannels: {steps: {[step]: {}}}, wander: {files: {}}}};
  assert.deepEqual(stepHomes(map, 'activityfailures', step), ['failureschannels']);
  assert.deepEqual(stepHomes(map, 'activityfailures', 'a brand new step'), ['activityfailures'], 'a step no run recorded yet stays');
  assert.deepEqual(stepHomes(map, 'wander', step), ['wander'], 'a suite recorded without steps: cannot tell, stays');
  const out = rehomeQuotes({activityfailures: new Set(['readable digest'])}, {activityfailures: {steps: [step], whole: false}}, map);
  assert.deepEqual(Object.keys(out.hits), ['failureschannels'], 'activityfailures is no longer pointed at by that text');
  assert.deepEqual(out.quoting, {failureschannels: {steps: [step], whole: false}});
  const whole = rehomeQuotes({apply: new Set(['Claude is off'])}, {apply: {steps: [], whole: true}}, map);
  assert.deepEqual(whole.quoting, {apply: {steps: [], whole: true}}, 'a quote outside a named step keeps its suite whole');
});

test('#2156: a folder watch on app code no longer runs wander or interactions whole once the map has their steps', async () => {
  const {pointedWithMap} = await import('../lib/pr-suites.mjs');
  const map = {suites: {wander: {steps: {walk: {}}}, interactions: {steps: {sweep: {}}}, quality: {steps: {score: {}}}}};
  assert.deepEqual(pointedWithMap('desktop/lib/ai-caps.js', ['wander'], [], map), [], 'a new lib file: its loader\'s changed line picks the steps');
  assert.deepEqual(pointedWithMap('desktop/renderer/pages/topup-dialog.js', ['interactions', 'wander'], [], map), []);
  assert.deepEqual(pointedWithMap('desktop/lib/e2e-ipc.js', ['interactions', 'wander'], ['interactions'], map), ['interactions'], 'a file named exactly still runs it');
  assert.deepEqual(pointedWithMap('desktop/lib/ai-caps.js', ['wander'], [], {suites: {wander: {files: {}}}}), ['wander'], 'no steps recorded yet: whole, as before');
  assert.deepEqual(pointedWithMap('desktop/e2e/fixtures/golden/a.json', ['quality'], [], map), ['quality'], 'a fixture folder the map cannot record keeps its watch');
  const watched = ['wander', 'interactions'].map(suite => fs.readFileSync(new URL(`../suites/${suite}.mjs`, import.meta.url), 'utf8').match(/^export const watches = (.*);/m)?.[1] || '');
  assert.ok(watched.every(text => /'desktop\/renderer\/'/.test(text)), 'the class this guards still watches app folders (drop this test with the watch)');
});

test('#2157: removed UI words count only where a suite expects them, not in step names, labels, messages or comments', async () => {
  const {checkedText, suitesExpecting} = await import('../lib/pr-suites.mjs');
  const named = "// a Notion page\nawait ctx.run('this suite starts with no jobs in its Notion page', async () => {\n  if (!ok) throw new Error(`the Notion page ${id} was empty`);\n  console.log('  Notion page ready');\n}, {needs: [{name: 'the Notion page', value: true}]});\nconst url = 'https://x.test/a'; // Notion page";
  const expects = "await ctx.run('the review is saved', async () => { await see(page, 'The review is on the Notion page'); });";
  assert.equal(checkedText(named).length, named.length, 'same length: positions stay');
  assert.deepEqual(suitesExpecting(['Notion page'], {'suites/a.mjs': named, 'suites/b.mjs': expects}), {b: ['Notion page']});
  assert.match(checkedText(named), /'https:\/\/x\.test\/a'/, 'a URL is no comment');
});

test('one replay of the recorded cases per PR: its e2e run never starts `recorded`; page-cases leaves the slow ones to main, extension change or not', async () => {
  // #2164 replayed every case twice: page-cases 2 jobs and 5 runner-min, e2e's recorded 5 jobs and 44.
  // Owner, 27 Oct 2026: slow cases stay off PRs ("One bug in hundreds of PRs, that's low value": #1621 was the one escape since 17 Oct).
  const {planPrSuites, ON_PR_ELSEWHERE} = await import('../lib/pr-suites.mjs');
  const {splitForPr} = await import('../lib/replay-slow.mjs');
  const args = {pointed: ['apply', 'recorded'], linux: () => true};
  assert.deepEqual(planPrSuites({...args, pullRequest: true}).suites, ['apply'], 'a PR');
  assert.deepEqual(planPrSuites(args).suites, ['apply', 'recorded'], 'after a merge (main-steps.yml): unchanged');
  assert.ok(ON_PR_ELSEWHERE.recorded);
  const workflow = name => fs.readFileSync(new URL(`../../../.github/workflows/${name}`, import.meta.url), 'utf8');
  assert.match(workflow('pr-suites.yml'), /pr-suites\.mjs --base origin\/main --plan --pull-request/);
  assert.doesNotMatch(workflow('main-steps.yml'), /--pull-request/, 'main keeps recorded after a merge');
  const pages = workflow('page-cases.yml');
  for (const path of ["'extension/**'", "'desktop/e2e/recorded/**'"]) assert.ok(pages.includes(path), `page-cases.yml runs on a PR that changes ${path}`);
  const cases = [{name: 'fast'}, {name: 'slow'}];
  for (const changed of [['desktop/lib/x.js'], ['extension/flow.js']]) {
    assert.deepEqual(splitForPr(cases, {slow: ['slow'], changed}).left.map(one => one.name), ['slow'], `${changed[0]}: the slow ones wait for main`);
  }
});
