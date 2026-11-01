/* global document, window */
// The Interviews library, layer 2: what the window draws from the interviews this Mac's store hands it, moved from the e2e `interviews` suite (1 Nov 2026). The jobs and interviews
// are the engine's own answers for a seeded SQLite store (screen-interviews-kit.js), shown in the app's demo window, no Notion, no AI.
// Nothing of Interviews stays in e2e (owner, 1 Nov 2026: only Tier 1 journeys are e2e). The links and the writes through the app are desktop/integration/store/interviews-flow.test.mjs; the one-time setup banner is here,
// given the app's own progress steps (a test run never starts the real setup). Delete: the window's message, and the store's delete in interviews-flow (the window is read-only to the main process).
import assert from 'node:assert/strict';
import {after, before, test} from 'node:test';
import {needsElectron} from '../../test/needs-electron.js';
import {interviewsKit, interviewsStore} from './screen-interviews-kit.js';
import {probeWindow} from './window-probe.js';

const live = {skip: needsElectron.skip};
let held, window1;

before(async () => {
  held = await interviewsStore();
  if (needsElectron.skip) return;
  const {seed} = held, want = id => seed[id].id;
  window1 = probeWindow({files: held.files, use: [interviewsKit], settings: {store: 'sqlite'}, timeout: 180000, script: new Function('kit', `return (${async (kit, ids) => {
    const out = {};
    const section = async (name, read) => { try { out[name] = await read(); } catch (error) { out[name] = {error: error.message}; } };
    window.confirm = () => true;   // the person agrees to "Delete …?"
    out.jobCount = await kit.readJobs();
    await section('library', async () => {
      await kit.open(4);
      return {order: kit.ids(), stats: kit.stats(), outcomes: Object.fromEntries(Object.entries(ids).map(([key, id]) => [key, kit.cell(id, 4)])), layout: kit.severe('interviews')};
    });
    await section('jobs', async () => {
      const acme = kit.cell(ids.positive, 1), none = kit.cell(ids.negative, 1);
      kit.jobButton(ids.positive, 'E2E Acme').click();
      await kit.until(() => document.querySelector('.view[data-view="jobs"]:not([hidden])'), 'the Jobs list to open');
      const shown = await kit.until(() => { const rows = [...document.querySelectorAll('.view[data-view="jobs"]:not([hidden]) .job-row')].map(one => one.innerText); return rows.length === 1 && rows; }, 'the Jobs list to show only the Acme job');
      return {acme, none, shown};
    });
    await section('filters', async () => {
      await kit.open(4);
      await kit.type('#iv-filter', 'beta', 1);
      const beta = kit.ids();
      await kit.type('#iv-filter', 'zzz-no-such-interview', 0);
      const emptyShown = await kit.until(() => !document.getElementById('iv-empty').hidden && document.getElementById('iv-empty').innerText, 'the empty-search line');
      await kit.type('#iv-filter', '', 4);
      await kit.pick('#iv-outcome', 'none', 1);
      const none = kit.ids();
      await kit.pick('#iv-outcome', 'negative', 1);
      const negative = kit.ids();
      await kit.pick('#iv-outcome', '', 4);
      return {beta, emptyShown, none, negative};
    });
    await section('review', async () => {
      await kit.open(4);
      kit.press(ids.positive, 'Open review');
      const dialog = await kit.until(() => document.querySelector('#review-dialog[open]'), '"Open review" to open the review in the app');
      const text = await kit.until(() => dialog.innerText.includes('SEED summary') && dialog.innerText, 'the review text to show');
      // Close with its own button: a script's key event is not a trusted Escape, which is what closes a modal <dialog>.
      document.querySelector('#review-dialog button[aria-label="Close"]').click();
      await kit.until(() => !document.querySelector('#review-dialog[open]'), 'the review to close');
      return {text};
    });
    await section('consent', async () => {
      await kit.open(4);
      const record = document.getElementById('iv-record'), consent = document.getElementById('iv-consent');
      const before = {off: record.disabled, title: record.title, box: document.getElementById('iv-consent-box').innerText};
      consent.click(); await kit.until(() => !record.disabled, 'Record to turn on after the consent box is ticked');
      consent.click(); await kit.until(() => record.disabled, 'Record to turn off after the consent box is unticked');
      return before;
    });
    // The one-time setup banner (J18, moved from the e2e `interviews` suite, 1 Nov 2026): a test run never starts the real setup, so the page is given the app's own progress steps.
    await section('banner', async () => {
      await kit.open(4);
      const {drawInterviewProgress} = await import('./pages/interviews-setup.js');
      const banner = () => ({shown: !document.getElementById('iv-setup').hidden, text: document.getElementById('iv-setup-text').textContent,
        bar: document.getElementById('iv-setup-bar').hidden ? null : document.getElementById('iv-setup-fill').style.width});
      const draft = () => ({shown: !document.getElementById('iv-progress').hidden, text: document.getElementById('iv-progress-text').textContent, percent: document.getElementById('iv-progress-percent').textContent});
      const open = 'the-open-draft';
      // A setup step carries the id of the draft the person is reading or of none: either way the banner shows, the draft's own line only for its own id.
      drawInterviewProgress({id: 'another-draft', percent: 40, setup: true, text: 'Downloading the speech models, only the first time (about 520 MB): asr'}, open);
      const downloading = banner(), notMine = draft(), layout = kit.severe('interviews');
      drawInterviewProgress({id: open, percent: null, setup: true, text: 'Unpacking the speech models (asr), a minute or two'}, open);
      const unpacking = banner(), mineUnknown = draft();
      drawInterviewProgress({id: open, percent: 10, text: 'Writing down what was said'}, open);
      return {downloading, unpacking, transcribing: banner(), notMine, mineUnknown, mine: draft(), layout};
    });
    await section('delete', async () => {
      await kit.open(4);
      await kit.choose(ids.neutral, /^Delete$/);
      // Demo mode writes nothing, so the page's re-read draws the same four rows again: what it says is the check here; the store's own list is below.
      const message = await kit.until(() => /Deleted/.test(document.getElementById('iv-message').textContent) && document.getElementById('iv-message').textContent, 'the "Deleted" line');
      return {message};
    });
    return out;
  }})(kit, ${JSON.stringify({positive: want('ivPositive'), neutral: want('ivNeutral'), negative: want('ivNegative'), fresh: want('ivFresh')})})`)});
});
after(() => held?.store.remove());

