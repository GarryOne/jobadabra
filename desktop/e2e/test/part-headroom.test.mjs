// A suite part blocks a beta only when it fits its budget with headroom on its slowest leg (Mac + the Notion stand-in): this reads each part's measured time there and fails with "split it".
// Why (31 Oct 2026, a8; beta 41229992832, owner via the coordinator: "so no other suite reaches a beta at 95%"): apply-3of3 ran 698 s of its 660 on Mac + stand-in. Its slices had been balanced by guessed
// weights (two steps of ~25 s weighed 140 s, two of 125-170 s weighed 45-90 s) and the 5% margin held on the default store only.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {test} from 'node:test';
import {BUDGET_SECONDS, HEADROOM, over, sliceLoads} from '../lib/part-headroom.mjs';
import * as apply from '../suites/apply.mjs';

const read = file => JSON.parse(fs.readFileSync(new URL(`../fixtures/${file}`, import.meta.url), 'utf8'));
const parts = read('part-seconds.json');
// What every slice of apply runs besides its steps: the app's set-up and the final checks (7.3 + 20.8 + 5.2 s in the Mac jobs of beta 41229992832).
const SETUP_SECONDS = 33.3;
// apply's weights before this change (suites/apply.mjs, 26-31 Oct 2026): the table the beta-41229992832 slices were cut by.
const OLD_WEIGHTS = {'real forms the extension once failed on': 76, 'Tailor CVs for top matches': 51, 'a multi-step form': 37, 'a form with a control the extension cannot operate': 35,
  'Tailor CV on a job': 34, 'a Lever-like form': 33, 'Open in Chrome on a form the night filled': 29, 'Tailor on the session page of a form': 23, 'the person submits a form': 21,
  'a Greenhouse-like form': 16, 'Apply on a saved job without a kit': 15, 'a Workday-shaped form': 11, 'The hidden browser fills a form': 30, 'Full automation presses Submit once on its own': 60,
  'a silent Chrome in Standard automation': 45, 'a silent Chrome in Background automation': 20, 'a silent Chrome in Full automation': 20,
  'the app quits while Background automation holds a filled form': 40, 'the app quits in Full automation\'s wait': 140,
  'each read verdict gives its own chip': 90,
  'Stop on the card in Background automation': 40, 'Stop on the card in Full automation': 140,
  'the Jobs popup has one field': 15, 'checking jobs before the form read exists': 10,
  'the triage bar moves per real read': 45,
  'Background automation hands a bot check': 25, 'Full automation hands a bot check': 25,
  'Background automation fills several queued jobs': 90, 'Full automation presses each queued job': 50,
  'Full automation asks once in Settings': 10, 'Full automation saved without its confirmation': 10};

test('the budget is the runner\'s 11 minutes and the headroom is a stated share of it', () => {
  assert.equal(BUDGET_SECONDS, 660);
  assert.ok(HEADROOM > 0.5 && HEADROOM < 0.9, 'a headroom outside 50-90% is a typo');
});

test('every slice of apply fits the budget with headroom on Mac + the Notion stand-in', () => {
  const loads = sliceLoads(apply.stepSeconds, apply.shards, apply.stepSeconds, SETUP_SECONDS);
  assert.deepEqual(over(loads), [], `split apply further: ${loads.map(load => `${load.toFixed(0)} s`).join(' / ')} of ${BUDGET_SECONDS} s (limit ${Math.round(HEADROOM * BUDGET_SECONDS)} s)`);
});

// The red before: the old weights cut the same steps into slices whose slowest-leg seconds are not near a third (beta 41229992832: apply-3of3 ran 698 s).
test('the guard sees the split the old weights made: a slice over the headroom', () => {
  const loads = sliceLoads(OLD_WEIGHTS, 3, apply.stepSeconds, SETUP_SECONDS);
  assert.ok(over(loads).length >= 1, `old split ${loads.map(load => load.toFixed(0)).join(' / ')} s`);
  assert.ok(Math.max(...loads) > BUDGET_SECONDS * 0.9, 'the heaviest old slice sat near the budget, as apply-3of3 did');
});

// Parts that are not sliced by weights are measured whole (tools/e2e-part-times.mjs, the last betas): apply is judged above, from its steps (recorded left e2e on 1 Nov 2026: CI · Page cases shards it).
test('every other measured part fits the budget with headroom on its slowest leg', () => {
  const tooLong = Object.entries(parts.parts).filter(([name]) => !/ · apply-\d+of\d+$/.test(name)).filter(([, leg]) => over([leg.max]).length)
    .map(([name, leg]) => `${name}: ${leg.max} s (standin ${leg.standin ?? '-'}, sqlite ${leg.sqlite ?? '-'})`);
  assert.deepEqual(tooLong, [], 'split it: these parts are over the headroom on their slowest leg');
});
