// Prove instruction edits invalidate reviewed answers without changing semantic identities or using live AI.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import http from 'node:http';
import childProcess from 'node:child_process';
import {syncBuiltinESMExports} from 'node:module';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {test} from 'node:test';
import {capturePrompts, promptOf, familyHashes} from '../lib/ai-answer-prompts.mjs';
import {loadTable, questionOf, storedAnswer} from '../lib/ai-answers.mjs';
import {checkAiMisses} from '../lib/no-real-ai.mjs';
import {startAiProxy} from '../lib/ai-proxy.mjs';
import {keep, requestKey} from '../lib/ai-meter.mjs';
import {modelFetch} from '../lib/model.mjs';
import {stampAnswers} from '../../../tools/ai-answers-stamp.mjs';

const ROOT = fileURLToPath(new URL('../../../', import.meta.url));
const contracts = () => capturePrompts(ROOT);
const requests = JSON.parse(fs.readFileSync(new URL('../fixtures/golden/ai-format-python.json', import.meta.url))).entries;
const place = () => structuredClone(requests.find(entry => entry.kind === 'app.place').request);
const mixed = ['app.score', 'app.interview', 'app.enrich', 'mail'];
const manifest = JSON.parse(fs.readFileSync(new URL('../fixtures/golden/ai-format-manifest.json', import.meta.url))).entries;
const mixedRequest = family => {
  if (family !== 'mail') return structuredClone(manifest.find(entry => entry.kind === (family === 'app.interview' ? 'interview' : family)).request);
  const value = contracts().mail.default;
  return {system: [{type: 'text', text: value.system.replace('{data}', '(none)')}],
    messages: [{role: 'user', content: '### Item 0\nFrom: sender@example.com\nDate: 2026-10-30\nSubject: Fixture subject\n\nFixture mail text'}], output_config: {format: {schema: value.schema}}};
};
const responses = body => ({model: 'other', instructions: body.system, input: body.messages.map(turn => ({...turn, content: [{type: 'input_text', text: turn.content}]})), text: {format: body.output_config.format}});
const stepOf = kind => requests.find(entry => entry.kind === kind).action, PLACE = stepOf('app.place');
const step = kind => ({'x-jp-action': stepOf(kind)});
function fixture(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'answer-prompts-')), file = path.join(dir, 'answers.json');
  t.after(() => fs.rmSync(dir, {recursive: true, force: true}));
  const table = loadTable(), item = questionOf({body: place()}, {}).items[0];
  table.items['app.place'][item.key] = {text: item.text, answer: {where: 'Town', country: 'Country', nearest: 'zurich', km: 0, answer: 'best'}};
  fs.writeFileSync(file, JSON.stringify(table));
  return {dir, file, env: {E2E_AI_ANSWERS: 'backbone', E2E_ARTIFACTS: dir, E2E_AI_ANSWERS_FILE: file}};
}
function sourceCopy(dir) {
  for (const name of ['src', 'tools', 'desktop/e2e/fixtures/golden', 'desktop/e2e/lib/interview-data.mjs']) {
    const dest = path.join(dir, name); fs.mkdirSync(path.dirname(dest), {recursive: true});
    fs.cpSync(path.join(ROOT, name), dest, {recursive: true});
  }
}
function edit(root, file, from, to) {
  const dest = path.join(root, file), before = fs.readFileSync(dest, 'utf8');
  assert.ok(before.includes(from)); fs.writeFileSync(dest, before.replace(from, to));
}

function changedMixedData(family, original) {
  const changedData = structuredClone(original);
  if (['app.score', 'app.interview'].includes(family)) changedData.system[0].text += '\nDifferent private CV and persona.';
  if (family === 'mail') changedData.system[0].text = changedData.system[0].text.replace('(none)', '0. Different private application');
  changedData.messages[0].content = changedData.messages[0].content.replace(/Posting:\n[\s\S]*$/, 'Posting:\nDifferent private posting.')
    .replace(/Transcript or notes:\n[\s\S]*$/, 'Transcript or notes:\nDifferent private transcript.')
    .replace(/Subject: [\s\S]*$/, 'Subject: Different private mail\n\nDifferent private body.');
  if (['app.score', 'app.enrich'].includes(family)) changedData.messages[0].content = changedData.messages[0].content
    .replace(/^Title: [^\n]*\nCompany: [^\n]*\nLocation: [^\n]*/, 'Title: Different posting\nCompany: Different company\nLocation: Somewhere');
  return changedData;
}

