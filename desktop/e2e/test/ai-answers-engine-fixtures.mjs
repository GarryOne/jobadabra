// Build engine request fixtures from Python constants without importing engine configuration or data.
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {test} from 'node:test';
import {answerFor, loadTable, questionOf, recordCandidate} from '../lib/ai-answers.mjs';
import {message} from '../lib/ai-proxy.mjs';
import {withDerived} from '../../lib/target-roles.js';

const root = fileURLToPath(new URL('../../../', import.meta.url));
// Only named constant assignments execute; no source imports, expressions, functions or engine factories run.
const literals = JSON.parse(execFileSync('python3', ['-c', `import ast,json,sys,types
from pathlib import Path
root=Path(sys.argv[1]); base={}
for n in ast.parse((root/'src/role_kinds.py').read_text()).body:
 if isinstance(n,ast.Assign) and isinstance(n.targets[0],ast.Name) and n.targets[0].id in ('KINDS','WORK'): base[n.targets[0].id]=ast.literal_eval(n.value)
keys=set('LANGUAGES _evidence IT_FAMILIES IT_WORK ROLE_FAMILIES SCHEMA SYSTEM ROLE_SYSTEM KINDS VAGUE_SCHEMA VAGUE_SYSTEM VISA_SCHEMA VISA_SYSTEM READ_SCHEMA READ_SYSTEM RECHECK_SYSTEM RELEVANT_SCHEMA RELEVANT_SYSTEM RELEVANT_UNSURE PORTALS'.split()); out={}
for file in ['src/places.py','src/geo.py','src/ai/title_triage.py','src/ai/enrich.py','src/ai/place_triage.py','src/sources/visits.py','src/sources/visits_portals.py']:
 env={**base,'schema_notes':types.SimpleNamespace(text=lambda schema:'')}
 for n in ast.parse((root/file).read_text()).body:
  if isinstance(n,ast.Assign) and isinstance(n.targets[0],ast.Name) and n.targets[0].id in keys:
   exec(compile(ast.Module(body=[n],type_ignores=[]),file,'exec'),env)
 out[file]={k:env[k] for k in keys if k in env and k not in base}
print(json.dumps(out,default=lambda value:sorted(value)))`, root], {encoding: 'utf8'}));
const constants = file => literals[file];
export const fixturePortals = constants('src/sources/visits_portals.py').PORTALS;
const places = {best_places: ['zurich'], anywhere_in: ['switzerland'], cities_abroad: [], remote_jobs: 'yes', remote_limited_to_regions_they_cannot_work_from: []};
const search = {role_words: ['site reliability'], words_ruled_out: ['intern'], level: 'senior'};
const truth = JSON.parse(fs.readFileSync(new URL('../fixtures/golden/truth.json', import.meta.url)));
const posting = truth[0], company = 'E2E Quality Labs';
const spec = (name, operation, system, schema, user, reply, options = {}) => ({name, operation, system, schema, user, reply, ...options});
const fields = constants('src/ai/enrich.py').SCHEMA.properties;
const emptyValue = schema => schema.enum ? schema.enum[0] : schema.type === 'string' ? '' : schema.type === 'boolean' ? false : schema.type === 'array' ? [] : schema.type === 'object' ? Object.fromEntries(Object.entries(schema.properties).map(([k,v]) => [k,emptyValue(v)])) : 0;
const enrichAnswer = Object.fromEntries(Object.entries(fields).map(([k,v]) => [k,emptyValue(v)]));
const narrow = names => ({type: 'object', additionalProperties: false, required: names, properties: Object.fromEntries(names.map(name => [name, fields[name]]))});
const postUser = `Title: ${posting.title}\nCompany: ${company}\nLocation: ${posting.location}\n\nPosting:\n${posting.description}`;
const p = constants('src/ai/place_triage.py'), t = constants('src/ai/title_triage.py'), g = constants('src/geo.py'), w = constants('src/places.py'), v = constants('src/sources/visits.py'), e = constants('src/ai/enrich.py');
export const engineCases = [
  spec('place', 'app.place', p.SYSTEM, p.SCHEMA, `Their places (JSON): ${JSON.stringify(places)}\nThe job locations:\n1. zurich`, {locations: [{n: 1, where: 'Zurich', country: 'Switzerland', nearest: 'zurich', km: 0, answer: 'best'}]}, {action: 'place_triage', first: 'zurich'}),
  spec('decide', 'app.decide', 'You decide what short pieces of content mean, in any language, for a job-search tool.', {type: 'object', additionalProperties: false, required: ['results'], properties: {results: {type: 'array', items: {type: 'object', additionalProperties: false, required: ['index','answer'], properties: {index: {type:'integer'}, answer: {type:'string', enum:['yes','no']}}}}}}, 'Task: Is this a place?\nAllowed answers: yes, no\n\n### Item 0\nZurich', {results: [{index: 0, answer: 'yes'}]}, {action: 'decide', first: 'Zurich'}),
  spec('score', 'app.score', 'You rank job postings for one candidate. The candidate profile follows.', {}, postUser, {score: 82}, {action: 'score', first: '3001'}),
  spec('places', 'app.places', w.SYSTEM, w.SCHEMA, 'Place words (JSON): ["Zürich", "Paris"]', {places: [{word: 'Zürich', countries: ['Switzerland'], kind: 'city', names: ['Zurich']}, {word: 'Paris', countries: ['France'], kind: 'city', names: []}]}, {action: 'scout', shared: true, first: 'zurich'}),
  spec('geo', 'app.geo', g.SYSTEM, g.SCHEMA, 'Strings:\n1. zurich, switzerland\n2. remote', {places: [{n: 1, kind: 'city', cc: 'CH', lat: 47.37, lon: 8.54, r_km: 15}, {n: 2, kind: 'remote', cc: '', lat: 0, lon: 0, r_km: 0}]}, {action: 'place_triage', shared: true, first: 'zurich, switzerland'}),
  spec('title', 'app.title', t.SYSTEM, t.SCHEMA, `The search (JSON): ${JSON.stringify(search)}\nThe titles:\n1. senior sre\n2. cashier`, {fit: [1]}, {action: 'title_triage', first: 'senior sre'}),
  spec('title recheck', 'app.title', t.RECHECK_SYSTEM, t.SCHEMA, `The search (JSON): ${JSON.stringify(search)}\nThe titles:\n1. senior sre\n2. cashier`, {fit: []}, {action: 'title_triage', first: 'senior sre'}),
  spec('enrich', 'app.enrich', e.SYSTEM, e.SCHEMA, postUser, enrichAnswer, {action: 'enrich', first: posting.title}),
  spec('enrich retry', 'app.enrich', e.SYSTEM, narrow(['seniority', 'technologies']), postUser + '\n\nYour last answer left seniority, technologies empty. Read the posting again.', {seniority: enrichAnswer.seniority, technologies: []}, {action: 'enrich', first: posting.title}),
  spec('enrich role', 'app.enrich', e.ROLE_SYSTEM, narrow(['role_family']), postUser, {role_family: 'sre'}, {action: 'enrich', first: posting.title}),
  spec('visit', 'app.visit', `${v.RELEVANT_SYSTEM} ${v.RELEVANT_UNSURE.keep}`, v.RELEVANT_SCHEMA, 'Their roles: ["site reliability"]\nTheir places: ["zurich"]\nThe sites:\n1. E2E Quality Labs (https://boards.e2e.test) [employer] found in: fixture list\n2. E2E Other (https://other.e2e.test) [portal]', {keep: [1]}, {action: 'visit_relevant', first: 'E2E Quality Labs'}),
  spec('visa', 'app.visa', p.VISA_SYSTEM, p.VISA_SCHEMA, 'Their work rights: ["Swiss citizenship"]\nCountries: ["Switzerland", "France"]', {visa: ['France']}, {action: 'place_triage', first: 'Switzerland'}),
  spec('vague', 'app.placeVague', p.VAGUE_SYSTEM, p.VAGUE_SCHEMA, `Their places (JSON): ${JSON.stringify({best_places: places.best_places, anywhere_in: places.anywhere_in, cities_abroad: []})}\nThe job locations:\n1. switzerland\n2. zurich`, {vague: [1]}, {action: 'place_vague', first: 'switzerland'}),
  spec('reading', 'app.placeReading', p.READ_SYSTEM, p.READ_SCHEMA, `Their places (JSON): ${JSON.stringify(places)}\nThe postings:\n1. Title: ${posting.title}\nLocation field: Switzerland\nText: Work at the Zurich site.\n\n2. Title: Another job\nLocation field: Switzerland\nText: Location not stated.`, {jobs: [{n: 1, where: 'Zurich', nearest: 'zurich', km: 0, answer: 'best'}, {n: 2, where: '', nearest: 'none', km: -1, answer: 'unclear'}]}, {action: 'place_reading', first: posting.title}),
];

