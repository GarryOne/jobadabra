// A publish ADDS a bundle to the release net-records, never replaces the set (14 Oct 2026: publishing 7 rows would have dropped 11 of 18), and net-records-fetch.sh,
// the one reader, unpacks every bundle so the newest record per row wins. Offline: a throwaway key pair and a fake `gh` that serves a folder as the release.
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {execFileSync} from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {bundleNames} from '../../records-publish.mjs';
import {newestPerRow} from '../../replay-records.mjs';

const E2E = path.resolve(path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..'), '..');
const ROOT = path.resolve(E2E, '../..');

test('each publish has its own asset names, so an upload never overwrites another bundle', () => {
  const one = bundleNames(new Date('2026-10-14T21:03:07Z')), two = bundleNames(new Date('2026-10-14T22:15:00Z'));
  assert.deepEqual(one, {bundle: 'net-records-20261014T210307Z.tgz.enc', key: 'net-records-20261014T210307Z.k.enc'});
  assert.notEqual(one.bundle, two.bundle);
  const g0 = bundleNames(new Date('2026-10-14T21:03:07Z'), '-g0'), g1 = bundleNames(new Date('2026-10-14T21:03:07Z'), '-g1');
  assert.deepEqual(g0, {bundle: 'net-records-20261014T210307Z-g0.tgz.enc', key: 'net-records-20261014T210307Z-g0.k.enc'});
  assert.notEqual(g0.bundle, g1.bundle, 'two publish groups in the same second never write the same asset');
  assert.doesNotMatch(fs.readFileSync(path.join(E2E, 'records-publish.mjs'), 'utf8'), /'--clobber'/, 'records-publish uploads without --clobber');
});

test('every reader of the release goes through net-records-fetch.sh: no second copy of the decrypt lines', () => {
  const files = execFileSync('git', ['grep', '-l', '-e', 'pkeyutl -decrypt', '--', '.github', 'desktop/e2e', 'tools', ':!*/test/*'], {cwd: ROOT, encoding: 'utf8'}).trim().split('\n');
  assert.deepEqual(files, ['desktop/e2e/net-records-fetch.sh']);
});

test('the fetch unpacks every bundle (the first set and each added one) and the newest record per row wins', {skip: process.platform === 'win32' && 'bash and openssl'}, () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'jp-bundles-')), release = path.join(tmp, 'release'), bin = path.join(tmp, 'bin'), out = path.join(tmp, 'out');
  fs.mkdirSync(release); fs.mkdirSync(bin);
  const sh = (cmd, cwd = tmp) => execFileSync('bash', ['-c', cmd], {cwd, stdio: ['ignore', 'pipe', 'pipe']});
  sh('openssl genpkey -algorithm RSA -pkeyopt rsa_keygen_bits:2048 -out priv.pem 2>/dev/null && openssl pkey -in priv.pem -pubout -out pub.pem');
  // A bundle as records-publish.mjs makes it: net-records/<row>/record.json, tar + AES with a random key, the key RSA-OAEP with the public key.
  const bundle = (bundleFile, keyFile, rows) => {
    const work = fs.mkdtempSync(path.join(tmp, 'b-'));
    for (const [dir, record] of rows) { fs.mkdirSync(path.join(work, 'net-records', dir), {recursive: true}); fs.writeFileSync(path.join(work, 'net-records', dir, 'record.json'), JSON.stringify(record)); }
    sh(`tar czf net.tgz net-records && openssl rand -hex -out k 32 && openssl enc -aes-256-cbc -pbkdf2 -salt -in net.tgz -out "${path.join(release, bundleFile)}" -pass file:k`
      + ` && openssl pkeyutl -encrypt -pubin -inkey "${path.join(tmp, 'pub.pem')}" -pkeyopt rsa_padding_mode:oaep -in k -out "${path.join(release, keyFile)}"`, work);
  };
  bundle('net-records.tgz.enc', 'net-records.k.enc', [['a', {name: 'row a', url: 'https://a.example.test/', startMs: 1}], ['b', {name: 'row b', url: 'https://b.example.test/', startMs: 1}]]);
  const added = bundleNames(new Date('2026-10-14T22:15:00Z'));
  bundle(added.bundle, added.key, [['a2', {name: 'row a', url: 'https://a.example.test/', startMs: 2}], ['c', {name: 'row c', url: 'https://c.example.test/', startMs: 2}]]);
  // gh: `release download` copies the folder's matching assets, `run list` has no recording runs.
  fs.writeFileSync(path.join(bin, 'gh'), `#!/usr/bin/env bash
case "$1 $2" in
  "release download") dir=""; while [ $# -gt 0 ]; do [ "$1" = --dir ] && dir="$2"; shift; done; mkdir -p "$dir"; cp "${release}"/net-records* "$dir"/ ;;
  *) exit 0 ;;
esac
`, {mode: 0o755});
  const env = {...process.env, PATH: `${bin}:${process.env.PATH}`, NET_RECORD_KEY: fs.readFileSync(path.join(tmp, 'priv.pem')).toString('base64'), RUNNER_TEMP: tmp, NET_RECORDS_READ_TOKEN: 'read-only'};
  execFileSync('bash', [path.join(E2E, 'net-records-fetch.sh'), out], {env, stdio: ['ignore', 'pipe', 'pipe']});
  const rows = Object.fromEntries(newestPerRow(out, new Map()).map(row => [row.name, row]));
  assert.deepEqual(Object.keys(rows).sort(), ['row a', 'row b', 'row c'], 'the first set\'s rows stay beside the added bundle\'s');
  assert.equal(rows['row a'].record.startMs, 2, 'a re-recorded row: the newer bundle\'s record wins');
  assert.match(rows['row b'].dir, /[\\/]mac[\\/]/, 'unpacked under mac/: whereOf says the Mac made it');
  fs.rmSync(tmp, {recursive: true, force: true});
});

