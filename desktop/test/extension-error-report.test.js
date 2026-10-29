// Extension exception payloads contain fixed diagnostics and extension locations, never arbitrary exception or page strings.
import assert from 'node:assert/strict';
import {test} from 'node:test';
import fs from 'node:fs';

const source = fs.readFileSync(new URL('../../extension/error-report.js', import.meta.url), 'utf8');
const moduleUrl = `data:text/javascript;base64,${Buffer.from(source).toString('base64')}`;

test('extension errors keep native types and own frame locations, dropping every arbitrary string', async () => {
  const {errorReport} = await import(moduleUrl);
  const origin = 'chrome-extension://abcdefghijklmnopabcdefghijklmnop/';
  const error = new TypeError('PAGE_TEXT_CANARY https://private.example/jobs/URL_CANARY');
  error.stack = `${error}\n at PAGE_TEXT_CANARY (${origin}page/fill.js:42:7)\n at ${origin}flow.js:91:3\n at https://private.example/jobs/URL_CANARY:12:9`;
  const report = errorReport(error, {origin});
  assert.deepEqual(report, {source: 'extension', type: 'TypeError', error: 'Uncaught TypeError', rejection: false,
    at: 'at fill.js:42:7\nat flow.js:91:3'});
  assert.doesNotMatch(JSON.stringify(report), /PAGE_TEXT_CANARY|URL_CANARY|private\.example|chrome-extension|page\//);
  assert.equal(errorReport('PAGE_TEXT_CANARY', {origin, rejection: true}).error, 'Unhandled Error rejection');
  assert.equal(errorReport({name: 'PAGE_TEXT_CANARY'}, {origin}).type, 'Error');
});

test('an ErrorEvent without an Error uses only its own extension filename and line', async () => {
  const {errorReport} = await import(moduleUrl);
  const origin = 'chrome-extension://abcdefghijklmnopabcdefghijklmnop/';
  assert.equal(errorReport(null, {origin, filename: `${origin}page/fill.js`, lineno: 4, colno: 2}).at, 'at fill.js:4:2');
  assert.equal(errorReport(null, {origin, filename: 'https://private.example/URL_CANARY', lineno: 4}).at, '');
});
