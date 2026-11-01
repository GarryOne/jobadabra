/* global document, window, localStorage */
// Focus, layer 2: the five ways to finish an Up next card, moved from the e2e `focus` and `focusdismiss` suites (5 Oct 2026, owner: a card was dismissed, came back after a
// refresh, then left again). The window side: each card leaves at once, stays gone after a refresh and after a reload while the engine still lists it (the in-app hold,
// pages/focus.js, covers the store's lag). The store side: the engine command each button runs, and the next payload no longer lists the card ("once the hold is over").
import assert from 'node:assert/strict';
import {after, before, test} from 'node:test';
import {actionScenario, scenario} from '../../e2e/lib/focus-data.mjs';
import {STAGES} from '../../lib/outcomes.js';
import {focusKit} from './screen-focus-kit.js';
import {needsElectron} from '../../test/needs-electron.js';
import {newStore, seed} from './screen-store.js';
import {probeWindow} from './window-probe.js';

const NOW = new Date();
// [who, the card's kind in the payload, how it is finished, the engine command that button runs (lib/pipeline-commands.js), a matcher for the card's headline]
const WAYS = [
  {who: 'Osprey Agency', kind: 'details', how: ['button', 'Skip'], run: (id) => ['src.focus', 'done', id, 'details_skipped'], card: /Osprey Agency/},
  {who: 'Plover Partners', kind: 'reply', how: ['button', 'Done'], run: (id) => ['src.focus', 'done', id, 'replied'], card: /Plover Partners/},
  {who: 'Wren Labs', kind: 'feedback', how: ['menu', 'Skip this request'], run: (id) => ['src.feedback', id, 'skip'], card: /Wren Labs/},
  {who: 'Heron Data', kind: 'prepare', how: ['menu', 'Dismiss interview'], run: (id) => ['src.ai.interviews', 'cancelled', id], card: /Prepare.*Heron Data/},
  {who: 'Lark Systems', kind: 'nudge', how: ['menu', "I'm out: withdraw"], run: (id, item) => ['src.notion.ledger', 'event', item.job_url, STAGES.withdrawn, '--note', 'Marked in Jobadabra', '--source', 'CLI'], card: /Lark Systems/},
];
let store, payload, ran;

before(() => {
  store = newStore();
  seed(store, actionScenario(NOW));
  payload = store.engine('src.focus');
  if (needsElectron.skip) return;
  ran = probeWindow({use: [focusKit], settings: {store: 'sqlite'}, files: {'focus.json': payload}, script: async kit => {
    const ways = [['Osprey Agency', ['button', 'Skip']], ['Plover Partners', ['button', 'Done']], ['Wren Labs', ['menu', 'Skip this request']], ['Heron Data', ['menu', 'Dismiss interview']], ['Lark Systems', ['menu', "I'm out: withdraw"]]];   // WAYS, as the window needs it (the script is serialised)
    window.confirm = () => true;   // "Dismiss the interview with …?" is a native question; the person's yes
    await kit.until(() => document.querySelector('.nav[data-view=focus]:not([hidden])'), 'the menu');
    await kit.open(); kit.showAll();
    const out = {};
    const finish = async (who, [how, label]) => {
      const li = kit.row(who);
      if (!li) return {present: false};
      if (how === 'button') kit.press(li, label);
      else {
        li.querySelector('.ui-more').click();
        const item = await kit.until(() => [...document.querySelectorAll('[role="menuitem"]')].find(one => one.textContent.trim() === label), `the menu item "${label}"`);
        item.click();
      }
      await kit.until(() => !kit.row(who), `the card of ${who} to leave at once`, 5000);
      return {present: true, leftAtOnce: true};
    };
    for (const [who, how] of ways) out[who] = await finish(who, how);
    await kit.refresh(); kit.showAll();
    out.afterRefresh = ways.map(([who]) => ({who, back: !!kit.row(who)}));
    return out;
  }, after: async (kit, before) => {
    const ways = ['Osprey Agency', 'Plover Partners', 'Wren Labs', 'Heron Data', 'Lark Systems'];
    await kit.until(() => document.querySelector('.nav[data-view=focus]:not([hidden])'), 'the menu');
    await kit.open(); kit.showAll();
    // How long the saved holds still last after the reload (pages/focus.js HOLD_MS): the shortest, in ms.
    const holds = Object.values(JSON.parse(localStorage.getItem('focusHolds') || '{}')).map(until => until - Date.now());
    return {...before, afterReload: ways.map(who => ({who, back: !!kit.row(who)})), holdLeftMs: holds.length ? Math.min(...holds) : null};
  }, env: {}});
});
after(() => store?.remove());
const live = {skip: needsElectron.skip};

