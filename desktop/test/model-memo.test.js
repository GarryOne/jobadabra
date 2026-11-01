// The model-call cache of the e2e harness (lib/ai/model-memo.js): one answer per normalised request, only under the e2e env, never in the app's real folder.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {test} from 'node:test';
import {fileURLToPath} from 'node:url';
import {ADDED_SCHEMA_KEYS, LATENCY_CAP_MS, latencyOn, layoutKey, memoFile, nearSizeKey, memoKey, fillOn, memoOnly, memoParts, volatileParts, withMemo} from '../lib/ai/model-memo.js';

const ask = (text, extra = {}) => ({model: 'claude-haiku-5-5', max_tokens: 500, system: 'Say what kind of page this is.', messages: [{role: 'user', content: text}], ...extra});

test('volatile fields do not change the key: query strings, timestamps, long ids, uuids', () => {
  const a = memoKey(ask('page https://jobs.example.com/o/role?token=abc&utm=1 at 2026-10-11T02:09:18.786Z id 1791685394882 ref 3f2a9c1e-7b2d-4c1a-9e0f-1a2b3c4d5e6f hash 0123456789abcdef0123'));
  const b = memoKey(ask('page https://jobs.example.com/o/role?token=zzz at 2026-10-12T11:00:00Z id 1791699999999 ref 00000000-1111-2222-3333-444444444444 hash fedcba9876543210fedc'));
  assert.equal(a, b);
});

test('what the model is really asked changes the key: the page, the system prompt, the schema, the model', () => {
  const base = memoKey(ask('buttons: [1] Apply [2] Share'));
  assert.notEqual(base, memoKey(ask('buttons: [1] Share [2] Apply')), 'a numbered list keeps its order: the number is the answer');
  assert.notEqual(base, memoKey({...ask('buttons: [1] Apply [2] Share'), system: 'Another prompt line.'}));
  assert.notEqual(base, memoKey({...ask('buttons: [1] Apply [2] Share'), output_config: {format: {type: 'json_schema', schema: {type: 'object'}}}}));
  assert.notEqual(base, memoKey({...ask('buttons: [1] Apply [2] Share'), model: 'claude-sonnet-5-5'}));
  assert.notEqual(memoKey(ask('job 12345')), memoKey(ask('job 12346')), 'a short number (a field id, a count) is kept');
});

test('a hit answers without asking; a miss asks once and is kept on disk for the next run', async () => {
  const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'jp-memo-')), 'model-memo.json');
  let calls = 0;
  const client = {engine: 'cli', messages: {create: async () => { calls += 1; return {content: [{type: 'text', text: '{"kind":"form"}'}], stop_reason: 'end_turn', usage: {input_tokens: 9, output_tokens: 3}}; }}};
  withMemo(client, file);
  const first = await client.messages.create(ask('a form page'));
  const second = await client.messages.create(ask('a form page'));
  assert.equal(calls, 1);
  assert.deepEqual(second.content, first.content);
  assert.equal(client.engine, 'cli', 'the adapter keeps its own properties');
  const again = {messages: {create: async () => { throw new Error('must not ask'); }}};
  withMemo(again, file);
  assert.deepEqual((await again.messages.create(ask('a form page'))).content, first.content);
  const stored = JSON.parse(fs.readFileSync(file, 'utf8'));
  assert.equal(Object.keys(stored).filter(name => !/#(parts|lines|volatile|ms|layout)$/.test(name)).length, 1, 'one answer, and beside it its parts (hashes) and how long the ask took');
  assert.ok(!JSON.stringify(stored).includes('a form page'), 'the request text is not stored, only its hash and the answer');
});

test('a failed ask is not kept', async () => {
  const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'jp-memo-')), 'model-memo.json');
  const client = {messages: {create: async () => { throw new Error('limit'); }}};
  withMemo(client, file);
  await assert.rejects(client.messages.create(ask('x')));
  assert.equal(fs.existsSync(file), false);
});

