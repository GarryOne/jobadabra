// The flaky verdict over the recorded gh answers of the night red 41269467529 (Night burn-in 4/5 · main, 5b63233, 1 Nov 2026 03:30 UTC): apply-3of3 + apply-3of3-standin + wizard-standin failed.
// Recorded with a scratch script from the real runs ±6 h round it: run list, artifact names and sizes (the failed shards' view artifacts are 1,045,025,600 and 91,961,426 bytes), the
// failed steps' pass/fail per view, each coverage artifact's store, the coverage map of the failed steps, and the step-file names that changed between each run's commit and the red's.
// The real ghIo runs over a fake gh, so the listing, the created= ranges, the store rule and the download fallback are the shipped code; only git is answered from the fixture.
// Before the fix (main at 8fd8795) this read said "Unknown" for every step (the red's store was read per suite: sqlite leg + stand-in leg = unknown).
import assert from 'node:assert/strict';
import {test} from 'node:test';
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {ghIo, verdictsForCauses} from '../lib/flaky-evidence.mjs';
import {sayLine} from '../lib/flaky-verdict.mjs';

const F = JSON.parse(fs.readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), 'fixtures/flaky-41269467529.json'), 'utf8'));
const FULL = F.causes.find(cause => cause.step.startsWith('Full automation presses Submit')).step;

function fakeGh(fixture, calls = []) {
  return (args, options = {}) => {
    calls.push({args, options});
    const joined = args.join(' ');
    const artifacts = /actions\/runs\/(\d+)\/artifacts/.exec(joined);
    if (artifacts) return (fixture.artifacts[artifacts[1]] || []).map(([name, size], i) => `${i}\t${size}\t${name}`).join('\n');
    if (/workflows\/e2e\.yml\/runs/.test(joined)) return JSON.stringify(fixture.runs);
    if (args[0] === 'run' && args[1] === 'download') {
      const id = args[2], name = args[args.indexOf('-n') + 1], dir = args[args.indexOf('-D') + 1];
      if (name.startsWith('e2e-view-')) fs.writeFileSync(path.join(dir, 'steps.json'), JSON.stringify({results: fixture.steps[`${id}:${name}`] || []}));
      else fs.writeFileSync(path.join(dir, 'coverage-x-1.json'), JSON.stringify({store: fixture.stores[`${id}:${name}`] ?? null}));
      return '';
    }
    if (args[0] === 'auth') return 'token\n';
    throw new Error(`unexpected gh ${joined}`);
  };
}
const refuseRanges = async () => { throw new Error('no ranges in this test'); };   // the 1 GB views are unreadable here; their steps are not in the fixture either
// The suite file at the red's commit, as the import closure it had there (recorded as paths): one synthetic import per file, so lib/flaky-verdict.mjs walks the same set the real read walks.
const tree = fixture => {
  const files = new Map();
  for (const [suite, closure] of Object.entries(fixture.closure)) {
    const root = `desktop/e2e/suites/${suite}.mjs`;
    files.set(root, closure.filter(file => file !== root).map(file => `import '${path.posix.relative(path.posix.dirname(root), file)}';`).join('\n'));
    for (const file of closure) if (!files.has(file)) files.set(file, '');
  }
  return files;
};
const ioOf = (fixture, changed = fixture.changed) => ({...ghIo({repo: 'GarryOne/jobadabra', run: fakeGh(fixture), zipSource: refuseRanges}), changedNames: async sha => changed[sha] ?? null, readAt: (_sha, file) => tree(fixture).get(file) ?? null, coverageMap: async () => fixture.map});
const read = (fixture, changed) => verdictsForCauses(fixture.causes, {redSha: fixture.red.sha, redRun: fixture.red.id, redAt: fixture.red.at, io: ioOf(fixture, changed)});

test('the night red is judged per leg: apply-3of3 is "Changed" against its newest comparable green, naming files the step runs, never "Unknown" for everything', async () => {
  const out = await read(F);
  const full = out.find(item => item.step === FULL);
  assert.equal(full.verdict, 'changed', 'every green of this step differs from the red in files the step runs');
  for (const file of ['desktop/e2e/suites/apply.mjs', 'desktop/lib/ext-http-timing.js', 'desktop/lib/server.js']) assert.ok(full.files.includes(file), file);
  assert.equal(full.green.sha, 'a1b42a2' + full.green.sha.slice(7), 'the newest comparable green is the after-merge run 41267097969');
  assert.equal(full.store, 'sqlite+standin', 'it failed on both legs, so a green on either counts');
  for (const item of out.filter(entry => entry.suite === 'apply')) assert.notEqual(item.verdict, 'unknown', item.step);
  assert.match(sayLine(full), /^Changed: “Full automation presses Submit once on its own/);
});

test('positive control: the same read says "flaky" against the newest sqlite green once none of the step\'s files differ between it and the red', async () => {
  const sha = F.runs.find(run => run.title.startsWith('E2E after merge · a1b42a2')).sha;
  const out = await read(F, {...F.changed, [sha]: []});
  const full = out.find(item => item.step === FULL);
  assert.equal(full.verdict, 'flaky');
  assert.equal(full.green.sha, sha);
  assert.match(full.green.url, /actions\/runs\/41267097969$/);
  assert.match(sayLine(full), /^Flaky: “Full automation presses Submit once on its own/);
});

test('the wizard step, red on the stand-in leg only, is compared with stand-in greens only', async () => {
  const out = await read(F);
  const wizard = out.find(item => item.suite === 'wizard');
  assert.equal(wizard.store, 'standin');
  assert.ok(wizard.verdict !== 'unknown' || /no green in \d+ runs since 2026-/.test(wizard.reason), `${wizard.verdict}: ${wizard.reason}`);
});
