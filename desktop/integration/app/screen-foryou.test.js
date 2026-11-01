/* global document */
// What the shared pool tells a person, layer 2: moved from the e2e `foryou` suite (7 Oct 2026; a manual suite, no schedule ran it since 26 Oct). The app's own window on
// the demo data: the Strategy card "Employers hiring people like you" and its way into the Jobs list, the job sources card staying away, the "Few new jobs" advice, a strategy draft's
// save bar, a suggested role's pop-up, Focus offering Strategy's search rows, and that every recommendation is recorded in fixed words (app.log area "advice").
// No Notion, no AI, no engine run: the demo's fictional files only.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {before, test} from 'node:test';
import {needsElectron} from '../../test/needs-electron.js';
import {probeWindow} from './window-probe.js';

const demo = JSON.parse(fs.readFileSync(new URL('../../demo/coverage.json', import.meta.url), 'utf8'));
const first = (demo.coverage || demo).for_you?.[0];
const live = {skip: needsElectron.skip};
let ran;

before(() => {
  assert.ok(first, 'desktop/demo/coverage.json has no for_you employers: the setup did not take');
  if (needsElectron.skip) return;
  ran = probeWindow({settings: {}, script: async kit => {
    const out = {};
    const $ = selector => document.querySelector(selector);
    const need = selector => $(selector) || (() => { throw new Error(`nothing matches ${selector}`); })();
    const shown = selector => { const node = $(selector); return !!node && node.offsetParent !== null; };
    const section = async (name, fn) => { try { out[name] = await fn(); } catch (error) { out[name] = {error: error.message}; } };
    const MARK = {'strategy-suggestions': '#strategy-ideas', 'strategy-yours': '#strategy-main-goals .card-edit'};   // a thing only that tab draws
    const strategyTab = async tab => { await kit.go('strategy'); $(`[data-tab=${tab}]`).click(); await kit.until(() => !MARK[tab] || shown(MARK[tab]), `the ${tab} tab`); };
    const menuItem = async label => (await kit.until(() => [...document.querySelectorAll('[role="menuitem"]')].find(item => item.textContent.trim() === label), `the menu item "${label}"`)).click();
    await kit.until(() => $('.nav[data-view=focus]:not([hidden])'), 'the menu');

    await section('opens', async () => { await strategyTab('strategy-suggestions'); await kit.until(() => shown('#strategy-foryou'), 'the row "Employers hiring people like you"'); return {ok: true}; });
    await section('review', async () => {
      $('#strategy-foryou [data-review]').click();
      await kit.until(() => document.querySelectorAll('#foryou-chips .option-row b').length, 'the employers\' chips');
      return {chips: [...document.querySelectorAll('#foryou-chips .option-row b')].map(node => node.innerText)};
    });
    await section('chip', async () => {
      $('#foryou-chips button').click();
      await kit.until(() => $('.view[data-view=jobs]:not([hidden])'), 'the Jobs list');
      const query = $('#filter-text').value;
      $('#filter-text').value = ''; $('#filter-text').dispatchEvent(new Event('input', {bubbles: true}));
      return {query};
    });
    await section('sources', async () => { await strategyTab('strategy-suggestions'); await kit.until(() => shown('#strategy-foryou'), 'the tab\'s rows'); return {drawn: document.querySelectorAll('#strategy-sources').length}; });
    await section('notNow', async () => {
      $('#strategy-foryou .ui-more').click();
      await menuItem('Not now');
      await kit.until(() => !shown('#strategy-foryou'), 'the employers row to hide');
      await kit.go('focus');
      await strategyTab('strategy-suggestions');
      await kit.until(() => shown('#strategy-ideas'), 'the other rows of the tab');
      return {backAfterVisit: shown('#strategy-foryou')};
    });
    await section('fewJobs', async () => {
      await kit.go('actions');
      $('[data-actions-tab="runs"]').click();
      await kit.until(() => !$('#actions-runs')?.hidden && $('#actions-runs #activity-recent'), 'the run list');
      for (let i = 0; i < 10 && shown('#activity-all'); i++) $('#activity-all').click();
      const count = document.querySelectorAll('#activity-recent li:not(.recent-group) button').length;
      for (let i = 0; i < count; i++) {
        if (shown('#activity-back')) $('#activity-back').click();
        const row = document.querySelectorAll('#activity-recent li:not(.recent-group) button')[i];
        row.click();
        // The run is drawn when its status is in words (Completed, With warnings, Failed, ...); its "Few new jobs" box is part of that card.
        await kit.until(() => /Completed|warnings|Failed|Stopped|Running|Queued/.test($('#activity-status')?.innerText || ''), `run ${i + 1} to be drawn`);
        if (shown('.run-card-help')) break;
      }
      if (!shown('.run-card-help')) throw new Error('no run shows the "Few new jobs" box (the demo has a check with 0 new jobs)');
      await kit.until(() => [...document.querySelectorAll('.run-card-help .item-action')].some(node => /^Review /.test(node.textContent)), 'the Review rows');
      return {review: [...document.querySelectorAll('.run-card-help .item-action')].filter(node => /^Review /.test(node.textContent)).length};
    });
    await section('reviewOpens', async () => {
      [...document.querySelectorAll('.run-card-help .item-action')].find(node => /^Review /.test(node.textContent)).click();
      await kit.until(() => document.querySelectorAll('.suggestion-detail .option-row').length && [...document.querySelectorAll('.suggestion-detail .option-row')].some(node => node.offsetParent !== null), 'the suggestion\'s options');
      return {ok: true};
    });
    await section('draft', async () => {
      const BAR = '#strategy-bar-host .page-save-bar';
      await strategyTab('strategy-yours');
      need('#strategy-main-goals .card-edit').click();
      const editors = document.querySelectorAll('.strategy-page .card-done').length;
      const field = need('#strategy-main-goals input.add[data-list=roles]');
      field.value = 'cashier'; field.dispatchEvent(new Event('input', {bubbles: true}));
      await kit.until(() => shown(BAR), 'the save bar after typing');
      const facts = {editors, badge: shown('#strategy-main-goals .unsaved-badge'), barText: $(BAR).innerText};
      need('[data-tab=strategy-scoring]').click();
      await kit.until(() => !shown('#strategy-main-goals'), 'the Scoring tab to replace Your strategy');
      facts.barOnOtherTab = shown(BAR);
      need('[data-tab=strategy-yours]').click();
      await kit.until(() => shown('#strategy-main-goals input.add[data-list=roles]'), 'the editor again');
      facts.kept = $('#strategy-main-goals input.add[data-list=roles]').value;
      document.querySelector('.nav[data-view=focus]:not([data-settings])').click();
      const leave = await kit.until(() => document.querySelector('dialog[open]:has(button[value="keep"]):has(button[value="discard"])'), 'the question about leaving a draft');
      leave.querySelector('button[value=keep]').click();
      await kit.until(() => !leave.open, 'the question to close');
      facts.stayed = shown('.view[data-view=strategy]');
      need(`${BAR} button.primary`).click();
      await kit.until(() => !shown(BAR), 'the save bar to clear after Save');
      return facts;
    });
    await section('suggestedRole', async () => {
      await strategyTab('strategy-suggestions');
      if ($('#strategy-ideas [data-review]').getAttribute('aria-expanded') !== 'true') $('#strategy-ideas [data-review]').click();
      await kit.until(() => $('#ideas-chips .option-row button'), 'the suggested roles');
      $('#ideas-chips .option-row button').click();
      const next = await kit.until(() => [...document.querySelectorAll('#toasts .toast.toast-link .toast-next')].find(node => node.textContent.includes('Find jobs')), 'the pop-up that offers Find jobs');
      return {next: next.textContent};
    });
    await section('focusRows', async () => {
      await kit.go('focus');
      const row = kind => `#focus-suggestions-list .focus-item[data-suggestion="${kind}"]`;
      await kit.until(() => shown('#focus-suggestions-all'), 'Show all');
      if (/Show all/.test($('#focus-suggestions-all').innerText)) $('#focus-suggestions-all').click();
      await kit.until(() => $(row('filters')), 'the search rows on Focus');
      const buttons = kind => [...document.querySelectorAll(`${row(kind)} .focus-actions > button:not(.ui-more)`)].map(node => node.innerText.trim());
      const facts = {places: buttons('places'), filters: buttons('filters')};
      [...document.querySelectorAll(`${row('filters')} .focus-actions > button`)].find(node => node.innerText.includes('See both')).click();
      await kit.until(() => shown('#strategy-filters-detail'), 'See both to open the filters row on Strategy');
      await kit.go('focus');
      $(`${row('places')} .ui-more`).click();
      await menuItem('Not now');
      await kit.until(() => !$(row('places')), 'the places row to leave Focus');
      await strategyTab('strategy-suggestions');
      await kit.until(() => shown('#strategy-ideas'), 'the other rows of the tab');
      facts.placesOnStrategy = shown('#strategy-places');
      return facts;
    });
    return out;
  }});
});

