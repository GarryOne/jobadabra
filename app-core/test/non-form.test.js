// The non-form outcomes (extension/ladder/outcomes.js): only an AI answer of apply_by email with its address becomes an email report.
import test from 'node:test';
import assert from 'node:assert/strict';
import {emailReport} from '../../extension/ladder/outcomes.js';

test('an email answer with its address is reported as the application\'s need', () => {
  assert.deepEqual(emailReport({applyBy: 'email', applyEmail: 'jobs@firma.ch'}), {why: 'email', needs: 'jobs@firma.ch'});
});
test('nothing else becomes an email outcome: no AI, another way, an email without its address', () => {
  for (const kind of [null, {}, {applyBy: 'form', applyEmail: 'jobs@firma.ch'}, {applyBy: 'other'}, {applyBy: 'email', applyEmail: ''}]) assert.equal(emailReport(kind), null);
});
