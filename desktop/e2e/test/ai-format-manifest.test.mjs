// Keep the nightly format requests complete, fictional and reproducible without an AI transport.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import childProcess from 'node:child_process';
import {createHash} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {test} from 'node:test';
import {loadTable, questionOf} from '../lib/ai-answers.mjs';
import {tierOf} from '../lib/broker-client.mjs';

const ROOT = fileURLToPath(new URL('../../../', import.meta.url));
const FILE = new URL('../fixtures/golden/ai-format-manifest.json', import.meta.url);
const read = () => JSON.parse(fs.readFileSync(FILE, 'utf8'));
const families = table => [...new Set([
  ...Object.keys(table.kinds || {}), ...Object.keys(table.items || {}), ...Object.keys(table.answers || {}),
].map(kind => kind === 'app.interview' ? 'interview' : kind))].sort();

test('the manifest contains exactly one request for every family declared by the answer loader', () => {
  const table = loadTable(), manifest = read();
  assert.ok(manifest.about.length >= 25);
  assert.equal(manifest.v, 1);
  const kinds = manifest.entries.map(entry => entry.kind);
  assert.equal(new Set(kinds).size, kinds.length, 'duplicate kind');
  assert.deepEqual(kinds, families(table), 'missing, extra or unsorted family');
});

test('each captured request has validator context, a bounded body and real source locations', () => {
  for (const entry of read().entries) {
    for (const field of ['kind', 'action', 'request', 'context', 'source', 'validator', 'tier']) assert.ok(field in entry, `${entry.kind}: ${field}`);
    assert.ok(['small', 'mid', 'large'].includes(entry.tier), entry.kind);
    const actions = {'app.geo': 'place_triage', 'app.place': 'place_triage', 'app.title': 'title_triage', 'app.visa': 'place_triage'};
    assert.equal(entry.action, actions[entry.kind] || entry.kind.replace(/^app\./, ''), entry.kind);
    assert.equal(typeof entry.context, 'object');
    assert.ok(entry.context && Object.keys(entry.context).length, `${entry.kind}: no context`);
    const {request} = entry, text = JSON.stringify(request);
    assert.ok(text.length >= 200 && text.length < 40_000, `${entry.kind}: ${text.length} characters`);
    assert.deepEqual(JSON.parse(text), request);
    assert.match(request.model, /^claude-(haiku|sonnet|opus)-/);
    assert.equal(entry.tier, tierOf(request.model), entry.kind);
    assert.ok(request.system?.length, entry.kind);
    assert.ok(request.messages.length && request.messages.every(turn => turn.role && turn.content), entry.kind);
    assert.equal(request.output_config.format.type, 'json_schema');
    assert.equal(request.output_config.format.schema.type, 'object');
    for (const field of ['source', 'validator']) {
      const match = /^((?:desktop|src)\/[\w/.-]+):(\d+)$/.exec(entry[field]);
      assert.ok(match, `${entry.kind}: ${field}`);
      const filename = path.join(ROOT, match[1]), lines = fs.readFileSync(filename, 'utf8').split('\n');
      assert.ok(Number(match[2]) > 0 && Number(match[2]) <= lines.length, entry[field]);
      assert.ok(lines[Number(match[2]) - 1].trim(), `${entry[field]}: blank line`);
    }
  }
});

test('captured engine requests identify their actual family despite shared action labels', () => {
  for (const entry of read().entries.filter(entry => entry.kind.startsWith('app.'))) {
    const question = questionOf({body: entry.request, headers: {'x-jp-action': entry.action}}, {});
    assert.equal(question.operation, entry.kind, `${entry.kind}: ${question.unkeyable || 'wrong identity'}`);
    if ('subrequest' in entry.context) assert.match(entry.context.subrequest, /^[a-z][a-z-]*$/);
  }
});

test('the manifest contains no API credentials, bearer tokens or non-fictional email addresses', () => {
  const documents = read().entries.flatMap(entry => entry.request.messages.flatMap(turn => Array.isArray(turn.content)
    ? turn.content.filter(part => part.type === 'document').map(part => Buffer.from(part.source.data, 'base64').toString('latin1')) : []));
  const text = [fs.readFileSync(FILE, 'utf8'), ...documents].join('\n');
  assert.doesNotMatch(text, /\b(?:sk-(?:ant-)?[A-Za-z0-9_-]{12,}|Bearer\s+[A-Za-z0-9._-]{12,}|eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+)\b/i);
  for (const email of text.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi) || []) assert.match(email, /@example\.com$/i);
});

test('in-process regeneration reproduces the committed bytes without a subprocess or network', async t => {
  t.mock.method(globalThis, 'fetch', () => { throw new Error('network forbidden'); });
  for (const name of ['spawn', 'spawnSync', 'exec', 'execSync', 'execFile', 'execFileSync', 'fork']) {
    t.mock.method(childProcess, name, () => { throw new Error('subprocess forbidden'); });
  }
  const {captureManifest} = await import('../../../tools/ai-format-capture.mjs');
  const expected = fs.readFileSync(FILE, 'utf8');
  assert.equal(await captureManifest(), expected);
  assert.equal(await captureManifest(), expected, 'second capture must not reuse mutable cache/storage');
});

test('a changed Python sender refuses regeneration until its offline capture is refreshed', async () => {
  const {captureManifest} = await import('../../../tools/ai-format-capture.mjs');
  const pythonSnapshot = JSON.parse(fs.readFileSync(new URL('../fixtures/golden/ai-format-python.json', import.meta.url), 'utf8'));
  // Why (30 Oct 2026, ap): another rebased source can be stale first; isolate the injected mismatch, while byte regeneration above still requires fresh committed snapshots.
  const fresh = Object.fromEntries(Object.keys(pythonSnapshot.dependencies).map(file => [file,
    createHash('sha256').update(fs.readFileSync(path.join(ROOT, file))).digest('hex')]));
  const sources = Object.keys(fresh).filter(file => file.startsWith('src/'));
  assert.ok(sources.length >= 2);
  for (const file of [sources[0], sources.at(-1)]) {
    const dependencies = {...fresh, [file]: '0'.repeat(64)};
    await assert.rejects(captureManifest({pythonSnapshot: {...pythonSnapshot, dependencies}}), error => {
      assert.equal(error.message, `Engine capture stale: ${file}; run python3 tools/ai-format-python-capture.py`);
      return true;
    });
  }
});
