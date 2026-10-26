// A screen line that says something could not be read or added never carries an IPC or AI error raw: its text goes through plainError (run-warnings.js), so a
// provider's JSON dump ("429 {"type":"error",…}") is a sentence. The wander suite's ai-rate-limit scenario found it on Strategy's "Review your preferences" (26 Oct 2026).
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {test} from 'node:test';
import {fileURLToPath} from 'node:url';
import {plainError} from '../renderer/run-warnings.js';

const pages = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'renderer', 'pages');

test('a provider\'s rate-limit dump becomes a sentence', () => {
  assert.doesNotMatch(plainError('Couldn\'t read it: 429 {"type":"error","error":{"type":"rate_limit_error","message":"Number of request tokens has exceeded your per-minute rate limit"}}'), /\{|429/);
});

test('every "could not read/add … ${error}" line in a page goes through plainError', () => {
  const bad = [];
  for (const file of fs.readdirSync(pages).filter(f => f.endsWith('.js'))) {
    fs.readFileSync(path.join(pages, file), 'utf8').split('\n').forEach((line, i) => {
      if (/`[^`]*(?:Couldn.t|Could not)[^`]*\$\{[A-Za-z_.]*\berror\}/.test(line) && !/plainError\(|\bmessage\(/.test(line)) bad   // message() (core.js) runs its text through plainError itself.push(`${file}:${i + 1}`);
    });
  }
  assert.deepEqual(bad, []);
});
