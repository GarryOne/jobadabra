// Which reasons the fill writes count as a miss in the pool verdict (lib/record-sites.mjs verdictOf): a correct answer must never make a form "short". Guards the Migros "unread" row.
import assert from 'node:assert/strict';
import {test} from 'node:test';
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {shortfall, verdictOf} from '../lib/record-sites.mjs';

const left = (reason, type = 'text', required = true) => ({outcome: 'left', type, label: 'Q', required, reason});

// The class (15 Oct 2026, Migros "unread" row): a reason the fill writes for a field that is NOT a failure must never count as a miss in the pool verdict. 0ae22fd added
// "answered no: left unchecked" and the verdict kept reading it as a miss, so a correct "no" made a form "short". Every reason the fill can write is listed here as a failure or not.
const FAILURES = new Set(['answer given, but the field did not take it', 'dropdown that opens only on a real click', 'question on the page not read', 'question text not found on the page',
  'no answer in the kit, Profile or your details', 'the AI gave no answer', 'preselected by the page: check it', 'from your CV: check it']);   // preselected / from your CV (fill.js, 27 Oct 2026): written with outcome filled, so never judged here
test('every reason the fill writes that is not a failure counts as filled or expected, never a miss', () => {
  const dir = path.join(path.dirname(fileURLToPath(import.meta.url)), '../../../extension/page');
  const reasons = new Set(fs.readdirSync(dir).filter(name => name.endsWith('.js')).flatMap(name => [...fs.readFileSync(path.join(dir, name), 'utf8').matchAll(/reason = '([^']+)'/g)].map(m => m[1])));
  assert.ok(reasons.size >= 10, 'the reasons were found');
  for (const reason of reasons) {
    if (FAILURES.has(reason)) continue;
    if (/^upload/.test(reason)) continue;   // an upload slot never reaches the verdict: shortfall() leaves file slots out
    const row = left(reason, 'checkbox');
    assert.notEqual(verdictOf(row), 'miss', `"${reason}" counts as a miss: classify it in verdictOf (or list it in FAILURES if it is one)`);
    assert.notEqual(verdictOf(row), 'no_suggestion', reason);
  }
});

test('a required box answered no and left unchecked is explained, so the form is not short', () => {
  const no = {outcome: 'left', type: 'checkbox', label: 'Employee of the group', required: true, source: 'Claude (on the page)', reason: 'answered no: left unchecked'};
  const result = {reached: 'form', filled: 1, left: 1, fieldList: [{outcome: 'filled', type: 'text', label: 'Name', required: true, source: 'your details', reason: ''}, no]};
  assert.equal(verdictOf(no), 'filled');
  assert.equal(shortfall(result), null);
});
