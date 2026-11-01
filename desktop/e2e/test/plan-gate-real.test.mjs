// The release gate planned from the REAL suites never plans none: a gate that tests zero suites approves nothing and, with a pipe or a count check that skips quietly, read green for 3 days (18-21 Oct 2026).
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {planRun, suiteFacts} from '../plan-run.mjs';

const SHA = 'a'.repeat(40);
const gh = args => (args[0] === 'api' && /commits\//.test(args.join(' ')) ? SHA : '[]');

for (const kind of ['nightly', 'beta']) {
  test(`the ${kind} gate plans every always suite on the real suite list, on both lanes`, async () => {
    const facts = await suiteFacts();
    const out = await planRun({env: {REPO: 'o/r', EVENT: 'gate', SHA, TARGET_REF: 'desktop-v9.9', GATE_TAG: 'desktop-v9.9', GATE_KIND: kind}, gh, ...facts});
    const planned = new Set(out.suites.split(',').filter(Boolean));
    assert.ok(Number(out.count) > 0, 'the gate planned no suite at all');
    assert.ok(JSON.parse(out.windows_matrix).include.length > 0, 'the Windows gate planned no suite');
    const always = facts.all.filter(suite => !['manual', 'watched', 'night-report'].includes(facts.cadence[suite]) && (kind === 'nightly' || facts.cadence[suite] !== 'nightly'));
    assert.deepEqual(always.filter(suite => !planned.has(suite)), [], 'an always suite is missing from the gate');
  });
}