/** Rebuild every source-derived SRE portal context with the real relevance prompt's numbered-site layout. */
export function goldenPortalCases() {
  const setup = withDerived(JSON.parse(fs.readFileSync(new URL('../../demo/draft.json', import.meta.url))).draft.search);
  const roles = ['sre', 'site reliability', 'platform engineer', 'infrastructure engineer', 'devops engineer'];
  // Why (30 Oct 2026, qu): the seed, the literal quality reset, and art6's captured post-reset search have distinct identities; batch order/subsets do not.
  const contexts = [
    {name: 'captured golden', roles, places: ['zurich', 'geneva', 'basel', 'bern'], role: 'sre', place: 'zurich'},
    {name: 'quality reset', roles, places: ['zurich', 'geneva', 'switzerland', 'basel', 'bern'], role: 'sre', place: 'zurich'},
    {name: 'setup', roles: setup.role_keywords, places: ['zürich', 'switzerland', 'schweiz'], role: setup.role_keywords[0], place: 'zürich'},
  ];
  return contexts.map(context => {
    const sites = Object.values(fixturePortals).map(portal => ({name: portal.name, kind: 'portal',
      url: portal.url.replace('{role}', encodeURIComponent(context.role)).replace('{place}', encodeURIComponent(context.place)).replace('{indeed}', 'ch.indeed.com')}));
    const listed = sites.map((site, index) => `${index + 1}. ${site.name} (${site.url}) [${site.kind}]`).join('\n');
    return {...engineCases.find(c => c.name === 'visit'), name: context.name, sites,
      user: `Their roles: ${JSON.stringify(context.roles)}\nTheir places: ${JSON.stringify(context.places)}\nThe sites:\n${listed}`};
  });
}

