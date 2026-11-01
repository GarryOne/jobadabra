// The PR suite budget keeps five strongest reaches and reports every deferred journey after merge.
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {fileURLToPath} from 'node:url';
import * as pick from '../lib/pr-suites.mjs';
import {ensureStaged} from '../lib/ensure-staged.mjs';
import {NON_BACKBONE, shardLegs} from '../lib/suite-shards.mjs';

// Suite imports need generated shared/ even when this test runs alone in a fresh worktree.
ensureStaged(fileURLToPath(new URL('../..', import.meta.url)));

const args = {pullRequest: true, linux: () => true};
const eight = {
  ...args, pointed: ['z-own', 'y-import', 'x-own'], direct: ['z-own', 'x-own'],
  hits: {'b-quote': ['Gone label'], 'a-quote': ['Old label']},
  covering: {'c-map': 'runs app.js:3', 'b-map': 'runs app.js:2', 'a-map': 'runs app.js:1'},
};

test('a stale branch never admits a suite main demoted after its merge-base', () => {
  const tip = {suites: {quality: {lane: 'tolerant'}}};
  const git = args => ({
    'merge-base origin/main HEAD': 'fork\n',
    'show origin/main:desktop/e2e/lanes.json': JSON.stringify(tip),
    'show fork:desktop/e2e/lanes.json': '{"suites":{}}',
    'show HEAD:desktop/e2e/lanes.json': '{"suites":{}}',
  })[args.join(' ')];
  assert.deepEqual(pick.admittedSuites({baseLanes: tip, headLanes: {suites: {}}}), ['quality'], 'main tip would falsely admit it');
  assert.deepEqual(pick.admittedSuites(pick.admissionLanes(git, 'origin/main')), []);
});

test('dropping a tolerant entry since the merge-base admits a real promotion', () => {
  const git = args => ({
    'merge-base origin/main HEAD': 'fork\n',
    'show fork:desktop/e2e/lanes.json': '{"suites":{"quality":{"lane":"tolerant"}}}',
    'show HEAD:desktop/e2e/lanes.json': '{"suites":{}}',
  })[args.join(' ')];
  assert.deepEqual(pick.admittedSuites(pick.admissionLanes(git, 'origin/main')), ['quality']);
});

test('unreadable admission registries become empty independently', () => {
  for (const unreadable of [undefined, 'not json', 'null', '{"suites":[]}']) {
    const git = args => args[0] === 'merge-base' ? 'fork\n' : args[1].startsWith('HEAD:') ? '{"suites":{}}' : unreadable;
    assert.deepEqual(pick.admissionLanes(git, 'origin/main'), {baseLanes: {}, headLanes: {suites: {}}});
  }
  assert.deepEqual(pick.admissionLanes(() => { throw new Error('git read failed'); }, 'origin/main'), {baseLanes: {}, headLanes: {}});
});

test('admission follows added files and BASE to HEAD backbone promotions only', () => {
  const baseLanes = {suites: {quality: {lane: 'tolerant'}, paused: {lane: 'suspended'}, old: {lane: 'retired'}}};
  const admitted = input => pick.admittedSuites({baseLanes, headLanes: baseLanes, ...input});
  assert.deepEqual(admitted({addedFiles: ['desktop/e2e/suites/new.mjs']}), ['new']);
  assert.deepEqual(admitted({headLanes: {suites: {paused: {lane: 'suspended'}, old: {lane: 'retired'}}}}), ['quality']);
  assert.deepEqual(admitted({headLanes: {suites: {quality: {lane: 'backbone'}, paused: {lane: 'suspended'}, old: {lane: 'retired'}}}}), ['quality']);
  assert.deepEqual(admitted({}), []);
  assert.deepEqual(admitted({headLanes: {suites: {...baseLanes.suites, paused: {lane: 'tolerant'}}}}), []);
  assert.deepEqual(admitted({baseLanes: {}, headLanes: {suites: {quality: {lane: 'tolerant'}}}}), []);
  assert.deepEqual(admitted({addedFiles: ['desktop/e2e/suites/new.mjs'], headLanes: {suites: {...baseLanes.suites, new: {lane: 'tolerant'}}}}), []);
  assert.deepEqual(admitted({headLanes: {}, deletedFiles: ['desktop/e2e/suites/quality.mjs', 'desktop/e2e/suites/paused.mjs', 'desktop/e2e/suites/old.mjs']}), []);
});

