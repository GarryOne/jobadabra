// The fill's record after a late retype (extension/ladder/record-update.js; spec docs/superpowers/specs/2026-10-12-fill-ladder.md, the record update, cc 13 Oct 2026): a page's own
// autofill can empty a box AFTER the record was sent (an upload's "autofill from resume" a few seconds later); the retype watcher types it again, and the record said "left" for a box
// that holds its value. The extension then re-settles (rung 0) and logs ONE "fields (updated after a late retype)" line, at most twice a run, only when an outcome changed.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {test} from 'node:test';
import {armRecordUpdate, disarmRecordUpdate, noteLateRetype, runUpdateBody, MAX_UPDATES} from '../../extension/ladder/record-update.js';
import {onPageProgress} from '../../extension/ladder/progress.js';

const TRACE = [
  {label: 'First name', type: 'text', required: true, outcome: 'left', source: 'your details', reason: 'the page changed what was typed, by the end of the fill'},
  {label: 'Email', type: 'email', required: true, outcome: 'filled', source: 'your details', reason: ''},
];
// A page the test holds: `form` is what the page describes at the end (the fields that hold a value).
function page(form) {
  const lines = [];
  const inPage = async (tabId, func) => (String(func).includes('DescribeForm') ? form.rows : String(func).includes('GaveUp') ? [] : String(func).includes('ReadBack') ? [] : null);
  return {lines, inPage, decide: (kind, text, data) => { lines.push({kind, text, data}); return Promise.resolve(); }};
}
const arm = (tabId, host, extra = {}) => armRecordUpdate(tabId, {page: 'https://jobs.example.com/apply#jobpilotto-fill', trace: TRACE, resumeName: '', inPage: host.inPage, decide: host.decide, quietMs: 0, ...extra});

test('a retype after the record was sent logs ONE updated fields line, with the new outcomes', async () => {
  const form = {rows: [{label: 'First name', field: 'first_name', filled: true}, {label: 'Email', field: 'email', filled: true}]};
  const host = page(form), seen = [];
  arm(1, host, {onUpdate: trace => seen.push(trace.map(row => `${row.label}:${row.outcome}`))});
  assert.equal(await noteLateRetype(1), true);
  assert.equal(host.lines.length, 1);
  assert.equal(host.lines[0].text, 'fields (updated after a late retype): 2 filled, 0 left');
  assert.deepEqual(host.lines[0].data.fields.map(row => [row.label, row.outcome]), [['First name', 'filled'], ['Email', 'filled']]);
  assert.equal(host.lines[0].data.url, 'https://jobs.example.com/apply#jobpilotto-fill', 'the page of the fill line it replaces');
  assert.deepEqual(seen, [['First name:filled', 'Email:filled']]);
  disarmRecordUpdate(1);
});

test('nothing changed since the record: no line (the retype put back what the record already said)', async () => {
  const host = page({rows: [{label: 'First name', field: 'first_name', filled: false}, {label: 'Email', field: 'email', filled: true}]});
  arm(2, host);
  assert.equal(await noteLateRetype(2), false);
  assert.deepEqual(host.lines, []);
  disarmRecordUpdate(2);
});

test('at most MAX_UPDATES lines a run, and none for a tab that was never armed or was disarmed', async () => {
  const form = {rows: [{label: 'First name', field: 'first_name', filled: true}, {label: 'Email', field: 'email', filled: true}]};
  const host = page(form);
  assert.equal(await noteLateRetype(3), false, 'not armed: the record was not sent');
  arm(3, host);
  assert.equal(await noteLateRetype(3), true);
  form.rows[0].filled = false;   // emptied again: a second change
  assert.equal(await noteLateRetype(3), true);
  form.rows[0].filled = true;
  assert.equal(await noteLateRetype(3), false, 'the cap is spent');
  assert.equal(host.lines.length, MAX_UPDATES);
  const other = page(form);
  arm(4, other); disarmRecordUpdate(4);
  assert.equal(await noteLateRetype(4), false, 'a page that was left (or a closed tab) is not the record\'s any more');
});

test('a burst of retypes is one re-settle (quiet first)', async () => {
  const host = page({rows: [{label: 'First name', field: 'first_name', filled: true}, {label: 'Email', field: 'email', filled: true}]});
  arm(5, host, {quietMs: 20});
  const results = await Promise.all([noteLateRetype(5), noteLateRetype(5), noteLateRetype(5)]);
  assert.deepEqual(results.filter(Boolean), [true]);
  assert.equal(host.lines.length, 1);
  disarmRecordUpdate(5);
});

test('the page\'s value_stayed message reaches it (progress.js), only from a tab, and only that kind', async () => {
  const host = page({rows: [{label: 'First name', field: 'first_name', filled: true}, {label: 'Email', field: 'email', filled: true}]});
  arm(6, host);
  assert.equal(await onPageProgress({type: 'progress', kind: 'navigated'}, {tab: {id: 6}}), false);
  assert.equal(await onPageProgress({type: 'progress', kind: 'value_stayed'}, {}), false);
  assert.equal(await onPageProgress({type: 'progress', kind: 'value_stayed'}, {tab: {id: 6}}), true);
  assert.equal(host.lines.length, 1);
  disarmRecordUpdate(6);
});

test('the ends of the record: flow.js arms after it sends the run; every reader of the fields line knows the updated one', () => {
  const read = file => fs.readFileSync(new URL(`../../${file}`, import.meta.url), 'utf8');
  assert.match(read('extension/fill-tab-finish.js'), /armRecordUpdate\(tab\.id,/);
  assert.match(read('extension/ladder/progress.js'), /noteLateRetype\(/);
  const smoke = read('desktop/e2e/lib/record-sites.mjs');
  assert.ok(!/fields: \(\\d\+\) filled/.test(smoke) && !/fill: fields: \\d\+ filled/.test(smoke), 'record-sites.mjs reads the fields line through FIELDS_LINE, never its own copy of the words');
});

test('the run row\'s update: the same run with the counts of the new record, never a new run', () => {
  const body = {url: 'https://jobs.example.com/apply', started: '2026-10-13T00:00:00.000Z', ended: '2026-10-13T00:00:05.000Z', fields: 2, unfilled: 1, usd: 0, kit: true, todo: [], trace: TRACE, debug: {steps: []}};
  const next = TRACE.map(row => ({...row, outcome: 'filled', reason: ''}));
  const update = runUpdateBody(body, TRACE, next, 'r1');
  assert.deepEqual([update.update, update.url, update.started, update.fields, update.unfilled], ['r1', body.url, body.started, 3, 0]);
  assert.equal(update.trace, next);
  assert.deepEqual([body.fields, body.unfilled], [2, 1], 'the first record is not changed');
  assert.equal(runUpdateBody(body, next, TRACE, 'r1').unfilled, 1, 'and back: a box emptied again');
});

test('flow.js sends the update to the run it logged (its id), and only when the store gave one', () => {
  const flow = fs.readFileSync(new URL('../../extension/fill-tab-finish.js', import.meta.url), 'utf8');
  assert.match(flow, /runUpdateBody\(/);
  assert.match(flow, /\(await logged\)\?\.id/);
});
