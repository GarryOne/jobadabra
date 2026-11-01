// Applyflows fixture questions are explicit; unknown questions fail before any cache or model.
import {loadAppModule} from '../../lib/app-module.mjs';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {test} from 'node:test';
import * as fixtureForms from '../../lib/forms.mjs';
import {problems} from '../../../lib/ai/schema.js';
import {SCHEMA as PICTURE_SCHEMA, FORM_INSTRUCTIONS as PICTURE_FORM_RULES, vetForm} from '../../../lib/ladder/rung4-picture.js';
import {installApplyAnswers} from '../../lib/apply-answers.mjs';
import {backboneHarness} from '../../lib/backbone-harness.mjs';
import {LEARN_FORM_PREFIX, answerFor, loadTable, questionOf, refusedQuestions, storedAnswer} from '../../lib/ai-answers.mjs';
import {INSTRUCTIONS as KIND_RULES} from '../../../lib/ladder/rung2-sketch.js';
import {INSTRUCTIONS as FORM_RULES, STEP_RULE, SUBMIT_RULE, BLOCKED_RULE, BOT_RULE} from '../../../lib/form-judge.js';
import {DIGEST_INSTRUCTIONS} from '../../../lib/ladder/rung3-digest.js';
import {CHAIN, FORMS, LATE, MISLABELLED} from '../../lib/forms.mjs';
const {INSTRUCTIONS: LEARN_RULES, judge: judgeLearnings} = await loadAppModule('learnings.js');
import * as suite from '../../suites/applyflows.mjs';

const body = (system, text) => ({model: 'fixture', system, messages: [{role: 'user', content: text}]});
const sketch = where => `Address path: ${where}\nControls (type · label):\n(none)`;
const digest = where => `Address path: ${where}\nCandidates (number · kind · position · host · text):\n(none)`;