test('admission overrides BASE tolerance, Mac and cadence exclusions ahead of reach within five places', () => {
  const out = pick.planPrSuites({...eight, admitted: ['quality'], lanes: {suites: {quality: {lane: 'tolerant', pr: 'number'}}},
    cadence: {quality: 'manual'}, linux: suite => suite !== 'quality'});
  assert.deepEqual(out.suites, ['quality', 'x-own', 'z-own', 'a-quote', 'b-quote']);
  assert.equal(out.deferred.length, 4);
});

test('eight reached suites: own files above imports/quotes above coverage; three wait for merge', () => {
  const plan = pick.planPrSuites(eight);
  assert.deepEqual(plan.suites, ['x-own', 'z-own', 'a-quote', 'b-quote', 'y-import']);
  assert.deepEqual(plan.left, ['c-map', 'b-map', 'a-map']);
  assert.deepEqual(plan.deferred, ['a-map', 'b-map', 'c-map']);
  assert.deepEqual(pick.stepLists({suites: plan.suites, pullRequest: true}), {});
  assert.deepEqual(pick.deferredLines({left: plan.deferred, picked: Object.fromEntries(Object.entries(eight.covering).map(([s, reason]) => [s, {reason}]))}), [
    'a-map · run after merge ← runs app.js:1',
    'b-map · run after merge ← runs app.js:2',
    'c-map · run after merge ← runs app.js:3',
  ]);
  assert.equal(pick.planPrSuites({...eight, pullRequest: false}).suites.length, 8);
});

test('equal reach uses suite name independently of input order', () => {
  for (const pointed of [['f', 'e', 'd', 'c', 'b', 'a'], ['c', 'a', 'e', 'f', 'd', 'b']]) {
    assert.deepEqual(pick.planPrSuites({...args, pointed}).suites, ['a', 'b', 'c', 'd', 'e']);
  }
});

test('five suite names defer nothing despite more than five jobs: fails if the planner counts jobs', async () => {
  // Why (29 Oct 2026, a8; owner on #2421): a suite split into jobs takes one of the five places, so the five names stay whole; counting slice jobs would defer some of them.
  const {shards: apply} = await import('../suites/apply.mjs');
  const {shards: applyflows} = await import('../suites/applyflows.mjs');
  const shards = {apply, applyflows};
  const pointed = ['settings', 'applyflows', 'jobs', 'apply', 'calendar'];
  const plan = pick.planPrSuites({...args, pointed});
  assert.deepEqual(plan, {suites: pointed, left: [], deferred: []});
  const jobs = pointed.flatMap(suite => shardLegs(suite, shards[suite]));
  assert.equal(jobs.length, apply + applyflows + 3);
  assert.ok(jobs.length > 5, 'the cap counts suite names, not their slice jobs');

  const six = pick.planPrSuites({...args, pointed: [...pointed, 'strategy']});
  assert.deepEqual(six, {
    suites: ['apply', 'applyflows', 'calendar', 'jobs', 'settings'],
    left: ['strategy'], deferred: ['strategy'],
  });
});

test('recorded takes no PR place (page-cases.yml replays it) and is one suite name with its slice jobs after merge', async () => {
  const {shards} = await import('../suites/recorded.mjs');
  const ordinary = ['strategy', 'settings', 'jobs', 'interviews', 'focus', 'calendar'];
  const pointed = ['recorded', ...ordinary];
  const plan = pick.planPrSuites({...args, pointed});
  assert.deepEqual(plan, {
    suites: ['calendar', 'focus', 'interviews', 'jobs', 'settings'],
    left: ['strategy'], deferred: ['strategy'],
  });
  // Why (29 Oct 2026, a8): page-cases.yml replays recorded on a PR, so ON_PR_ELSEWHERE removes it before the cap counts anything.
  assert.ok(!plan.suites.includes('recorded'));
  assert.ok(!plan.deferred.includes('recorded'));

  const main = pick.planPrSuites({...args, pointed, pullRequest: false});
  assert.deepEqual(main, {suites: pointed, left: [], deferred: []});
  assert.equal(main.suites.filter(suite => suite === 'recorded').length, 1);
  const jobs = main.suites.flatMap(suite => shardLegs(suite, suite === 'recorded' ? shards : undefined).map(leg => ({suite, ...leg})));
  assert.equal(jobs.filter(job => job.suite === 'recorded').length, shards);
  assert.equal(jobs.length, ordinary.length + shards);
  assert.ok(shards > 1, 'after merge, one recorded suite name expands into several slice jobs');
});

