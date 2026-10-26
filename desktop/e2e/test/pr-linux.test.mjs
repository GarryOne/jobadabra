// A pull request's e2e run (and the same steps after its merge) runs a suite that needs the Mac only for its release path (`macos = 'release'`: apply, applyflows,
// the real extension opened through `open`) on Linux: no wait for one of the 5 macOS runners (#2119's apply waited 17 min, 26 Oct 2026). A beta, a nightly
// gate and the night's schedule keep it on the Mac, so the Mac path is proved before every release. A suite that needs the Mac itself (`macos = true`:
// Keychain, pixels) stays there for a PR too. Owner, 26 Oct 2026: "Both, PRs on Linux (Recommended)".
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {test} from 'node:test';
import {planRun, suiteFacts} from '../plan-run.mjs';
import {runnerOf} from '../lib/plan.mjs';

const SHA = 'a'.repeat(40);
const gh = args => (args[0] === 'api' && /commits\//.test(args.join(' ')) ? SHA : '[]');
const osBySuite = async env => {
  const out = await planRun({env: {REPO: 'o/r', SHA, ...env}, gh, ...(await suiteFacts())});
  const os = {};
  for (const item of JSON.parse(out.matrix).include) (os[item.suite] ||= new Set()).add(item.os);
  return Object.fromEntries(Object.entries(os).map(([suite, set]) => [suite, [...set].join(',')]));
};
const suitesWhere = value => {
  const dir = new URL('../suites/', import.meta.url);
  return fs.readdirSync(dir).filter(file => file.endsWith('.mjs') && new RegExp(`^export const macos = ${value};`, 'm').test(fs.readFileSync(new URL(file, dir), 'utf8'))).map(file => file.slice(0, -4));
};

test('runnerOf: a release-only Mac suite is Linux for a PR, the Mac otherwise; a Mac suite stays on the Mac', () => {
  assert.equal(runnerOf({macos: 'release'}, {pr: true}), 'ubuntu-24.04');
  assert.equal(runnerOf({macos: 'release'}), 'macos-latest');
  assert.equal(runnerOf({macos: true}, {pr: true}), 'macos-latest');
  assert.equal(runnerOf({}, {pr: true}), 'ubuntu-24.04');
});

test('apply and applyflows are the release-only Mac suites', () => {
  assert.deepEqual(suitesWhere("'release'").sort(), ['apply', 'applyflows']);
});

test('a PR run puts every release-only Mac suite on Linux and keeps every Mac suite on the Mac', async () => {
  const release = suitesWhere("'release'"), mac = suitesWhere('true');
  const os = await osBySuite({EVENT: 'workflow_dispatch', ONLY: [...release, ...mac].join(','), PR_SUITES: [...release, ...mac].join(',')});
  for (const suite of release) assert.equal(os[suite], 'ubuntu-24.04', `${suite} waits for a Mac in a PR run`);
  for (const suite of mac) assert.equal(os[suite], 'macos-latest', `${suite} needs the Mac itself, yet a PR run put it on Linux`);
});

for (const [name, env] of [
  ['the beta gate', {EVENT: 'gate', TARGET_REF: 'desktop-v9.9', GATE_TAG: 'desktop-v9.9', GATE_KIND: 'beta'}],
  ['the nightly gate', {EVENT: 'gate', TARGET_REF: 'desktop-v9.9', GATE_TAG: 'desktop-v9.9', GATE_KIND: 'nightly'}],
  ['the night schedule', {EVENT: 'schedule'}],
  ['a run by hand', {EVENT: 'workflow_dispatch', ONLY: 'apply,applyflows'}],
]) {
  test(`${name} keeps the release-only Mac suites on the Mac`, async () => {
    const os = await osBySuite(env);
    for (const suite of suitesWhere("'release'")) assert.equal(os[suite], 'macos-latest', `${name} ran ${suite} off the Mac: the Mac path is no longer proved before a release`);
  });
}