test('the cache exists only under the e2e env, and never in the app\'s own folder', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'jp-memo-'));
  assert.equal(memoFile({JOB_PILOTTO_MODEL_MEMO: path.join(dir, 'm.json')}), '', 'no JOB_PILOTTO_E2E: the person\'s app never memoizes');
  assert.equal(memoFile({JOB_PILOTTO_E2E: '1'}), '');
  assert.equal(memoFile({JOB_PILOTTO_E2E: '1', JOB_PILOTTO_MODEL_MEMO: path.join(dir, 'm.json')}), path.join(dir, 'm.json'));
  const real = path.join(os.homedir(), 'Library', 'Application Support', 'Job Pilotto', 'model-memo.json');
  assert.equal(memoFile({JOB_PILOTTO_E2E: '1', JOB_PILOTTO_MODEL_MEMO: real}), '');
});

test('the app\'s AI client is memoized through one place only', () => {
  const index = fs.readFileSync(new URL('../lib/ai/index.js', import.meta.url), 'utf8');
  assert.match(index, /withMemo\(/);
  const lib = fileURLToPath(new URL('../lib', import.meta.url));
  const users = fs.readdirSync(lib, {recursive: true}).map(file => String(file).split(path.sep).join('/')).filter(file => file.endsWith('.js'))
    .filter(file => fs.readFileSync(path.join(lib, file), 'utf8').includes('withMemo('));
  assert.deepEqual(users.sort(), ['ai/index.js', 'ai/model-memo.js']);
});

test('memo-only (an offline row replay): a kept answer is given, a miss is refused and never asked', async () => {
  const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'jp-memo-')), 'model-memo.json');
  const asking = {messages: {create: async () => ({content: [{type: 'text', text: 'kept'}]})}};
  withMemo(asking, file);
  await asking.messages.create(ask('a kept page'));
  let asked = 0;
  const offline = {messages: {create: async () => { asked += 1; return {content: []}; }}};
  withMemo(offline, file, {only: true});
  assert.deepEqual((await offline.messages.create(ask('a kept page'))).content, [{type: 'text', text: 'kept'}]);
  await assert.rejects(offline.messages.create(ask('a page the live run never asked about')), /not in the row's kept answers/);
  assert.equal(asked, 0, 'the model is never asked');
  assert.equal(memoOnly({JOB_PILOTTO_E2E: '1', JOB_PILOTTO_MODEL_MEMO_ONLY: '1'}), true);
  assert.equal(memoOnly({JOB_PILOTTO_MODEL_MEMO_ONLY: '1'}), false, 'only under the e2e env');
});

test('the key scrubs contacts as the page capture does: the live ask (the page\'s real email) and its replay (the scrubbed page) are one key', () => {
  const live = ask('Buttons: Apply | rh@fidag-sa.ch | Call +41 22 555 12 34\n- mailto:rh@fidag-sa.ch');
  const replay = ask('Buttons: Apply | test.candidate@example.com | Call (phone)\n- mailto:test.candidate@example.com');
  assert.equal(memoKey(live), memoKey(replay));
  assert.notEqual(memoKey(ask('Buttons: Apply | Share')), memoKey(ask('Buttons: Apply | rh@fidag-sa.ch')), 'an address is still part of the page');
});

test('memo-only answers are scrubbed like the replayed page: an email the AI read off the live page matches the scrubbed one', async () => {
  const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'jp-memo-')), 'model-memo.json');
  const live = {messages: {create: async () => ({content: [{type: 'text', text: '{"kind":"posting","apply_email":"rh@fidag-sa.ch","apply_by":"email"}'}]})}};
  withMemo(live, file);
  await live.messages.create(ask('Addresses: rh@fidag-sa.ch'));
  const replay = {messages: {create: async () => { throw new Error('never asked'); }}};
  withMemo(replay, file, {only: true});
  const answer = await replay.messages.create(ask('Addresses: test.candidate@example.com'));
  assert.match(answer.content[0].text, /"apply_email":"test\.candidate@example\.com"/);
  assert.match(JSON.parse(fs.readFileSync(file, 'utf8'))[Object.keys(JSON.parse(fs.readFileSync(file, 'utf8')))[0]].content[0].text, /rh@fidag-sa\.ch/, 'the kept answer itself is unchanged');
});

const answerAsk = (job, system = 'You fill forms.') => ({model: 'claude-sonnet-5-5', system: [{type: 'text', text: system}, {type: 'text', text: '<profile>Ada</profile>'}],
  messages: [{role: 'user', content: `<job>\n${job}\n</job>\n\n<form_fields>\n[{"field":"q1"}]\n</form_fields>`}]});

