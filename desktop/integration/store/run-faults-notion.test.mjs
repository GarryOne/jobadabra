// Layer 3 (Node + the real engine + the Notion stand-in behind the fault proxy, no window): a Jobs check while Notion is busy (429), answers an HTML error page, or is gone ends in words,
// with nothing left Running, and a Save Notion refuses is never shown as saved's counterpart is store/. Moved from the e2e `activityfailures` suite's Notion part (suite failuresnotion,
// 1 Nov 2026, R2): "Notion is busy (429) for a moment / answers an HTML error page / the connection is gone during a Jobs check". The e2e "a Save that Notion refuses is never shown as saved" stays
// (journey, critical-journeys.json). The writes fail, the reads work, as in the e2e steps (notion-proxy `writes: true`), so the run can still say what became of it.
import assert from 'node:assert/strict';
import {after, before, test} from 'node:test';
import {assertNothingRunning, commonProblems, whatARunShows} from './engine-support.mjs';
import {startEngineKit} from './engine-kit.mjs';

let kit;
before(async () => { kit = await startEngineKit({store: 'notion', ai: false}); });
after(async () => { await kit?.close(); });

const NOTION_FAULTS = [
  {mode: 'rate-limit', times: 3, writes: true, what: 'Notion is busy (429) for a moment', recovers: true},
  {mode: 'html', writes: true, what: 'Notion answers an HTML error page instead of JSON'},
  {mode: 'offline', writes: true, what: 'the connection to Notion is gone'},
];

for (const fault of NOTION_FAULTS) {
  test(`${fault.what} during a Jobs check: the run ends ${fault.recovers ? 'normally' : 'as Failed or with warnings'}, in words, with nothing left Running`, async () => {
    kit.feed([`Senior Site Reliability Engineer, notion ${fault.mode}`]);
    const failedBefore = kit.notion.stats.failed;
    kit.notion.fail(fault.mode, {times: fault.times ?? null, writes: !!fault.writes});
    let done;
    try { done = await kit.runTask('refresh', 'run', 'you'); } finally { kit.notion.pass(); }
    const seen = await whatARunShows(kit, done);
    const problems = commonProblems(kit, seen);
    if (kit.notion.stats.failed - failedBefore < 1) problems.push('Notion was never asked while failing, so nothing was tested');
    if (!fault.recovers && /^Completed$/.test(seen.pill)) problems.push('the run says plain "Completed" though its results never reached Notion');
    assert.deepEqual(problems, []);
    await assertNothingRunning(kit);
  });
}
