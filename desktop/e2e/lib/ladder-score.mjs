// Scores page-kind decisions against the ladder fixtures: each fixture's sketch goes through the REAL pageKind (desktop/lib/page-kind.js, the endpoint's sketchBody), with either the stored answer
// (offline: no model, what the push gate runs) or the real model on the plan path (live). Rates are per source, never one blended number. Used by: ladder-score.mjs, test/ladder-ratchet.test.js. Guard: test/ladder-score.test.js.
// Job: keep the scorecard
import {judgeAccount} from '../../lib/account-judge.js';
import {judgeForm} from '../../lib/form-judge.js';
import {judgeFill} from '../../lib/ladder/fill-verify.js';
import {askRepair} from '../../lib/ladder/fill-repair.js';
import {pageKind, sketchBody} from '../../lib/page-kind.js';
import {questionOf} from './ladder-fixtures.mjs';

export const RANK = {exact: 0, ok: 1, miss: 2, 'wrong-confident': 3, 'no-answer': 4};   // higher is worse (the ratchet compares these)
export const SURE = 0.8;   // an answer at or above this that is wrong is "confidently wrong"
export const SOURCE_GROUP = {recorded: 'real', captured: 'real', reconstructed: 'reconstructed', invented: 'invented'};

// A pageKind result as the one outcome word the ladder speaks in. An unsure or failed answer is 'unsure': today it goes DOWN to the structure rule (spec gap 1).
export function outcomeOf(result = {}) {
  if (result.error) return 'unsure';
  if (result.kind === 'form' || result.kind === 'account-form') return 'form';
  if (result.kind === 'account') return 'account';
  if (result.kind === 'closed') return 'closed';   // the posting is gone (any status): its own outcome, not 'other'
  if (result.kind === 'posting' && Number.isInteger(result.formFrame) && result.formFrame >= 0) return 'form_in_frame';   // the form sits in a listed frame of the posting (Datadog)
  if (result.kind === 'posting') return result.applyBy === 'email' ? 'email' : result.applyBy === 'other' ? 'other' : 'posting';
  return 'other';
}
// The rung that decides today: 0 the structure rule (no answer), 1 a kept answer, 2 the AI's text sketch.
export const rungOf = (result = {}) => (result.error ? 0 : result.by === 'remembered' ? 1 : 2);

export function statusOf(expect, outcome, confidence = 0) {
  if (outcome === expect.outcome) return 'exact';
  if ((expect.accept || []).includes(outcome)) return 'ok';
  return outcome !== 'unsure' && confidence >= SURE ? 'wrong-confident' : 'miss';
}

// A client that answers with a fixture's stored answer (the shape the Messages API gives), so the real pageKind runs unchanged.
const replayClient = answer => ({messages: {create: async () => ({stop_reason: 'end_turn', usage: {input_tokens: 0, output_tokens: 0, billing: 'subscription'}, content: [{type: 'text', text: JSON.stringify(answer)}]})}});

// -> rows [{id, source, lang, trap, expected, outcome, confidence, rung, status, answer}]. `clientFor(fixture)` gives a live client; without it the stored answers are replayed.
// One of the judges' questions (account ready / account result / form step), through the real judge with the stored answer or the live client.
// fill_repair answers per control: the fixture scores the verb of the one it names (expect.control); an option or layer button other than the expected one(s) is "wrong_option".
const repairOutcome = (repairs, expect) => {
  const row = repairs.find(one => one.n === expect.control);
  if (!row) return 'unsure';
  const options = [expect.option ?? []].flat();
  return ['choose_option', 'dismiss_layer'].includes(row.verb) && options.length && !options.includes(row.option) ? 'wrong_option' : row.verb;
};
// form_flags: the judge's login-wall / account-to-create flags as one word; a flag the judge left out is unknown, so the answer is unsure (apply triage read, lib/triage-read.js).
const flagsOutcome = r => (typeof r.loginWall !== 'boolean' || typeof r.accountCreation !== 'boolean' ? 'unsure' : r.loginWall ? 'login' : r.accountCreation ? 'account' : 'neither');
// The one outcome word a judge's answer scores as, per question. fill_verify answers per control: the fixture scores the one it names (expect.control); a control the answer skipped is "unsure".
const JUDGE_OUTCOMES = {
  fill_repair: (result, expect) => repairOutcome(result.repairs, expect),
  fill_verify: (result, expect) => result.verdicts.find(row => row.n === expect.control)?.verdict || 'unsure',
  form_step: result => result.step,
  form_flags: flagsOutcome,
};
const judgeOutcome = (question, result, expect) => (result.error ? 'unsure' : (JUDGE_OUTCOMES[question] || (answer => answer.answer))(result, expect));
async function scoreJudge(fixture, base, {clientFor, pending}) {
  const question = questionOf(fixture);
  if (!clientFor && !fixture.answer) return {...base, outcome: '', confidence: 0, rung: -1, route: '', digestOk: null, status: pending ? 'pending' : 'no-answer'};
  let captured = null;
  const client = clientFor ? clientFor(fixture) : replayClient(fixture.answer);
  const tee = {messages: {create: async body => { const response = await client.messages.create(body); try { captured = JSON.parse(response.content?.find(block => block.type === 'text')?.text || ''); } catch { /* the judge says so */ } return response; }}};
  const result = question === 'fill_repair' ? await askRepair(tee, fixture.sketch, fixture.misses) : question === 'fill_verify' ? await judgeFill(tee, fixture.sketch) : question.startsWith('form_') ? await judgeForm(tee, fixture.sketch) : await judgeAccount(tee, fixture.sketch, question === 'account_result' ? 'result' : 'ready');
  const outcome = judgeOutcome(question, result, fixture.expect);
  const confidence = Number(result.confidence ?? captured?.confidence) || 0;
  return {...base, outcome, confidence, rung: result.error ? 0 : question === 'fill_repair' ? 3 : 2, route: '', digestOk: null, status: pending ? 'pending' : statusOf(fixture.expect, outcome, confidence), note: fixture.note || '', answer: captured || fixture.answer || null};
}

