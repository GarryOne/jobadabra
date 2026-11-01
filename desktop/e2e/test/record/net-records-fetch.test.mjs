// net-records-fetch.sh keeps going through GitHub's burst limit (17 Oct 2026: "Site replays · PR / bundles" failed repo-wide in bursts with "release not found", which is how gh words a 404 that the
// private repo answers while many PR runs read the release at once; the script retried only on the words "rate limit", then fell back to the public repo, whose own "release not found" hid the
// first answer). A fake `gh` answers as GitHub did; the test checks the retries, the words, and that the first answer is never hidden.
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {test} from 'node:test';

const script = new URL('../../net-records-fetch.sh', import.meta.url).pathname;

// failures: what the first calls of `gh` print on stderr (each exits 1); after them gh "downloads" one bundle. -> {status, out, err, calls, bundles}
function run({failures, token = 'tok', sleeps = '0 0 0'}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'jp-fetch-')), bin = path.join(dir, 'bin'), out = path.join(dir, 'out'), calls = path.join(dir, 'calls');
  fs.mkdirSync(bin);
  fs.writeFileSync(path.join(bin, 'gh'), `#!/bin/bash
n=$(( $(cat "${calls}" 2>/dev/null | wc -l) ))
echo "gh $* [token \${GH_TOKEN:+set}]" >> "${calls}"
fails=(${failures.map(text => JSON.stringify(text)).join(' ')})
if [ "$n" -lt "\${#fails[@]}" ]; then echo "\${fails[$n]}" >&2; exit 1; fi
dest=""; while [ $# -gt 0 ]; do [ "$1" = "--dir" ] && dest="$2"; shift; done
mkdir -p "$dest" && echo x > "$dest/net-records-a.tgz.enc" && echo k > "$dest/net-records-a.k.enc"
`, {mode: 0o755});
  const done = spawnSync('bash', [script, '--bundles-only', out], {env: {PATH: `${bin}:${process.env.PATH}`, HOME: dir, TMPDIR: dir, CI: '1', NET_RECORDS_READ_TOKEN: token, NET_RECORDS_RETRY_SLEEP: sleeps}, encoding: 'utf8'});
  const read = file => { try { return fs.readFileSync(file, 'utf8'); } catch { return ''; } };
  return {status: done.status, out: done.stdout, err: done.stderr, calls: read(calls).split('\n').filter(Boolean), bundles: fs.existsSync(out) ? fs.readdirSync(out) : []};
}

test('a 404 from the private repo during a burst is retried, then the bundle is fetched', () => {
  const got = run({failures: ['release not found', 'release not found']});
  assert.equal(got.status, 0, got.err);
  assert.equal(got.calls.length, 3, 'two refused calls, then the third works');
  assert.match(got.err, /retrying in/);
  assert.deepEqual(got.bundles.sort(), ['net-records-a.k.enc', 'net-records-a.tgz.enc']);
});

test('GitHub\'s secondary limit wording is retried the same way', () => {
  const got = run({failures: ['HTTP 403: You have exceeded a secondary rate limit.']});
  assert.equal(got.status, 0, got.err);
  assert.equal(got.calls.length, 2);
});

test('when every wait fails it says BURST-LIMITED, shows what the private repo answered, and never "no record fetched"', () => {
  const got = run({failures: Array(8).fill('release not found')});
  assert.notEqual(got.status, 0);
  assert.match(got.err, /BURST-LIMITED/);
  assert.doesNotMatch(got.err, /no record fetched/);
  assert.match(got.err, /read token: set/, 'which token path was used');
  assert.match(got.err, /jobadabra-lab: release not found/, 'the private repo\'s own answer, not only the last fallback\'s');
});

test('with no read token the failure says so (the fallback to this repo cannot see the private release)', () => {
  const got = run({failures: Array(8).fill('release not found'), token: ''});
  assert.notEqual(got.status, 0);
  assert.match(got.err, /read token: EMPTY/);
});
