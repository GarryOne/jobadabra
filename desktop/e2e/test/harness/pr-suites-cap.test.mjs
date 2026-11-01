// The PR suite budget keeps five strongest reaches and reports every deferred journey after merge.
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {fileURLToPath} from 'node:url';
import * as pick from '../../lib/pr-suites.mjs';
import {ensureStaged} from '../../lib/ensure-staged.mjs';
import {NON_BACKBONE, shardLegs} from '../../lib/suite-shards.mjs';

// Suite imports need generated shared/ even when this test runs alone in a fresh worktree.
ensureStaged(fileURLToPath(new URL('../../..', import.meta.url)));

const args = {pullRequest: true, linux: () => true};
const eight = {
  ...args, pointed: ['z-own', 'y-import', 'x-own'], direct: ['z-own', 'x-own'],
  hits: {'b-quote': ['Gone label'], 'a-quote': ['Old label']},
  covering: {'c-map': 'runs app.js:3', 'b-map': 'runs app.js:2', 'a-map': 'runs app.js:1'},
};

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
  const {shards: apply} = await import('../../suites/apply.mjs');
  const {shards: applyflows} = await import('../../suites/applyflows.mjs');
  const shards = {apply, applyflows};
  const pointed = ['settings', 'applyflows', 'jobs', 'apply', 'activity'];
  const plan = pick.planPrSuites({...args, pointed});
  assert.deepEqual(plan, {suites: pointed, left: [], deferred: []});
  const jobs = pointed.flatMap(suite => shardLegs(suite, shards[suite]));
  assert.equal(jobs.length, apply + applyflows + 3);
  assert.ok(jobs.length > 5, 'the cap counts suite names, not their slice jobs');

  const six = pick.planPrSuites({...args, pointed: [...pointed, 'strategy']});
  assert.deepEqual(six, {
    suites: ['activity', 'apply', 'applyflows', 'jobs', 'settings'],
    left: ['strategy'], deferred: ['strategy'],
  });
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