test('a request\'s parts are hashes of the model, each system block and each tag block of the user message; same request, same parts, no text in them', () => {
  const parts = memoParts(answerAsk('Seller in Zurich'));
  assert.deepEqual(Object.keys(parts), ['model', 'system:0', 'system:1', 'system:1:profile', 'user:job', 'user:form_fields', 'output']);
  assert.deepEqual(parts, memoParts(answerAsk('Seller in Zurich')));
  assert.ok(Object.values(parts).every(hash => /^[0-9a-f]{12}$/.test(hash)));
  assert.ok(!JSON.stringify(parts).includes('Zurich'));
});

test('a kept answer keeps its parts; a miss names the nearest kept ask\'s differing parts ("job differs"), in the refusal and never by text', async () => {
  const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'jp-memo-parts-')), 'model-memo.json');
  const live = {engine: 'cli', messages: {create: async () => ({content: [{type: 'text', text: '{"answers":[]}'}], stop_reason: 'end_turn', usage: {}})}};
  withMemo(live, file);
  await live.messages.create(answerAsk('Seller in Zurich'));
  const replay = {messages: {create: async () => { throw new Error('must not ask'); }}};
  withMemo(replay, file, {only: true});
  await assert.rejects(replay.messages.create(answerAsk('Seller in Zurich, page text read a second later')), /nearest kept ask differs in: user:job\b(?!.*system)/);
  await assert.rejects(replay.messages.create(answerAsk('Seller in Zurich', 'You fill forms, learned: x')), /differs in: system:0\b/);
  await assert.rejects(replay.messages.create({...answerAsk('Seller in Zurich'), model: 'claude-haiku-5-5'}), /differs in: model/);
  assert.ok((await replay.messages.create(answerAsk('Seller in Zurich'))).content, 'the same ask still hits');
});

test('a miss in a tagged section names the lines that differ ("system:1:profile (lines 2)"), by hashes kept beside the answer', async () => {
  const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'jp-memo-lines-')), 'model-memo.json');
  const withProfile = text => ({model: 'claude-sonnet-5-5', system: [{type: 'text', text: 'You fill forms.'}, {type: 'text', text: `<profile>\n${text}\n</profile>`}], messages: [{role: 'user', content: '<job>\nx\n</job>'}]});
  const live = {engine: 'cli', messages: {create: async () => ({content: [{type: 'text', text: '{}'}], stop_reason: 'end_turn', usage: {}})}};
  withMemo(live, file);
  await live.messages.create(withProfile('First name: Ada\nLast name: Tester\nCity: Zurich'));
  const replay = {messages: {create: async () => { throw new Error('must not ask'); }}};
  withMemo(replay, file, {only: true});
  await assert.rejects(replay.messages.create(withProfile('First name: Test\nLast name: Tester\nCity: Zurich')), /differs in: system:1, system:1:profile \(lines 2 of 5\)/);
  assert.ok(!JSON.stringify(memoParts(withProfile('First name: Ada'))).includes('Ada'));
});

// Loose lookup (owner, 12 Oct 2026): a CI row-case replay serves a kept answer whose user-message parts and output schema match even when the SYSTEM side (instructions, profile, search, knowledge) or the model
// changed since the capture, and counts each such hit; strict stays strict. A changed job or form_fields block is still a miss.
const looseSetup = async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'jp-memo-loose-')), file = path.join(dir, 'model-memo.json'), hits = path.join(dir, 'hits.jsonl');
  const live = {engine: 'cli', messages: {create: async () => ({content: [{type: 'text', text: '{"answers":[]}'}], stop_reason: 'end_turn', usage: {}})}};
  withMemo(live, file);
  await live.messages.create(answerAsk('Seller in Zurich'));
  const replay = (options = {}) => { const client = {messages: {create: async () => { throw new Error('must not ask'); }}}; withMemo(client, file, {only: true, ...options}); return client; };
  return {file, hits, replay};
};

test('loose: a changed system block (or model) is a hit served from the kept answer, counted with the differing parts', async () => {
  const run = await looseSetup(), loose = run.replay({loose: run.hits});
  const answer = await loose.messages.create({...answerAsk('Seller in Zurich', 'You fill forms, NEW instruction line'), model: 'claude-sonnet-9-9'});
  assert.deepEqual(JSON.parse(answer.content[0].text), {answers: []});
  const recorded = fs.readFileSync(run.hits, 'utf8').trim().split('\n').map(line => JSON.parse(line));
  assert.equal(recorded.length, 1);
  assert.ok(recorded[0].differs.includes('system:0') && recorded[0].differs.includes('model'));
  assert.ok(!recorded[0].differs.some(name => name.startsWith('user:') || name === 'output'), 'only the system side differs');
});