for (const way of WAYS) {
  test(`Up next "${way.kind}" card: ${way.how[0] === 'button' ? `${way.how[1]} button` : `⋯ ${way.how[1]}`} removes it for good (leaves at once, not back after a refresh or a reload)`, live, () => {
    assert.ok(ran.result[way.who].present, `no ${way.kind} card for ${way.who} appeared`);
    assert.equal(ran.result[way.who].leftAtOnce, true, `the ${way.kind} card for ${way.who} is still listed 5 seconds after ${way.how[1]}`);
    assert.equal(ran.result.afterRefresh.find(one => one.who === way.who).back, false, `the ${way.kind} card for ${way.who} came back after a refresh`);
    assert.equal(ran.result.afterReload.find(one => one.who === way.who).back, false, `the ${way.kind} card for ${way.who} is listed again after a reload`);
  });
}

// A planted code bug (desktop/e2e/mutants.json focus-hold-one-minute; 5 Oct 2026, the hold ended after a minute): a hold shorter than the store takes to list a write
// lets a dismissed card come back. The store can take minutes (#315), so after the reload every hold still has minutes left, not seconds.
test('the in-app hold on a dismissed card outlives the store\'s lag: minutes are left after the reload', live, () => {
  assert.ok(ran.result.holdLeftMs !== null, 'no hold was saved for the dismissed cards');
  assert.ok(ran.result.holdLeftMs >= 5 * 60000, `the shortest hold has ${Math.round(ran.result.holdLeftMs / 1000)} s left after the reload`);
});

test('once the in-app hold is over, none of the dismissed Up next cards comes back from the store', () => {
  const item = way => payload.items.find(one => one.kind === way.kind && way.card.test(one.headline || ''));
  for (const way of WAYS) assert.ok(item(way), `the engine lists no ${way.kind} card for ${way.who}`);
  const commands = WAYS.map(way => [way, item(way)]);
  for (const [way, one] of commands) store.engine(...way.run(one.page_id, one));
  const next = store.engine('src.focus');
  const back = commands.filter(([way]) => next.items.concat(next.suggestions || []).some(one => way.card.test(one.headline || one.title || '') && (way.kind !== 'prepare' || one.kind === 'prepare')));
  assert.deepEqual(back.map(([way]) => way.who), [], 'dismissed cards are still listed by the engine after their dismissal was saved');
});

// A job dismissed while in process (3 Oct 2026: it was bouncing back to "Interview scheduled"): the store half. The Jobs list is the engine's own (`python -m src.desktop jobs`)
// for the dummy search. "It leaves at once" is not drawn here: the demo window answers a status change with "Demo mode: nothing is sent" (lib/demo.js BLOCKED); it is the renderer's (jobs-render.js setStatus → jobsChanged). The late-listing half is integration/store/dismiss-in-process.test.mjs (J19; the e2e `focusdismiss` suite is deleted).
const EMBER = 'https://jobs.e2e.test/ember/platform';
test('a job dismissed in process is Closed in the store, and the Jobs list built from it no longer has it in process', live, () => {
  const jobsStore = newStore();
  try {
    seed(jobsStore, scenario(NOW));
    const inProcess = () => probeWindow({settings: {store: 'sqlite'}, files: {'jobs.json': jobsStore.engine('src.desktop', 'jobs')}, script: async kit => {
      await kit.until(() => document.querySelector('.nav[data-view=focus]:not([hidden])'), 'the menu');
      await kit.go('jobs');
      document.querySelector('.stat[data-stat="interviews"]').click();
      await kit.until(() => document.querySelector('#jobs-body .job-row') && !document.querySelector('#jobs-body .list-loading'), 'the In process list');
      return [...document.querySelectorAll('#jobs-body .job-row')].map(row => row.innerText.replace(/\s+/g, ' ')).filter(row => row.includes('Ember Data'));
    }}).result;
    assert.match(inProcess().join(' '), /Interview scheduled/, 'the Ember Data row should start as "Interview scheduled"');
    jobsStore.engine('src.desktop', 'status', EMBER, 'dismissed');   // lib/pipeline-commands.js setStatus
    assert.equal(jobsStore.call('applications', 'get', {url: EMBER}).stage, 'Closed');
    assert.deepEqual(inProcess(), [], 'the dismissed job is back in the In process list');
  } finally { jobsStore.remove(); }
});
