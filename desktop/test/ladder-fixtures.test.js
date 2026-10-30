// Guards the ladder fixture set (desktop/e2e/ladder-fixtures): its shape, its coverage of the pool's shapes, languages and traps, and that it holds no personal data.
import {REASONS as FILL_REASONS, VERDICTS as FILL_VERDICTS, schema as fillSchema} from '../lib/ladder/fill-verify.js';
import {VERBS as REPAIR_VERBS, WIDGETS as REPAIR_WIDGETS, schema as repairSchema} from '../lib/ladder/fill-repair.js';
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {CONFIRMED_BY, EXPECT_FIELDS, FIELDS, JUDGE_SKETCH_FIELDS, LANGS, MOVE_VERBS, OUTCOMES_BY_QUESTION, QUESTIONS, SCHEMA_VERSION, SOURCES, loadFixtures, questionOf} from '../e2e/lib/ladder-fixtures.mjs';
import {SKETCH_FIELDS} from '../lib/page-kind.js';
import {KINDS, SCHEMA} from '../lib/ladder/rung2-sketch.js';
import {schema as accountSchema, READY, RESULT} from '../lib/account-judge.js';
import {schema as formSchema} from '../lib/form-judge.js';

const fixtures = loadFixtures();
const EMAIL = /[\w.+-]+@[\w-]+(\.[\w-]+)+/g, PHONE = /(\+\d[\d\s().-]{8,}\d)|(\b0\d{2}[\s.]\d{3}[\s.]\d{2}[\s.]\d{2}\b)/;
const POOL = ['hornbach', 'aldi', 'datadog', 'fidag', 'jobs-ch-apply-not-found', 'cloudera-workday', 'auterion', 'formlabs', 'hm', 'coreweave', 'nebius', 'databricks', 'ashby', 'greenhouse', 'lever'];

test('every fixture has its sketch, an expected outcome and a source', () => {
  assert.ok(fixtures.length >= 30, `only ${fixtures.length} fixtures`);
  const ids = new Set();
  for (const f of fixtures) {
    assert.equal(f.schemaVersion, SCHEMA_VERSION, `${f.id}: schemaVersion`);
    for (const key of Object.keys(f)) assert.ok(FIELDS.includes(key), `${f.id}: field ${key} is not declared in FIELDS (e2e/lib/ladder-fixtures.mjs)`);
    assert.equal(f.file, `${f.id}.json`, `${f.file}: id must match the file name`);
    assert.ok(!ids.has(f.id), `${f.id} twice`); ids.add(f.id);
    assert.ok(SOURCES.includes(f.source), `${f.id}: source ${f.source}`);
    for (const key of Object.keys(f.expect || {})) assert.ok(EXPECT_FIELDS.includes(key), `${f.id}: expect field ${key} is not declared in EXPECT_FIELDS`);
    assert.ok(['asked', 'not_asked', undefined].includes(f.expect?.digest), `${f.id}: expect.digest`);
    assert.ok(['manual', 'reuse_previous', 'third_party_account', undefined].includes(f.expect?.apply_route), `${f.id}: expect.apply_route`);
    assert.ok(QUESTIONS.includes(questionOf(f)), `${f.id}: question ${f.question}`);
    assert.ok(OUTCOMES_BY_QUESTION[questionOf(f)].includes(f.expect?.outcome) || f.expect?.outcome === 'pending', `${f.id}: expected outcome ${f.expect?.outcome}`);
    assert.ok(f.expect.outcome !== 'pending' || (f.source === 'captured' && f.note), `${f.id}: a pending fixture is a captured candidate with a note`);
    for (const word of f.expect.accept || []) assert.ok(OUTCOMES_BY_QUESTION[questionOf(f)].includes(word), `${f.id}: accept ${word}`);
    assert.ok(!f.expect.accept || f.expect.outcome === 'pending' || f.expect.accept.includes(f.expect.outcome), `${f.id}: accept must include the expected outcome`);
    assert.ok(f.sketch && typeof f.sketch.url === 'string', `${f.id}: sketch.url`);
    for (const key of Object.keys(f.sketch)) assert.ok(['url', ...(questionOf(f) === 'page_kind' ? SKETCH_FIELDS : JUDGE_SKETCH_FIELDS)].includes(key), `${f.id}: sketch field ${key} is not in its question's field list`);
    if (questionOf(f) !== 'page_kind') for (const control of f.sketch.controls) assert.ok(!('value' in control) && !('at' in control), `${f.id}: a judge control carries only type, label, required, state, options`);
    assert.ok(typeof f.why === 'string' && f.why.length > 10, `${f.id}: say why it is in the set`);
  }
});