// Find ladder modules and the page server's sender dependencies in their existing discovery order.
function pagePromptFiles() {
  const ladder = new URL('../../../lib/ladder/', import.meta.url), server = new URL('../../../lib/server-pages.js', import.meta.url);
  return new Set([...fs.readdirSync(ladder).filter(name => name.endsWith('.js')).map(name => new URL(name, ladder).href),
    ...[...fs.readFileSync(server, 'utf8').matchAll(/(?:from\s*|import\(\s*)['"](\.[^'"]+\.js)['"]/g)].map(([, spec]) => new URL(spec, server).href)]);
}

// Read each actual system expression's instruction branches, including concatenated form rules.
function systemBranches(source, names) {
  const branches = [];
  for (const [, expression] of source.matchAll(/\bsystem:\s*([^,\n]+)/g)) {
    for (const branch of expression.split(/[?:]/)) {
      const terms = branch.trim().split(/\s*\+\s*/);
      if (terms.some(term => names.includes(term))) branches.push({expression, terms});
    }
  }
  return branches;
}

// Expand a sender's schema into its existing phase variants without changing its prompt text.
function promptVariants(file, module, terms) {
  const system = terms.map(term => module[term]).join(''), schema = module.SCHEMA || module.DIGEST_SCHEMA || module.schema;
  assert.ok(schema, `${file}: sender's reply schema must be discoverable`);
  return (typeof schema === 'function' ? ['ready', 'result'] : ['']).map(phase => ({
    system, schema: typeof schema === 'function' ? schema(module[phase.toUpperCase()]) : schema,
    phase, name: `${path.basename(new URL(file).pathname)}:${terms.join('+')}${phase ? `:${phase}` : ''}`,
  }));
}

// Validate that every exported instruction participates in a sender and collect its variants.
async function promptsInFile(file) {
  const source = fs.readFileSync(new URL(file), 'utf8');
  const names = [...source.matchAll(/export const (\w*INSTRUCTIONS)\s*=/g)].map(([, name]) => name);
  if (!names.length) return [];
  const module = await import(file), used = new Set(), prompts = [];
  for (const {expression, terms} of systemBranches(source, names)) {
    assert.ok(terms.every(term => typeof module[term] === 'string'), `${file}: unenumerated system expression ${expression}`);
    terms.forEach(term => used.add(term));
    prompts.push(...promptVariants(file, module, terms));
  }
  for (const name of names) assert.ok(used.has(name), `${file}: ${name} has no enumerated sender`);
  return prompts;
}

// Discover exported prompts and the actual system expressions, including form-judge's appended rules and picture's three scopes.
async function pagePrompts() {
  const prompts = [];
  for (const file of pagePromptFiles()) prompts.push(...await promptsInFile(file));
  return prompts;
}

// Exported fixture objects own the base paths; literal route templates in forms and journeys own derived pages such as accountPath/new.
function fixturePaths() {
  const paths = new Set(), seen = new Set();
  function walk(value) {
    if (!value || typeof value !== 'object' || seen.has(value)) return;
    seen.add(value);
    for (const [key, item] of Object.entries(value)) {
      if (/(?:^path$|Path$)/.test(key) && typeof item === 'string' && item.startsWith('/')) paths.add(item);
      walk(item);
    }
  }
  walk(fixtureForms);
  for (const filename of ['../../lib/forms.mjs', '../../lib/apply-journeys.mjs', '../../suites/apply.mjs', '../../suites/applyflows.mjs']) {
    const source = fs.readFileSync(new URL(filename, import.meta.url), 'utf8');
    for (const match of source.matchAll(/`\$\{([\w.]+Path)\}(\/[^`?$]*)`/g)) {
      const [, expression, suffix] = match;
      const [owner, ...parts] = expression.split('.');
      const loops = [...source.slice(0, match.index).matchAll(new RegExp(`for \\(const ${owner} of \\[([^\\]]+)\\]\\)`, 'g'))];
      const roots = fixtureForms[owner] ? [fixtureForms[owner]] : (loops.at(-1)?.[1] || '').split(',').map(name => fixtureForms[name.trim()]);
      for (const root of roots) {
        const base = parts.reduce((value, key) => value?.[key], root);
        if (typeof base === 'string') paths.add(base + suffix);
      }
    }
    for (const [, literal] of source.matchAll(/['"]((?:\/e2e|\/o\/)[^'"?\s]*)['"]/g)) paths.add(literal);
  }
  return [...paths].sort();
}

// Why (30 Oct 2026, ap, Gitar on #2562): judgeFormat (desktop/lib/format-judge.js) sends only the field, the site's error and the writings tried, never an Address path or a page sketch; its request is built in that exact shape, and what it answers depends on the field, not the page.
const askedWithoutPage = prompt => 'format' in prompt.schema.properties;
const formatRequest = (prompt, field) => ({model: 'claude-opus-5-5', system: prompt.system,
  output_config: {format: {type: 'json_schema', schema: prompt.schema}}, messages: [{role: 'user', content: [{type: 'text', text: [
    `Field: ${field}`, "The site's error: Fixture error", 'Writings already tried: (only the first, E.164 with spaces)'].join('\n')}]}]});
const pageRequest = (prompt, where) => askedWithoutPage(prompt) ? formatRequest(prompt, 'Phone') : ({model: 'claude-opus-5-5', system: prompt.system,
  output_config: {format: {type: 'json_schema', schema: prompt.schema}}, messages: [{role: 'user', content: [{type: 'text', text: [
    ...(prompt.phase ? [`Phase: ${prompt.phase}`] : []),
    ...(prompt.schema.properties.action ? ['Why asked: the fill put nothing in and required fields are left'] : []),
    ...(askedWithoutPage(prompt) ? [] : [`Address path: ${where}`]), 'Title: Fictional fixture application', 'Controls (type · label):',
    '[1] text · Notice period · required · empty · match no', 'Candidates (number · kind · position · host · text):', '(none)',
    'Needs repair:', '[1] empty (not_kept)', 'Field: Phone', "The site's error: Fixture error", 'Buttons and links: Submit application',
  ].join('\n')}]}]});

function assertSchema(reply, schema, name) {
  assert.deepEqual(problems(reply, schema), [], name);
  if (schema.additionalProperties === false) assert.ok(Object.keys(reply).every(key => key in schema.properties), `${name}: extra reply property`);
  for (const [key, value] of Object.entries(reply)) {
    const property = schema.properties?.[key];
    if (Array.isArray(value) && property?.items?.type === 'object') for (const item of value) assertSchema(item, property.items, `${name}.${key}`);
  }
}

function handler() {
  let canned = null;
  const ctx = {proxy: {canned: () => canned, setCanned: value => { canned = value; }}};
  installApplyAnswers(ctx);
  return {ctx, answer: request => canned(request)};
}

test('an unknown fixture page is never silently classified as a form', () => {
  const {answer} = handler();
  assert.equal(answer(body(KIND_RULES, sketch('/undeclared-fixture'))), null);
  assert.equal(answer(body('An undeclared question', sketch(MISLABELLED.path))), null);
  assert.equal(JSON.parse(answer(body(KIND_RULES, sketch(MISLABELLED.path)))).kind, 'posting', 'the wrong-kind plant remains explicit');
});

test('every declared journey path has its authored page kind', () => {
  const {answer} = handler();
  for (const [where, kind] of [[CHAIN.stepPath, 'posting'], [FORMS.submitter.autoPath, 'form']]) {
    assert.equal(JSON.parse(answer(body(KIND_RULES, sketch(where))))?.kind, kind, where);
    assert.equal(JSON.parse(answer(body(FORM_RULES + STEP_RULE + SUBMIT_RULE + BLOCKED_RULE + BOT_RULE, sketch(where))))?.answer, 'unsure', where);
  }
});

test('the late empty form has an authored no-control digest answer', () => {
  const {answer} = handler();
  assert.deepEqual(JSON.parse(answer(body(DIGEST_INSTRUCTIONS, digest(LATE.formPath)))),
    {outcome: 'other', verb: 'none', numbers: [], press_kind: '', form_frame: -1, confidence: 1});
  assert.equal(answer(body(DIGEST_INSTRUCTIONS, digest('/undeclared-fixture'))), null);
});

test('every source-declared page prompt has a schema-valid fixture answer on every planted page', async () => {
  const prompts = await pagePrompts(), paths = fixturePaths(), {answer} = handler(), missing = [];
  assert.ok(prompts.length && paths.length, 'the source enumeration must not be empty');
  for (const prompt of prompts) {
    for (const where of paths) {
      const raw = await answer(pageRequest(prompt, where)), name = `${prompt.name} ${where}`;
      if (raw === null) { missing.push(name); continue; }
      assertSchema(JSON.parse(raw), prompt.schema, name);
      const reply = JSON.parse(raw);
      if ('action' in reply) assert.equal(reply.action, 'ask_person', name);
      if ('repairs' in reply) assert.deepEqual(reply.repairs, [], name);
      if ('verb' in reply) assert.equal(reply.verb, 'none', name);
    }
    if (askedWithoutPage(prompt)) {
      assert.deepEqual(JSON.parse(await answer(formatRequest(prompt, 'Téléphone'))), {format: 'none', confidence: 1}, `${prompt.name}: the planted phone field is answered`);
      assert.equal(await answer(formatRequest(prompt, 'Shoe size')), null, `${prompt.name}: an unplanted field must fall through`);
    } else assert.equal(await answer(pageRequest(prompt, '/undeclared-fixture')), null, `${prompt.name}: unknown page must fall through`);
  }
  console.log(`Applyflows page coverage: ${prompts.length} prompt variants x ${paths.length} fixture paths = ${prompts.length * paths.length} requests`);
  assert.deepEqual(missing, [], 'a prompt or fixture page has no stored answer');
});

for (const where of ['/e2e/signin-refused', '/e2e/signin-refused/new', '/o/chain-form', '/e2e/signup-application', '/e2e/signin-application']) {
  test(`rung 4 leaves ${where} for the person without naming an action control`, () => {
    const {answer} = handler(), raw = answer(pageRequest({system: PICTURE_FORM_RULES, schema: PICTURE_SCHEMA}, where));
    assert.notEqual(raw, null);
    const reply = JSON.parse(raw);
    assertSchema(reply, PICTURE_SCHEMA, where);
    assert.equal(reply.action, 'ask_person');
    for (const field of ['control', 'control_kind', 'detail', 'option']) assert.equal(reply[field], '');
    assert.deepEqual(vetForm(reply, {controls: [], buttons: []}), {ok: true, action: 'ask_person'});
  });
}

for (const family of ['claude', 'openai']) test(`${family}: both CI refusal files replay without stored-answer failures`, async t => {
  const h = await backboneHarness(t, 'applyflows', family);
  installApplyAnswers(h);
  const prompts = await pagePrompts(), evidence = JSON.parse(fs.readFileSync(new URL('../../fixtures/golden/applyflows-ai-refusals.json', import.meta.url), 'utf8'));
  const proxy = h.openaiProxy || h.proxy;
  for (const [part, records] of Object.entries(evidence.runs)) for (const record of records) {
    // CI stores only 160 system / 100 user characters, flattening line breaks. Restore the full exported system and the path's line boundary.
    const captured = JSON.parse(record.message.split('request=')[1]), matches = prompts.filter(prompt => prompt.system.replace(/\s+/g, ' ').trim().startsWith(captured.system));
    assert.equal(matches.length, 1, `${part}: captured prompt must match exactly one source system`);
    const where = /Address path: (\S+)/.exec(captured.user)?.[1];
    assert.ok(where, `${part}: captured fixture path`);
    const request = pageRequest(matches[0], where);
    request.model = captured.model;
    const payload = family === 'openai' ? {model: request.model, instructions: request.system, input: request.messages} : request;
    const response = await h.localFetch(`${proxy.url}${family === 'openai' ? '/v1/responses' : '/v1/messages'}`, {
      method: 'POST', headers: {'content-type': 'application/json'}, body: JSON.stringify(payload)});
    const reply = await response.json();
    assert.equal(response.status, 200, `${part} ${where}: ${JSON.stringify(reply)}`);
    assertSchema(JSON.parse(family === 'openai' ? reply.output_text : reply.content[0].text), matches[0].schema, `${part} ${where}`);
  }
  assert.deepEqual(refusedQuestions(h.env), []);
  h.assertNoLive();
});

test('fixture journeys refuse to start in off mode before taking any app action', async t => {
  const before = process.env.E2E_AI_ANSWERS;
  process.env.E2E_AI_ANSWERS = 'off';
  t.after(() => { if (before === undefined) delete process.env.E2E_AI_ANSWERS; else process.env.E2E_AI_ANSWERS = before; });
  assert.throws(() => suite.run({}), /applyflows is a backbone suite/);
});

for (const family of ['claude', 'openai']) test(`${family}: unknown page fails at the real proxy seam, before cache or transport`, async t => {
  const h = await backboneHarness(t, 'applyflows', family);
  installApplyAnswers(h);
  const proxy = h.openaiProxy || h.proxy, prompts = (await pagePrompts()).filter(prompt => !askedWithoutPage(prompt));
  for (const prompt of prompts) {
    const request = pageRequest(prompt, '/undeclared-fixture');
    const response = await h.localFetch(`${proxy.url}${family === 'openai' ? '/v1/responses' : '/v1/messages'}`, {
      method: 'POST', headers: {'content-type': 'application/json'},
      body: JSON.stringify(family === 'openai' ? {model: 'fixture', instructions: request.system, input: request.messages} : request)});
    const reply = await response.json();
    assert.equal(response.status, 503, prompt.name);
    assert.equal(reply.error.code, 'E2E_AI_ANSWER_MISSING', prompt.name);
    assert.match(reply.error.message, /undeclared-fixture/, prompt.name);
  }
  assert.equal(refusedQuestions(h.env).length, prompts.length);
  h.assertNoLive();
});

test('both workflow attempts run applyflows with semantic backbone answers', () => {
  // The suite declares it; every workflow reads it from the matrix (plan-run.mjs, tests/test_workflow_ai_answers.py; beta 41078746088: a hand-kept list drifted).
  assert.match(fs.readFileSync(new URL('../../suites/applyflows.mjs', import.meta.url), 'utf8'), /^export const aiAnswers = 'backbone';/m);
});

// Capture the product's own request: no app, store, account or model is started.
async function learningRequest() {
  let request;
  await judgeLearnings({messages: {create: async body => {
    request = body;
    return {content: [{type: 'text', text: '{"verdicts":[]}'}]};
  }}}, {answers: [{label: 'Why this company?', value: 'Fixture motivation'}]});
  return request;
}

test('the background learning ask has a declared kind answer, not an unknown-question escape', async () => {
  const request = await learningRequest(), table = loadTable();
  const question = questionOf({body: request}, {E2E_AI_ANSWERS: 'backbone'}, table);
  assert.deepEqual(question, {operation: 'app.kind', id: 'learn_from_form'});
  assert.deepEqual(answerFor(question, table), {refuse: 'invalid-key'});
  for (const mode of ['off', 'record']) assert.ok(questionOf({body: request}, {E2E_AI_ANSWERS: mode}, table).unkeyable);
  const missing = structuredClone(table);
  delete missing.kinds.learn_from_form;
  assert.ok(answerFor(question, missing).missing, 'removing the authored refusal must fail');
  assert.ok(questionOf({body: {...request, system: 'An undeclared background question'}}, {}, table).unkeyable);
});

for (const family of ['claude', 'openai']) test(`${family}: known journey and learning asks leave no stored-answer guard failures`, async t => {
  const h = await backboneHarness(t, 'applyflows', family);
  installApplyAnswers(h);
  const proxy = h.openaiProxy || h.proxy, learning = await learningRequest();
  for (const [request, status] of [
    [body(KIND_RULES, sketch(CHAIN.stepPath)), 200],
    [body(KIND_RULES, sketch(FORMS.submitter.autoPath)), 200],
    [learning, 401],
  ]) {
    const payload = family === 'openai' ? {model: 'fixture', instructions: request.system, input: request.messages} : request;
    const response = await h.localFetch(`${proxy.url}${family === 'openai' ? '/v1/responses' : '/v1/messages'}`, {
      method: 'POST', headers: {'content-type': 'application/json'}, body: JSON.stringify(payload)});
    assert.equal(response.status, status, await response.text());
  }
  assert.deepEqual(refusedQuestions(h.env), []);
  const table = loadTable();
  delete table.kinds.learn_from_form;
  const file = path.join(h.env.E2E_ARTIFACTS, 'missing-learning.json');
  fs.writeFileSync(file, JSON.stringify(table));
  assert.throws(() => storedAnswer({body: learning}, {...h.env, E2E_AI_ANSWERS_FILE: file}), /E2E_AI_ANSWERS=backbone/);
  h.assertNoLive();
});

// Why (30 Oct 2026, PR #2562, Gitar): the harness recognises the header-less learning call by this opening; rewording the product prompt must fail here, not silently send the call to the unknown-question path.
test('the learning prompt still opens with the prefix the harness recognises', () => {
  assert.ok(LEARN_RULES.startsWith(LEARN_FORM_PREFIX));
});