/** Build a fixture request in the requested provider's wire format. */
export function bodyOf(c, shape = 'anthropic') {
  return shape === 'anthropic' ? {model: 'test', system: [{type: 'text', text: c.system}], messages: [{role: 'user', content: c.user}], output_config: {format: {type: 'json_schema', schema: structuredClone(c.schema)}}} :
    {model: 'test', instructions: c.system, input: [{role: 'user', content: [{type: 'input_text', text: c.user}]}], text: {format: {type: 'json_schema', schema: structuredClone(c.schema)}}};
}
/** Attach the engine action header to a fixture request body. */
export const askOf = (c, body = bodyOf(c)) => ({headers: {'x-jp-action': c.action}, body});
/** Write an isolated answer table and remove its temporary folder after the test. */
export function tempTable(t, items = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'engine-answers-')), file = path.join(dir, 'table.json');
  fs.writeFileSync(file, JSON.stringify({v: 1, answers: {}, items}));
  t.after(() => fs.rmSync(dir, {recursive: true, force: true}));
  return {dir, file, env: {E2E_AI_ANSWERS: 'backbone', E2E_AI_ANSWERS_FILE: file, E2E_ARTIFACTS: dir, E2E_AI_CACHE: dir, E2E_AI_CANDIDATES: dir, E2E_QUALITY_PERSONA: '', E2E_AI_PROVIDER: 'claude', E2E_JUDGE_FAMILY: 'claude', E2E_AI_REPLAY: '0'}};
}
/** Record a fixture reply and load its candidate items for replay assertions. */
export function recorded(t, c, env = {}) {
  const {dir} = tempTable(t), q = questionOf(askOf(c), env);
  assert.equal(q.operation, c.operation);
  recordCandidate(dir, q, message(JSON.stringify(c.reply)));
  const items = {}, answers = {};
  for (const name of fs.readdirSync(dir).filter(name => name.startsWith('ai-answers-'))) {
    const table = loadTable(path.join(dir, name));
    for (const [operation, rows] of Object.entries(table.answers)) Object.assign(answers[operation] ??= {}, rows);
    for (const [operation, rows] of Object.entries(table.items || {})) Object.assign(items[operation] ??= {}, rows);
  }
  return {q, items, table: {v: 1, answers, items}};
}
// Why (30 Oct 2026, qu): split fixture construction by shape while preserving the original requests and expected replies.
/** Build reordered numbered batches without changing their original markers or expected answers. */
function reorderedNumberedCase(c) {
  let user, expected, subsetUser, subsetExpected;
  const marker = c.name === 'reading' ? '\nThe postings:\n' : c.name === 'geo' ? 'Strings:\n' : c.name.startsWith('title') ? '\nThe titles:\n' : c.name === 'visit' ? '\nThe sites:\n' : '\nThe job locations:\n';
  const start = c.user.indexOf(marker) + marker.length, prefix = c.user.slice(0, start), delimiter = c.name === 'reading' ? '\n\n' : '\n';
  const blocks = c.user.slice(start).split(delimiter).map(line => line.replace(/^\d+\. /, ''));
  user = prefix + [`1. ${blocks[1]}`, `2. ${blocks[0]}`].join(delimiter);
  subsetUser = prefix + `1. ${blocks[1]}`;
  const root = Object.keys(c.reply)[0], values = c.reply[root];
  if (['geo', 'reading'].includes(c.name)) {
    expected = {[root]: [{...values[1], n: 1}, {...values[0], n: 2}]}; subsetExpected = {[root]: [{...values[1], n: 1}]};
  } else { expected = {[root]: values.length ? [2] : []}; subsetExpected = {[root]: []}; }
  return {user, expected, subsetUser, subsetExpected};
}