test('the demo window opens on Strategy with the shared pool\'s answer', live, () => assert.equal(ran.result.opens.error, undefined));

test('"Employers hiring people like you": Review lists employers with their interviews, and was recorded as shown', live, () => {
  assert.equal(ran.result.review.error, undefined);
  const chips = ran.result.review.chips;
  assert.ok(chips.length && chips[0].startsWith(first.company) && /\binterviews?\b/.test(chips[0]), `chips: ${JSON.stringify(chips)}`);
  assert.ok(advice().some(line => /shown employer on strategy/.test(line)), `no "shown employer" in app.log: ${advice().slice(-3).join(' | ')}`);
});

test('a chip opens the Jobs list searched for that employer, and is recorded as taken', live, () => {
  assert.equal(ran.result.chip.error, undefined);
  assert.equal(ran.result.chip.query, first.company);
  assert.ok(advice().some(line => /taken employer on strategy/.test(line)), 'no "taken employer" in app.log');
});

test('the job sources card is not offered: every source it could list needs a key of the person\'s own', live, () => {
  assert.equal(ran.result.sources.error, undefined);
  assert.equal(ran.result.sources.drawn, 0, 'the job sources row is drawn although key sources are not offered');
});

test('⋯ Not now hides the employers row, records it, and it stays hidden on the next visit', live, () => {
  assert.equal(ran.result.notNow.error, undefined);
  assert.equal(ran.result.notNow.backAfterVisit, false, 'back after leaving and coming back');
  assert.ok(advice().some(line => /dismissed employer on strategy/.test(line)), 'no "dismissed employer" in app.log');
});

