// Guards that no harness test can write text into the node:test runner's result channel (stdout); see test/stdout-to-stderr.mjs.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {spawnSync} from 'node:child_process';

const preload = new URL('../stdout-to-stderr.mjs', import.meta.url).pathname;

test('npm test loads the preload, so every test file in the folder is covered', () => {
  const script = JSON.parse(fs.readFileSync(new URL('../../package.json', import.meta.url), 'utf8')).scripts.test;
  assert.match(script, /--import \.\/test\/stdout-to-stderr\.mjs --test /);
  assert.match(script, /test\/\*\.test\.mjs/);
});

test('with the preload, a line the runner prints (✗, ✓, ⚠) reaches stderr and stdout stays empty', () => {
  // Positive control: without the preload the same child writes it to stdout.
  const code = "console.log('✗ a step failed'); console.info('✓ done'); console.debug('⚠ careful')";
  const bare = spawnSync(process.execPath, ['-e', code], {encoding: 'utf8'});
  assert.match(bare.stdout, /✗ a step failed/);
  const quiet = spawnSync(process.execPath, ['--import', preload, '-e', code], {encoding: 'utf8'});
  assert.equal(quiet.stdout, '');
  assert.match(quiet.stderr, /✗ a step failed[\s\S]*✓ done[\s\S]*⚠ careful/);
});

test('no harness test writes to stdout by hand', () => {
  const dir = new URL('../', import.meta.url);
  const writers = fs.readdirSync(dir).filter(file => file.endsWith('.test.mjs') && file !== 'runner-channel.test.mjs'
    && /process\.stdout\.write|stdio:\s*'inherit'/.test(fs.readFileSync(new URL(file, dir), 'utf8')));
  assert.ok(fs.readdirSync(dir).filter(file => file.endsWith('.test.mjs')).length > 100, 'positive control: the class reads the real folder');
  assert.deepEqual(writers, []);
});
