// The discovery batch's verdicts and its one message (lib/discovery-judge.mjs).
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {capText, judgeBatch, judgeRow, poolAdditions, telegramText} from '../../lib/discovery-judge.mjs';

const form = (extra = {}) => ({url: 'https://careers.a.example/j/1', reached: 'form', filled: 9, left: 0, ending: 'ready', cause: 'ready', signature: 'posting>form@careers.a.example#form', ...extra});

test('each ending the recordings know maps to one verdict', () => {
  assert.equal(judgeRow(form()).verdict, 'fine');
  assert.equal(judgeRow(form({ending: 'told'})).verdict, 'fine', 'a stop the person is told about is not a failure');
  assert.equal(judgeRow(form({short: {miss: 2, noSuggestion: 1, total: 9}})).verdict, 'fields-left');
  assert.equal(judgeRow(form({ending: 'unresolved', cause: 'field-missed', left: 4})).verdict, 'fields-left');
  assert.equal(judgeRow(form({blocked: 'a dialog covers the form'})).verdict, 'wrong');
  assert.equal(judgeRow(form({wrong: 2})).verdict, 'wrong');
  assert.equal(judgeRow(form({reached: 'posting', ending: 'unresolved', cause: 'no-reason'})).verdict, 'stopped-early');
  assert.equal(judgeRow(form({reached: 'account', ending: 'site_broken', cause: 'site_broken'})).verdict, 'stopped-early');
});

test('the test\'s own holds, bot walls, gone postings, refused AI and unfinished runs are never failures', () => {
  for (const result of [undefined, {reached: 'code/bot', ending: 'handed'}, {reached: 'none', note: 'posting gone (HTTP 404)'}, form({ending: 'held'}), form({ending: ''}), form({aiRefused: {why: 'x'}}), form({tripped: true}), form({note: 'site refused'})]) {
    assert.equal(judgeRow(result).verdict, 'not-measured', JSON.stringify(result));
  }
});

test('the batch is judged row by row in its own order, and a row missing from the report did not finish', () => {
  const picked = [{shape: 'Discovery: a.example', urls: ['https://a.example/j/1'], source: 'matches'}, {shape: 'Discovery: b.example', urls: ['https://b.example/j/1'], source: 'gaps'}];
  const out = judgeBatch({results: {'Discovery: a.example': form({url: 'https://a.example/j/1', blocked: 'overlay'}), 'Some other row': form()}}, picked);
  assert.deepEqual(out.map(item => [item.shape, item.verdict, item.host]), [['Discovery: a.example', 'wrong', 'a.example'], ['Discovery: b.example', 'not-measured', 'b.example']]);
});

test('one message a run, only when something failed, and it names every failure with the spend', () => {
  const picked = ['a', 'b', 'c', 'd'].map(name => ({shape: `Discovery: ${name}.example`, urls: [`https://${name}.example/j/1`], source: 'matches'}));
  const report = {results: {'Discovery: a.example': form({url: 'https://a.example/j/1', reached: 'posting', ending: 'unresolved', cause: 'no-reason'}), 'Discovery: b.example': form({url: 'https://b.example/j/1', short: {miss: 4, noSuggestion: 0, total: 9}}),
    'Discovery: c.example': form({url: 'https://c.example/j/1'})}};
  const text = telegramText({day: '2026-10-17', judged: judgeBatch(report, picked), usd: 0.24, weekSpent: 1.1});
  assert.match(text, /^🔎 Discovery 2026-10-17: 4 sites recorded, 2 failed/);
  assert.match(text, /• a\.example: stopped early/);
  assert.match(text, /• b\.example: fields left \(4 of 9/);
  assert.match(text, /✅ 1 fine: c\.example/);
  assert.match(text, /⚪ 1 not measured/);
  assert.match(text, /Spent \$0\.24 \(week \$1\.10 of \$3\.00\)/);
  const clean = judgeBatch({results: {'Discovery: c.example': form({url: 'https://c.example/j/1'})}}, [picked[2]]);
  assert.equal(telegramText({day: '2026-10-17', judged: clean}), '', 'nothing failed: no message');
  assert.match(capText({week: '2026-10-12', spent: 2.95, cap: 3}), /\$2\.95 of the \$3\.00 week cap/);
});

test('only rows that reached a new shape join the pool', () => {
  const judged = [{shape: 'A', url: 'https://a.example/1', signature: 'posting>form@a.example#form', verdict: 'fine'}, {shape: 'B', url: 'https://b.example/1', signature: 'posting>form@a.example#form', verdict: 'fields-left'},
    {shape: 'C', url: 'https://c.example/1', signature: 'unclear', verdict: 'stopped-early'}, {shape: 'D', url: 'https://d.example/1', signature: 'posting@d.example#code/bot', verdict: 'not-measured'},
    {shape: 'E', url: 'https://e.example/1', signature: 'posting>account@e.example#account', verdict: 'stopped-early'}];
  assert.deepEqual(poolAdditions(judged, new Set(['posting>account@e.example#account'])).map(row => row.shape), ['A'], 'a repeated signature, an unclear run, a bot wall and a known shape add nothing');
});