test('optional catch counts break a reach tie, never outrank a stronger reach', () => {
  const out = pick.planPrSuites({...eight, catches: {'c-map': 1000, 'y-import': 2, 'b-quote': 1}});
  assert.deepEqual(out.suites, ['x-own', 'z-own', 'y-import', 'b-quote', 'a-quote']);
  const pointed = ['a', 'b', 'c', 'd', 'e', 'f'];
  assert.deepEqual(pick.planPrSuites({...args, pointed, catches: {f: 3}}).suites, ['f', 'a', 'b', 'c', 'd']);
});

test('zero through five suites preserve order and leave Mac exclusions out of deferred', () => {
  for (let n = 0; n <= 5; n++) {
    const pointed = ['e', 'd', 'c', 'b', 'a'].slice(0, n);
    assert.deepEqual(pick.planPrSuites({...args, pointed, hits: {mac: ['Old label']}, linux: s => s !== 'mac', catches: {a: 99}}), {suites: pointed, left: ['mac'], deferred: []});
  }
});

test('tolerant, suspended and retired entries never use a PR place or join the deferred backbone', () => {
  const pointed = [...NON_BACKBONE, 'f', 'e', 'd', 'c', 'b', 'a'];
  const lanes = {suites: Object.fromEntries(NON_BACKBONE.map(lane => [lane, {lane}]))};
  const out = pick.planPrSuites({...args, pointed, lanes});
  assert.deepEqual(out, {suites: ['a', 'b', 'c', 'd', 'e'], left: ['f'], deferred: ['f']});
  assert.deepEqual(pick.planPrSuites({...args, pointed: ['tolerant', 'b'], lanes}), {suites: ['b'], left: [], deferred: []});
  assert.deepEqual(pick.planPrSuites({...args, pullRequest: false, pointed, lanes}).suites, ['f', 'e', 'd', 'c', 'b', 'a']);
});

test('a reached tolerant number runs outside the five backbone places and never joins deferrals', () => {
  const pointed = ['qualityai', 'notion-real', 'f', 'e', 'd', 'c', 'b', 'a'];
  const lanes = {suites: {qualityai: {lane: 'tolerant', pr: 'number'}, 'notion-real': {lane: 'tolerant'}}};
  assert.deepEqual(pick.planPrSuites({...args, pointed, lanes}), {
    suites: ['a', 'b', 'c', 'd', 'e', 'qualityai'], left: ['f'], deferred: ['f'],
  });
  assert.deepEqual(pick.planPrSuites({...args, pointed: ['qualityai'], lanes}), {suites: ['qualityai'], left: [], deferred: []});
  assert.deepEqual(pick.planPrSuites({...args, pointed: ['a'], lanes}), {suites: ['a'], left: [], deferred: []});
  assert.deepEqual(pick.planPrSuites({...args, covering: {qualityai: 'runs score.py:1'}, lanes}), {suites: ['qualityai'], left: [], deferred: []});
});

test('planner owns the cap deferrals, excluding a Mac-only loader even after merge', () => {
  const input = {...args, covering: {
    mac: 'loads app.js (line 9 ran in no suite)',
    f: 'runs app.js:6', e: 'runs app.js:5', d: 'runs app.js:4',
    c: 'runs app.js:3', b: 'runs app.js:2', a: 'runs app.js:1',
  }, linux: suite => suite !== 'mac'};
  const plan = pick.planPrSuites(input);
  assert.deepEqual(plan.suites, ['a', 'b', 'c', 'd', 'e']);
  assert.deepEqual(plan.left, ['mac', 'f']);
  assert.deepEqual(plan.deferred, ['f']);
  const main = pick.planPrSuites({...input, pullRequest: false});
  assert.deepEqual(main.suites, ['f', 'e', 'd', 'c', 'b', 'a']);
  assert.deepEqual(main.left, ['mac']);
  assert.deepEqual(main.deferred, []);
});

// Reaches: ../pr-suites.mjs
// Run the real CLI with only git's read results supplied; gh is a tripwire and all output is temporary.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {spawnSync} from 'node:child_process';