function seedMixedAnswers(table, family, original, changedData, env, headers) {
  if (family === 'app.score') {
    const originalId = questionOf({body: original, headers}, env, table).id, changedId = questionOf({body: changedData, headers}, env, table).id;
    assert.notEqual(originalId, changedId);
    table.answers[family][changedId] = structuredClone(table.answers[family][originalId]);
  }
  if (['mail', 'app.enrich'].includes(family)) {
    const empty = schema => schema.enum ? schema.enum[0] : schema.type === 'object' ? Object.fromEntries(Object.entries(schema.properties).map(([key, value]) => [key, empty(value)]))
      : schema.type === 'array' ? [] : schema.type === 'string' ? '' : schema.type === 'boolean' ? false : 0;
    for (const body of [original, changedData]) {
      const q = questionOf({body, headers}, env, table);
      const answer = empty(family === 'mail' ? body.output_config.format.schema.properties.results.items : body.output_config.format.schema);
      if (family === 'mail') delete answer.index;
      table.items[family] ??= {};
      for (const item of q.items) table.items[family][item.key] = {text: item.text, answer};
    }
  }
}

test('capture uses the harness Python override and UTF-8 environment', t => {
  const saved = process.env.E2E_PYTHON, marker = new Error('captured subprocess boundary');
  process.env.E2E_PYTHON = 'fixture-python-command';
  t.after(() => {
    if (saved === undefined) delete process.env.E2E_PYTHON; else process.env.E2E_PYTHON = saved;
    t.mock.restoreAll(); syncBuiltinESMExports();
  });
  t.mock.method(childProcess, 'execFileSync', (command, args, options) => {
    assert.equal(command, process.env.E2E_PYTHON);
    assert.equal(options.env.PYTHONUTF8, '1');
    assert.equal(options.env.PYTHONDONTWRITEBYTECODE, '1');
    throw marker;
  });
  syncBuiltinESMExports();
  assert.throws(() => capturePrompts(), error => error === marker);
});

test('fresh capture includes all thirteen families and both title/visit variants; stamping is byte stable', t => {
  const {file} = fixture(t), before = loadTable(file), current = contracts();
  assert.equal(Object.keys(current).length, 13); assert.deepEqual(loadTable().promptHashes, familyHashes(current));
  assert.match(current['app.decide'].default.user, /^Task: \{data\}\nAllowed answers: /);
  assert.deepEqual(Object.keys(current['app.title']), ['recheck', 'sort']);
  assert.deepEqual(Object.keys(current['app.visit']), ['keep', 'leave']);
  stampAnswers({file, all: true}); const once = fs.readFileSync(file, 'utf8');
  stampAnswers({file, all: true}); assert.equal(fs.readFileSync(file, 'utf8'), once);
  const after = loadTable(file); delete before.promptHashes; delete after.promptHashes;
  assert.deepEqual(after, before);
  assert.throws(() => stampAnswers({file, family: 'unknown'}), /uncaptured/);
  assert.throws(() => promptOf(place(), {}), /Incomplete fixed prompt capture/);
});

