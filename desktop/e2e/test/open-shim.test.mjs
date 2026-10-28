// The e2e `open` stand-in (lib/extension.mjs makeOpenShim) records the URL the app opens, whatever comes after it: lib/browser-launch.js sends
// `open -a "Google Chrome" <url> --args --profile-directory=<p>` on a Mac whose browser has profiles (16 Oct 2026: the stand-in kept the last
// argument, the flag, and every Apply looked unopened on the owner's Mac; CI has no profile, so it passed there).
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import fs from 'node:fs';
import {test} from 'node:test';
import {browserCommand} from '../../lib/browser-launch.js';
import path from 'node:path';
import {makeOpenShim, opensIntoSpool} from '../lib/extension.mjs';

const URL = 'https://boards.greenhouse.io/e2e/jobs/4001001#jobpilotto-fill=abc';
const recorded = spool => fs.readdirSync(spool).filter(name => name.endsWith('.url')).map(name => fs.readFileSync(`${spool}/${name}`, 'utf8'));
// A browser with a last-used profile: the launch names it after the URL.
const withProfile = () => {
  const [, args] = browserCommand([URL], 'darwin', {HOME: '/home/e2e', JOB_PILOTTO_E2E: '1'}, file => file === '/Applications/Google Chrome.app', '',
    () => JSON.stringify({profile: {last_used: 'Profile 2'}}));
  return args;
};

test('the launch the app sends ends with the profile flag, not the URL (the shape the stand-in must read)', () => {
  const args = withProfile();
  assert.equal(args.at(-1), '--profile-directory=Profile 2');
  assert.ok(args.includes(URL));
});

test('the shell stand-in records the URL, with or without flags after it; a call without a URL records nothing', {skip: process.platform === 'win32'}, () => {
  for (const args of [withProfile(), ['-g', '-a', 'Google Chrome', URL], ['-a', 'Finder', '/tmp']]) {
    const shim = makeOpenShim();
    execFileSync(`${shim.bin}/open`, args, {env: {...process.env, JOB_PILOTTO_E2E_OPEN_DIR: shim.spool}});
    assert.deepEqual(recorded(shim.spool), args.includes(URL) ? [URL] : [], args.join(' '));
  }
});

test('the Windows stand-in (node script) reads the URL the same way', () => {
  for (const args of [[URL, '--profile-directory=Profile 2'], ['--profile-directory=Default', URL], ['--new-window']]) {
    const shim = makeOpenShim();
    execFileSync(process.execPath, [shim.script, ...args], {env: {...process.env, JOB_PILOTTO_E2E_OPEN_DIR: shim.spool}});
    assert.deepEqual(recorded(shim.spool), args.includes(URL) ? [URL] : [], args.join(' '));
  }
});

test('a run opens into the spool only with the shim first on PATH: the owner\'s own PATH or a missing spool fails the guard (#2350)', () => {
  const shim = makeOpenShim(), owners = process.env.PATH;
  const env = {PATH: `${shim.bin}${path.delimiter}${owners}`, JOB_PILOTTO_E2E_OPEN_DIR: shim.spool, JOB_PILOTTO_E2E_OPENER: shim.script};
  assert.equal(opensIntoSpool(env, 'darwin'), true);
  assert.equal(opensIntoSpool(env, 'win32'), true);
  assert.equal(opensIntoSpool({...env, PATH: owners}, 'darwin'), false, 'the real open first: a page would reach the owner\'s Chrome');
  assert.equal(opensIntoSpool({...env, JOB_PILOTTO_E2E_OPEN_DIR: ''}, 'darwin'), false);
  assert.equal(opensIntoSpool({...env, JOB_PILOTTO_E2E_OPENER: ''}, 'win32'), false);
});