const facts = name => { const value = window1.result[name]; assert.equal(value?.error, undefined, `${name}: ${value?.error}`); return value; };

test('the app reads the new jobs, as it does when the Jobs page has loaded', live, () => {
  assert.ok(window1.result.jobCount >= 3, `the app's job list has ${window1.result.jobCount} job(s) after three were added to the store`);
});

test('the library lists every interview, newest first, with its outcome', live, () => {
  const {order, stats, outcomes} = facts('library'), {seed} = held;
  assert.deepEqual(order, [seed.ivFresh, seed.ivNegative, seed.ivNeutral, seed.ivPositive].map(item => item.id), 'the rows are not newest first');
  assert.deepEqual(outcomes, {positive: 'Positive', neutral: 'Neutral', negative: 'Negative', fresh: 'Not reviewed'});
  assert.equal(stats, 'Saved in Jobadabra', 'the library does not say where it is kept');
});

test('the library shows each interview\'s job by name (opening it in the Jobs list), and "Link a job" when there is none', live, () => {
  const {acme, none, shown} = facts('jobs');
  assert.match(acme, /E2E Acme/, `the Acme interview shows the job "${acme}"`);
  assert.match(none, /Link a job/, `an interview without a job does not offer "Link a job": "${none}"`);
  assert.ok(shown.length === 1 && /Acme/.test(shown[0]), `the Jobs list shows ${JSON.stringify(shown)} after opening the Acme job, expected only that one`);
});