const cli = new URL('../pr-suites.mjs', import.meta.url);
function cliPlan({catches, pullRequest = true, base = 'origin/main', listed = {}, mergeBaseListed = listed, headListed = listed, checkoutLanes = {}, addedFiles = [], deletedFiles = [], suites = ['wizard', 'visitread', 'strategy', 'settings', 'jobs', 'interviews', 'focus', 'calendar'], extraFiles = [], coverage = {}, baseSources = {}} = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pr-cap-cli-'));
  try {
    const files = [...suites.map(s => `desktop/e2e/suites/${s}.mjs`), ...extraFiles];
    const diff = files.map(file => {
      const line = extraFiles.includes(file) ? 1 : fs.readFileSync(new URL(`../../../${file}`, import.meta.url), 'utf8').split('\n').findIndex(text => text.startsWith('import ')) + 1;
      assert.ok(line > 0, `fixture needs an import line: ${file}`);
      return `--- a/${file}\n+++ b/${file}\n@@ -${line} +${line} @@\n-old\n+new`;
    }).join('\n');
    const bin = path.join(dir, 'bin'); fs.mkdirSync(bin);
    fs.writeFileSync(path.join(bin, 'git'), `#!${process.execPath}\nconst args = process.argv.slice(2);\nif (args.includes('--name-only') && !args.includes(${JSON.stringify(`${base || 'origin/main'}...HEAD`)})) throw new Error('wrong diff base');\nif (args.includes('--diff-filter=A')) console.log(${JSON.stringify(addedFiles.join('\n'))});\nelse if (args.includes('--diff-filter=D')) console.log(${JSON.stringify(deletedFiles.join('\n'))});\nelse if (args.includes('--name-only')) console.log(${JSON.stringify(files.join('\n'))});\nelse if (args[0] === 'merge-base') console.log('fork');\nelse if (args[0] === 'show' && !args[1].endsWith('lanes.json')) { const file = args[1].split(':').slice(1).join(':'); const sources = ${JSON.stringify(baseSources)}; console.log(Object.hasOwn(sources, file) ? sources[file] : require('node:fs').readFileSync(require('node:path').join(${JSON.stringify(new URL('../../../', import.meta.url).pathname)}, file), 'utf8')); }\nelse if (args[0] === 'show') console.log(args[1].startsWith('HEAD:') ? ${JSON.stringify(JSON.stringify({suites: headListed}))} : args[1].startsWith('fork:') ? ${JSON.stringify(JSON.stringify({suites: mergeBaseListed}))} : ${JSON.stringify(JSON.stringify({suites: listed}))});\nelse console.log(${JSON.stringify(diff)});\n`, {mode: 0o755});
    fs.writeFileSync(path.join(bin, 'gh'), `#!${process.execPath}\nthrow new Error('Network forbidden in CLI test');\n`, {mode: 0o755});
    const output = path.join(dir, 'output'), map = path.join(dir, 'map.json');
    fs.writeFileSync(map, JSON.stringify(coverage));
    // Isolate the merged-checkout registry too: a future lane promotion must not change these fixtures.
    const preload = path.join(dir, 'registry.mjs');
    fs.writeFileSync(preload, `import fs from 'node:fs'; import {syncBuiltinESMExports} from 'node:module';
const read = fs.readFileSync;
fs.readFileSync = function(file, ...args) {
  return String(file) === ${JSON.stringify(new URL('../lanes.json', import.meta.url).pathname)} ? ${JSON.stringify(JSON.stringify({suites: checkoutLanes}))} : read.call(this, file, ...args);
};
syncBuiltinESMExports();`);
    const argv = ['--import', preload, cli.pathname, ...(base ? ['--base', base] : []), '--plan', '--map', map, ...(pullRequest ? ['--pull-request'] : [])];
    if (catches) { const file = path.join(dir, 'catches.json'); fs.writeFileSync(file, JSON.stringify(catches)); argv.push('--catches', file); }
    const run = spawnSync(process.execPath, argv, {encoding: 'utf8', timeout: 30000, env: {...process.env, PATH: `${bin}${path.delimiter}${process.env.PATH}`, GITHUB_OUTPUT: output, GITHUB_REPOSITORY: ''}});
    assert.equal(run.status, 0, run.stderr);
    assert.ok(fs.existsSync(output), run.stdout + run.stderr);
    const values = Object.fromEntries(fs.readFileSync(output, 'utf8').trim().split('\n').map(line => { const i = line.indexOf('='); return [line.slice(0, i), line.slice(i + 1)]; }));
    return {values, text: run.stdout};
  } finally { fs.rmSync(dir, {recursive: true, force: true}); }
}

