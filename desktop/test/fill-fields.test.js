// The fill's logged field rows carry `required`, so the smoke report never counts an optional field left empty as a failure (11 Oct 2026, Datadog: "Website").
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {test} from 'node:test';
import {loggedFields} from '../../extension/fill-fields.js';
import {fieldLines} from '../e2e/lib/record-sites.mjs';
import {logText} from './log-text.mjs';

const TRACE = [
  {label: 'First Name', type: 'text', required: true, outcome: 'filled', source: 'your details', reason: ''},
  {label: 'Website', type: 'text', required: false, outcome: 'left', source: '', reason: 'a detail of yours not saved yet (website)'},
];

test('the logged fill line says which fields are required and which are optional', () => {
  const rows = loggedFields(TRACE);
  assert.deepEqual(rows.map(row => [row.label, row.required]), [['First Name', true], ['Website', false]]);
  const line = `00:22:09 [extension] fill: fields: 1 filled, 1 left {"fields":${JSON.stringify(rows)}}`;
  assert.deepEqual(fieldLines(line).map(text => text.match(/required=(\S+)/)[1]), ['true', 'false']);
});

test('background.js logs the fill line through loggedFields, never its own copy of the rows', () => {
  const source = fs.readFileSync(new URL('../../extension/background.js', import.meta.url), 'utf8');
  assert.match(source, /logFieldsLine\(decide, result\.trace/);
});

// The LAST layer the evidence reaches (11 Oct 2026, Datadog round 2): c67f153 kept `required` in the extension's line, but the log boundary
// (app-core/src/extension.js fieldRows) let only five keys through, so app.log and the smoke report still said "required=?". This test goes the
// whole way: the extension's entry -> the app's /extension/log handler -> its onLog -> app.log -> the smoke report's field reader.
test('required reaches the app log and the smoke report\'s field list, through the log boundary', async () => {
  const {handleExtension} = await import('../shared/app-core/extension.js');
  const server = await import('../lib/server.js');
  const log = await import('../lib/log.js');
  const os = await import('node:os'), path = await import('node:path');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'jp-fieldlog-'));
  log.logTo(dir);
  try {
    const storage = {settings: () => ({}), secret: () => 't', setSecret: () => {}, path: (...p) => path.join(dir, ...p)};
    const body = {entries: [{at: '2026-10-11T01:31:58.075Z', kind: 'fill', text: 'fields: 1 filled, 1 left', fields: {fields: loggedFields(TRACE), recipes: 0, url: 'https://forms.example.com/apply', version: '0.9.192'}}]};   // keys sorted, as chrome.storage.local hands them to the push
    const response = await handleExtension(new Request('http://127.0.0.1/extension/log', {method: 'POST', headers: {Authorization: 'Bearer t', 'Content-Type': 'application/json'},
      body: JSON.stringify(body)}), server.localEnv(storage));
    assert.equal(response.status, 200);
    const line = logText(path.join(dir, 'app.log')).trim().split('\n').find(text => text.includes('fill: fields:'));
    assert.ok(line, 'the fill line is in app.log');
    assert.deepEqual(fieldLines(line).map(text => text.match(/"(.*)" required=(\S+)/).slice(1)), [['First Name', 'true'], ['Website', 'false']]);
  } finally { log.logTo(null); }
});