test('the search box and the outcome filter narrow the library, and say so when nothing matches', live, () => {
  const {beta, emptyShown, none, negative} = facts('filters'), {seed} = held;
  assert.deepEqual(beta, [seed.ivNeutral.id], 'searching "beta" did not leave the Beta interview');
  assert.match(emptyShown, /No interview matches/);
  assert.deepEqual(none, [seed.ivFresh.id], '"Not reviewed" did not leave the one unreviewed interview');
  assert.deepEqual(negative, [seed.ivNegative.id]);
});

test('a reviewed row opens its review in the app', live, () => {
  const {text} = facts('review');
  assert.match(text, /E2E Acme · Round 1/);
  assert.match(text, /SEED summary ivPositive/, 'the review shown is not this interview\'s');
  assert.deepEqual(window1.host.filter(call => call.api === 'shell.openExternal'), [], '"Open review" also opened something outside the app');
});

test('Record stays off until everyone has agreed, and says why', live, () => {
  const {off, title, box} = facts('consent');
  assert.equal(off, true, 'Record is enabled before the consent box is ticked');
  assert.match(title, /everyone on the call agreed/i, `the disabled Record button gives no reason: title "${title}"`);
  assert.match(box, /Recording consent required/, 'the consent notice is not on the page');
});

test('the one-time setup banner shows its step and percent, then goes away when transcribing starts; a draft\'s own line is drawn only for its own id', live, () => {
  const {downloading, unpacking, transcribing, notMine, mineUnknown, mine, layout} = facts('banner');
  assert.equal(downloading.shown, true, 'the banner is not on screen while the speech models download');
  assert.ok(/asr 40%/.test(downloading.text) && downloading.bar === '40%', `the setup banner shows "${downloading.text}" with a bar of ${downloading.bar}, expected asr 40% and 40%`);
  assert.equal(unpacking.shown, true);
  assert.equal(unpacking.bar, null, 'the bar stays while the percent is unknown');
  assert.equal(transcribing.shown, false, 'the banner is still on screen after transcribing started');
  assert.equal(notMine.shown, false, 'a step for another draft drew the open draft\'s own progress line');
  assert.deepEqual([mineUnknown.shown, mineUnknown.percent], [true, ''], 'the open draft\'s progress line is missing, or shows a percent nobody sent');
  assert.deepEqual([mine.text, mine.percent], ['Writing down what was said', '10%'], 'the open draft\'s progress line does not show its own step');
  assert.deepEqual(layout, [], 'the banner has layout problems');
});

test('Delete, once the person agrees, says which interview was deleted', live, () => {
  // The window only shows the "Deleted …" line: demo mode writes nothing, and the bridge to the main process (window.pilot) is read-only, so which id the page asks the
  // main process to delete is not seen here. The delete itself (the id reaches the store) is interviews-flow.test.mjs 'Delete takes an interview out of the store'.
  const {message} = facts('delete');
  assert.match(message, /Deleted "E2E Beta · Round 2"/, `no confirmation after deleting: "${message.trim()}"`);
});

test('the engine\'s own delete takes an interview out of the list the page draws (not through the window)', () => {
  const {seed, store} = held;
  const gone = store.engine('src.ai.interviews', 'delete', seed.ivNeutral.id);
  assert.equal(gone.ok, true, JSON.stringify(gone));
  assert.deepEqual(store.engine('src.ai.interviews', 'list').interviews.map(row => row.id).sort(), [seed.ivFresh, seed.ivNegative, seed.ivPositive].map(item => item.id).sort(), 'the interview is still in the store after Delete');
});

test('the Interviews page renders without layout problems', live, () => {
  assert.deepEqual(facts('library').layout, []);
});
