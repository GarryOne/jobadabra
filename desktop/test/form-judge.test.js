// The AI's readiness judgment on an application form (lib/form-judge.js): fixed answers, a control only if the page lists it, no AI means no answer, no typed value is sent.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {test} from 'node:test';
import {judgeForm} from '../lib/form-judge.js';
import {decideAccountJudge} from '../lib/server-pages.js';

const page = {url: 'https://jobs.example.ch/apply/1?token=SECRET', title: 'Postuler', headings: ['Postuler'],
  controls: [{type: 'text', label: 'Prénom', required: true, state: 'filled', value: 'Ada'}, {type: 'select', label: 'Formule d\'appel', required: true, state: 'filled'}],
  buttons: ['Lire et accepter la déclaration de confidentialité', 'Envoyer'], texts: ['La déclaration est obligatoire'], frames: []};
const fake = (answer, seen = []) => ({messages: {create: async body => { seen.push(body); return {content: [{type: 'text', text: JSON.stringify(answer)}], stop_reason: 'end_turn'}; }}});

test('a consent that is a LINK is what the panel\'s count cannot see: the AI says needs_person and names it, from what the page lists', async () => {
  const seen = [];
  const got = await judgeForm(fake({answer: 'needs_person', needs: 'lire et accepter la déclaration de confidentialité', needs_kind: 'consent', confidence: 0.9}, seen), page);
  assert.deepEqual([got.answer, got.needs, got.needsKind], ['needs_person', 'Lire et accepter la déclaration de confidentialité', 'consent']);
  const sent = JSON.stringify(seen[0]);
  assert.ok(!sent.includes('Ada') && !sent.includes('SECRET'), 'no typed value and no query string reach the model');
  assert.ok(sent.includes('La déclaration est obligatoire'));
});

test('ready is ready; a control the page does not list is dropped; an answer outside the fixed ones, or no AI, is an error', async () => {
  assert.equal((await judgeForm(fake({answer: 'ready', needs: '', needs_kind: '', confidence: 0.9}), page)).answer, 'ready');
  assert.equal((await judgeForm(fake({answer: 'needs_person', needs: 'Made-up control', needs_kind: 'field', confidence: 0.9}), page)).needs, '');
  assert.equal((await judgeForm(fake({answer: 'created', needs: '', needs_kind: '', confidence: 0.9}), page)).error, 'not an answer');
  assert.equal((await judgeForm(null, page)).error, 'no AI');
});

test('the route answers phase "form" with the form judge, never the account one', async () => {
  const calls = [];
  const answer = await decideAccountJudge({}, {phase: 'form', sketch: page}, {client: fake({answer: 'needs_person', needs: 'Envoyer', needs_kind: 'other', confidence: 0.8}, calls)});
  assert.deepEqual([answer.ok, answer.answer, answer.needs], [true, 'needs_person', 'Envoyer']);
  assert.ok(JSON.stringify(calls[0]).includes('JOB APPLICATION form'));
});

// Multi-step forms (owner, 8 Oct 2026: approved): the AI names the control that goes on to the next step, for this page state only.
const steps = {...page, buttons: ['Retour', 'Continuer', 'Envoyer']};
test('a middle step keeps the next control the page lists; a final step, an invented control or a field label never', async () => {
  const ask = answer => judgeForm(fake({answer: 'ready', needs: '', needs_kind: '', confidence: 0.9, ...answer}), steps);
  assert.deepEqual(await ask({step: 'middle', next_control: 'continuer'}).then(a => [a.step, a.nextControl]), ['middle', 'Continuer']);   // the page's own wording
  assert.equal((await ask({step: 'final', next_control: 'Envoyer'})).nextControl, '');
  assert.equal((await ask({step: 'middle', next_control: 'Next step'})).nextControl, '');       // not on the page
  assert.equal((await ask({step: 'middle', next_control: 'Prénom'})).nextControl, '');          // a field, not a button
  assert.equal((await ask({step: 'maybe', next_control: 'Continuer'})).step, 'unsure');
});

test('a ready final step names the page\'s own sending button; any other answer, an invented button or a field label never does', async () => {
  const ask = answer => judgeForm(fake({answer: 'ready', needs: '', needs_kind: '', confidence: 0.9, ...answer}), steps);
  assert.equal((await ask({step: 'final', submit_control: 'envoyer'})).submitControl, 'Envoyer');   // the page's own wording
  assert.equal((await ask({step: 'middle', submit_control: 'Envoyer'})).submitControl, '');
  assert.equal((await ask({answer: 'needs_person', step: 'final', submit_control: 'Envoyer'})).submitControl, '');
  assert.equal((await ask({step: 'final', submit_control: 'Submit application'})).submitControl, '');   // not on the page
  assert.equal((await ask({step: 'final', submit_control: 'Prénom'})).submitControl, '');              // a field, not a button
  assert.equal((await ask({step: 'final'})).submitControl, '');                                         // a stored answer without it
  const seen = [];
  await judgeForm(fake({answer: 'ready', step: 'final', submit_control: 'Envoyer', confidence: 0.9}, seen), steps);
  assert.ok(seen[0].output_config.format.schema.required.includes('submit_control'));
  assert.match(seen[0].system, /submit_control/);
});