test('loose: a changed job block or form_fields block is still a miss; strict mode (no loose file) never serves a changed system block', async () => {
  const run = await looseSetup(), loose = run.replay({loose: run.hits});
  await assert.rejects(loose.messages.create(answerAsk('Seller in Zurich, the page text changed')), /not in the row's kept answers/);
  const form = answerAsk('Seller in Zurich'); form.messages[0].content = form.messages[0].content.replace('"q1"', '"q2"');
  await assert.rejects(loose.messages.create(form), /not in the row's kept answers/);
  const strict = run.replay();
  await assert.rejects(strict.messages.create(answerAsk('Seller in Zurich', 'You fill forms, NEW instruction line')), /differs in: system:0/);
  assert.ok(!fs.existsSync(run.hits), 'strict mode records no loose hit');
});

// A schema property added after the captures (ADDED_SCHEMA_KEYS, dated), whose absence the code handles, does not turn every row case cold in CI (12 Oct 2026: the
// form answers' `fact`, app-core/src/answer-facts.js); any other schema change is still a miss.
const withSchema = (ask, extra = {}) => {
  const item = {type: 'object', required: ['field', 'value', ...Object.keys(extra)], properties: {field: {type: 'string'}, value: {type: 'string'}, ...extra}};
  return {...ask, output_config: {format: {type: 'json_schema', schema: {type: 'object', required: ['answers'], properties: {answers: {type: 'array', items: item}}}}}};
};
test('loose: a schema that only gained a listed added property still matches the kept answer; an unlisted new property is a miss', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'jp-memo-added-')), file = path.join(dir, 'model-memo.json'), hits = path.join(dir, 'hits.jsonl');
  const live = {engine: 'cli', messages: {create: async () => ({content: [{type: 'text', text: '{"answers":[]}'}], stop_reason: 'end_turn', usage: {}})}};
  withMemo(live, file);
  await live.messages.create(withSchema(answerAsk('Seller in Zurich')));
  const loose = {messages: {create: async () => { throw new Error('must not ask'); }}};
  withMemo(loose, file, {only: true, loose: hits});
  assert.ok(ADDED_SCHEMA_KEYS.fact);
  const answer = await loose.messages.create(withSchema(answerAsk('Seller in Zurich', 'You fill forms, NEW rule'), {fact: {type: 'string', enum: ['work_permit', 'none']}}));
  assert.deepEqual(JSON.parse(answer.content[0].text), {answers: []});
  await assert.rejects(loose.messages.create(withSchema(answerAsk('Seller in Zurich'), {mood: {type: 'string'}})), /not in the row's kept answers/);
});

test('loose lookup is read from the environment too (JOB_PILOTTO_MODEL_MEMO_LOOSE=<hits file>, e2e only) and is off without it', async () => {
  const {looseFile} = await import('../lib/ai/model-memo.js');
  assert.equal(looseFile({}), '');
  assert.equal(looseFile({JOB_PILOTTO_E2E: '1', JOB_PILOTTO_MODEL_MEMO_LOOSE: '/tmp/x'}), '/tmp/x');
  assert.equal(looseFile({JOB_PILOTTO_MODEL_MEMO_LOOSE: '/tmp/x'}), '', 'never outside the e2e env');
});

test('a kept ask whose prompt carries a clock time or a date keeps the names of those parts beside it (the class check at capture time); a clean one keeps none', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'jp-memo-volatile-')), file = path.join(dir, 'model-memo.json');
  const live = {engine: 'cli', messages: {create: async () => ({content: [{type: 'text', text: '{}'}], stop_reason: 'end_turn', usage: {}})}};
  withMemo(live, file);
  await live.messages.create(answerAsk('Seller, contact kept from Notion (16:17)'));
  await live.messages.create(answerAsk('Seller in Zurich'));
  const kept = Object.entries(JSON.parse(fs.readFileSync(file, 'utf8'))).filter(([name]) => name.endsWith('#volatile'));
  assert.equal(kept.length, 1);
  assert.deepEqual(kept[0][1], ['user:job']);
});

