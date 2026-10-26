// Windows runs only apply and the settings smoke (the e2e audit, owner's yes 26 Oct 2026: Windows was 38% of e2e runner-minutes). Both Windows planners go
// through lib/plan.mjs onWindows: the release run's matrix (plan-run.mjs) and the run after main's checks or a gate by hand (plan-windows.mjs). A run by hand
// that names its suites still runs them.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {test} from 'node:test';
import {planRun, suiteFacts} from '../plan-run.mjs';
import {WINDOWS, onWindows} from '../lib/plan.mjs';

const SHA = 'a'.repeat(40);
const gh = args => (args[0] === 'api' && /commits\//.test(args.join(' ')) ? SHA : '[]');

test('the Windows suites exist, and the filter keeps only them', async () => {
  const {all} = await suiteFacts();
  assert.deepEqual(WINDOWS.filter(suite => !all.includes(suite)), [], 'a Windows suite no longer exists');
  assert.deepEqual(onWindows(['jobs', 'apply', 'settings', 'quality']), ['apply', 'settings']);
});

for (const kind of ['nightly', 'beta']) {
  test(`the ${kind} gate's Windows matrix on the real suites is apply and the settings smoke`, async () => {
    const out = await planRun({env: {REPO: 'o/r', EVENT: 'gate', SHA, TARGET_REF: 'desktop-v9.9', GATE_TAG: 'desktop-v9.9', GATE_KIND: kind}, gh, ...(await suiteFacts())});
    const planned = [...new Set(JSON.parse(out.windows_matrix).include.map(item => item.suite))].sort();
    assert.deepEqual(planned, [...WINDOWS].sort());
    assert.ok(out.suites.split(',').length > WINDOWS.length, 'positive control: the Mac + Linux gate still runs every suite');
  });
}

test('plan-windows.mjs filters every planned run through onWindows, except a run by hand that names its suites', () => {
  const source = fs.readFileSync(new URL('../plan-windows.mjs', import.meta.url), 'utf8');
  const block = source.slice(source.indexOf('if (!process.env.ONLY) {'));
  assert.ok(block.length < source.length, 'the "not named by hand" block is gone');
  assert.match(block.slice(0, block.indexOf('\n  }')), /result\.suites = onWindows\(/, 'plan-windows.mjs no longer narrows Windows to apply + settings');
});
