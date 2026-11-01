// verdictsFor / verdictsForCauses over injected reads: the owner's 31 Oct apply reds, from recorded shapes of the runs' step tables (no network).
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {execFileSync} from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {ghIo, verdictsFor, verdictsForCauses} from '../../lib/flaky-evidence.mjs';

const READ = "a job's form in the hidden browser";
const STOP = 'Stop on the card in Background automation';
const RED = 'fb1d711';
const tree = {
  'desktop/e2e/suites/apply.mjs': "import {proof} from '../../lib/background-proof.mjs';\n",
  'desktop/e2e/lib/background-proof.mjs': '', 'desktop/e2e/suite.mjs': '', 'desktop/e2e/lib/suite-main.mjs': '',
};
const table = (...passed) => ({results: passed.map(name => ({name, status: 'passed'}))});
// newest first, as GitHub lists them: a PR run (green on the read step), main after-merge (read step missing), an older main run (changed the step's file)
const RUNS = [
  {id: 1, sha: '79e6c34', title: 'E2E for PR · apply · a8-x', url: 'https://x/runs/1'},
  {id: 2, sha: '4a79a6b', title: 'E2E after merge · 4a79a6b · apply', url: 'https://x/runs/2'},
  {id: 3, sha: 'dead000', title: 'Mutant · apply', url: 'https://x/runs/3'},
  {id: 9, sha: RED, title: 'E2E Mac + Linux · apply · main', url: 'https://x/runs/9'},
];
const artifacts = {1: ['e2e-view-apply-1of3', 'e2e-view-settings'], 2: ['e2e-view-apply-1of3'], 3: ['e2e-view-apply-1of3'], 9: []};
const tables = {'1:e2e-view-apply-1of3': table(READ), '2:e2e-view-apply-1of3': table(READ, STOP), '3:e2e-view-apply-1of3': table(READ, STOP)};
const changes = {'79e6c34': ['desktop/e2e/ci-alert.mjs', 'desktop/e2e/lib/telegram-html.mjs'], '4a79a6b': ['desktop/e2e/lib/background-proof.mjs', 'desktop/e2e/ci-alert.mjs'], dead000: []};
const MAP = {suites: {apply: {steps: {[READ]: {'desktop/lib/apply-run.js': {lines: []}}, [STOP]: {'desktop/lib/apply-run.js': {lines: []}}, 'the app quits': {'desktop/lib/apply-run.js': {lines: []}}}}}};
const io = (over = {}) => ({
  runs: async () => RUNS, viewNames: async id => artifacts[id] || [], stepsOf: async (id, name) => tables[`${id}:${name}`] || null,
  changedNames: async (green) => changes[green] ?? null, readAt: (sha, file) => tree[file] ?? null, coverageMap: async () => MAP, ...over,
});

test('the read step is flaky: a PR head green whose diff to the red touches none of its files; the older main green alone would say changed', async () => {
  const [read] = await verdictsFor({suite: 'apply', steps: [READ], redSha: RED, redRun: 9, io: io()});
  assert.equal(read.verdict, 'flaky');
  assert.equal(read.green.sha, '79e6c34');
  assert.equal(read.green.url, 'https://x/runs/1');
  const [older] = await verdictsFor({suite: 'apply', steps: [READ], redSha: RED, redRun: 9, io: io({runs: async () => RUNS.filter(run => run.id !== 1)})});
  assert.equal(older.verdict, 'changed');
  assert.deepEqual(older.files, ['desktop/e2e/lib/background-proof.mjs'], 'the file the step imports, named');
});

test('a step the coverage map does not know counts the whole desktop/ app, so the same PR green says changed, never flaky', async () => {
  const [read] = await verdictsFor({suite: 'apply', steps: [READ], redSha: RED, redRun: 9, io: io({coverageMap: async () => null})});
  assert.equal(read.verdict, 'changed');
  assert.ok(read.files.includes('desktop/e2e/ci-alert.mjs'));
});