test('a miss is also written to the miss log with its differing parts and the parts that carry a clock time or a date (a prompt no memo can ever match), never cut by a log line\'s length', async () => {
  const {file, replay} = await looseSetup(), log = path.join(path.dirname(file), 'miss-log.jsonl');
  const client = replay({missLog: log});
  const timed = answerAsk('Seller in Zurich, contact kept from Notion (16:17), review of 2026-10-11');
  await assert.rejects(client.messages.create(timed), /differs in: user:job/);
  const recorded = fs.readFileSync(log, 'utf8').trim().split('\n').map(line => JSON.parse(line));
  assert.deepEqual(recorded.map(entry => entry.differs), [['user:job (lines 2 of 3)']]);
  assert.deepEqual(recorded[0].volatile, ['user:job'], 'the part with a clock time and a date is named');
  assert.deepEqual(volatileParts(answerAsk('Seller in Zurich')), []);
});

test('the live ask\'s duration is kept beside its answer (#ms); a replay serves the kept answer after that time only when asked to, and never longer than the cap', async () => {
  const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'jp-memo-ms-')), 'model-memo.json');
  const slow = {engine: 'cli', messages: {create: async () => { await new Promise(resolve => setTimeout(resolve, 60)); return {content: [{type: 'text', text: '{"kind":"form"}'}], stop_reason: 'end_turn'}; }}};
  await withMemo(slow, file, {only: false}).messages.create(ask('a page'));
  const kept = JSON.parse(fs.readFileSync(file, 'utf8')), key = memoKey(ask('a page'));
  assert.ok(kept[`${key}#ms`] >= 50 && kept[`${key}#ms`] < 5000, `the live duration is kept: ${kept[`${key}#ms`]}`);
  const replayed = async options => { const client = {engine: 'cli', messages: {create: async () => { throw new Error('never asked'); }}}; const at = Date.now(); await withMemo(client, file, {only: true, ...options}).messages.create(ask('a page')); return Date.now() - at; };
  assert.ok(await replayed({latency: false}) < 40, 'off: answered at once');
  assert.ok(await replayed({latency: true}) >= 45, 'on: after the live duration');
  assert.equal(LATENCY_CAP_MS, 3000, 'the cap');
  assert.equal(latencyOn({JOB_PILOTTO_E2E: '1', JOB_PILOTTO_MODEL_MEMO_LATENCY: '1'}), true);
  assert.equal(latencyOn({JOB_PILOTTO_MODEL_MEMO_LATENCY: '1'}), false, 'only under the e2e env');
});

test('a slowed replay scales the live duration and pads every kept answer, also one with no recorded time (row-to-case\'s second speed)', async () => {
  const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'jp-memo-slow-')), 'model-memo.json');
  const key = memoKey(ask('a page'));
  fs.writeFileSync(file, JSON.stringify({[key]: {content: [{type: 'text', text: '{}'}]}}));   // no #ms: answered at once unless padded
  const timed = async env => { const client = {messages: {create: async () => { throw new Error('never asked'); }}}; const at = Date.now(); await withMemo(client, file, {only: true, latency: true, env}).messages.create(ask('a page')); return Date.now() - at; };
  assert.ok(await timed({}) < 40, 'normal speed: at once');
  assert.ok(await timed({JOB_PILOTTO_MODEL_MEMO_LATENCY_PAD_MS: '80'}) >= 70, 'slowed: padded');
});