// 15 Oct 2026 (owner): replays read ONLY the published release (what passed records-publish's guard). A recording a record-sites run left as a CI artifact, published or not, is never read:
// Migros' and Databricks' new records reached #824's gate that way, past the guard.
test('a recording that only sits in a record-sites run artifact is not read; the published one is', {skip: process.platform === 'win32' && 'bash and openssl'}, () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'jp-published-')), release = path.join(tmp, 'release'), artifact = path.join(tmp, 'artifact'), bin = path.join(tmp, 'bin'), out = path.join(tmp, 'out'), calls = path.join(tmp, 'gh-calls');
  for (const dir of [release, artifact, bin]) fs.mkdirSync(dir);
  const sh = (cmd, cwd = tmp) => execFileSync('bash', ['-c', cmd], {cwd, stdio: ['ignore', 'pipe', 'pipe']});
  sh('openssl genpkey -algorithm RSA -pkeyopt rsa_keygen_bits:2048 -out priv.pem 2>/dev/null && openssl pkey -in priv.pem -pubout -out pub.pem');
  const pack = (rows, tgz, keyFile, into) => {
    const work = fs.mkdtempSync(path.join(tmp, 'b-'));
    for (const [dir, record] of rows) { fs.mkdirSync(path.join(work, 'net-records', dir), {recursive: true}); fs.writeFileSync(path.join(work, 'net-records', dir, 'record.json'), JSON.stringify(record)); }
    sh(`tar czf net.tgz net-records && openssl rand -hex -out k 32 && openssl enc -aes-256-cbc -pbkdf2 -salt -in net.tgz -out "${path.join(into, tgz)}" -pass file:k`
      + ` && openssl pkeyutl -encrypt -pubin -inkey "${path.join(tmp, 'pub.pem')}" -pkeyopt rsa_padding_mode:oaep -in k -out "${path.join(into, keyFile)}"`, work);
  };
  pack([['a', {name: 'row a', url: 'https://a.example.test/', startMs: 1}]], 'net-records.tgz.enc', 'net-records.k.enc', release);
  pack([['z', {name: 'row z', url: 'https://z.example.test/', startMs: 99}]], 'net.tgz.enc', 'k.enc', artifact);   // a CI run's artifact: net.tgz.enc + k.enc, never guarded
  fs.writeFileSync(path.join(bin, 'gh'), `#!/usr/bin/env bash
echo "$@" >> "${calls}"
case "$1 $2" in
  "release download") dir=""; while [ $# -gt 0 ]; do [ "$1" = --dir ] && dir="$2"; shift; done; mkdir -p "$dir"; cp "${release}"/net-records* "$dir"/ ;;
  "run list") echo 4242 ;;
  "run download") dir=""; while [ $# -gt 0 ]; do [ "$1" = --dir ] && dir="$2"; shift; done; mkdir -p "$dir"; cp "${artifact}"/* "$dir"/ ;;
  *) exit 0 ;;
esac
`, {mode: 0o755});
  const env = {...process.env, PATH: `${bin}:${process.env.PATH}`, NET_RECORD_KEY: fs.readFileSync(path.join(tmp, 'priv.pem')).toString('base64'), RUNNER_TEMP: tmp, NET_RECORDS_READ_TOKEN: 'read-only'};
  execFileSync('bash', [path.join(E2E, 'net-records-fetch.sh'), out], {env, stdio: ['ignore', 'pipe', 'pipe']});
  assert.deepEqual(newestPerRow(out, new Map()).map(row => row.name), ['row a'], 'only the published record is read');
  assert.doesNotMatch(fs.existsSync(calls) ? fs.readFileSync(calls, 'utf8') : '', /run (list|download)/, 'the fetch never lists or downloads a workflow run\'s artifacts');
  fs.rmSync(tmp, {recursive: true, force: true});
});