test('CLI writes five whole suites and three deferrals with their reasons to stdout and GITHUB_OUTPUT', () => {
  const {values, text} = cliPlan();
  assert.equal(values.suites, 'calendar,focus,interviews,jobs,settings');
  assert.equal(values.left, 'wizard,visitread,strategy');
  const steps = JSON.parse(values.steps);
  assert.deepEqual(Object.keys(steps), ['(parts)', '(why)']);
  for (const suite of values.left.split(',')) {
    assert.match(text, new RegExp(`${suite} · run after merge ← desktop/e2e/suites/${suite}.mjs`));
    assert.ok(steps['(why)'].some(line => line.startsWith(`${suite} · run after merge ←`)));
  }
});

test('CLI reads catch counts only when supplied and applies the base registry before capping', () => {
  assert.equal(cliPlan({catches: {wizard: 99}}).values.suites, 'wizard,calendar,focus,interviews,jobs');
  const {values} = cliPlan({listed: {calendar: {lane: 'tolerant'}, focus: {lane: 'suspended'}}});
  assert.equal(values.suites, 'interviews,jobs,settings,strategy,visitread');
  assert.equal(values.left, 'wizard');
  const main = cliPlan({pullRequest: false, catches: {wizard: 99}, listed: {calendar: {lane: 'tolerant'}}});
  assert.equal(main.values.suites.split(',').length, 7);   // --base applies even without --pull-request
  assert.ok(!main.values.suites.split(',').includes('calendar'));
  assert.equal(main.values.left, '');
});

test('CLI picks a real watched AI suite only when BASE enables its informational number', () => {
  // qualityai is the real watched AI suite left on PRs; quality is night-report (never on a PR) since 1 Nov 2026.
  const change = {suites: [], extraFiles: ['src/ai/score.py']};
  assert.ok(!cliPlan({...change, listed: {qualityai: {lane: 'tolerant'}}}).values.suites.split(',').includes('qualityai'));
  assert.ok(cliPlan({...change, listed: {qualityai: {lane: 'tolerant', pr: 'number'}}}).values.suites.split(',').includes('qualityai'));
});

test('CLI labels only the capped Linux suite for merge, not the Mac-only loader', () => {
  const {values, text} = cliPlan({
    suites: ['strategy', 'settings', 'jobs', 'interviews', 'focus', 'calendar'],
    extraFiles: ['cap-fixture.js'],
    coverage: {suites: {
      strategy: {sha: 'fixture', files: {'cap-fixture.js': {loaded: true, lines: []}}, steps: {}},
      updates: {sha: 'fixture', files: {'cap-fixture.js': {loaded: true, lines: []}}, steps: {}},
    }},
  });
  assert.equal(values.suites, 'calendar,focus,interviews,jobs,settings');
  assert.equal(values.left, 'strategy,updates');
  assert.ok(text.includes('| `strategy` | run after merge | loads cap-fixture.js'));
  assert.ok(text.includes('| `updates` | not in this PR run | loads cap-fixture.js'));
  assert.ok(!text.includes('| `updates` | run after merge |'));
  const reasons = JSON.parse(values.steps)['(why)'];
  assert.deepEqual(reasons.filter(line => line.includes(' · run after merge ←')), [
    'strategy · run after merge ← desktop/e2e/suites/strategy.mjs (the suite watches or imports it, and its recorded run never loaded it)',
  ]);
});


test('CLI admits a new file or a lane promotion even when no watched app line reaches it', () => {
  const added = cliPlan({suites: ['settings'], addedFiles: ['desktop/e2e/suites/settings.mjs']});
  assert.deepEqual(JSON.parse(added.values.steps)['(burn-in)'], ['settings']);
  const promoted = cliPlan({suites: [], extraFiles: ['desktop/e2e/lanes.json'], listed: {quality: {lane: 'tolerant'}}, headListed: {}});
  assert.ok(promoted.values.suites.split(',').includes('quality'));
  assert.deepEqual(JSON.parse(promoted.values.steps)['(burn-in)'], ['quality']);
  assert.match(promoted.text, /quality.*burn-in.*5/);
});

test('CLI keeps main tip exemptions without burning in a stale branch after a main demotion', () => {
  const {values} = cliPlan({suites: ['quality'], listed: {quality: {lane: 'tolerant'}}, mergeBaseListed: {}, headListed: {}});
  assert.equal(values.suites, '');
  assert.equal(values.left, '');
  assert.equal(JSON.parse(values.steps)['(burn-in)'], undefined);
});

