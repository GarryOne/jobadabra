/* global document */
// The night's pictures of the screens' error and empty states, for the night's AI screenshot review (e2e.yml integration-shots, night pass 1). One launch of the demo window per state, built by the
// kits the screen tests use; the state is asserted INSIDE the window (a throw is a red test and keeps no picture), then the app's end-of-run picture is copied to E2E_SHOTS_DIR/ui-<name>.png (window-probe.js `picture`).
// Why (1 Nov 2026, owner: "Also add integration shots"; "restores a detector, report only"): the screens' error and empty states were asserted in words but never looked at. Without E2E_SHOTS_DIR (every PR run) no
// state test is registered, so a PR launches nothing extra; the one test below always runs. REPORT ONLY: nothing gates on this file. Not here yet: the wizard's refused key and Apply's "Retry apply" (their setup
// lives inside screen-wizard.test.js and screen-apply.test.js, not in a kit); offline and Notion 429 have no screen in desktop/integration/app yet.
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {TOKYO} from '../../e2e/lib/interview-data.mjs';
import {needsElectron} from '../../test/needs-electron.js';
import {FAILED_STATES, activityKit, demoFocus, indexOf, stateFiles, withData} from './screen-activity-kit.js';
import {NOW, calendarFiles, calendarKit} from './screen-calendar-kit.js';
import {enginePayload, focusKit} from './screen-focus-kit.js';
import {interviewsKit, interviewsStore} from './screen-interviews-kit.js';
import {newStore} from './screen-store.js';
import {probeWindow} from './window-probe.js';

const live = {skip: needsElectron.skip};
/** What each failed run's screen says, as the window draws it (read from the app, 1 Nov 2026): the words only that state has, so the state is the one the picture is named for. The pattern is matched in the window. */
const SCREEN = {
  limit: 'Your API spend limit was reached', credits: 'API credits are exhausted', telegram: 'Telegram message not delivered',
  google: 'Google sign-in expired or was revoked', unexplained: 'An unexpected error interrupted this run', queued: 'waiting for another Jobadabra run',
};
const SAYS = Object.fromEntries(Object.entries(SCREEN).map(([key, text]) => [key, text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')]));
const PICTURES = [...Object.keys(FAILED_STATES).map(key => `activity-failed-${key}`), 'calendar-empty', 'focus-empty-account', 'interviews-search-empty'];

test('every picture of the night has its own lower case name, and each failed run has words only its own screen says', () => {
  assert.equal(new Set(PICTURES).size, PICTURES.length);
  for (const name of PICTURES) assert.match(name, /^[a-z0-9-]+$/);
  assert.deepEqual(Object.keys(SAYS), Object.keys(FAILED_STATES));
  for (const [key, pattern] of Object.entries(SAYS)) {
    for (const [other, text] of Object.entries(SCREEN)) assert.equal(new RegExp(pattern, 'i').test(text), key === other, `/${pattern}/ ${key === other ? 'does not match its own screen' : `also matches the ${other} screen`}`);
  }
});

if (process.env.E2E_SHOTS_DIR) {
  for (const [key, state] of Object.entries(FAILED_STATES)) {
    test(`Recent activity: the ${key} run, as a person sees it`, live, () => {
      probeWindow({files: stateFiles(Date.now(), demoFocus()), use: [activityKit], timeout: 180000, picture: `activity-failed-${key}`,
        script: withData({index: indexOf(state), says: SAYS[key], key}, async (kit, {index, says, key: name}) => {
          await kit.until(() => document.querySelector('.nav[data-view=focus]:not([hidden])'), 'the menu');
          await kit.openRuns();
          await kit.select(index);
          const words = kit.readable();
          if (kit.text('#activity-status').trim() === 'Completed' && name !== 'telegram') throw new Error(`the ${name} run says plain Completed`);
          if (!new RegExp(says, 'i').test(words)) throw new Error(`the ${name} run's screen does not say /${says}/: ${words.slice(0, 300)}`);
          return true;
        })});
    });
  }

  test('Calendar with nothing scheduled', live, () => {
    const store = newStore();
    try {
      const none = {jobs: store.engine('src.desktop', 'calendar'), recordings: store.engine('src.ai.interviews', 'calendar')};
      probeWindow({files: calendarFiles(none), use: [calendarKit], env: {TZ: TOKYO}, settings: {store: 'sqlite'}, timeout: 180000, picture: 'calendar-empty',
        script: withData({now: NOW}, async (kit, {now}) => {
          kit.pin(now);
          await kit.open();
          const {upcomingText, pastText} = kit.agenda();
          if (!/No upcoming interviews/.test(upcomingText) || !/No past meetings yet/.test(pastText)) throw new Error(`the calendar does not say it is empty: ${upcomingText} | ${pastText}`);
          return true;
        })});
    } finally { store.remove(); }
  });

  test('Focus of a fresh account: nothing waits, one suggested next step', live, () => {
    const store = newStore();
    try {
      probeWindow({files: {'focus.json': enginePayload(store)}, use: [focusKit], settings: {store: 'sqlite'}, timeout: 180000, picture: 'focus-empty-account',
        script: async kit => {
          await kit.until(() => document.querySelector('.nav[data-view=focus]:not([hidden])'), 'the menu');
          await kit.open();
          await kit.refresh();
          kit.showAll();
          if (document.querySelector('#focus-empty').hidden) throw new Error('Up next is not empty on a fresh account');
          if (document.querySelector('.view[data-view="focus"] .skeleton')) throw new Error('a skeleton is still showing');
          return true;
        }});
    } finally { store.remove(); }
  });

  test('Interviews when a search finds nothing', live, async () => {
    const held = await interviewsStore();
    try {
      probeWindow({files: held.files, use: [interviewsKit], settings: {store: 'sqlite'}, timeout: 180000, picture: 'interviews-search-empty',
        script: async kit => {
          await kit.readJobs();
          await kit.open(4);
          await kit.type('#iv-filter', 'zzz-no-such-interview', 0);
          const line = await kit.until(() => !document.getElementById('iv-empty').hidden && document.getElementById('iv-empty').innerText, 'the empty-search line');
          if (!/No interview matches/.test(line)) throw new Error(`the empty search says: ${line}`);
          return true;
        }});
    } finally { held.store.remove(); }
  });
}