// 15 Oct 2026: main's full replay fetched "0 records" (gh failed, its error went to /dev/null) and the gate then judged all 16 pinned rows "worse: no result". A fetch that gets nothing fails with gh's own words.
test('a fetch that gets no record fails loudly with gh\'s error, never an empty set for the gate to judge', {skip: process.platform === 'win32' && 'bash and openssl'}, () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'jp-loud-')), bin = path.join(tmp, 'bin'), out = path.join(tmp, 'out');
  fs.mkdirSync(bin);
  fs.writeFileSync(path.join(bin, 'gh'), '#!/usr/bin/env bash\necho "HTTP 403: API rate limit exceeded for user ID 1" >&2\nexit 1\n', {mode: 0o755});
  // The fake gh answers a rate limit every time: no real pauses (the default 20 + 60 + 120 s made this one test take 200 s, 17 Oct 2026).
  const env = {...process.env, PATH: `${bin}:${process.env.PATH}`, NET_RECORD_KEY: Buffer.from('not a key').toString('base64'), RUNNER_TEMP: tmp, NET_RECORDS_READ_TOKEN: 'read-only', CI: 'true', NET_RECORDS_RETRY_SLEEP: '0 0 0'};
  let failed = null;
  try { execFileSync('bash', [path.join(E2E, 'net-records-fetch.sh'), out], {env, stdio: ['ignore', 'pipe', 'pipe']}); } catch (error) { failed = error; }
  assert.ok(failed, 'the fetch exits non-zero when it found no record');
  assert.match(String(failed.stderr) + String(failed.stdout), /API rate limit exceeded/, 'gh\'s own error is shown');
  fs.rmSync(tmp, {recursive: true, force: true});
});

test('no caller swallows a failed fetch: a workflow step runs it plainly, the retry script exits on it', () => {
  const retry = fs.readFileSync(path.join(ROOT, '.github/replay-records-fetch.sh'), 'utf8');
  assert.match(retry, /net-records-fetch\.sh records \|\| exit 1/, 'the retry script has no set -e: the exit code must be checked by hand');
  for (const file of ['fix-verdicts', 'site-replays', 'replay-refill']) {
    const text = fs.readFileSync(path.join(ROOT, '.github/workflows', `${file}.yml`), 'utf8');
    assert.doesNotMatch(text, /net-records-fetch\.sh[^\n]*(\|\||\| *true|;)/, `${file}.yml: the fetch's exit code is not swallowed`);
  }
});

// 15 Oct 2026 (a2, cc): every replay job fetched the release itself (one gh call per asset, dozens of bundles) and one verdicts run (~20 jobs, a PR's 4 parts) tripped GitHub's burst limit for every session.
// One job downloads the ENCRYPTED bundles once (--bundles-only: no key, nothing decrypted: the repo is public, an artifact is readable by anyone) and uploads them; the others take them from the
// artifact (NET_RECORDS_BUNDLES) and make no release call.
const shared = () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'jp-shared-')), release = path.join(tmp, 'release'), bin = path.join(tmp, 'bin'), calls = path.join(tmp, 'gh-calls');
  fs.mkdirSync(release); fs.mkdirSync(bin);
  const sh = (cmd, cwd = tmp) => execFileSync('bash', ['-c', cmd], {cwd, stdio: ['ignore', 'pipe', 'pipe']});
  sh('openssl genpkey -algorithm RSA -pkeyopt rsa_keygen_bits:2048 -out priv.pem 2>/dev/null && openssl pkey -in priv.pem -pubout -out pub.pem');
  const work = fs.mkdtempSync(path.join(tmp, 'b-'));
  fs.mkdirSync(path.join(work, 'net-records', 'a'), {recursive: true});
  fs.writeFileSync(path.join(work, 'net-records', 'a', 'record.json'), JSON.stringify({name: 'row a', url: 'https://a.example.test/', startMs: 1}));
  sh(`tar czf net.tgz net-records && openssl rand -hex -out k 32 && openssl enc -aes-256-cbc -pbkdf2 -salt -in net.tgz -out "${path.join(release, 'net-records.tgz.enc')}" -pass file:k`
    + ` && openssl pkeyutl -encrypt -pubin -inkey "${path.join(tmp, 'pub.pem')}" -pkeyopt rsa_padding_mode:oaep -in k -out "${path.join(release, 'net-records.k.enc')}"`, work);
  fs.writeFileSync(path.join(bin, 'gh'), `#!/usr/bin/env bash
echo "$@" >> "${calls}"
case "$1 $2" in
  "release download") dir=""; while [ $# -gt 0 ]; do [ "$1" = --dir ] && dir="$2"; shift; done; mkdir -p "$dir"; cp "${release}"/net-records* "$dir"/ ;;
  *) exit 0 ;;
esac
`, {mode: 0o755});
  const key = fs.readFileSync(path.join(tmp, 'priv.pem')).toString('base64');
  const env = {...process.env, PATH: `${bin}:${process.env.PATH}`, RUNNER_TEMP: tmp, NET_RECORDS_READ_TOKEN: 'read-only', CI: 'true'};
  delete env.NET_RECORD_KEY;   // the bundles job has no key at all: UNSET, not empty (CI run 38757629268 died on set -u)
  return {tmp, calls, env, key, run: (args, extra = {}) => execFileSync('bash', [path.join(E2E, 'net-records-fetch.sh'), ...args], {env: {...env, ...extra}, stdio: ['ignore', 'pipe', 'pipe']})};
};
const ghCalls = file => (fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : '');