test('both provider shapes hash full schemas but exclude persona, posting, batch order and transport noise', () => {
  const current = contracts(), original = place(), expected = promptOf(original, current, PLACE);
  const noisy = place(); noisy.model = 'different'; noisy.system[0].cache_control = {type: 'ephemeral'};
  noisy.messages[0].content = 'Their places (JSON): {"persona":"other","date":"2099-01-01"}\nThe job locations:\n1. Elsewhere\n2. Somewhere';
  assert.deepEqual(promptOf(noisy, current, PLACE), expected);
  assert.deepEqual(promptOf(responses(noisy), current, PLACE), expected);
  for (const [family, variants] of Object.entries(current)) for (const value of Object.values(variants)) {
    const body = {system: value.system, messages: [{role: 'user', content: value.user.replace(/\{\w+\}/g, 'other persona/posting/date/order')}], output_config: {format: {schema: value.schema}}};
    assert.equal(promptOf(body, current, value.action).hash, familyHashes(current)[family]);
    assert.deepEqual(promptOf(responses(body), current, value.action), promptOf(body, current, value.action));
  }
  const reordered = place(); reordered.output_config.format.schema = Object.fromEntries(Object.entries(reordered.output_config.format.schema).reverse());
  assert.deepEqual(promptOf(reordered, current, PLACE), expected);
  reordered.output_config.format.schema.properties.locations.items.properties.km.description += ' Changed.';
  assert.notEqual(promptOf(reordered, current, PLACE).hash, expected.hash);
});

test('a sender outside the nine families is never claimed by a shared schema root; a family\'s own step still is (Gitar on #2606)', t => {
  const {file, env} = fixture(t); stampAnswers({file, all: true});
  const current = contracts(), shaped = (root, text) => ({system: [{type: 'text', text}], messages: [{role: 'user', content: 'An alert email'}],
    output_config: {format: {schema: {type: 'object', required: [root], properties: {[root]: {type: 'array', items: {type: 'integer'}}}}}}});
  // Real roots and steps: job_alerts' jobs, page_reader's jobs (scout), web_search's PICK_SCHEMA keep (job_page_pick), and a request with no step.
  for (const [action, body] of [['mail', shaped('jobs', 'You read one job-alert email.')], ['scout', shaped('jobs', 'You read one web page.')],
    ['job_page_pick', shaped('keep', 'You get a company and numbered web addresses.')], ['', shaped('keep', 'You get a job seeker\'s roles and places.')]]) {
    assert.equal(promptOf(body, current, action), undefined, action);
    assert.doesNotThrow(() => { try { storedAnswer({body, headers: action ? {'x-jp-action': action} : {}}, env); } catch (error) { if (/stale/.test(error.message)) throw error; } });
  }
  const reworded = place(); reworded.system[0].text = 'A new instruction opening.';
  assert.equal(promptOf(reworded, current, PLACE).family, 'app.place');
});

test('wire instruction/framing and schema edits refuse before lookup in all modes while place keys stay stable', t => {
  const {file, env} = fixture(t); stampAnswers({file, all: true});
  for (const provider of [body => body, responses]) for (const mode of ['off', 'record', 'backbone']) {
    for (const change of [body => { body.system[0].text += ' Changed instruction.'; },
      body => { body.system[0].text = 'A new instruction opening.'; },
      body => { body.messages[0].content = body.messages[0].content.replace('Their places', 'Accepted places'); },
      body => { body.output_config.format.schema.properties.locations.items.properties.km.description += ' Changed description.'; },
      body => { body.output_config.format.schema.properties.locations = null; }]) {
      const body = place(); change(body);
      assert.throws(() => storedAnswer({body: provider(body), headers: step('app.place')}, {...env, E2E_AI_ANSWERS: mode}), /E2E_AI_ANSWER_MISSING: stale: prompt changed app.place/);
    }
  }
  const changed = place(); changed.system[0].text += ' More wording.';
  assert.deepEqual(questionOf({body: changed}, env), questionOf({body: place()}, env));
});

