// The recording-side guards (lib/record-guard.mjs, records-publish.mjs): every refusal fails on a fixture record, and the owner's named accept lifts only the pinned and worse ones.
import assert from 'node:assert/strict';
import {test} from 'node:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {judgeRecords, memoProblem, mojibakeBodies, notWorse, partition, report} from '../../lib/record-guard.mjs';

const form = (filled, left) => ({reached: 'form', filled, left});
const replay = ({hit = 4, asks = 4, extra = 0, outcome = form(8, 4), live = form(8, 4)} = {}) => ({outcome, liveOutcome: live, live: {asks}, network: {hit, extra, notRecorded: 0}});
// a record folder: bodies (hash -> bytes), asks.jsonl lines, model-memo.json (object, or null for none)
function folder({bodies = {}, asks = 2, memo = {a: 1, b: 2}} = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'jp-guard-'));
  fs.mkdirSync(path.join(dir, 'bodies'));
  const entries = [];
  for (const [hash, body] of Object.entries(bodies)) { const {bytes, type = 'text/x-component'} = Buffer.isBuffer(body) ? {bytes: body} : body; fs.writeFileSync(path.join(dir, 'bodies', hash), bytes); entries.push({url: `https://x.test/${hash}`, hash, headers: {'content-type': type}}); }
  fs.writeFileSync(path.join(dir, 'record.json'), JSON.stringify({name: 'fixture', entries}));
  fs.writeFileSync(path.join(dir, 'asks.jsonl'), Array.from({length: asks}, (_, at) => JSON.stringify({at})).join('\n'));
  if (memo !== null) fs.writeFileSync(path.join(dir, 'model-memo.json'), JSON.stringify(memo));
  return dir;
}
const CP1252 = new Map(Array.from({length: 256}, (_, byte) => [byte, new TextDecoder('windows-1252').decode(Uint8Array.of(byte))]));
// a reply with no charset, decoded as windows-1252 and stored as UTF-8 again: the Aldi shape "dÃ©tail â€“" (the dash becomes a euro sign)
const doubled = text => Buffer.from([...Buffer.from(text, 'utf8')].map(byte => CP1252.get(byte)).join(''), 'utf8');
const item = (name, over = {}) => ({name, dir: folder(), replay: replay(), replaced: undefined, ...over});
const checks = result => result.refusals.map(one => `${one.row}:${one.check}`);

test('garbled is what the charset repair changes, the Aldi windows-1252 shape included, never a grep for "Ã"', () => {
  assert.equal(doubled('détail – Zürich').toString('utf8'), 'dÃ©tail â€“ ZÃ¼rich');
  assert.deepEqual(mojibakeBodies(folder({bodies: {
    aldi: doubled('détail – Zürich'),
    latin1: {bytes: Buffer.from(Buffer.from('détail', 'utf8').toString('latin1'), 'utf8')},
    good: Buffer.from('détail – Zürich', 'utf8'),
    labeled: {bytes: doubled('détail'), type: 'text/html; charset=utf-8'},
    lone: Buffer.from('Ã', 'utf8'),
    ascii: Buffer.from('plain', 'utf8'),
    binary: {bytes: Buffer.from([0xff, 0x00, 0xc3, 0x28]), type: 'application/octet-stream'},
  }})).sort(), ['aldi', 'latin1']);
  assert.deepEqual(mojibakeBodies(fs.mkdtempSync(path.join(os.tmpdir(), 'jp-guard-'))), [], 'a folder without record.json has nothing to check');
});

