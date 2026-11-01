// lib/quality-rows.mjs: a store match record reads as the columns the quality checks use, and a column the record does not carry yet is left out and named
// (the check then says "not kept on this Mac's store"), never reported as wrong or empty; once the record carries it, it is checked.
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {checkFacts, missingColumns} from '../../lib/quality.mjs';
import {ENRICHED, notKeptNote, rowOfRecord} from '../../lib/quality-rows.mjs';

const RECORD = {url: 'https://boards.e2e.test/jobs/1', title: 'Senior SRE', company: 'E2E Acme', location: 'Zurich', work_mode: 'Hybrid', fit: 84, reason: 'Strong Kubernetes match',
  status: 'New', fit_detail: {parts: {role_fit: 5, location: 5, compensation: 4, growth: 4, risk: 2}, gaps: ['no Go']}, first_seen: '2026-10-09'};
const ITEM = {title: 'Senior SRE', seniority: 'Senior', workMode: 'Hybrid', location: 'Zurich', salary: ['170000']};

test('a record without the enriched facts: what it has is checked, the rest is named, not failed', () => {
  const row = rowOfRecord(RECORD);
  assert.deepEqual([row.props.Job, row.props.Score, row.props['Role fit'], row.props.Gaps], ['Senior SRE', 84, 5, 'no Go']);
  assert.deepEqual(row.notKept, Object.keys(ENRICHED));
  const facts = checkFacts(ITEM, row).map(item => item.fact);
  assert.deepEqual(facts, ['work mode', 'location'], 'seniority and salary are not checked on a record that does not keep them');
  assert.ok(!missingColumns(row).some(column => column in ENRICHED), 'a column not kept is not "empty"');
  assert.match(notKeptNote([row]), /^not kept on this Mac's store \(not checked\): Tier, Confidence/);
});

test('once the record carries a fact it is checked, and a wrong one fails', () => {
  const row = rowOfRecord({...RECORD, seniority: 'Mid', salary: 'CHF 170,000'});
  const results = Object.fromEntries(checkFacts(ITEM, row).map(item => [item.fact, item.ok]));
  assert.equal(results.seniority, false, 'the wrong seniority is caught');
  assert.equal(results.salary, true);
  assert.ok(!row.notKept.includes('Seniority'));
});