// Box 7 of spec 2026-10-12-one-next-move.md: a label comes only from a confirmed outcome (e2e/ladder-label-moves.mjs), never by hand or by a model.
test('an expected move is a confirmed one: its verb, the fixture\'s own candidates, and the run that confirmed it', () => {
  for (const f of fixtures) {
    const {verb, candidates, confirmed} = f.expect;
    if (verb === undefined && candidates === undefined && confirmed === undefined) continue;
    assert.ok(MOVE_VERBS.includes(verb), `${f.id}: expect.verb ${verb} is not one of ${MOVE_VERBS.join('|')}`);
    assert.ok(Array.isArray(candidates) && (verb === 'not_listed' ? candidates.length === 0 : candidates.length) && candidates.every(n => (f.candidates || []).some(item => item.n === n)), `${f.id}: expect.candidates must be numbers of its own candidates (none for not_listed)`);
    assert.ok(CONFIRMED_BY.includes(confirmed?.by) && typeof confirmed.run === 'string' && confirmed.run.length > 3, `${f.id}: expect.confirmed {by: ${CONFIRMED_BY.join('|')}, run} names what confirmed the move`);
  }
  assert.ok(fixtures.filter(f => f.expect.verb).length >= 10, 'the confirmed moves stay in the set');
});

test('the pool\'s shapes are all in the set, and the four languages, with traps', () => {
  const have = new Set(fixtures.map(f => f.id));
  for (const shape of POOL) assert.ok([...have].some(id => id.startsWith(shape)), `no fixture for pool shape ${shape}`);
  for (const lang of LANGS) assert.ok(fixtures.filter(f => f.source === 'invented' && f.lang === lang).length >= 2, `fewer than 2 invented postings in ${lang}`);
  assert.ok(fixtures.filter(f => f.source === 'recorded').length >= 8, 'the recorded cases of desktop/e2e/recorded are missing');
  assert.ok(fixtures.filter(f => f.expect.digest).length >= 10, 'need the start dialogs (digest not asked)');
  assert.ok(fixtures.filter(f => f.id.startsWith('pool-')).length >= 30, 'the real pool shapes were grown');
  assert.ok(fixtures.filter(f => f.trap).length >= 2, 'need the confidently-wrong traps');
  for (const kind of ['email', 'phone', 'closed', 'in_person']) assert.ok(fixtures.some(f => f.expect.outcome === kind), `no ${kind} posting`);
});

