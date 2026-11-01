// The key that encrypts a network-record bundle is read by openssl as a pass FILE: its first line is the password. 32 random bytes start with a newline once in 256 keys
// ("Error reading password from BIO": the harness test went red on 17 Oct 2026, and a record-sites run would lose its recordings the same way), so the key is hex, never raw bytes.
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {test} from 'node:test';

const skip = process.platform === 'win32' && 'bash and openssl';
const root = path.resolve(path.resolve(import.meta.dirname, '..'), '..', '..', '..');
const sh = (cmd, cwd) => execFileSync('bash', ['-c', cmd], {cwd, stdio: ['ignore', 'pipe', 'pipe']});
const encrypt = (cwd, key) => sh(`printf '%s' hello > in.txt && openssl enc -aes-256-cbc -pbkdf2 -salt -in in.txt -out out.enc -pass file:${key}`, cwd);

test('a hex key is always usable as the pass file', {skip}, () => {   // (a raw key starting with a newline fails on the Linux runners' openssl, not on every build: only the hex key is proven here)
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'jp-key-'));
  for (let i = 0; i < 40; i++) { sh('openssl rand -hex -out k 32', dir); encrypt(dir, 'k'); }
});

test('no workflow, script or test makes a key with raw random bytes (openssl rand without -hex)', () => {
  const found = [];
  const walk = dir => {
    for (const entry of fs.readdirSync(dir, {withFileTypes: true})) {
      if (entry.name === 'node_modules' || entry.name === '.git') continue;
      const file = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(file);
      else if (/\.(ya?ml|mjs|js|sh|py)$/.test(entry.name) && file !== import.meta.filename) {
        fs.readFileSync(file, 'utf8').split('\n').forEach((line, i) => { if ((/openssl rand\b(?!.*-hex)/.test(line) && /-out\b/.test(line)) || /\['rand', '-out'/.test(line)) found.push(`${path.relative(root, file)}:${i + 1}`); });
      }
    }
  };
  walk(path.join(root, '.github')); walk(path.join(root, 'desktop', 'e2e')); walk(path.join(root, 'tools'));
  assert.deepEqual(found, [], 'make the key with `openssl rand -hex -out <file> 32` (the first line of a pass file is the password)');
});
