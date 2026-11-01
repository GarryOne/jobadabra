// GitHub's rate limit is said plainly and retried (19:06Z, 16 Oct 2026: the read token belongs to the owner's account, every session and CI fetch shared its 5,000/h, and the PR journeys
// went red as "no record"). Offline: a throwaway key pair and a fake `gh` that answers "API rate limit exceeded" for its first N downloads.
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {spawnSync} from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const E2E = path.resolve(path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..'), '..');
const skip = process.platform === 'win32' && 'bash and openssl';

// limited: how many downloads the fake gh refuses before serving the release. -> {status, stdout, stderr, calls}
function fetchWith(limited) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'jp-ratelimit-')), release = path.join(tmp, 'release'), bin = path.join(tmp, 'bin'), out = path.join(tmp, 'out'), counter = path.join(tmp, 'count');
  fs.mkdirSync(release); fs.mkdirSync(bin);
  const sh = (cmd, cwd = tmp) => spawnSync('bash', ['-c', cmd], {cwd, encoding: 'utf8'});
  sh('openssl genpkey -algorithm RSA -pkeyopt rsa_keygen_bits:2048 -out priv.pem 2>/dev/null && openssl pkey -in priv.pem -pubout -out pub.pem');
  const work = fs.mkdtempSync(path.join(tmp, 'b-'));
  fs.mkdirSync(path.join(work, 'net-records', 'a'), {recursive: true});
  fs.writeFileSync(path.join(work, 'net-records', 'a', 'record.json'), JSON.stringify({name: 'row a', url: 'https://a.example.test/', startMs: 1}));
  sh(`tar czf net.tgz net-records && openssl rand -hex -out k 32 && openssl enc -aes-256-cbc -pbkdf2 -salt -in net.tgz -out "${path.join(release, 'net-records.tgz.enc')}" -pass file:k`
    + ` && openssl pkeyutl -encrypt -pubin -inkey "${path.join(tmp, 'pub.pem')}" -pkeyopt rsa_padding_mode:oaep -in k -out "${path.join(release, 'net-records.k.enc')}"`, work);
  fs.writeFileSync(counter, '0');
  fs.writeFileSync(path.join(bin, 'gh'), `#!/usr/bin/env bash
if [ "$1 $2" = "release download" ]; then
  n=$(( $(cat "${counter}") + 1 )); echo $n > "${counter}"
  if [ $n -le ${limited} ]; then echo "HTTP 403: API rate limit exceeded for user ID 1. (https://api.github.com/repos/x/releases)" >&2; exit 1; fi
  dir=""; while [ $# -gt 0 ]; do [ "$1" = --dir ] && dir="$2"; shift; done; mkdir -p "$dir"; cp "${release}"/net-records* "$dir"/
fi
exit 0
`, {mode: 0o755});
  const env = {...process.env, PATH: `${bin}:${process.env.PATH}`, NET_RECORD_KEY: fs.readFileSync(path.join(tmp, 'priv.pem')).toString('base64'), RUNNER_TEMP: tmp, NET_RECORDS_READ_TOKEN: 'read-only', NET_RECORDS_RETRY_SLEEP: '0 0', CI: '1'};
  const ran = spawnSync('bash', [path.join(E2E, 'net-records-fetch.sh'), out], {env, encoding: 'utf8'});
  const calls = Number(fs.readFileSync(counter, 'utf8'));
  fs.rmSync(tmp, {recursive: true, force: true});
  return {...ran, calls};
}

test('a rate limit that passes within the retries still fetches, and said it waited', {skip}, () => {
  const ran = fetchWith(2);
  assert.equal(ran.status, 0, ran.stderr);
  assert.equal(ran.calls, 3, 'two refusals, then the release');
  assert.match(ran.stderr, /rate limited by GitHub .*retrying/);
  assert.match(ran.stdout, /1 records/);
});

test('a rate limit that stays says RATE LIMITED, never "no record fetched"', {skip}, () => {
  const ran = fetchWith(99);
  assert.notEqual(ran.status, 0);
  assert.match(ran.stderr, /FAILED: RATE LIMITED: GitHub's API limit/);
  assert.doesNotMatch(ran.stderr, /FAILED: no record fetched/);
  assert.match(ran.stderr, /API rate limit exceeded/, 'gh\'s own words are shown too');
});

test('with no limit the fake release is served at once (the harness itself works)', {skip}, () => {
  const ran = fetchWith(0);
  assert.equal(ran.calls, 1);
  assert.equal(ran.status, 0, ran.stderr);
});