test('a stored answer is a fixed-values object the page-kind schema knows, and nothing but the sketch is page text', () => {
  for (const f of fixtures) {
    if (!f.answer) continue;
    if (questionOf(f) === 'fill_repair') {   // per-control repairs (lib/ladder/fill-repair.js): only the schema's fields, closed widgets and verbs, an option number; its input is the fill check's misses
      assert.ok(Array.isArray(f.misses) && f.misses.length && f.misses.every(miss => Number.isInteger(miss.n) && ['empty', 'wrong', 'unreachable'].includes(miss.verdict) && FILL_REASONS.includes(miss.reason)), `${f.id}: misses`);
      assert.ok(Array.isArray(f.answer.repairs) && Object.keys(f.answer).every(key => Object.keys(repairSchema.properties).includes(key)), `${f.id}: a repair answer is its repairs`);
      for (const row of f.answer.repairs) assert.ok(Number.isInteger(row.n) && REPAIR_VERBS.includes(row.verb) && REPAIR_WIDGETS.includes(row.widget) && Number.isInteger(row.option), `${f.id}: repair ${row.n}`);
      continue;
    }
    if (questionOf(f) === 'fill_verify') {   // per-control verdicts (lib/ladder/fill-verify.js): only the schema's fields, fixed verdicts and reasons
      assert.ok(Array.isArray(f.answer.controls) && Object.keys(f.answer).every(key => Object.keys(fillSchema.properties).includes(key)), `${f.id}: a fill check answer is its controls`);
      for (const row of f.answer.controls) assert.ok(Number.isInteger(row.n) && FILL_VERDICTS.includes(row.verdict) && FILL_REASONS.includes(row.reason), `${f.id}: control ${row.n}`);
      continue;
    }
    if (questionOf(f) === 'page_kind') assert.ok(KINDS.includes(f.answer.kind), `${f.id}: answer kind`);
    else assert.ok(f.answer.answer !== undefined, `${f.id}: a judge answer has an answer`);
    assert.equal(typeof f.answer.confidence, 'number', `${f.id}: answer confidence`);
    const allowedAnswer = {page_kind: SCHEMA, account_ready: accountSchema(READY), account_result: accountSchema(RESULT), form_step: formSchema, form_ready: formSchema, form_flags: formSchema}[questionOf(f)];
    for (const key of Object.keys(f.answer)) assert.ok(Object.keys(allowedAnswer.properties).includes(key), `${f.id}: answer field ${key} is not in rung 2's SCHEMA`);   // the schema is the one list
  }
});

test('the judges are questions of rung 2: real and invented pages, the four languages, traps, per question', () => {
  const of = question => fixtures.filter(f => questionOf(f) === question);
  for (const question of ['account_ready', 'account_result', 'form_step']) {
    assert.ok(of(question).length >= 8, `${question}: only ${of(question).length} fixtures`);
    for (const lang of LANGS) assert.ok(of(question).filter(f => f.source === 'invented' && f.lang === lang).length >= 1, `${question}: no invented fixture in ${lang}`);
  }
  assert.ok(of('form_step').filter(f => ['recorded', 'captured'].includes(f.source)).length >= 6, 'form_step needs real pages (recorded and read from the pool)');
  assert.ok(of('account_ready').some(f => f.source === 'recorded'), 'account_ready needs a recorded page');
  for (const question of ['account_ready', 'form_step']) assert.ok(of(question).some(f => f.trap), `${question}: no confidently-wrong trap`);
  for (const outcome of ['needs_code', 'created', 'created_confirm', 'already_exists', 'refused', 'unsure']) assert.ok(of('account_result').some(f => f.expect.outcome === outcome), `account_result: no ${outcome}`);
  for (const f of of('account_result')) assert.ok(f.sketch.fromPath !== undefined && f.sketch.sameForm !== undefined, `${f.id}: a result fixture knows the path before the press and whether the form is the same`);
});

test('no personal data: only example.* emails, no phone number, no URL query string, no typed value', () => {
  const found = [];
  for (const f of fixtures) {
    const {capture, ...held} = f;   // a capture address may carry a public job id (gh_jid=…, board=…), never a token
    if (/[?&](token|key|secret|auth|session|email|code|sig)\w*=/i.test(capture?.url || '')) found.push(`${f.id}: a secret-looking capture URL query`);
    const text = JSON.stringify(held);
    for (const email of text.match(EMAIL) || []) if (!/@example\.(com|org|net|ch)$/i.test(email)) found.push(`${f.id}: an email`);
    if (PHONE.test(text)) found.push(`${f.id}: a phone number`);
    if (/https?:\/\/[^"'\s]+\?[^"'\s]+/i.test(text)) found.push(`${f.id}: a URL query string`);
    if (Array.isArray(f.sketch.controls) && f.sketch.controls.some(c => 'value' in c)) found.push(`${f.id}: a typed value`);
  }
  assert.deepEqual(found, []);
});