test('greens are compared nearest the red in time, on either side: newer greens that carry the fix must not crowd out the older one that did not change', async () => {
  const at = minutes => new Date(Date.UTC(2026, 9, 31, 12, 0) + minutes * 60000).toISOString();
  const runs = [{id: 20, sha: 'new0001', at: at(300), title: 'E2E after merge', url: 'https://x/20'}, {id: 21, sha: 'new0002', at: at(200), title: 'E2E after merge', url: 'https://x/21'},
    {id: 9, sha: RED, at: at(0), title: 'E2E after merge', url: 'https://x/9'}, {id: 22, sha: 'old0001', at: at(-5), title: 'E2E after merge', url: 'https://x/22'}];
  const all = {viewNames: async () => ['e2e-view-apply-1of3'], stepsOf: async () => table(READ), changedNames: async green => (green === 'old0001' ? ['desktop/e2e/ci-alert.mjs'] : ['desktop/lib/apply-run.js'])};
  const [near] = await verdictsFor({suite: 'apply', steps: [READ], redSha: RED, redRun: 9, maxGreens: 2, io: io({runs: async () => runs, ...all})});
  assert.equal(near.verdict, 'flaky', 'the green 5 minutes before the red is compared first, then the nearest newer one');
  assert.equal(near.green.sha, 'old0001');
  const [unordered] = await verdictsFor({suite: 'apply', steps: [READ], redSha: RED, redRun: 9, maxGreens: 2, io: io({runs: async () => runs.map(({at: _at, ...rest}) => rest), ...all})});
  assert.equal(unordered.verdict, 'changed', 'positive control: with no times the newest two fill the cap');
});

test('a mutant run, and the red run itself is not compared with itself', async () => {
  const seen = [];
  await verdictsFor({suite: 'apply', steps: [STOP], redSha: RED, redRun: 2, io: io({stepsOf: async (id, name) => { seen.push(id); return tables[`${id}:${name}`] || null; }})});
  assert.ok(!seen.includes(3) && !seen.includes(2));
});

test('a step no run passed is unknown; a green whose diff cannot be read is unknown too, never changed or flaky', async () => {
  const [none] = await verdictsFor({suite: 'apply', steps: ['some other step'], redSha: RED, redRun: 9, io: io()});
  assert.equal(none.verdict, 'unknown');
  const [blind] = await verdictsFor({suite: 'apply', steps: [READ], redSha: RED, redRun: 9, io: io({changedNames: async () => null})});
  assert.equal(blind.verdict, 'unknown');
});

test('a suite\'s shards are one suite: a green in another slice counts, a different suite\'s table does not', async () => {
  const [step] = await verdictsFor({suite: 'apply', steps: [READ], redSha: RED, redRun: 9, io: io({viewNames: async id => (id === 1 ? ['e2e-view-apply-2of2', 'e2e-view-applyflows-1of2'] : []),
    stepsOf: async (id, name) => (name === 'e2e-view-apply-2of2' ? table(READ) : table(READ, STOP))})});
  assert.equal(step.verdict, 'flaky');
});

test('verdictsForCauses groups by suite, drops the steps never run (the budget was spent) and dedups a step', async () => {
  const causes = [
    {suite: 'apply', step: READ, message: "the suite's 11-minute budget ran out during this step"},
    {suite: 'apply', step: READ, message: 'again'},
    {suite: 'apply', step: 'the app quits', message: 'not run: the suite was over its 11-minute budget'},
  ];
  const out = await verdictsForCauses(causes, {redSha: RED, redRun: 9, io: io()});
  assert.deepEqual(out.map(item => [item.suite, item.step, item.verdict]), [['apply', READ, 'flaky']]);
});

// The real git reads, against a local "remote": a shallow checkout lacks a PR head that is no ancestor of main; the commit comes from a private bare repo, never into the checkout.