for (const provider of ['anthropic', 'responses']) test(`${provider}: a real sender edit refuses the same question and counts one metadata-only miss on retry`, t => {
  const {dir, file, env} = fixture(t); sourceCopy(dir);
  stampAnswers({file, all: true, root: dir}); const before = fs.readFileSync(file, 'utf8');
  assert.ok(storedAnswer({body: place(), headers: step('app.place')}, env).reply);
  edit(dir, 'src/ai/place_triage.py', 'For each \\\nlocation, first say', 'For each \\\nlocation, carefully say');
  const changed = capturePrompts(dir), updated = place(); updated.system[0].text = changed['app.place'].default.system;
  const body = provider === 'responses' ? responses(updated) : updated;
  const ask = {body, headers: step('app.place'), prompts: changed}, key = questionOf(ask, env);
  assert.equal(checkAiMisses(dir, {aiMissesMax: 0}).misses, 0);
  const approved = loadTable(file).promptHashes['app.place'], current = promptOf(body, changed, PLACE).hash;
  assert.equal(current, familyHashes(changed)['app.place']);
  for (let retry = 0; retry < 2; retry++) assert.throws(() => storedAnswer(ask, env), error => {
    assert.equal(error.code, 'E2E_AI_ANSWER_MISSING');
    assert.equal(error.message, `E2E_AI_ANSWER_MISSING: stale: prompt changed app.place (${approved.slice(0, 12)} -> ${current.slice(0, 12)})`);
    return true;
  });
  assert.deepEqual(questionOf(ask, env), key); assert.equal(fs.readFileSync(file, 'utf8'), before);
  assert.equal(checkAiMisses(dir, {aiMissesMax: 0}).misses, 1); assert.equal(checkAiMisses(dir, {aiMissesMax: 0}).ok, false);
  const markers = fs.readdirSync(path.join(dir, 'ai-misses')); assert.equal(markers.length, 1);
  const marker = JSON.parse(fs.readFileSync(path.join(dir, 'ai-misses', markers[0])));
  assert.deepEqual(Object.keys(marker).sort(), ['approved', 'current', 'family', 'question']);
  assert.doesNotMatch(JSON.stringify(marker), /Zurich|carefully|Their places/);
});

for (const [file, from, to, family] of [
  ['src/ai/title_triage.py', 'You check job titles that a first sort rejected', 'You check job titles that an earlier sort rejected', 'app.title'],
  ['src/sources/visits.py', 'When unsure, leave it out.', 'When uncertain, leave it out.', 'app.visit'],
  ['src/ai/title_triage.py', "listed = '\\n'.join", "listed = '\\n\\n'.join", 'app.title'],
]) test(`${family}: editing the otherwise-unused variant changes the entire family hash`, t => {
  const {dir, file: tableFile, env} = fixture(t); sourceCopy(dir);
  const body = requests.find(entry => entry.kind === family).request, question = questionOf({body}, env), table = loadTable(tableFile);
  table.items[family] = Object.fromEntries(question.items.map(item => [item.key, {text: item.text, answer: true}])); fs.writeFileSync(tableFile, JSON.stringify(table));
  stampAnswers({file: tableFile, all: true}); assert.ok(storedAnswer({body, headers: step(family)}, env).reply);
  const before = familyHashes(contracts()); edit(dir, file, from, to);
  const changed = capturePrompts(dir), after = familyHashes(changed); assert.notEqual(after[family], before[family]);
  assert.throws(() => storedAnswer({body, headers: step(family), prompts: changed}, env), new RegExp(`stale: prompt changed ${family}`));
  const oldStamps = loadTable(tableFile).promptHashes; stampAnswers({file: tableFile, family, root: dir});
  assert.deepEqual(loadTable(tableFile).promptHashes, {...oldStamps, [family]: after[family]});
  assert.ok(storedAnswer({body, headers: step(family), prompts: changed}, env).reply);
  for (const other of Object.keys(before).filter(name => name !== family)) assert.equal(after[other], before[other]);
});

