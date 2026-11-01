// The grown test applicant (applicants/grown.json, lib/applicant-seed.mjs applicantDraft): thin stays the default, grown = thin + answers given once,
// fake values only, every overlay line still matches the thin draft, and a capture made with one applicant is named old by the other.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {test} from 'node:test';
import {APPLICANTS, GROWN_FILE, applicantDraft, seedVersion} from '../../lib/applicant-seed.mjs';

test('thin is the default; grown keeps the thin profile and adds the answers given once', () => {
  const thin = applicantDraft({which: 'thin'}), grown = applicantDraft({which: 'grown'});
  assert.deepEqual(applicantDraft({which: undefined}), process.env.JP_APPLICANT === 'grown' ? grown : thin);
  assert.ok(grown.answers_markdown.startsWith(thin.answers_markdown.replace('- Notice period: ❓', '- Notice period: 3 months').trimEnd()));
  assert.match(grown.answers_markdown, /# Questions forms keep asking/);
  assert.ok(grown.profile_markdown.includes("| Start date / notice period | 3 months' notice") && !grown.profile_markdown.includes('| Start date / notice period | ❓ |'));
  assert.deepEqual({...grown, profile_markdown: '', answers_markdown: ''}, {...thin, profile_markdown: '', answers_markdown: ''}, 'only the two texts differ');
  assert.throws(() => applicantDraft({which: 'rich'}), /one of thin, grown/);
  assert.deepEqual(APPLICANTS, ['thin', 'grown']);
});

test('grown is fake: links only on example.test, every batch dated in the changelog', () => {
  const grown = JSON.parse(fs.readFileSync(GROWN_FILE, 'utf8'));
  for (const link of grown.answers_append.match(/https?:\/\/\S+/g)) assert.match(new URL(link).hostname, /(^|\.)example\.test$/, link);
  assert.ok(grown.changelog.length >= 1);
  for (const line of grown.changelog) assert.match(line, /^\d{4}-\d{2}-\d{2} batch \d+: /);
});

test('a thin capture is old for a grown run and back (the seed hash names the applicant)', () => {
  assert.notEqual(seedVersion(undefined, 'thin'), seedVersion(undefined, 'grown'));
  assert.equal(seedVersion(undefined, 'thin'), seedVersion());
});