test('a record with a double-encoded page, or without the live run\'s kept answers, is refused', () => {
  const result = judgeRecords([item('mojibake', {dir: folder({bodies: {bad: doubled('Cloudera Careers – détail')}})}), item('no memo', {dir: folder({memo: null})}), item('empty memo', {dir: folder({memo: {}})}), item('no asks, no memo needed', {dir: folder({asks: 0, memo: null})})]);
  assert.deepEqual(checks(result), ['mojibake:text', 'no memo:answers', 'empty memo:answers']);
  assert.match(report(result), /refused: mojibake: text: 1 kept page\(s\) are double-encoded \(UTF-8 text stored as a single-byte charset/);
  assert.match(report(result), /to proceed: /);
  assert.match(memoProblem(folder({memo: {}})), /keeps no answer/);
});

test('a record whose own replay did not run, or stops before the step live reached, is refused', () => {
  assert.deepEqual(checks(judgeRecords([item('none', {replay: null})])), ['none:replay']);
  assert.deepEqual(checks(judgeRecords([item('short', {replay: replay({outcome: {reached: 'posting'}})})])), ['short:step']);
});

test('a pinned row must replay same as live before it replaces its record; only the owner\'s named accept lifts it', () => {
  const broken = replay({hit: 3, extra: 1}), pins = ['p'];
  assert.deepEqual(checks(judgeRecords([item('p', {replay: broken, replaced: null})], {pins})), ['p:pinned']);
  assert.deepEqual(checks(judgeRecords([item('p', {replay: replay(), replaced: null})], {pins})), []);
  assert.deepEqual(checks(judgeRecords([item('q', {replay: broken, replaced: null})], {pins})), [], 'an unpinned row is not held to same');
  assert.deepEqual(checks(judgeRecords([item('p', {replay: broken, replaced: null})], {pins, accepts: ['intended']})), ['p:pinned'], 'a bare reason accepts nothing');
  const named = judgeRecords([item('p', {replay: broken, replaced: null})], {pins, accepts: ['p — one slot per upload widget']});
  assert.deepEqual(checks(named), []);
  assert.match(report(named), /accepted by the owner \(one slot per upload widget\)/);
  assert.deepEqual(checks(judgeRecords([item('p', {replay: broken, replaced: null}), item('r', {replay: broken, replaced: null})], {pins: ['p', 'r'], accepts: ['p — ok']})), ['r:pinned'], 'the accept covers only the row it names');
});

test('a record cannot replace a better one: a lower step or fewer boxes filled is refused (the Aldi case)', () => {
  const old = replay({live: form(10, 2)});
  assert.equal(notWorse(form(10, 2), form(10, 2)), '');
  assert.equal(notWorse(form(12, 0), form(10, 2)), '');
  assert.match(notWorse(form(8, 4), form(10, 2)), /fills 8, the record it replaces fills 10/);
  assert.match(notWorse({reached: 'posting'}, form(1, 1)), /reaches posting, the record it replaces reaches form/);
  assert.deepEqual(checks(judgeRecords([item('a', {replay: replay({live: form(8, 4)}), replaced: old})])), ['a:worse']);
  assert.deepEqual(checks(judgeRecords([item('a', {replay: replay({live: form(10, 2)}), replaced: old})])), []);
  assert.deepEqual(checks(judgeRecords([item('a', {replay: replay({live: form(8, 4)}), replaced: old})], {accepts: ['a — new form is smaller on purpose']})), [], 'the owner\'s named accept lifts it');
  assert.deepEqual(checks(judgeRecords([item('a', {dir: folder({bodies: {bad: doubled('détail')}}), replay: replay({live: form(8, 4)}), replaced: old})], {accepts: ['a — whatever']})), ['a:text'], 'an accept never lifts a double-encoded page');
});

test('without the replaced record, a pinned row is refused ("pass --against") and another row only gets a note', () => {
  const result = judgeRecords([item('p'), item('q')], {pins: ['p']});
  assert.deepEqual(checks(result), ['p:worse']);
  assert.match(result.refusals[0].run, /--against/);
  assert.match(report(result), /note: q: not compared with the record it replaces/);
});

test('one refused row never keeps its group back: the others are published, the refused one is named, and the run still ends red', () => {
  const rows = ['good a', 'old Cloudera', 'good b', 'Aldi'].map(name => ({name, dir: '/x'}));
  const judged = judgeRecords([item('good a'), item('old Cloudera', {replay: null}), item('good b'), item('Aldi', {dir: folder({bodies: {bad: doubled('détail – ALDI')}})})]);
  const {publish, refused} = partition(rows, judged);
  assert.deepEqual(publish.map(row => row.name), ['good a', 'good b']);
  assert.deepEqual(refused, ['old Cloudera', 'Aldi']);
  assert.match(report(judged), /refused: old Cloudera: replay/, 'each refusal still says which row and why');
  assert.match(report(judged), /refused: Aldi: text/);
  assert.deepEqual(partition(rows, {refusals: [], notes: []}), {publish: rows, refused: []});
  assert.deepEqual(partition([{name: 'a'}], {refusals: [{row: 'a', check: 'text'}, {row: 'a', check: 'answers'}], notes: []}), {publish: [], refused: ['a']}, 'a row with two problems is named once');
});

test('records-publish uploads the passing rows then exits red when any row was refused; it no longer stops at the first refusal', async () => {
  const {readFileSync} = await import('node:fs');
  const code = readFileSync(new URL('../../records-publish.mjs', import.meta.url), 'utf8');
  assert.match(code, /partition\(rows, judged\)/);
  assert.doesNotMatch(code, /nothing was uploaded/, 'the blanket refusal is gone');
  assert.match(code, /process\.exitCode = refusedExit/, 'red after the upload when a row was refused');
  assert.match(code, /fs\.rmSync\(path\.join\(stage, path\.basename\(row\.dir\)\)/, 'a refused row is taken out of the bundle');
});