/** Build the same reordered and subset requests and replies for a fixture family. */
function reorderedCase(c) {
  let user, expected, subsetUser, subsetExpected;
  if (c.name === 'places') {
    user = 'Place words (JSON): ["Paris", "Zurich"]';
    expected = {places: [{...c.reply.places[1]}, {...c.reply.places[0], word: 'Zurich'}]};
    subsetUser = 'Place words (JSON): ["PARIS"]'; subsetExpected = {places: [{...c.reply.places[1], word: 'PARIS'}]};
  } else if (c.name === 'visa') {
    user = c.user.replace('["Switzerland", "France"]', '["France", "Switzerland"]'); expected = {visa: ['France']};
    subsetUser = c.user.replace('["Switzerland", "France"]', '["Switzerland"]'); subsetExpected = {visa: []};
  } else return reorderedNumberedCase(c);
  return {user, expected, subsetUser, subsetExpected};
}

/** Define observable replay, isolation, validation and recording checks for one engine family. */
export function familyTests(names) {
  for (const c of engineCases.filter(c => names.includes(c.name))) {
    test(`${c.name}: source-shaped request works with its header, no header and translated Responses`, () => {
      const q = questionOf(askOf(c), {}); assert.equal(q.operation, c.operation);
      for (const shape of ['anthropic', 'openai']) assert.deepEqual(questionOf({body: bodyOf(c, shape)}, {}), q);
      const changed = bodyOf(c); changed.model = 'different'; changed.system[0].text += ' More guidance.';
      assert.deepEqual(questionOf({body: changed}, {}), q);
      const bad = bodyOf(c); bad.output_config.format.schema = {type: 'string'};
      assert.ok(questionOf(askOf(c, bad), {}).unkeyable);
    });
    test(`${c.name}: records complete rows, validates the table and composes the engine reply`, t => {
      const {q, table, items} = recorded(t, c);
      assert.equal(Object.keys(items[c.operation]).length, q.items.length);
      assert.deepEqual(JSON.parse(answerFor(q, table).reply.content[0].text), c.reply);
      const {file} = tempTable(t, items);
      assert.deepEqual(loadTable(file).items, items);
      const entry = Object.values(items[c.operation])[0]; entry.answer = null;
      fs.writeFileSync(file, JSON.stringify({v: 1, answers: {}, items}));
      assert.throws(() => loadTable(file), /AI answers/);
      assert.match(answerFor(q, table).missing, new RegExp(c.operation));
    });
    test(`${c.name}: partial or invalid provider replies keep no candidates`, t => {
      const {dir} = tempTable(t), q = questionOf(askOf(c), {});
      for (const value of [{}, {...c.reply, unexpected: true}]) recordCandidate(dir, q, message(JSON.stringify(value)));
      const bad = structuredClone(c.reply), root = Object.keys(bad)[0];
      if (Array.isArray(bad[root])) {
        if (bad[root].length && typeof bad[root][0] === 'object') bad[root].pop();
        else bad[root].push(c.name === 'visa' ? 'Unknown country' : 999);
      } else bad[root] = null;
      recordCandidate(dir, q, message(JSON.stringify(bad)));
      if (Array.isArray(c.reply[root]) && c.reply[root].length === 2 && typeof c.reply[root][0] === 'object') {
        const duplicate = structuredClone(c.reply); duplicate[root][1] = {...duplicate[root][0]};
        recordCandidate(dir, q, message(JSON.stringify(duplicate)));
      }
      recordCandidate(dir, q, {...message(JSON.stringify(c.reply)), stop_reason: 'max_tokens'});
      assert.deepEqual(fs.readdirSync(dir).filter(name => name.startsWith('ai-answers-')), []);
    });
    if (c.name !== 'enrich' && !c.name.startsWith('enrich ')) test(`${c.name}: reorder and subset reuse rows while current numbering is rebuilt`, t => {
      const {table} = recorded(t, c);
      const {user, expected, subsetUser, subsetExpected} = reorderedCase(c);
      for (const [text, value] of [[user, expected], [subsetUser, subsetExpected]]) {
        const q = questionOf(askOf(c, bodyOf({...c, user: text})), {});
        assert.deepEqual(JSON.parse(answerFor(q, table).reply.content[0].text), value);
      }
    });
    test(`${c.name}: persona isolation follows whether the question contains personal context`, t => {
      const {q, table} = recorded(t, c), other = questionOf(askOf(c), {E2E_QUALITY_PERSONA: 'photographer'});
      if (c.shared) assert.deepEqual(other, q);
      else if (other.unkeyable) assert.match(other.unkeyable, /app.enrich: posting/);
      else { assert.notDeepEqual(other.items.map(i => i.key), q.items.map(i => i.key)); assert.ok(answerFor(other, table).missing); }
    });
  }
}

/** Check that changed semantic context cannot reuse a fixture's recorded answers. */
export function contextCase(name, change) {
  const c = engineCases.find(c => c.name === name);
  test(`${name}: semantic context changes cannot reuse earlier rows`, t => {
    const {q, table} = recorded(t, c), body = bodyOf(c); change(body);
    const changed = questionOf(askOf(c, body), {});
    assert.equal(changed.operation, c.operation);
    assert.notDeepEqual(changed.items.map(item => item.key), q.items.map(item => item.key));
    assert.ok(answerFor(changed, table).missing);
  });
}