test('ordinal (CI row cases): an ask with no kept answer gets the n-th kept answer of its kind, and says so; another kind is a miss; without the option nothing is served by order', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'jp-memo-ord-')), file = path.join(dir, 'model-memo.json'), note = path.join(dir, 'ordinal.jsonl');
  const kept = {};
  for (const [at, text] of [['one', 'first page'], ['two', 'second page']]) { const params = ask(text); kept[memoKey(params)] = {content: [{type: 'text', text: `{"answer":"${at}"}`}]}; kept[memoKey(params) + '#parts'] = memoParts(params); }
  fs.writeFileSync(file, JSON.stringify(kept));
  const make = options => { const client = {messages: {create: async () => { throw new Error('never asked'); }}}; return withMemo(client, file, {only: true, ...options}).messages.create; };
  const create = make({ordinal: note});
  assert.equal(JSON.parse((await create(ask('a different first page'))).content[0].text).answer, 'one', 'the 1st ask of its kind: the 1st kept answer');
  assert.equal(JSON.parse((await create(ask('a different second page'))).content[0].text).answer, 'two', 'the 2nd: the 2nd');
  await assert.rejects(create(ask('a third page')), /not in the row's kept answers/, 'no 3rd kept answer of that kind: a miss');
  await assert.rejects(make({ordinal: note})(ask('x', {system: 'Another kind of ask.'})), /not in the row's kept answers/, 'another kind: a miss');
  assert.equal(fs.readFileSync(note, 'utf8').trim().split('\n').length, 2, 'each served by order is noted');
  await assert.rejects(make({ordinal: ''})(ask('a different first page')), /not in the row's kept answers/, 'off: a miss');
});

test('ordinal picks, among the kept answers of the kind, the one whose parts differ least; a tie goes by order', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'jp-memo-near-')), file = path.join(dir, 'model-memo.json'), note = path.join(dir, 'ordinal.jsonl');
  const kept = {};
  const variant = (id, text) => ({system: [{type: 'text', text: 'Fill the form.'}, {type: 'text', text: `<profile>p</profile>`}], messages: [{role: 'user', content: `<job>${text}</job>\n<form_fields>${id}</form_fields>`}], model: 'claude-sonnet-5-5', max_tokens: 500});
  for (const [id, text] of [['fields A', 'page with banner'], ['fields B', 'page without banner']]) { const params = variant(id, text); kept[memoKey(params)] = {content: [{type: 'text', text: `{"v":"${id}"}`}]}; kept[memoKey(params) + '#parts'] = memoParts(params); }
  fs.writeFileSync(file, JSON.stringify(kept));
  const create = withMemo({messages: {create: async () => { throw new Error('never asked'); }}}, file, {only: true, ordinal: note}).messages.create;
  const got = async params => JSON.parse((await create(params)).content[0].text).v;
  assert.equal(await got(variant('fields B', 'page with something new')), 'fields B', 'the fields part matches variant B: the 1st ask of the kind still gets B, not the 1st kept');
});

test('a frame\'s pixel size is layout, not meaning: a replay on another machine still finds the answer kept for it (old records keep their exact key)', async () => {
  // 14 Oct 2026, coreweave: the runner's fonts made the embedded Greenhouse frame 6869 px tall, the Mac's live run 6993: one number, no kept answer, 3/11 asks.
  const page = height => ask(`frames: ${JSON.stringify([{host: 'job-boards.greenhouse.io', path: '/embed/job_app', width: 1140, height}])}`);
  assert.notEqual(memoKey(page(6993)), memoKey(page(6869)), 'the exact key is unchanged, so every record made before this still matches as before');
  assert.equal(layoutKey(page(6993)), layoutKey(page(6869)));
  assert.notEqual(layoutKey(page(6993)), layoutKey(ask('frames: []')), 'the rest of the ask still counts');
  // The frame line as the page-kind prompt writes it (coreweave, 14 Oct 2026): "0 · job-boards.greenhouse.io · /embed/job_app · 1140x6869".
  const line = height => ask(`Frames:\n0 · job-boards.greenhouse.io · /embed/job_app · 1140x${height}`);
  assert.equal(layoutKey(line(6993)), layoutKey(line(6869)));
  assert.notEqual(layoutKey(line(6993)), layoutKey(ask('Frames:\n0 · other.example · /embed/job_app · 1140x6993')), 'the host still counts');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'jp-memo-')), file = path.join(dir, 'model-memo.json'), hits = path.join(dir, 'hits.txt');
  let calls = 0;
  const reply = {content: [{type: 'text', text: '{"kind":"form"}'}], stop_reason: 'end_turn', usage: {input_tokens: 9, output_tokens: 3}};
  const live = withMemo({engine: 'cli', messages: {create: async () => { calls += 1; return reply; }}}, file, {only: false});
  await live.messages.create(page(6993));
  const env = {JOB_PILOTTO_E2E: '1', JOB_PILOTTO_MODEL_MEMO_HITS: hits};
  const replay = withMemo({engine: 'cli', messages: {create: async () => { throw new Error('never asked'); }}}, file, {only: true, env});
  assert.deepEqual(await replay.messages.create(page(6869)), reply);
  assert.equal(calls, 1);
  assert.equal(fs.readFileSync(hits, 'utf8').trim(), memoKey(page(6993)), 'the hit counts as the live ask it stands for');
});

