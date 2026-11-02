// npm run shot reports saved values cut by their text box (design system, owner 17 Oct 2026): the report's words, and that the shot runs the check
// whenever no --eval of its own is asked.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {test} from 'node:test';
import {cutFields, cutReport} from '../scripts/cut-fields.mjs';

test('the report names each cut field and stays silent when none is cut', () => {
  assert.deepEqual(cutReport([]), []);
  const lines = cutReport([{field: 'Target', value: '~CHF 9,000 net per month. Treat as a target'}]);
  assert.match(lines[0], /^✂ 1 saved value cut by its box/);
  assert.equal(lines[1], '  Target: "~CHF 9,000 net per month. Treat as a target…"');
});

test('the check is scoped to --select and wired into the shot', () => {
  assert.match(cutFields('#setting-availability'), /document\.querySelector\("#setting-availability"\)/);
  assert.match(cutFields(), /field\.scrollWidth > field\.clientWidth \+ 1/);
  assert.match(cutFields(), /\.segmented/);
  assert.match(cutFields(), /data-saved-value/);
  const shot = fs.readFileSync(new URL('../scripts/shot.mjs', import.meta.url), 'utf8');
  assert.match(shot, /JOBADABRA_SMOKE_EVAL = option\('eval'\) \|\| cutFields\(option\('select'\)\)/);
});

test('the choice checks name a one-column choice row and a saved value nothing shows (owner, 18 Oct 2026: Target level)', () => {
  const lines = cutReport([{kind: 'column', field: 'Target level', value: 'Junior / Mid / Senior'}, {kind: 'unseen', field: 'Target level', value: 'Senior or higher'}]);
  assert.match(lines[0], /^▤ 1 choice row drawn as one column/);
  assert.equal(lines[1], '  Target level: Junior / Mid / Senior');
  assert.match(lines[2], /^◌ 1 saved value its choice does not show/);
  assert.equal(lines[3], '  Target level: "Senior or higher"');
});