test('ghIo compares and reads a commit its checkout lacks, and leaves the checkout unshallowed', async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'flaky-io-'));
  const git = (dir, ...args) => execFileSync('git', ['-C', dir, '-c', 'user.name=t', '-c', 'user.email=t@t', '-c', 'protocol.file.allow=always', ...args], {encoding: 'utf8'}).trim();
  const origin = path.join(tmp, 'origin');
  fs.mkdirSync(origin);
  git(origin, 'init', '-q', '-b', 'main');
  git(origin, 'config', 'uploadpack.allowAnySHA1InWant', 'true');
  const put = (file, text) => { fs.mkdirSync(path.dirname(path.join(origin, file)), {recursive: true}); fs.writeFileSync(path.join(origin, file), text); };
  put('desktop/e2e/suite.mjs', "import '../lib/x.mjs';\n"); put('desktop/e2e/lib/x.mjs', '1');
  git(origin, 'add', '-A'); git(origin, 'commit', '-qm', 'base');
  git(origin, 'checkout', '-q', '-b', 'pr'); put('desktop/e2e/lib/x.mjs', '2'); git(origin, 'commit', '-qam', 'pr'); const pr = git(origin, 'rev-parse', 'HEAD');
  git(origin, 'checkout', '-q', 'main'); put('desktop/e2e/other.mjs', '1'); git(origin, 'add', '-A'); git(origin, 'commit', '-qm', 'main'); const main = git(origin, 'rev-parse', 'HEAD');
  const checkout = path.join(tmp, 'checkout');
  git(tmp, 'clone', '-q', '--depth=1', '--branch', 'main', `file://${origin}`, checkout);
  const io = ghIo({repo: 'o/r', root: checkout, remoteUrl: `file://${origin}`});
  assert.deepEqual(await io.changedNames(pr, main), ['desktop/e2e/lib/x.mjs', 'desktop/e2e/other.mjs'].sort(), 'the PR head is no ancestor and not in the checkout: its tree is compared all the same');
  assert.equal(io.readAt(pr, 'desktop/e2e/lib/x.mjs'), '2');
  assert.equal(io.readAt(pr, 'desktop/e2e/nope.mjs'), null);
  assert.equal(git(checkout, 'rev-parse', '--is-shallow-repository'), 'true', 'the checkout was shallow and stays as it was');
  assert.throws(() => git(checkout, 'cat-file', '-e', pr), 'nothing was fetched into the checkout');
  fs.rmSync(tmp, {recursive: true, force: true});
});

// The owner's 31 Oct apply red (#2703): run 41200878403 ran the Notion stand-in store, the "green 2 minutes earlier on the same commit" 41200737331 ran sqlite
// (coverage artifacts: "store": "standin" / "sqlite"), and the tools called it flaky. Two stores are two inputs: that pair is no evidence of "same code, different result".
const VIEW = 'e2e-view-apply-1of3';
const storesOf = (byRun, other = {}) => async id => byRun[id] ?? other[id] ?? null;
test('a red on the stand-in store next to a green on sqlite of the same commit gives no verdict (41200878403 vs 41200737331)', async () => {
  const pair = {runs: async () => [{id: 41200737331, sha: RED, title: 'E2E after merge · fb1d711 · apply', url: 'https://x/41200737331'}, {id: 41200878403, sha: RED, title: 'E2E Mac + Linux · apply · main', url: 'https://x/41200878403'}],
    viewNames: async () => [VIEW], stepsOf: async () => table(READ), changedNames: async () => [],
    storesOf: storesOf({41200737331: {[VIEW]: 'sqlite'}, 41200878403: {[VIEW]: 'standin'}})};
  const [read] = await verdictsFor({suite: 'apply', steps: [READ], redSha: RED, redRun: 41200878403, io: io(pair)});
  assert.equal(read.verdict, 'unknown', 'a different store is not a comparable green');
  assert.equal(read.store, 'standin');
  assert.equal(read.otherStore, 1, 'the verdict says one green was left out for its store');
});

test('a green on the red\'s own store still decides flaky, and a store that cannot be read is no evidence either way', async () => {
  const runs = async () => [{id: 1, sha: '79e6c34', title: 'E2E for PR · apply · a8-x', url: 'https://x/1'}, {id: 9, sha: RED, title: 'E2E Mac + Linux · apply · main', url: 'https://x/9'}];
  const same = await verdictsFor({suite: 'apply', steps: [READ], redSha: RED, redRun: 9, io: io({runs, storesOf: async () => ({[VIEW]: 'standin'})})});
  assert.equal(same[0].verdict, 'flaky');
  const blindGreen = await verdictsFor({suite: 'apply', steps: [READ], redSha: RED, redRun: 9, io: io({runs, storesOf: async id => (id === 9 ? {[VIEW]: 'standin'} : {[VIEW]: null})})});
  assert.equal(blindGreen[0].verdict, 'unknown');
  const blindRed = await verdictsFor({suite: 'apply', steps: [READ], redSha: RED, redRun: 9, io: io({runs, storesOf: async id => (id === 9 ? {[VIEW]: null} : {[VIEW]: 'standin'})})});
  assert.equal(blindRed[0].verdict, 'unknown');
});