test('a jobs check with few new jobs offers the same advice as rows with a Review button, recorded as shown', live, () => {
  assert.equal(ran.result.fewJobs.error, undefined);
  assert.ok(ran.result.fewJobs.review > 0, 'no Review rows');
  assert.ok(advice().some(line => /shown \w+ on few-jobs/.test(line)), 'no "shown … on few-jobs" in app.log');
});

test('Review opens Strategy with that suggestion\'s options showing', live, () => assert.equal(ran.result.reviewOpens.error, undefined));

test('a strategy draft: one card\'s editor, Unsaved badge, the page bar on every tab, typed text kept, leaving asks, Save clears it', live, () => {
  const draft = ran.result.draft;
  assert.equal(draft.error, undefined);
  assert.equal(draft.editors, 1, 'Edit opened more than one editor');
  assert.equal(draft.badge, true, 'no Unsaved badge on Main goals');
  assert.match(draft.barText, /Save strategy changes/, 'the bar does not say what it saves');
  assert.equal(draft.barOnOtherTab, true, 'the save bar left with the tab');
  assert.equal(draft.kept, 'cashier', 'typed text after a tab switch');
  assert.equal(draft.stayed, true, 'Keep editing left the page anyway');
});

test('adding a suggested role says the next step: the pop-up offers Find jobs', live, () => {
  assert.equal(ran.result.suggestedRole.error, undefined);
  assert.match(ran.result.suggestedRole.next, /Find jobs/);
});

test('Focus offers Strategy\'s search rows: the top option in one press, See both opens that row on Strategy, Not now hides it there too', live, () => {
  const rows = ran.result.focusRows;
  assert.equal(rows.error, undefined);
  assert.equal(rows.places[0], 'Add France', 'the places row offers its top option in one press');
  assert.deepEqual(rows.filters, ['Remove "senior"', 'See both']);
  assert.equal(rows.placesOnStrategy, false, 'the places row is still on Strategy after Not now on Focus');
});

test('what is recorded holds fixed words only: never a role word, a place or an employer\'s name', live, () => {
  const lines = advice();
  assert.ok(lines.length, 'nothing recorded');
  assert.deepEqual(lines.filter(line => line.includes(first.company) || /Gen[eè]v|Zurich|photograph/i.test(line)), [], 'free words in the record');
  assert.deepEqual(lines.filter(line => !/(shown|taken|dismissed) (role|place|filter|source|explain|employer|visit) on (strategy|few-jobs|focus)/.test(line)), [], 'not in the fixed shape');
});

function advice() { return ran.log.filter(line => /\badvice\b/.test(line)); }
