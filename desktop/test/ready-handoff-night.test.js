// Ready to send's Open in Chrome replays the night (owner, 18 Oct 2026: "It should be all cached, every read and filled... instant"; sketch option A): the app keeps the
// night's page role and AI answers for that page (lib/ready-handoff.js), answers the page kind from it with no AI (lib/server-pages.js), and matches each question.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {test} from 'node:test';
import {clear, forgetNightKind, keep, nightAnswers, nightKind, nightOf, take} from '../lib/ready-handoff.js';
import {decidePageKind} from '../lib/server-pages.js';

const PAGE = 'https://boards.example.com/acme/jobs/1';
const said = (field, label, value) => ({field, label, answer: {field, value, use: 'fill'}});
const HANDOFF = {url: PAGE, storage: {cookies: [], origins: []}, sessionStorage: {}, snapshot: {fields: [], files: []},
  night: {role: 'form', answers: [said('q_why', 'Why us?', 'Because'), said('q_country', 'Country', 'Switzerland'), said('q_a', 'Start date', 'May'), said('q_b', 'Start date', 'June')]}};

test('the night\'s answers stay in the app; the tab only learns the night filled it', () => {
  clear();
  assert.equal(keep(HANDOFF, ['https://boards.example.com/acme/jobs/1?src=x']), true);
  const given = take(`${PAGE}#jobpilotto-fill=s1`);
  assert.equal(given.fromNight, true);
  assert.ok(!JSON.stringify(given).includes('Because'), 'no answer goes to the tab');
  assert.equal(nightKind(PAGE), 'form', 'kept after the one take: the fill asks after the tab loaded');
});

test('each question is answered by its id and question, else by its question when one night answer has it; the rest go to the AI', () => {
  clear(); keep(HANDOFF, []);
  const found = nightAnswers(PAGE, [{field: 'q_why', label: 'Why us?'}, {field: 'q_country_2', label: 'Country'}, {field: 'q_c', label: 'Start date'}, {field: 'q_new', label: 'Relocate?'}]);
  assert.deepEqual(found.answers.map(a => [a.field, a.value]), [['q_why', 'Because'], ['q_country_2', 'Switzerland']], 'a menu under today\'s id');
  assert.deepEqual(found.rest.map(f => f.field), ['q_c', 'q_new'], 'a question two night answers share is not guessed; a new one is asked');
  assert.equal(nightAnswers('https://boards.example.com/other', [{field: 'q_why', label: 'Why us?'}]), null, 'another page: nothing from the night');
});

test('the night\'s page kind: kept 2 hours, dropped when the page says otherwise; only a form is replayed', () => {
  clear(); const at = Date.parse('2026-10-18T05:00:00Z');
  keep(HANDOFF, [], at);
  assert.equal(nightKind(PAGE, at + 119 * 60000), 'form');
  assert.equal(nightKind(PAGE, at + 121 * 60000), '', 'stale after 2 h');
  forgetNightKind(PAGE);
  assert.equal(nightKind(PAGE, at), '');
  assert.equal(nightAnswers(PAGE, [{field: 'q_why', label: 'Why us?'}], at).answers.length, 1, 'its answers stay');
  clear(); keep({...HANDOFF, night: {role: 'account', answers: []}}, []);
  assert.equal(nightKind(PAGE), '', 'an account page is judged as any page');
  assert.deepEqual(nightOf({role: 'boss', answers: [{field: 'x', answer: {value: ''}}, 'junk'], extra: 1}), {role: '', answers: []}, 'only a role word and answers with a value pass');
});

test('the app\'s page kind for the night\'s page: form at once, no AI; a fresh read still asks', async () => {
  clear(); keep(HANDOFF, []);
  const storage = {path: name => path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'jp-night-kind-')), name)};
  let asked = 0;
  const decide = async () => { asked++; return {kind: 'posting', role: 'no-form', confidence: 0.9, by: 'ai', rung: 2}; };
  const answer = await decidePageKind(storage, {url: `${PAGE}#jobpilotto-fill=s1`, controls: []}, {decide, client: null});
  assert.equal(answer.role, 'form'); assert.equal(answer.by, 'night'); assert.equal(asked, 0, 'no AI');
  await decidePageKind(storage, {url: PAGE, controls: [], fresh: true}, {decide, client: null});
  assert.equal(asked, 1, 'a fresh read (the page still drawing) is the AI\'s');
});

test('the night\'s stand-in keeps each answer it gave with its question, never an empty one; a new fill of the form forgets them', async () => {
  const {createStandIn} = await import('../../desktop/ready-fill/stand-in.mjs');
  const answer = async () => ({answers: [{field: 'q_why', value: 'Because'}, {field: 'q_skip', value: ''}, {field: 'q_unknown', value: 'x'}], usd: 0});
  const standIn = await createStandIn({jobs: [{id: 'j1', url: PAGE, kit: {}}]}, {answer});
  try {
    const post = body => fetch(`http://127.0.0.1:${standIn.port}/extension/answer`, {method: 'POST', body: JSON.stringify(body)}).then(r => r.json());
    await post({url: `${PAGE}#jobpilotto-fill=n`, fields: [{field: 'q_why', label: 'Why us?'}, {field: 'q_skip', label: 'Optional'}]});
    assert.deepEqual(standIn.said(PAGE), [{field: 'q_why', label: 'Why us?', answer: {field: 'q_why', value: 'Because'}}], 'an empty answer and one for a question not asked are not kept');
    standIn.reset(PAGE);
    assert.deepEqual(standIn.said(PAGE), []);
  } finally { await standIn.close(); }
});
