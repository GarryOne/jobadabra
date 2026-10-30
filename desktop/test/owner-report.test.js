// An owner-seen bug is proven on the owner's own page (tools/owner-report.mjs): the trailer, a captured case with the report id, never a hand-cut one.
import assert from 'node:assert/strict';
import {test} from 'node:test';
import fs from 'node:fs';
import {NAMES_A_FAILURE, LABEL_KEYS} from '../../tools/recorded-cases.mjs';
import {escapeOf, ownerReportProblem, reportOf} from '../../tools/owner-report.mjs';

const commit = (message, files = []) => ({message, files});
const cases = {mine: {origin: 'captured', report: 'a1b2c3'}, cut: {origin: 'hand-cut', report: 'a1b2c3'}, other: {origin: 'captured', report: 'ffffff'}};
const look = name => cases[name] || null;

test('every way of saying the owner saw the bug needs the trailer, the same for each', () => {
  for (const text of ['Fix the select the owner saw', 'Fix what the owner reported', 'Fix the form reported by the owner', 'Fix ⚑ report', 'Fix a Report this form miss', 'owner-seen select bug', 'Fix: owner-seen select bug']) {
    assert.match(ownerReportProblem([commit(text)], look), /Owner-report: <report id>/, text);
  }
  assert.equal(ownerReportProblem([commit('Fix a log line')], look), '', 'no claim, no trailer needed');
});

test('a captured case carrying the report id proves it; hand-cut, missing or another report does not', () => {
  const ok = commit('Fix the select the owner saw\n\nOwner-report: a1b2c3\nEscaped-e2e: apply — select an answer', ['desktop/e2e/recorded/mine/case.json']);
  assert.equal(ownerReportProblem([ok], look), '');
  assert.match(ownerReportProblem([commit('Fix X\n\nOwner-report: a1b2c3', ['desktop/e2e/recorded/cut/case.json'])], look), /hand-cut/);
  assert.match(ownerReportProblem([commit('Fix X\n\nOwner-report: a1b2c3', ['desktop/e2e/recorded/other/case.json'])], look), /no recorded case/);
  assert.match(ownerReportProblem([commit('Fix X\n\nOwner-report: a1b2c3')], look), /no recorded case/);
});

test('"Owner-report: none" needs a reason and makes no claim without prose owner words', () => {
  assert.equal(ownerReportProblem([commit('Fix the owner saw\n\nOwner-report: none a rule, no page shows it\nEscaped-e2e: no suite — enforce a rule')], look), '');
  assert.match(ownerReportProblem([commit('Fix the owner saw\n\nOwner-report: none')], look), /needs a reason/);
  assert.equal(reportOf('x\n\nOwner-report: a1b2c3').claims, true);
  assert.equal(ownerReportProblem([commit('Fix a log line\n\nOwner-report: none a review finding')], look), '');
});

test('no-capture claims an owner-seen bug without prose owner words and needs an escape but no recorded case', () => {
  const message = 'Fix a gate\n\nOwner-report: no-capture a rule, no page shows it';
  assert.equal(reportOf(message).claims, true);
  assert.equal(reportOf(message).id, '');
  assert.match(ownerReportProblem([commit(message)], look), /Escaped-e2e:/);
  assert.equal(ownerReportProblem([commit(`${message}\nEscaped-e2e: no suite — enforce a rule`)], look), '');
});

test('bare no-capture and none are refused with a reason and guidance for all three forms', () => {
  for (const value of ['no-capture', 'none']) {
    const problem = ownerReportProblem([commit(`Fix a gate\n\nOwner-report: ${value}`)], look);
    assert.match(problem, /needs a reason/);
    for (const form of ['Owner-report: <id>', 'Owner-report: no-capture <why>', 'Owner-report: none <why>']) {
      assert.ok(problem.includes(form), `missing guidance: ${form}`);
    }
  }
});

test('owner claims and report ids require an escape record on the same commit', () => {
  for (const message of ['Fix the bug the owner saw\n\nOwner-report: none no page capture', 'Fix the select\n\nOwner-report: a1b2c3']) {
    const problem = ownerReportProblem([commit(message, ['desktop/e2e/recorded/mine/case.json'])], look);
    assert.match(problem, /Escaped-e2e: <suite>\[, <suite>\] —/);
    assert.match(problem, /Escaped-e2e: no suite —/);
    assert.match(ownerReportProblem([commit(message), commit('Other change\n\nEscaped-e2e: apply — fill a form')], look), /Escaped-e2e:/);
  }
});

test('both escape forms satisfy the gate, including multiple suites', () => {
  for (const value of ['apply — fill a form', 'apply, jobs — open a job and fill a form', 'no suite — enforce a rule']) {
    assert.equal(ownerReportProblem([commit(`Fix the owner-seen bug\n\nOwner-report: none no capture\nEscaped-e2e: ${value}`)], look), '');
  }
});

test('unknown suites are refused with every exported suite name', () => {
  const problem = ownerReportProblem([commit('Fix the owner-seen bug\n\nOwner-report: none no capture\nEscaped-e2e: invented-suite — fill a form')], look);
  assert.match(problem, /invented-suite/);
  const folder = new URL('../e2e/suites/', import.meta.url);
  const names = fs.readdirSync(folder).filter(file => file.endsWith('.mjs')).map(file =>
    /^export const name = ['"]([^'"]+)['"]/m.exec(fs.readFileSync(new URL(file, folder), 'utf8'))[1]);
  assert.ok(names.length > 0);
  for (const name of names) assert.ok(problem.includes(name), `missing suite ${name}`);
});

test('trailer text cannot turn Owner-report none into an owner claim', () => {
  const message = 'Fix a log line\n\nOwner-report: none — not an owner-seen bug';
  assert.equal(reportOf(message).claims, false);
  assert.equal(ownerReportProblem([commit(message)], look), '');
  assert.equal(reportOf(`${message}\nReviewed-by: owner-reported`).claims, false);
});

test('escapeOf parses suite lists and no-suite gaps for the collector', () => {
  assert.deepEqual(escapeOf('Fix X\n\nEscaped-e2e: apply, jobs — open a job — then fill'),
    {suites: ['apply', 'jobs'], none: false, journey: 'open a job — then fill'});
  assert.deepEqual(escapeOf('Fix X\n\nEscaped-e2e: no suite — enforce a rule'),
    {suites: [], none: true, journey: 'enforce a rule'});
  assert.equal(escapeOf('Fix X'), null);
});

test('escape records require a suite list or no suite, an em dash and a journey', () => {
  for (const value of ['apply', 'apply — ', ' — fill a form', 'apply, — fill a form', 'no suite, apply — fill a form']) {
    assert.match(ownerReportProblem([commit(`Fix the owner-seen bug\n\nOwner-report: none no capture\nEscaped-e2e: ${value}`)], look), /Escaped-e2e:/, value);
  }
});

test('an owner report names a failure (no "Recorded-pins"), and report is a label of the case, not part of the replay', () => {
  assert.ok(NAMES_A_FAILURE.test('Fix X\n\nOwner-report: a1b2c3'));
  assert.ok(!NAMES_A_FAILURE.test('Pin X\n\nOwner-report: none a rule'));
  assert.ok(LABEL_KEYS.includes('report'));
});