// Gitar on #2726: a gate run holds BOTH stores of a suite (plan-run.mjs:148: the sqlite leg keeps the key, the stand-in leg adds "-standin"), so the store is a property of
// the view artifact, not of the run: a pass on one leg must not count for a red on the other.
test('a gate run with both legs: only the leg on the red\'s store counts, in either direction', async () => {
  const STAND = `${VIEW}-standin`;
  const gate = {[VIEW]: 'sqlite', [STAND]: 'standin'};
  const runs = async () => [{id: 1, sha: '79e6c34', title: 'Gate · apply', url: 'https://x/1'}, {id: 9, sha: RED, title: 'E2E Mac + Linux · apply · main', url: 'https://x/9'}];
  const only = leg => async (_id, name) => (name === leg ? table(READ) : table());   // the step passed on one leg only
  const base = {runs, viewNames: async id => (id === 1 ? [VIEW, STAND] : [])};
  const sqliteRed = await verdictsFor({suite: 'apply', steps: [READ], redSha: RED, redRun: 9, io: io({...base, storesOf: async id => (id === 1 ? gate : {[VIEW]: 'sqlite'}), stepsOf: only(STAND)})});
  assert.equal(sqliteRed[0].verdict, 'unknown', 'a sqlite red, the gate passed it on its stand-in leg only');
  const standinRed = await verdictsFor({suite: 'apply', steps: [READ], redSha: RED, redRun: 9, io: io({...base, storesOf: async id => (id === 1 ? gate : {[STAND]: 'standin'}), stepsOf: only(VIEW)})});
  assert.equal(standinRed[0].verdict, 'unknown', 'a stand-in red, the gate passed it on its sqlite leg only');
  const matching = await verdictsFor({suite: 'apply', steps: [READ], redSha: RED, redRun: 9, io: io({...base, storesOf: async id => (id === 1 ? gate : {[STAND]: 'standin'}), stepsOf: only(STAND)})});
  assert.equal(matching[0].verdict, 'flaky', 'positive control: the same leg decides');
});

test('the real reads: a view key\'s store is its store leg, else the "store" of its coverage artifact; none of either is unknown', async () => {
  const run = args => {
    if (args.some(arg => String(arg).includes('/artifacts?per_page=100'))) return 'e2e-view-apply-1of3\ne2e-coverage-apply-1of3\ne2e-view-apply-1of3-standin\ne2e-view-settings\ne2e-view-quality-2of2\ne2e-coverage-quality-2of2\n';
    const name = args[args.indexOf('-n') + 1], dir = args[args.indexOf('-D') + 1];
    fs.writeFileSync(path.join(dir, 'coverage-x-1.json'), JSON.stringify({store: name.includes('quality') ? '' : 'sqlite', steps: {}}));
    return '';
  };
  const real = ghIo({repo: 'GarryOne/jobadabra', run});
  assert.deepEqual(await real.storesOf(1, 'apply'), {'e2e-view-apply-1of3': 'sqlite', 'e2e-view-apply-1of3-standin': 'standin'}, 'a gate run: two legs, two stores');
  assert.deepEqual(await real.storesOf(1, 'settings'), {'e2e-view-settings': null}, 'no coverage artifact: unknown');
  assert.deepEqual(await real.storesOf(1, 'quality'), {'e2e-view-quality-2of2': ''}, 'a suite with no store says ""');
});

// Gitar on #2726: a red whose store is unknown can compare with nothing, so it must not walk the whole window; and stores are read only for runs where a pending step passed.
test('an unknown red store answers unknown at once, and a run with no pass of the step never has its stores read', async () => {
  const runs = async () => [{id: 1, sha: '79e6c34', title: 'E2E · apply', url: 'https://x/1'}, {id: 2, sha: '4a79a6b', title: 'E2E · apply', url: 'https://x/2'}, {id: 9, sha: RED, title: 'E2E Mac + Linux · apply · main', url: 'https://x/9'}];
  const reads = [], seen = [];
  const blind = await verdictsFor({suite: 'apply', steps: [READ], redSha: RED, redRun: 9, io: io({runs, viewNames: async () => { seen.push('views'); return [VIEW]; }, storesOf: async id => { reads.push(id); return {[VIEW]: null}; }})});
  assert.equal(blind[0].verdict, 'unknown');
  assert.deepEqual(reads, [9], 'only the red\'s own stores were read');
  assert.deepEqual(seen, [], 'no run of the window was opened');
  const lazy = [];
  await verdictsFor({suite: 'apply', steps: [READ], redSha: RED, redRun: 9, io: io({runs, viewNames: async () => [VIEW], stepsOf: async () => table(), storesOf: async id => { lazy.push(id); return {[VIEW]: 'standin'}; }})});
  assert.deepEqual(lazy, [9], 'runs where nothing passed cost no store read');
});
