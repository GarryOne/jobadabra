// Conflicting fictional saved notice periods stay proposed in any language; the French quality case must not force one saved fact into the form.
import assert from 'node:assert/strict';
import {test} from 'node:test';
import fs from 'node:fs';
import {realForms, formCases} from '../../tools/free-ai-form-cases.mjs';
import {answerProblems} from '../../tools/free-ai-eval-metrics.mjs';

const french = () => realForms().find(form=>form.id === 'real-available-fr');

test('French availability retains its question/options and accepts only the two conflicting saved facts as proposals', () => {
  const form=french();
  assert.equal(form.fields[0].label,'Disponibilité');
  assert.deepEqual(form.fields[0].options,['Immédiate','Dans 1 mois','Dans 2 mois','Dans 3 mois','Plus de 3 mois']);
  const expect=form.expect;
  for (const value of ['Dans 2 mois','Dans 3 mois']) {
    assert.deepEqual(answerProblems({answers:[{field:'f1',value,use:'propose'}]},expect),[]);
    assert.notDeepEqual(answerProblems({answers:[{field:'f1',value,use:'fill'}]},expect),[],'never silently choose between conflicting facts');
    assert.notDeepEqual(answerProblems({answers:[{field:'f1',value}]},expect),[],'missing proposal authorization is not accepted');
  }
  for (const value of ['Dans 2 mois && Dans 3 mois', 'Dans 2 mois && Dans 2 mois']) assert.notDeepEqual(answerProblems({answers:[{field:'f1',value,use:'propose'}]},expect),[],'one select accepts exactly one offered choice');
  assert.notDeepEqual(answerProblems({answers:[{field:'f1',value:'Dans 1 mois',use:'propose'}]},expect),[],'an unsaved month stays wrong');
});

test('both saved facts reach the exact French prompt; no demo fact or model rule is altered for its answer', async () => {
  const profile=fs.readFileSync(new URL('../../desktop/demo/profile.md',import.meta.url),'utf8');
  const answers=fs.readFileSync(new URL('../../desktop/demo/answers.md',import.meta.url),'utf8');
  assert.match(profile,/Notice period: 2 months/);
  assert.match(answers,/Notice period \/ earliest start \| 3 months/);
  const [built]=await formCases({profile,answers,forms:[french()]});
  const request=JSON.stringify(built.params);
  assert.ok(request.includes('Notice period: 2 months'));
  assert.ok(request.includes('Notice period / earliest start | 3 months'));
  assert.equal(built.expect.f1.use,'propose');
});
