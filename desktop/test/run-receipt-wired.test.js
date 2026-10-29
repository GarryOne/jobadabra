// markApplied, the one step every confirmed submit passes (the person's press and the hidden browser's alike), stamps the fill's run row through the store that wrote it.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {test} from 'node:test';

const source = fs.readFileSync(new URL('../lib/server-env.js', import.meta.url), 'utf8');

test('markApplied stamps the run row after the job is Applied, and a failed stamp only logs', () => {
  const body = source.slice(source.indexOf('markApplied: async'), source.indexOf('localJob:'));
  assert.match(body, /setStatus\(storage, job\.url, 'applied'\)[\s\S]*receiptRun\(job\.url/, 'the stamp comes after Applied is saved');
  assert.match(body, /receiptRun\([^\n]*\.catch\(/, 'a failed stamp never undoes or blocks Applied');
  assert.match(body, /!notionTexts && notionGate\.tracking\(storage\)/, 'only where the data is on this Mac, the store that holds the fill rows');
});
