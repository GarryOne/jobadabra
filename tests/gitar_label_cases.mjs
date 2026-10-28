// Cases for tools/gitar-label.mjs, run by tests/test_gitar_label.py: Gitar's real verdict lines map to one label, and a verdict older than the head commit gets none.
import test from 'node:test';
import assert from 'node:assert/strict';
import {verdictKind, wantedLabel, wantedLabels, LABELS, WAITING, WORKING} from '../tools/gitar-label.mjs';
const wrap = kbd => `<details>\n<summary><b>Code Review</b> ${kbd}</summary>\n\nBody\n</details>`;
const APPROVED = wrap('<kbd>✅ Approved</kbd>');   // #2377, #2380
const SUGGEST = wrap('<kbd>👍 Approved with suggestions</kbd> <kbd>2 closed / 3 findings</kbd>');   // #2381
const CHANGES = wrap('<kbd>⚠️ Changes requested</kbd> <kbd>0 closed / 3 findings</kbd>');   // #2382

test('real verdict lines map to their kind', () => {
  assert.equal(verdictKind(APPROVED), 'approved');
  assert.equal(verdictKind(SUGGEST), 'suggestions');
  assert.equal(verdictKind(CHANGES), 'changes');
});
test('no verdict line, no label; an unknown state is red, never green', () => {
  assert.equal(verdictKind('Gitar is reviewing…'), null);
  assert.equal(verdictKind(''), null);
  assert.equal(verdictKind(wrap('<kbd>🔄 Reviewing</kbd>')), 'changes');
});
test('a verdict written before the head commit is stale', () => {
  assert.equal(wantedLabel(APPROVED, '2026-10-28T19:59:08Z', '2026-10-28T19:56:45Z'), LABELS.approved.name);
  assert.equal(wantedLabel(APPROVED, '2026-10-28T19:50:00Z', '2026-10-28T19:56:45Z'), null);
  assert.equal(wantedLabel('no verdict', '2026-10-28T19:59:08Z', '2026-10-28T19:56:45Z'), null);
});
const HEAD = '2026-10-28T20:00:00Z', BEFORE = '2026-10-28T19:00:00Z', AFTER = '2026-10-28T20:05:00Z';
test('no current verdict shows "reviewing"; working ends with a push or an approval, never with a red verdict', () => {
  const w = (verdict, workingSince) => wantedLabels({verdict, workingSince, headTime: HEAD});
  assert.deepEqual(w(null, null), [WAITING.name]);
  assert.deepEqual(w(LABELS.changes.name, AFTER), [LABELS.changes.name, WORKING.name]);
  assert.deepEqual(w(null, BEFORE), [WAITING.name]);   // set before the head was pushed: the push ended it, even if no push event ran
  assert.deepEqual(w(LABELS.approved.name, AFTER), [LABELS.approved.name]);
  assert.deepEqual(w(LABELS.suggestions.name, AFTER), [LABELS.suggestions.name, WORKING.name]);
});