test('a record made before the size-free key still matches when one frame size moved a little; nothing else may differ', async () => {
  // 14 Oct 2026: Databricks' embedded frame was 1430 px on the runner, 1426 in its live run: 1/8 asks. Old records have only exact keys.
  const json = height => ask(`frames: ${JSON.stringify([{host: 'job-boards.greenhouse.io', path: '/embed/job_app', width: 1080, height}])}`);
  const text = height => ask(`Frames:\n0 · job-boards.greenhouse.io · /embed/job_app · 1080x${height}`);
  for (const page of [json, text]) {
    const kept = {[memoKey(page(1426))]: {kind: 'form'}};
    assert.equal(nearSizeKey(page(1430), kept), memoKey(page(1426)));
    assert.equal(nearSizeKey(page(1426 + 201), kept), '', 'more than 200 px away: no match');
  }
  const kept = {[memoKey(text(1426))]: {kind: 'form'}};
  assert.equal(nearSizeKey(ask('Frames:\n0 · other.example · /embed/job_app · 1080x1430'), kept), '', 'the rest of the ask must match exactly');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'jp-memo-')), file = path.join(dir, 'model-memo.json'), hits = path.join(dir, 'hits.txt');
  const reply = {content: [{type: 'text', text: '{"kind":"form"}'}], stop_reason: 'end_turn', usage: {input_tokens: 9, output_tokens: 3}};
  fs.writeFileSync(file, JSON.stringify({[memoKey(text(1426))]: reply}));
  const replay = withMemo({engine: 'cli', messages: {create: async () => { throw new Error('never asked'); }}}, file, {only: true, env: {JOB_PILOTTO_E2E: '1', JOB_PILOTTO_MODEL_MEMO_HITS: hits}});
  assert.deepEqual(await replay.messages.create(text(1430)), reply);
  assert.equal(fs.readFileSync(hits, 'utf8').trim(), memoKey(text(1426)), 'the hit counts as the live ask');
});

test('fill (an ask the recording lacks, Mac only): a kept answer is served, a miss is asked once and kept, the next memo-only replay hits it', async () => {
  const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'jp-memo-')), 'model-memo.json');
  const first = {messages: {create: async () => ({content: [{type: 'text', text: 'kept'}]})}};
  withMemo(first, file);
  await first.messages.create(ask('a kept page'));
  let asked = 0;
  const filling = {messages: {create: async () => { asked += 1; return {content: [{type: 'text', text: 'new'}]}; }}};
  withMemo(filling, file, {only: true, fill: true});
  assert.deepEqual((await filling.messages.create(ask('a kept page'))).content, [{type: 'text', text: 'kept'}]);
  assert.equal(asked, 0, 'a kept ask is never asked again');
  assert.deepEqual((await filling.messages.create(ask('a page with a new field'))).content, [{type: 'text', text: 'new'}]);
  assert.equal(asked, 1, 'only the missed ask goes to the model');
  const offline = {messages: {create: async () => { throw new Error('must not ask'); }}};
  withMemo(offline, file, {only: true});
  assert.deepEqual((await offline.messages.create(ask('a page with a new field'))).content, [{type: 'text', text: 'new'}], 'the filled answer is in the memo');
  assert.equal(fillOn({JOB_PILOTTO_E2E: '1', JOB_PILOTTO_MODEL_MEMO_ONLY: '1', JOB_PILOTTO_MODEL_MEMO_FILL: '1'}), true);
  assert.equal(fillOn({JOB_PILOTTO_MODEL_MEMO_ONLY: '1', JOB_PILOTTO_MODEL_MEMO_FILL: '1'}), false, 'only under the e2e env');
  assert.equal(fillOn({JOB_PILOTTO_E2E: '1', JOB_PILOTTO_MODEL_MEMO_FILL: '1'}), false, 'only with memo-only: a fill is a replay that may ask');
  assert.equal(fillOn({JOB_PILOTTO_E2E: '1', JOB_PILOTTO_MODEL_MEMO_ONLY: '1', JOB_PILOTTO_MODEL_MEMO_FILL: '1', CI: 'true'}), false, 'never on CI: no claude -p there');
});