test('--bundles-only downloads the encrypted bundles once, needs no key and decrypts nothing', {skip: process.platform === 'win32' && 'bash and openssl'}, () => {
  const {tmp, calls, run} = shared(), dest = path.join(tmp, 'bundles');
  run(['--bundles-only', dest]);
  assert.deepEqual(fs.readdirSync(dest).sort(), ['net-records.k.enc', 'net-records.tgz.enc'], 'the bundles as published, still encrypted');
  assert.equal(execFileSync('bash', ['-c', `find "${dest}" -name record.json | wc -l`]).toString().trim(), '0', 'no decrypted record is written');
  assert.equal((ghCalls(calls).match(/release download/g) || []).length, 1, 'one release download');
  fs.rmSync(tmp, {recursive: true, force: true});
});

test('with NET_RECORDS_BUNDLES a replay job makes no gh call and still gets the records', {skip: process.platform === 'win32' && 'bash and openssl'}, () => {
  const {tmp, calls, key, run} = shared(), dest = path.join(tmp, 'bundles'), out = path.join(tmp, 'out');
  run(['--bundles-only', dest]);
  fs.rmSync(calls);
  run([out], {NET_RECORD_KEY: key, NET_RECORDS_BUNDLES: dest});
  assert.deepEqual(newestPerRow(out, new Map()).map(row => row.name), ['row a']);
  assert.equal(ghCalls(calls), '', 'no gh call at all');
  fs.rmSync(tmp, {recursive: true, force: true});
});

test('each replay workflow downloads the release ONCE; every other fetch takes the run\'s shared bundles (no release call per job)', () => {
  // The workflow files are regular (jobs at 2 spaces, steps at "      - "), so the text is split without a YAML library (the harness job installs none).
  for (const file of ['site-replays', 'fix-verdicts', 'replay-refill']) {
    const text = fs.readFileSync(path.join(ROOT, '.github/workflows', `${file}.yml`), 'utf8');
    const jobsText = text.slice(text.indexOf('\njobs:\n') + 7), parts = jobsText.split(/^  ([A-Za-z0-9_-]+):\s*$/m);   // [before, name, body, name, body...]
    let producers = 0;
    for (let at = 1; at < parts.length; at += 2) {
      const name = parts[at], body = parts[at + 1], steps = body.split(/^      - /m).slice(1);
      const downloads = steps.some(step => /^uses: actions\/download-artifact/.test(step) && /name: net-bundles/.test(step));
      for (const step of steps) {
        if (/--bundles-only/.test(step)) { producers += 1; continue; }
        if (!/net-records-fetch\.sh|replay-records-fetch\.sh/.test(step)) continue;
        assert.match(step, /NET_RECORDS_BUNDLES/, `${file}.yml job ${name}: its fetch step takes the run's bundles (NET_RECORDS_BUNDLES), not the release`);
        assert.ok(downloads || steps.some(other => /--bundles-only/.test(other)), `${file}.yml job ${name}: the bundles come from an artifact (or its own one download)`);
      }
    }
    assert.equal(producers, 1, `${file}.yml: exactly one job downloads the release`);
    assert.doesNotMatch(text, /gh release download/, `${file}.yml: no job calls the release API itself`);
  }
});