// Why (R2 + J16/J19, 1 Nov 2026): 'failuresnotion' and 'linkedin' stand where the deleted `focusdismiss` and `interviews` suites stood, 'employers' where the deleted `activity` suite stood in these fixtures: a real suite file the diff fixture can read, sorting before failuresnotion as `activity` did.
const cli = new URL('../../pr-suites.mjs', import.meta.url);
function cliPlan({catches, pullRequest = true, base = 'origin/main', listed = {}, checkoutLanes = {}, suites = ['wizard', 'storemove', 'stores', 'settings', 'jobs', 'linkedin', 'failuresnotion', 'employers'], extraFiles = [], coverage = {}, baseSources = {}} = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pr-cap-cli-'));
  try {
    const files = [...suites.map(s => `desktop/e2e/suites/${s}.mjs`), ...extraFiles];
    const diff = files.map(file => {
      const line = extraFiles.includes(file) ? 1 : fs.readFileSync(new URL(`../../../../${file}`, import.meta.url), 'utf8').split('\n').findIndex(text => text.startsWith('import ')) + 1;
      assert.ok(line > 0, `fixture needs an import line: ${file}`);
      return `--- a/${file}\n+++ b/${file}\n@@ -${line} +${line} @@\n-old\n+new`;
    }).join('\n');
    const bin = path.join(dir, 'bin'); fs.mkdirSync(bin);
    fs.writeFileSync(path.join(bin, 'git'), `#!${process.execPath}\nconst args = process.argv.slice(2);\nif (args.some(a => a.startsWith('--diff-filter')) || args[0] === 'merge-base' || (args[0] === 'show' && /^(HEAD|fork):/.test(args[1]))) throw new Error('admission read: ' + args.join(' '));\nif (args.includes('--name-only') && !args.includes(${JSON.stringify(`${base || 'origin/main'}...HEAD`)})) throw new Error('wrong diff base');\nif (args.includes('--name-only')) console.log(${JSON.stringify(files.join('\n'))});\nelse if (args[0] === 'show' && !args[1].endsWith('lanes.json')) { const file = args[1].split(':').slice(1).join(':'); const sources = ${JSON.stringify(baseSources)}; console.log(Object.hasOwn(sources, file) ? sources[file] : require('node:fs').readFileSync(require('node:path').join(${JSON.stringify(new URL('../../../../', import.meta.url).pathname)}, file), 'utf8')); }\nelse if (args[0] === 'show') console.log(${JSON.stringify(JSON.stringify({suites: listed}))});\nelse console.log(${JSON.stringify(diff)});\n`, {mode: 0o755});
    fs.writeFileSync(path.join(bin, 'gh'), `#!${process.execPath}\nthrow new Error('Network forbidden in CLI test');\n`, {mode: 0o755});
    const output = path.join(dir, 'output'), map = path.join(dir, 'map.json');
    fs.writeFileSync(map, JSON.stringify(coverage));
    // Isolate the merged-checkout registry too: a future lane promotion must not change these fixtures.
    const preload = path.join(dir, 'registry.mjs');
    fs.writeFileSync(preload, `import fs from 'node:fs'; import {syncBuiltinESMExports} from 'node:module';
const read = fs.readFileSync;
fs.readFileSync = function(file, ...args) {
  return String(file) === ${JSON.stringify(new URL('../../lanes.json', import.meta.url).pathname)} ? ${JSON.stringify(JSON.stringify({suites: checkoutLanes}))} : read.call(this, file, ...args);
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
  assert.equal(values.suites, 'employers,failuresnotion,jobs,linkedin,settings');
  assert.equal(values.left, 'wizard,storemove,stores');
  const steps = JSON.parse(values.steps);
  assert.deepEqual(Object.keys(steps), ['(parts)', '(why)']);
  for (const suite of values.left.split(',')) {
    assert.match(text, new RegExp(`${suite} · run after merge ← desktop/e2e/suites/${suite}.mjs`));
    assert.ok(steps['(why)'].some(line => line.startsWith(`${suite} · run after merge ←`)));
  }
});

test('CLI reads catch counts only when supplied and applies the base registry before capping', () => {
  assert.equal(cliPlan({catches: {wizard: 99}}).values.suites, 'wizard,employers,failuresnotion,jobs,linkedin');
  const {values} = cliPlan({listed: {employers: {lane: 'tolerant'}, failuresnotion: {lane: 'suspended'}}});
  assert.equal(values.suites, 'jobs,linkedin,settings,storemove,stores');
  assert.equal(values.left, 'wizard');
  const main = cliPlan({pullRequest: false, catches: {wizard: 99}, listed: {employers: {lane: 'tolerant'}}});
  assert.equal(main.values.suites.split(',').length, 7);   // --base applies even without --pull-request
  assert.ok(!main.values.suites.split(',').includes('employers'));
  assert.equal(main.values.left, '');
});

test('CLI never picks the night-report AI suite, even when BASE enables its informational number', () => {
  // qualityai and quality are night-report (never on a PR) since 1 Nov 2026 (qualityai: 6/6a-2).
  const change = {suites: [], extraFiles: ['src/ai/score.py']};
  assert.ok(!cliPlan({...change, listed: {qualityai: {lane: 'tolerant'}}}).values.suites.split(',').includes('qualityai'));
  assert.ok(!cliPlan({...change, listed: {qualityai: {lane: 'tolerant', pr: 'number'}}}).values.suites.split(',').includes('qualityai'), 'qualityai is night-report: no PR number (6/6a-2)');
});

test('CLI labels only the capped Linux suite for merge, not the Mac-only loader', () => {
  const {values, text} = cliPlan({
    suites: ['stores', 'settings', 'jobs', 'linkedin', 'failuresnotion', 'employers'],
    extraFiles: ['cap-fixture.js'],
    coverage: {suites: {
      stores: {sha: 'fixture', files: {'cap-fixture.js': {loaded: true, lines: []}}, steps: {}},
      updates: {sha: 'fixture', files: {'cap-fixture.js': {loaded: true, lines: []}}, steps: {}},
    }},
  });
  assert.equal(values.suites, 'employers,failuresnotion,jobs,linkedin,settings');
  assert.equal(values.left, 'stores,updates');
  assert.ok(text.includes('| `stores` | run after merge | loads cap-fixture.js'));
  assert.ok(text.includes('| `updates` | not in this PR run | loads cap-fixture.js'));
  assert.ok(!text.includes('| `updates` | run after merge |'));
  const reasons = JSON.parse(values.steps)['(why)'];
  assert.deepEqual(reasons.filter(line => line.includes(' · run after merge ←')), [
    'stores · run after merge ← desktop/e2e/suites/stores.mjs (the suite watches or imports it, and its recorded run never loaded it)',
  ]);
});


// Why (1 Nov 2026, owner via mac-07: "Yes, journeys only (Recommended)": a PR that adds or changes a journey step runs it 5x, no other step and no suite admission): a new suite
// file or a lane promotion is planned like any change, once; the night burn-in proves it.
test('CLI: a new suite file or a lane promotion is planned once, with no admission legs', () => {
  const added = cliPlan({suites: ['settings']});
  assert.ok(added.values.suites.split(',').includes('settings'));
  assert.equal(JSON.parse(added.values.steps)['(burn-in)'], undefined);
  const promoted = cliPlan({suites: [], extraFiles: ['desktop/e2e/lanes.json'], listed: {}});
  assert.ok(!promoted.values.suites.split(',').includes('quality'), 'nothing reaches quality, so the promotion alone plans nothing');
  assert.equal(JSON.parse(promoted.values.steps)['(burn-in)'], undefined);
  assert.doesNotMatch(promoted.text + added.text, /burn-in/);
});

test('CLI: a suite BASE lists as tolerant stays out of the PR plan', () => {
  const {values} = cliPlan({suites: ['quality'], listed: {quality: {lane: 'tolerant'}}});
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
  const {values} = cliPlan({pullRequest: false, base: '', suites: ['quality', 'qualityai', 'failuresnotion'],
    checkoutLanes: {quality: {lane: 'tolerant'}, qualityai: {lane: 'tolerant'}}});
  assert.equal(values.suites, 'failuresnotion');
});


test('--base without --pull-request cannot use the checkout lane to exempt a reached suite', () => {
  const {values} = cliPlan({pullRequest: false, suites: ['failuresnotion'], listed: {}, checkoutLanes: {failuresnotion: {lane: 'tolerant'}}});
  assert.equal(values.suites, 'failuresnotion');
});


// Why (1 Nov 2026, owner via a8, 6/6a-2): qualityai is night-report (one live run a night), so no PR plans it or its mail part, whatever it watches; a person can still name qualityai:mail.
test('CLI: qualityai and its mail part are never planned on a PR, even when BASE lists its number', () => {
  const listed = {qualityai: {lane: 'tolerant', pr: 'number'}};
  for (const extraFiles of [['src/ai/mail.py'], ['src/ai/score.py'], ['desktop/e2e/lib/quality-mail.mjs'], ['desktop/e2e/suites/qualityai.mjs'], ['src/ai/mail.py', 'desktop/e2e/lib/quality-journey.mjs']]) {
    const plan = cliPlan({suites: [], extraFiles, listed});
    assert.ok(!plan.values.suites.split(',').includes('qualityai'), `${extraFiles} planned qualityai`);
  }
});


// Why (1 Nov 2026, owner: "Drop it entirely, now"): a new step in a backbone suite is no longer proved five times; the PR plan names the suite and no repeat metadata.
test('CLI: a PR that adds a step to a backbone suite plans the suite and writes no step burn-in', () => {
  const file = 'desktop/e2e/suites/settings.mjs';
  const head = fs.readFileSync(new URL('../../../../' + file, import.meta.url), 'utf8');
  const [step] = pick.stepCalls(head).filter(call => call.name);
  const old = head.slice(0, step.start) + head.slice(step.end + 1);
  const {values, text} = cliPlan({suites: ['settings'], baseSources: {[file]: old}});
  assert.ok(values.suites.split(',').includes('settings'));
  const steps = JSON.parse(values.steps);
  assert.equal(steps['(step-burn-in)'], undefined);
  assert.equal(steps['(burn-in)'], undefined);
  assert.doesNotMatch(text, /burn-in 5\/5/);
});
