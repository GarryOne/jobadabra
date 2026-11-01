// Job: run the backbone
/* global globalThis */
// The seeding half of the J14 Experience step (lib/profile-experience-step.mjs seedSummary), played against a fake `window.pilot` over an in-memory Profile: the step itself needs
// the app and runs on main only, so its first run was a TypeError nobody saw on the PR (Gitar on #2841: textOutline's {ok, items} was passed whole to the parts model).
// Pure: no app, no window, no browser; every case ends on the first poll, so no clock is waited on.
import assert from 'node:assert/strict';
import {afterEach, test} from 'node:test';
import {seedSummary} from '../../lib/profile-experience-step.mjs';

const SEEDED = 'Platform engineer with 8 years on AWS, written by the e2e suite.';
const line = (id, text, type = 'paragraph') => ({id, type, text});

// A Profile in memory behind the two IPC calls the step uses; textEdit applies the three change kinds changesFor can hand it.
function fakeApp(items, {refuse = ''} = {}) {
  const asked = [];
  globalThis.window = {pilot: {
    textOutline: async () => ({ok: true, items: structuredClone(items), store: 'This Mac', link: null}),
    textEdit: async (name, changes) => {
      asked.push(...changes);
      if (refuse) return {ok: false, error: refuse};
      for (const change of changes) {
        if (change.op === 'text') items.find(item => item.id === change.id).text = change.value;
        else if (change.op === 'remove') items.splice(items.findIndex(item => item.id === change.id), 1);
        else if (change.op === 'section') items.push(line('H9', change.heading, 'heading_2'), ...change.lines.map((text, i) => line(`L9${i}`, text)));
        else throw new Error(`the fake app does not know ${change.op}`);
      }
      return {ok: true, items: structuredClone(items), saved: changes.length};
    },
  }};
  return {asked, ctx: {page: {evaluate: (fn, arg) => fn(arg)}}};
}
afterEach(() => { delete globalThis.window; });

test('a Profile with no summary gets one section with the seeded line', async () => {
  const {ctx, asked} = fakeApp([line('H1', 'Strengths', 'heading_2'), line('L2', 'Kubernetes at scale')]);
  await seedSummary(ctx);
  assert.deepEqual(asked.map(change => [change.op, change.lines]), [['section', [SEEDED]]]);
});

test('a Profile with another summary has that line rewritten and extra summary lines removed', async () => {
  const {ctx, asked} = fakeApp([line('H1', 'Summary (from CV)', 'heading_2'), line('L2', 'Someone else, long ago.'), line('L3', 'A second summary line.')]);
  await seedSummary(ctx);
  assert.deepEqual(asked.map(change => change.op).sort(), ['remove', 'text']);
});

test('a Profile that already holds the seeded line is left alone', async () => {
  const {ctx, asked} = fakeApp([line('H1', 'Summary (from CV)', 'heading_2'), line('L2', SEEDED)]);
  await seedSummary(ctx);
  assert.deepEqual(asked, []);
});

test('a textEdit the app refuses says why', async () => {
  const {ctx} = fakeApp([line('H1', 'Strengths', 'heading_2')], {refuse: 'Not saved: disk full'});
  await assert.rejects(seedSummary(ctx), /could not be put in the Profile: Not saved: disk full/);
});