for (const [family, source, from, to] of [
  ['app.score', 'src/ai/score.py', 'You rank job postings for one candidate.', 'You carefully rank job postings for one candidate.'],
  ['app.interview', 'src/ai/interviews_ai.py', 'You review job interviews for the candidate', 'You carefully review job interviews for the candidate'],
  ['app.enrich', 'src/ai/enrich.py', 'You extract facts from job postings', 'You carefully extract facts from job postings'],
  ['mail', 'src/ai/mail_config.py', 'You sort the job-search emails', 'You carefully sort the job-search emails'],
]) test(`${family}: source instructions refuse on both providers; source and wire data stay outside the hash`, t => {
  const {dir, file, env} = fixture(t); sourceCopy(dir);
  const before = capturePrompts(dir), hashes = familyHashes(before), original = mixedRequest(family);
  assert.ok(before[family], `missing ${family}`);
  const changedData = changedMixedData(family, original);
  edit(dir, 'desktop/e2e/fixtures/golden/candidate.txt', 'a', 'A different persona ');
  // Keep the posting shape valid while replacing its actual text in the isolated fixture.
  const truthFile = path.join(dir, 'desktop/e2e/fixtures/golden/truth.json'), truth = JSON.parse(fs.readFileSync(truthFile));
  truth[0].description = 'Different private posting.'; fs.writeFileSync(truthFile, JSON.stringify(truth));
  const dataOnly = capturePrompts(dir); assert.deepEqual(familyHashes(dataOnly), hashes);
  const table = loadTable(file), headers = {'x-jp-action': family.replace('app.', '')};
  seedMixedAnswers(table, family, original, changedData, env, headers);
  fs.writeFileSync(file, JSON.stringify(table));
  for (const provider of [body => body, responses]) {
    assert.equal(promptOf(provider(original), dataOnly, headers['x-jp-action']).hash, hashes[family]);
    assert.equal(promptOf(provider(changedData), dataOnly, headers['x-jp-action']).hash, hashes[family]);
    assert.ok(storedAnswer({body: provider(changedData), headers, prompts: dataOnly}, env).reply);
  }
  stampAnswers({file, all: true, root: dir}); edit(dir, source, from, to);
  const changed = capturePrompts(dir); assert.notEqual(familyHashes(changed)[family], hashes[family]);
  const updated = structuredClone(original);
  if (typeof updated.system === 'string') updated.system = updated.system.replace(from, to);
  else updated.system[0].text = updated.system[0].text.replace(from, to);
  for (const provider of [body => body, responses]) assert.equal(promptOf(provider(updated), changed, headers['x-jp-action']).hash, familyHashes(changed)[family]);
  for (const provider of [body => body, responses]) for (const mode of ['off', 'record', 'backbone']) {
    for (let retry = 0; retry < 2; retry++) assert.throws(() => storedAnswer({body: provider(original), headers: {'x-jp-action': family.replace('app.', '')}, prompts: changed}, {...env, E2E_AI_ANSWERS: mode}), new RegExp(`stale: prompt changed ${family}`));
  }
  assert.equal(checkAiMisses(dir, {aiMissesMax: 0}).misses, 1);
  assert.doesNotMatch(JSON.stringify(changed[family]), /Different private|J'ai|Gamma Freight/);
});

for (const [family, source, from, to] of [
  ['app.score', 'src/ai/score.py', 'Extracted facts (stage 1):', 'Known facts (stage 1):'],
  ['app.score', 'src/ai/score_search.py', "The person's search (the roles they look for):", "The person's searched roles:"],
  ['app.enrich', 'src/ai/enrich.py', 'Your last answer left', 'The previous answer left'],
  ['app.enrich', 'src/ai/enrich.py', "You name one job's own kind of work", "You identify one job's own kind of work"],
  ['app.interview', 'src/ai/interviews_ai.py', 'Transcript or notes:', 'Transcript and notes:'],
  ['mail', 'src/ai/mail_read.py', 'Subject:', 'Mail subject:'],
  ['mail', 'src/ai/mail_read.py', "', via '", "', through '"],
  ['mail', 'src/ai/mail_read.py', "', recruiter '", "', contact '"],
  ['app.score', 'src/ai/score.py', "'them'", "'those parts'"],
]) test(`${family}: fixed framing or auxiliary instructions in ${source} invalidate the family`, t => {
  const {dir, file, env} = fixture(t); sourceCopy(dir); stampAnswers({file, all: true, root: dir});
  edit(dir, source, from, to); const changed = capturePrompts(dir);
  for (const provider of [body => body, responses]) assert.throws(() => storedAnswer({body: provider(mixedRequest(family)), headers: {'x-jp-action': family.replace('app.', '')}, prompts: changed}, env), new RegExp(`stale: prompt changed ${family}`));
});

test('mixed retry schemas and independent extraction role questions match their captured contracts', () => {
  const current = contracts(), hashes = familyHashes(current);
  for (const family of ['app.score', 'app.enrich']) for (const value of Object.values(current[family])) {
    const body = {system: value.system.replace(/\{\w+\}/g, 'Different private data'),
      messages: [{role: 'user', content: value.user.replace(/\{\w+\}/g, 'Different private data')}], output_config: {format: {schema: value.schema}}};
    for (const provider of [body => body, responses]) assert.equal(promptOf(provider(body), current, value.action).hash, hashes[family]);
  }
  assert.equal(Object.keys(current['app.score']).length, 4);
  assert.equal(Object.keys(current['app.enrich']).length, 9);
});

test('stale backbone replies refuse before warm cache, relay, upstream and model engine selection on both providers', async t => {
  const {dir, file, env} = fixture(t), saved = {...process.env};
  const table = loadTable(file); table.promptHashes = {...familyHashes(contracts()), ...Object.fromEntries(['app.place', ...mixed].map(family => [family, '0'.repeat(64)]))}; fs.writeFileSync(file, JSON.stringify(table));
  Object.assign(env, {E2E_AI_CACHE: dir, E2E_AI_REPLAY: '1', E2E_JUDGE_FAMILY: 'claude'}); Object.assign(process.env, env);
  t.after(() => { for (const key of Object.keys(process.env)) if (!(key in saved)) delete process.env[key]; Object.assign(process.env, saved); });
  let relays = 0, engines = 0, upstream = 0, cacheReads = 0;
  const server = http.createServer((req, res) => { upstream++; req.resume(); res.end('{}'); });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve)); t.after(() => { server.closeAllConnections(); return new Promise(resolve => server.close(resolve)); });
  const read = fs.readFileSync; t.mock.method(fs, 'readFileSync', (file, ...args) => { if (path.dirname(String(file)) === dir && /^[a-f0-9]{32}\.json$/.test(path.basename(String(file)))) cacheReads++; return read(file, ...args); });
  t.mock.method(globalThis, 'fetch', new Proxy(globalThis.fetch, {apply(target, receiver, args) {
    assert.match(String(args[0]), /^http:\/\/127\.0\.0\.1:/);
    return Reflect.apply(target, receiver, args);
  }}));
  const scenarios = ['app.place', ...mixed].flatMap(family => [false, true].map(stream => ({family, stream})));
  for (const shape of ['anthropic', 'openai']) {
    const proxy = await startAiProxy({shape, target: `http://127.0.0.1:${server.address().port}`, metered: /\/(?:messages|responses)/, relay: async () => { relays++; throw Error('relay'); }});
    t.after(() => proxy.close());
    for (const {family, stream} of scenarios) {
      const original = family === 'app.place' ? place() : mixedRequest(family);
      const body = {...(shape === 'openai' ? responses(original) : original), stream}, route = shape === 'openai' ? '/v1/responses' : '/v1/messages';
      keep(requestKey(route, Buffer.from(JSON.stringify(body))), {status: 200, body: Buffer.from('{}'), contentType: 'application/json'});
      const init = {method: 'POST', headers: {'x-jp-action': family === 'app.place' ? PLACE : family.replace('app.', '')}, body: JSON.stringify(body)};
      const response = await fetch(proxy.url + route, init); assert.equal(response.status, 503);
      assert.match((await response.json()).error.message, new RegExp(`stale: prompt changed ${family}`));
      await assert.rejects(modelFetch(proxy.url + route, init, {env, engine: () => { engines++; throw Error('engine'); }}), new RegExp(`stale: prompt changed ${family}`));
    }
    assert.equal(proxy.stats.paid || 0, 0);
  }
  assert.deepEqual([cacheReads, relays, engines, upstream], [0, 0, 0, 0]);
});
