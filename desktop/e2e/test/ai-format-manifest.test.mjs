// Keep the nightly format requests complete, fictional and reproducible without an AI transport.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import childProcess from 'node:child_process';
import {createHash} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {test} from 'node:test';
import {loadTable, questionOf} from '../lib/ai-answers.mjs';
import {tierOf} from '../lib/broker-client.mjs';

const ROOT = fileURLToPath(new URL('../../../', import.meta.url));
const FILE = new URL('../fixtures/golden/ai-format-manifest.json', import.meta.url);
const read = () => JSON.parse(fs.readFileSync(FILE, 'utf8'));
const answerFile = 'desktop/e2e/fixtures/golden/ai-answers.json';
const answerDependency = `${answerFile}#answers.app.interview.recruiter-call-gamma`;
// Canonical subtree bytes match Python json.dumps(sort_keys=True, separators=(',', ':'), ensure_ascii=False), UTF-8.
const canonical = value => JSON.stringify(value, (_key, part) => part && typeof part === 'object' && !Array.isArray(part)
  ? Object.fromEntries(Object.keys(part).sort().map(key => [key, part[key]])) : part);
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
    const actions = {'app.geo': 'place_triage', 'app.place': 'place_triage', 'app.placeVague': 'place_vague', 'app.title': 'title_triage', 'app.visa': 'place_triage', 'app.visit': 'visit_relevant'};
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
  // Why (30 Oct 2026, ap; a8 on #2580, the answers fixture is fingerprinted by the one subtree the capture reads): another rebased source can be stale first; isolate the injected mismatch, while byte regeneration above still requires fresh committed snapshots.
  const fresh = Object.fromEntries(Object.keys(pythonSnapshot.dependencies).map(dependency => {
    const [file, selector] = dependency.split('#');
    const bytes = fs.readFileSync(path.join(ROOT, file));
    if (selector) assert.equal(dependency, answerDependency);
    return [dependency, createHash('sha256').update(selector
      ? canonical(JSON.parse(bytes).answers['app.interview']['recruiter-call-gamma']) : bytes).digest('hex')];
  }));
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

test('engine fingerprints ignore unrelated answers and reject changed or missing interview replies', async t => {
  const {checkPython} = await import('../../../tools/ai-format-capture.mjs');
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ai-format-fingerprint-'));
  t.after(() => fs.rmSync(root, {recursive: true, force: true}));
  const filename = path.join(root, answerFile);
  fs.mkdirSync(path.dirname(filename), {recursive: true});
  const table = JSON.parse(fs.readFileSync(path.join(ROOT, answerFile), 'utf8'));
  const stored = JSON.parse(fs.readFileSync(new URL('../fixtures/golden/ai-format-python.json', import.meta.url), 'utf8'));
  assert.ok(stored.dependencies[answerDependency], 'capture must fingerprint only the interview subtree');
  assert.ok(!(answerFile in stored.dependencies), 'the full answer table must not invalidate engine captures');
  const snapshot = {...stored, dependencies: {[answerDependency]: stored.dependencies[answerDependency]}};
  const write = () => fs.writeFileSync(filename, JSON.stringify(table));
  write();
  assert.doesNotThrow(() => checkPython(snapshot, root));
  table.answers['app.interview']['unrelated-caption'] = {reply: {content: [{type: 'text', text: 'Unrelated Zürich answer'}]}};
  write();
  assert.doesNotThrow(() => checkPython(snapshot, root));
  table.answers['app.interview']['recruiter-call-gamma'].reply.content[0].text += ' changed';
  write();
  const stale = {message: `Engine capture stale: ${answerDependency}; run python3 tools/ai-format-python-capture.py`};
  assert.throws(() => checkPython(snapshot, root), stale);
  delete table.answers['app.interview']['recruiter-call-gamma'];
  write();
  assert.throws(() => checkPython(snapshot, root), stale);
});