test('the route passes a middle step\'s control on and has no mode: there is no setting to say otherwise', async () => {
  const client = fake({answer: 'ready', needs: '', needs_kind: '', confidence: 0.9, step: 'middle', next_control: 'Continuer'});
  const answer = await decideAccountJudge({settings: () => ({})}, {phase: 'form', sketch: steps}, {client});
  assert.deepEqual([answer.nextControl, answer.step, 'nextMode' in answer], ['Continuer', 'middle', false]);
});

test('alternatives (Upload CV / Copy and paste CV / LinkedIn) are one need, and a middle step is judged on its own: the rule is in the AI\'s instructions', async () => {
  const seen = [];
  await judgeForm(fake({answer: 'ready', needs: '', needs_kind: '', confidence: 0.9, step: 'middle', next_control: 'Continue'}, seen), {...steps});
  assert.match(seen[0].system, /alternatives/);
  assert.match(seen[0].system, /judge only what THIS step needs/);
});

test('under the e2e capture the form judge\'s ask is kept for the replay to compare with: the sketch, scrubbed (no typed value, no query), and the fixed answer', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'jp-judge-capture-')), before = process.env.LIVE_CAPTURE_DIR;
  process.env.LIVE_CAPTURE_DIR = dir;
  try {
    await decideAccountJudge({}, {phase: 'form', sketch: page}, {client: fake({answer: 'needs_person', needs: 'Envoyer', needs_kind: 'other', confidence: 0.8})});
  } finally { if (before === undefined) delete process.env.LIVE_CAPTURE_DIR; else process.env.LIVE_CAPTURE_DIR = before; }
  const [call] = JSON.parse(fs.readFileSync(path.join(dir, 'ai-calls.json'), 'utf8'));
  assert.equal(call.route, '/extension/account-judge');
  assert.equal(call.request.phase, 'form');
  assert.deepEqual(call.request.sketch.controls.map(item => [item.label, item.state]), [['Prénom', 'filled'], ['Formule d\'appel', 'filled']], 'the control states are what the replay must restore');
  const text = JSON.stringify(call);
  assert.ok(!text.includes('Ada') && !text.includes('SECRET'), 'no typed value, no query');
  assert.equal(call.answer.answer, 'needs_person');
});

// After the fill (11 Oct 2026, a site dialog "your filled fields may be replaced, continue?" sat over the form and the judge said needs_person about a field behind it):
// a fourth fixed answer, blocked, with a kind the code validates; the page's own layers and covered controls are structure the AI is shown.
const covered = {...page, onTop: {shape: 'dialog', role: 'dialog', text: 'Vos champs peuvent être remplacés. Continuer ?', buttons: ['Annuler', 'Continuer']}};
test('blocked: a dialog over the form is its own answer, with a kind from the fixed list (anything else is "overlay"), never a needed control', async () => {
  const seen = [];
  const got = await judgeForm(fake({answer: 'blocked', blocked_kind: 'dialog', needs: 'Prénom', needs_kind: 'field', confidence: 0.9}, seen), covered);
  assert.deepEqual([got.answer, got.blockedKind, got.needs], ['blocked', 'dialog', '']);
  assert.equal((await judgeForm(fake({answer: 'blocked', blocked_kind: 'banner words', confidence: 0.9}), covered)).blockedKind, 'overlay');
  for (const kind of ['dialog', 'error', 'overlay', 'gone']) assert.equal((await judgeForm(fake({answer: 'blocked', blocked_kind: kind, confidence: 0.8}), covered)).blockedKind, kind);
  assert.equal((await judgeForm(fake({answer: 'ready', blocked_kind: 'dialog', confidence: 0.8}), page)).blockedKind, '', 'a kind only goes with blocked');
  const sent = JSON.stringify(seen[0]);
  assert.ok(sent.includes('Vos champs peuvent être remplacés') && sent.includes('ON TOP of the form'), 'the page\'s layers and covered controls reach the model');
  assert.match(seen[0].system, /blocked/);
});

test('a page with no layer and no covered control sends neither line', async () => {
  const seen = [];
  await judgeForm(fake({answer: 'ready', needs: '', needs_kind: '', confidence: 0.9}, seen), page);
  assert.ok(!JSON.stringify(seen[0].messages).includes('ON TOP') && !JSON.stringify(seen[0].messages).includes('ON TOP'));
});

test('the route passes blocked and its kind on', async () => {
  const answer = await decideAccountJudge({}, {phase: 'form', sketch: covered}, {client: fake({answer: 'blocked', blocked_kind: 'dialog', needs: '', needs_kind: '', confidence: 0.9})});
  assert.deepEqual([answer.answer, answer.blockedKind], ['blocked', 'dialog']);
});
