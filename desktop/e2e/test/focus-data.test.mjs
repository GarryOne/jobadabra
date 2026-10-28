// The Focus suite's oracle must be right before the page is judged by it, and the comparison must be able to fail.
import assert from 'node:assert/strict';
import {test} from 'node:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {EXPECTED_SUGGESTIONS, EXPECTED_UP_NEXT, HAND_EDITS, compareNumbers, expectedNumbers, readData, resetFocusData, scenario, zurichAt, zurichDay} from '../lib/focus-data.mjs';
import {buildStandIn, startNotionFake} from '../lib/notion-fake.mjs';
import {storeCall} from '../lib/store-call.mjs';

const NOW = new Date('2026-10-02T09:30:00Z');
// The scenario as the store returns it (src/stores/base.py records: the same on every store).
function apiPages(now = NOW) {
  const data = scenario(now);
  const rows = data.rows.map(({key, fields}) => ({id: `row-${key}`, ...fields}));
  const events = data.events.map(({rowKey, ...item}) => ({id: `event-${rowKey}-${item.kind}`, app_id: `row-${rowKey}`, ...item}));
  return {rows, events};
}

test('the scenario gives the numbers the product spec promises', () => {
  const {rows, events} = apiPages();
  const want = expectedNumbers(rows, events, {now: NOW, target: 5});
  assert.equal(want.applied, 2, 'Delta Grid and Ibis Analytics were applied to today');
  assert.equal(want.pctText, '40%');
  assert.equal(want.chartSum, '5 applied · 0 days on target', 'Fjord (14 days ago) is outside the 14-day chart');
  assert.deepEqual(want.funnel.map(step => [step.name, step.reached]), [['Prepared', 8], ['Applied', 6], ['Human reply', 2], ['Screening', 2], ['Interviews', 0]]);
  assert.deepEqual(want.inbound.map(step => [step.name, step.reached]), [['Contacted you', 2], ['Screening', 1], ['Interviews', 1], ['Offers', 0]]);
  assert.equal(want.kits, 2);
});
test('a different target changes the ratio, not the count', () => {
  const {rows, events} = apiPages();
  const want = expectedNumbers(rows, events, {now: NOW, target: 3});
  assert.equal(want.applied, 2);
  assert.equal(want.pctText, '67%');
  assert.equal(want.ofText, '/ 3 applications today');
});
test('a day that reached the target is counted on target', () => {
  const {rows, events} = apiPages();
  assert.match(expectedNumbers(rows, events, {now: NOW, target: 2}).chartSum, /1 day on target/);
});
test('the comparison passes the right page and names every wrong number', () => {
  const {rows, events} = apiPages();
  const want = expectedNumbers(rows, events, {now: NOW, target: 5});
  const right = {count: '2', of: '/ 5 applications today', pct: '40%', bar: '40%', chartSum: want.chartSum,
    funnel: want.funnel.map(step => ({name: step.name, count: String(step.reached), share: `${step.share}% reached`})),
    inbound: want.inbound.map(step => ({name: step.name, count: String(step.reached), share: `${step.share}% reached`}))};
  assert.deepEqual(compareNumbers(right, want), []);
  const broken = structuredClone(right);
  broken.count = '3'; broken.funnel[1].count = '7'; broken.inbound[0].share = '90% reached'; broken.bar = '50%';
  const diffs = compareNumbers(broken, want);
  assert.equal(diffs.length, 4, diffs.join('\n'));
  assert.ok(diffs.some(d => /applications today.*"3".*"2"/.test(d)) && diffs.some(d => /"Applied" count/.test(d)));
});
test('a missing step is a difference, not a crash', () => {
  const {rows, events} = apiPages();
  const want = expectedNumbers(rows, events, {now: NOW});
  const shown = {count: '2', of: want.ofText, pct: want.pctText, bar: '40%', chartSum: want.chartSum, funnel: [], inbound: []};
  assert.ok(compareNumbers(shown, want).length >= 2);
});
test('the oracle refuses a row without an Origin instead of guessing', () => {
  const {rows, events} = apiPages();
  delete rows[0].origin;
  assert.throws(() => expectedNumbers(rows, events, {now: NOW}), /explicit Origin/);
});
test('Zurich days and offsets follow daylight saving', () => {
  assert.equal(zurichDay('2026-10-02T22:30:00Z'), '2026-10-03', '00:30 in Zurich is already the next day');
  assert.equal(zurichAt('2026-10-03', '10:00'), '2026-10-03T10:00:00+02:00');
  assert.equal(zurichAt('2026-10-30', '10:00'), '2026-10-30T10:00:00+01:00');
});
test('every Up next and Suggestions row names a button list; Up next holds only what can\'t wait', () => {
  assert.equal(EXPECTED_UP_NEXT.length, 2);
  assert.equal(EXPECTED_SUGGESTIONS.length, 4);
  for (const row of [...EXPECTED_UP_NEXT, ...EXPECTED_SUGGESTIONS]) assert.ok(row.buttons.length, row.who);
});

test('the hand-edited rows are what people type: an unknown stage, an empty title, a 2,000-character note, other scripts', () => {
  assert.equal(HAND_EDITS[0].stage, 'On hold (my own stage)');
  assert.equal(HAND_EDITS[0].title, '');
  assert.equal(HAND_EDITS[1].notes.length, 2000);
  assert.match(HAND_EDITS.map(row => row.company).join(' '), /株式会社.*شركة|شركة.*株式会社/s);
});

// The seed and the reset through the engine's own store command, on this Mac's store and on the stand-in: the oracle then reads the same numbers from both.
const profileWith = settings => {
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'jp-focus-data-'));
  fs.writeFileSync(path.join(profile, 'settings.json'), JSON.stringify(settings));
  return profile;
};
async function seedAndReset(ctx) {
  ctx.data = (entity, method, kwargs = {}) => storeCall(ctx, entity, method, kwargs);
  const made = await resetFocusData(ctx, {data: scenario(NOW)});
  assert.equal(Object.keys(made).length, 10);
  const {rows, events} = await readData(ctx);
  assert.deepEqual([rows.length, events.length], [10, 14]);
  const want = expectedNumbers(rows, events, {now: NOW, target: 5});
  assert.deepEqual(want.funnel.map(step => step.reached), [8, 6, 2, 2, 0], 'the same hand-counted funnel as from the scenario itself');
  assert.equal(events.find(item => item.source_id === 'e2e-lead-1')?.app_id, made.huxley.id, 'the lead\'s email is on its job');
  await resetFocusData(ctx, {});
  const after = await readData(ctx);
  assert.deepEqual([after.rows.length, after.events.length], [0, 0], 'a reset leaves a new user\'s data');
}
test('the seed and the reset on this Mac\'s store', {timeout: 120000}, async () => {
  await seedAndReset({profile: profileWith({store: 'sqlite'}), store: 'sqlite', token: ''});
});
test('the seed and the reset on Notion (the stand-in)', {timeout: 120000}, async () => {
  const fake = await startNotionFake();
  try {
    const ids = await buildStandIn(fake);
    await seedAndReset({profile: profileWith({notionIds: ids}), store: 'standin', token: fake.token, appEnv: {JOB_PILOTTO_E2E_NOTION_BASE_URL: fake.url}});
  } finally { await fake.close(); }
});