export async function scoreFixtures(fixtures, {clientFor} = {}) {
  const rows = [];
  for (const fixture of fixtures) {
    if (questionOf(fixture) !== 'page_kind') { rows.push(await scoreJudge(fixture, {id: fixture.id, source: fixture.source, lang: fixture.lang, question: questionOf(fixture), trap: !!fixture.trap, expected: fixture.expect.outcome, accept: fixture.expect.accept || [fixture.expect.outcome], digest: '', wantRoute: ''}, {clientFor, pending: fixture.expect.outcome === 'pending'})); continue; }
    const base = {id: fixture.id, source: fixture.source, lang: fixture.lang, question: 'page_kind', trap: !!fixture.trap, expected: fixture.expect.outcome, accept: fixture.expect.accept || [fixture.expect.outcome], digest: fixture.expect.digest || '', wantRoute: fixture.expect.apply_route || ''};
    const pending = fixture.expect.outcome === 'pending';   // a captured candidate whose real outcome a person has not confirmed yet: shown, never scored
    if (!clientFor && !fixture.answer) { rows.push({...base, outcome: '', confidence: 0, rung: -1, route: '', digestOk: null, status: pending ? 'pending' : 'no-answer'}); continue; }
    let captured = null;
    const client = clientFor ? clientFor(fixture) : replayClient(fixture.answer);
    const tee = {messages: {create: async body => { const response = await client.messages.create(body); try { captured = JSON.parse(response.content?.find(block => block.type === 'text')?.text || ''); } catch { /* not JSON: pageKind says so */ } return response; }}};
    const result = await pageKind(tee, sketchBody(fixture.sketch), null);
    const outcome = outcomeOf(result), confidence = Number(result.confidence ?? captured?.confidence) || 0;
    // A start dialog (expect.digest / expect.apply_route): the digest is NOT needed when rung 2 names the manual route and its listed button; the route it names is checked too.
    const route = result.applyRoute || '', button = result.applyButton || '', {digest, apply_route: wantRoute} = fixture.expect;
    const needsNoDigest = outcome === 'posting' && route === 'manual' && !!button;
    const digestOk = !digest && !wantRoute ? null : (digest === 'not_asked' ? needsNoDigest : digest === 'asked' ? !needsNoDigest : true) && (!wantRoute || route === wantRoute);
    const status = pending ? 'pending' : statusOf(fixture.expect, outcome, confidence);
    rows.push({...base, outcome, confidence, rung: rungOf(result), route, button, digestOk, status: digestOk === false && (status === 'exact' || status === 'ok') ? 'miss' : status, note: fixture.note || '', answer: captured || fixture.answer || null});
  }
  return rows;
}

// Hit rates per source group and per rung; the wrong-and-confident list. Never one blended number: reconstructed and invented fixtures must not lift the real ones.
export function summarize(rows) {
  const bySource = {}, byRung = {}, byQuestion = {};
  const add = (bucket, key, row) => { const entry = bucket[key] ||= {total: 0, hits: 0, exact: 0}; entry.total++; if (row.status === 'exact' || row.status === 'ok') entry.hits++; if (row.status === 'exact') entry.exact++; };
  for (const row of rows.filter(row => row.status !== 'pending')) {
    const question = row.question || 'page_kind', group = SOURCE_GROUP[row.source] || row.source;
    add(byQuestion[question] ||= {}, group, row);
    if (question === 'page_kind') { add(bySource, group, row); add(byRung, `rung ${row.rung}`, row); }   // the page-kind question's own rates (the judges' are in byQuestion)
  }
  return {bySource, byRung, byQuestion, wrongConfident: rows.filter(row => row.status === 'wrong-confident'), noAnswer: rows.filter(row => row.status === 'no-answer'), pending: rows.filter(row => row.status === 'pending')};
}

// The live run is on the plan (Claude Code), never on an API key.
export function assertNoApiSpend({env = process.env, engine}) {
  if (env.ANTHROPIC_API_KEY) throw new Error('ladder-score: ANTHROPIC_API_KEY is set; unset it (the score runs on the plan, never on an API key)');
  if (env.CI) throw new Error('ladder-score: not in CI (a CI run would spend the test keys); the live score runs on a Mac, on the plan');
  if (engine !== 'cli') throw new Error(`ladder-score: the live score runs on Claude Code on the plan (engine cli), not "${engine}"`);
}