// Owner's 30 Oct merges reached live-AI suites: only backbone belongs in the after-merge plan.
test('after merge drops tolerant quality and retired mailreading but keeps reached backbone and PR-only numbers', () => {
  const lanes = {suites: {quality: {lane: 'tolerant'}, mailreading: {lane: 'retired'}, qualityai: {lane: 'tolerant', pr: 'number'}}};
  const input = {linux: () => true, pointed: ['quality', 'mailreading', 'apply', 'qualityai'], lanes};
  assert.deepEqual(pick.planPrSuites({...input, pullRequest: false}), {suites: ['apply'], left: [], deferred: []});
  assert.deepEqual(pick.planPrSuites({...input, pullRequest: true}).suites, ['apply', 'qualityai']);
});

test('without --base the CLI reads the merged registry, including a lane changed by this merge', () => {
  const {values} = cliPlan({pullRequest: false, base: '', suites: ['quality', 'qualityai', 'focus'],
    checkoutLanes: {quality: {lane: 'tolerant'}, qualityai: {lane: 'tolerant'}}});
  assert.equal(values.suites, 'focus');
});


test('--base without --pull-request cannot use the checkout lane to exempt a reached suite', () => {
  const {values} = cliPlan({pullRequest: false, suites: ['focus'], listed: {}, checkoutLanes: {focus: {lane: 'tolerant'}}});
  assert.equal(values.suites, 'focus');
});


test('CLI transports watched mail parts from the actual PR changed files', () => {
  const listed = {qualityai: {lane: 'tolerant', pr: 'number'}};
  const mail = cliPlan({suites: [], extraFiles: ['src/ai/mail.py'], listed});
  assert.equal(mail.values.suites, 'qualityai');
  assert.deepEqual(JSON.parse(mail.values.steps)['(parts)'].qualityai, ['mail']);
  const unrelated = cliPlan({suites: [], extraFiles: ['src/ai/interviews.py'], listed});
  assert.ok(!unrelated.values.suites.split(',').includes('qualityai'));
  assert.deepEqual(JSON.parse(unrelated.values.steps)['(parts)'].qualityai, []);
});


test('mail part routing preserves helper, suite, mixed and recorded journey reach', () => {
  const listed = {qualityai: {lane: 'tolerant', pr: 'number'}};
  const parts = extraFiles => JSON.parse(cliPlan({suites: [], extraFiles, listed}).values.steps)['(parts)'].qualityai;
  assert.deepEqual(parts(['desktop/e2e/lib/quality-mail.mjs']), ['mail']);
  assert.deepEqual(parts(['src/ai/mail.py', 'desktop/e2e/lib/quality-journey.mjs']), ['journey', 'mail']);
  assert.deepEqual(parts(['src/ai/mail.py', 'desktop/e2e/suites/qualityai.mjs']), ['journey', 'mail']);
  assert.deepEqual(parts(['src/ai/mail.py', 'docs/ARCHITECTURE.md']), ['mail']);
  const coverage = {suites: {qualityai: {sha: 'recorded', files: {'desktop/lib/some-loaded.js': {lines: [[1, 1]]}}}}};
  const mapped = cliPlan({suites: [], extraFiles: ['src/ai/mail.py', 'desktop/lib/some-loaded.js'], listed, coverage});
  assert.deepEqual(JSON.parse(mapped.values.steps)['(parts)'].qualityai, ['journey', 'mail']);
});


test('CLI compares merge-base step names and emits step burn-in metadata', () => {
  const file = 'desktop/e2e/suites/settings.mjs';
  const head = fs.readFileSync(new URL('../../../' + file, import.meta.url), 'utf8');
  const [step] = pick.stepCalls(head).filter(call => call.name);
  const old = head.slice(0, step.start) + head.slice(step.end + 1);
  const {values} = cliPlan({suites: ['settings'], baseSources: {[file]: old}});
  assert.deepEqual(JSON.parse(values.steps)['(step-burn-in)'], {settings: [step.name]});
});

test('new-step suites outrank ordinary reach so the cap cannot silently skip burn-in', () => {
  const out = pick.planPrSuites({...eight, stepBurnIn: {'new-mac': ['New step']}, linux: suite => suite !== 'new-mac'});
  assert.ok(out.suites.includes('new-mac'));
  assert.equal(out.suites.length, 5);
});


test('more than five burn-in suites must be split, rather than defer an unproved step', () => {
  const stepBurnIn = Object.fromEntries(['a', 'b', 'c', 'd', 'e', 'f'].map(suite => [suite, ['New step']]));
  assert.throws(() => pick.planPrSuites({...args, stepBurnIn}), {code: 'E2E_BURN_IN_CAPACITY'});
});
