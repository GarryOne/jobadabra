/* global document, MutationObserver */
// Job: serve stored answers
// The dismissal half of Focus, on a REAL Notion page (6 Oct 2026; the rest of the Focus checks moved to desktop/test/screen-focus*.test.js on 1 Nov 2026, owner: "I'd like the beta
// to have only the critical e2e/user journeys"). What stays here is what a window on a fake store cannot prove: the five ways to finish an Up next card against a store that lists a write
// LATE (the stand-in's lag, lib/notion-fake.mjs setLag), the in-app hold that covers that lag, and Dismiss on a job in process written through the real app.
import {actionScenario, addFocusData, resetFocusData, readData, scenario} from '../lib/focus-data.mjs';
import {finish} from '../lib/layout.mjs';
import {ensureSetUp} from '../lib/seed.mjs';
import {pollUntil, stepTimeLeft, stepWait} from '../lib/wait-on-state.mjs';

export const name = 'focusdismiss';
export const keepGoing = true;
// Why (30 Oct 2026, #2601): setup's contact_from_cv ask already has a reviewed kind reply; do not depend on a hash cache or live AI.
export const aiAnswers = 'backbone';
// Why (30 Oct 2026, #2601): dismissal steps inject Notion listing lag with ctx.standIn.setLag; keep that existing fault path reachable.
export const store = 'standin';
export const minutes = 15;
// What a step needs from an earlier one when E2E_STEPS picks it (lib/runner.mjs wantedWords).
export const stepNeeds = {'in-app hold': ['five more Up next', 'removes it for good'], 'removes it for good': ['five more Up next']};
/** The suite entry: runs the dismissal steps in order on ctx; a failing step is reported by the runner. */
export const run = ctx => runFocus(ctx);

const LIST_LAG_MS = 15000;   // the stand-in's listing lag for the dismissal steps (lib/notion-fake.mjs setLag)
const ERROR_WORDS = /\b(undefined|null|NaN|\[object|TypeError|Traceback|ENOENT|ECONN|could not load|stack)\b/i;

async function runFocus(ctx) {
  const {page} = ctx;
  ctx.findings = [];
  const now = new Date();
  let rows, events;

  const focusReady = () => stepWait('the Focus view finished refreshing', timeout => page.waitForFunction(() => /^Updated/.test(document.querySelector('#focus-status')?.textContent || '')
    && !document.querySelector('#focus-refresh').disabled
    && !document.querySelector('.view[data-view="focus"] .skeleton, .view[data-view="focus"] .spinner'), null, {timeout}));
  const refresh = async () => { await page.click('#focus-refresh'); await focusReady(); };
  const goFocus = async () => { await page.click('.nav[data-view="focus"]'); await page.waitForSelector('.view[data-view="focus"]:not([hidden])'); };
  const rowsIn = list => page.evaluate(list => [...document.querySelectorAll(`${list} .focus-item`)].map(li => ({
    headline: li.querySelector('.focus-headline')?.textContent.trim() || '', badge: li.querySelector('.ui-pill')?.textContent.trim() || '',
    meta: li.querySelector('.focus-meta')?.textContent.trim() || '', kind: li.dataset.suggestion || '',
    buttons: [...li.querySelectorAll('.focus-actions > button:not(.ui-more)')].map(button => button.textContent.trim()),
    hasMore: !!li.querySelector('.focus-actions .ui-more')})), list);
  // Up next holds what can't wait; Suggestions the rest (pages/focus-suggestions.js; owner, 28 Oct 2026). Both lists: a card is looked for in either.
  const LISTS = '#focus-list .focus-item, #focus-suggestions-list .focus-item';
  const upNext = () => rowsIn('#focus-list');
  // The window's own rows (cover letter, Fill your details, What we learned, the LinkedIn offer) lead Suggestions and are not the engine's (renderer/question-entries.js).
  const DRAWER_KINDS = ['linkedin', 'letter', 'details', 'learned', 'questions-error'];
  const suggested = async () => (await rowsIn('#focus-suggestions-list')).filter(row => !DRAWER_KINDS.includes(row.kind));
  const anyRow = headline => page.locator(LISTS, {has: page.locator('.focus-headline', {hasText: headline})});
  // Suggestions shows 3, then "Show all N"; the choice is remembered, so one press lists every row from here on (a folded row is not drawn at all).
  const showAll = async () => { const all = page.locator('#focus-suggestions-all'); if (await all.isVisible() && /^Show all/.test(await all.textContent())) await all.click(); };
  const readStore = async () => ({rows, events} = await readData(ctx));
  // Wait for the saved event, including stores whose listing can lag a write.
  const eventsOf = async (kind, who) => {
    const {value: found} = await pollUntil(async () => {
      const row = (await ctx.data('applications', 'list', {})).find(item => item.company === who || item.via === who);
      return row ? await ctx.data('events', 'list', {app_id: row.id, kind}) : [];
    }, found => found.length > 0, {capMs: stepTimeLeft()});
    return found;
  };

  await ensureSetUp(ctx);
  await ctx.run('a search with applications in every stage is written to the store (dummy employers, target 5)', async () => {
    await resetFocusData(ctx, {data: scenario(now)});
    await pollUntil(readStore, data => data.rows.length === 10 && data.events.length === 14, {capMs: stepTimeLeft()});
    if (rows.length !== 10 || events.length !== 14) throw new Error(`expected 10 applications and 14 events in the store, found ${rows.length} and ${events.length}`);
  }, {needs: ctx.needs, critical: true});

  await ctx.run('Focus finishes loading with no error text', async () => {
    const started = Date.now();
    await goFocus();
    await focusReady();
    const seconds = (Date.now() - started) / 1000;
    const text = await page.evaluate(() => document.querySelector('.view[data-view="focus"]').innerText);
    const bad = text.match(ERROR_WORDS);
    if (bad) throw new Error(`Focus shows error-like text "${bad[0]}"`);
    console.log(`  clock: Focus loaded in ${seconds.toFixed(1)} s (promise 20 s; reported only)`);
  }, {needs: ctx.needs});

  // 5 Oct 2026 (owner): a card was dismissed from Up next, came back after a refresh, then left again. One card per way of finishing one (actionScenario):
  // each must leave at once, stay gone after a refresh, after a reload straight away (the saved Focus in lib/view-cache.js is painted first on every load)
  // and after a reload once Notion has had time. A MutationObserver from the first paint of every load records any moment the card is in the list.
  const actions = actionScenario(now, ` r${String(process.env.GITHUB_RUN_ID || Date.now().toString(36)).slice(-5)}`);   // names unique to this run
  await ctx.run('five more Up next cards, one for each way to finish one, are written to Notion', async () => {
    await addFocusData(ctx, actions);
    // Notion lists a write late (CI 6 Oct 2026: up to 2 min), which is what the in-app hold covers. The stand-in lags from here on, longer than a hold
    // cut short would last, so a dismissal the app does not hold comes back (27 Oct 2026: with no lag the three hold mutants survived, #1907 #1908 #1909).
    ctx.standIn?.setLag(LIST_LAG_MS);
    await page.addInitScript(() => {
      const watch = () => { try { return JSON.parse(localStorage.getItem('__e2eWatch') || '[]'); } catch { return []; } };
      new MutationObserver(() => {
        const watched = watch();   // [{key, source}]: the card's name and the pattern its headline matches
        if (!watched.length) return;
        for (const node of document.querySelectorAll('#focus-list .focus-headline, #focus-suggestions-list .focus-headline')) for (const {key, source} of watched) if (new RegExp(source).test(node.textContent)) sessionStorage.setItem(`__e2eSeen_${key}`, String(Date.now()));
      }).observe(document, {childList: true, subtree: true, characterData: true});
    });
  }, {needs: ctx.needs, critical: true});
  const seenOf = who => page.evaluate(name => sessionStorage.getItem(`__e2eSeen_${name}`), who);
  for (const action of actions.actions) {
    const [how, label] = Object.entries(action.how)[0];
    await ctx.run(`Up next "${action.kind}" card: ${how === 'button' ? `${label} button` : `⋯ ${label}`} removes it for good (leaves at once, not back after a refresh or a reload)`, async () => {
      const card = () => anyRow(new RegExp(action.card || action.who));
      await goFocus();
      await showAll();
      await pollUntil(async () => { await refresh(); return card().count(); }, count => count > 0, {capMs: stepTimeLeft()});
      if (!(await card().count())) throw new Error(`no ${action.kind} card for ${action.who} appeared; Focus lists: ${[...await upNext(), ...await suggested()].map(item => item.headline).join(' | ')}`);
      await page.evaluate(({key, source}) => { localStorage.setItem('__e2eWatch', JSON.stringify([{key, source}])); sessionStorage.removeItem(`__e2eSeen_${key}`); }, {key: action.who, source: action.card || action.who});
      if (action.how.confirm) page.once('dialog', dialog => dialog.accept());
      if (how === 'button') await card().getByRole('button', {name: label, exact: true}).click();
      else { await card().getByRole('button', {name: 'More'}).click(); await page.getByRole('menuitem', {name: label}).click(); }
      await card().waitFor({state: 'detached', timeout: 5000}).catch(() => { throw new Error(`the ${action.kind} card for ${action.who} is still listed 5 seconds after ${label}`); });
      await page.evaluate(name => sessionStorage.removeItem(`__e2eSeen_${name}`), action.who);   // watch from here: it must not return
      // Retained: optimistic removal precedes the save; Focus exposes no completion signal for these five different writes.
      await page.waitForTimeout(800);
      await focusReady();
      await refresh();
      if ((await card().count()) || await seenOf(action.who)) throw new Error(`the ${action.kind} card for ${action.who} came back after a refresh`);
      for (const [when, wait] of [['straight away', 0], ['once Notion has had time', 6000]]) {
        // Retained: the app exposes no signal for the end of Notion's listing lag; this second reload probes that later read.
        await page.waitForTimeout(wait);
        await page.reload();
        await page.waitForSelector('.view:not([hidden])', {timeout: 60000});
        await goFocus();
        await focusReady();
        if (await seenOf(action.who)) throw new Error(`the ${action.kind} card for ${action.who} was painted back after a reload ${when} (from the saved Focus, before the fresh read removed it)`);
        if (await card().count()) throw new Error(`the ${action.kind} card for ${action.who} is listed again after a reload ${when}`);
      }
    }, {needs: ctx.needs});
  }
  // The in-app hold (pages/focus.js HOLD_MS, ten minutes since 5 Oct 2026; dropped earlier once a read no longer has the row) hides a dismissed card until
  // Notion has it. Waiting 65 s for it to end checked nothing once the hold grew past that: the step ends any hold itself (localStorage) and reads Notion again.
  await ctx.run('once the in-app hold is over, none of the dismissed Up next cards comes back from Notion', async () => {
    console.log(`  ${await page.evaluate(() => Object.keys(JSON.parse(localStorage.getItem('focusHolds') || '{}')).length)} card(s) still held in the app; ending the hold`);
    await page.evaluate(() => localStorage.removeItem('focusHolds'));
    await page.reload();
    if (await page.evaluate(() => Object.keys(JSON.parse(localStorage.getItem('focusHolds') || '{}')).length)) throw new Error('a hold survived: this step would not see what Notion lists');
    await page.waitForSelector('.view:not([hidden])', {timeout: 60000});
    await goFocus();
    // Notion's query can list a just-written dismissal late (CI 6 Oct 2026: a "Details skipped" saved ok was still unlisted 2 min later; the app's 10-minute hold
    // covers that for a person). Re-read until no dismissed card returns, bounded by the running step's hang cap.
    const backNow = async () => [...await upNext(), ...await suggested()].filter(item => actions.actions.some(action => new RegExp(action.card || action.who).test(item.headline)));
    const {value: back} = await pollUntil(async () => { await refresh(); return backNow(); }, rows => !rows.length, {capMs: stepTimeLeft()});
    if (back.length) {
      const recorded = await Promise.all(back.map(async item => { const action = actions.actions.find(one => new RegExp(one.card || one.who).test(item.headline));
        if (action?.kind !== 'details') return item.headline;   // only a Skip of "Add details" leaves an event this step can look up
        return `${item.headline}: ${(await eventsOf('Details skipped', action.who).catch(() => [])).length ? 'its dismissal IS in Notion (the read lags)' : 'no dismissal event found in Notion'}`; }));
      throw new Error(`dismissed cards are still listed at the step's hang cap after the in-app hold ended: ${recorded.join(' | ')}`);
    }
  }, {needs: ctx.needs});

  await ctx.run('Dismiss on a job in process leaves the In process list at once, and is still gone after a reload (it was bouncing back to "Interview scheduled", 3 Oct 2026)', async () => {
    const ember = () => page.locator('#jobs-body .job-row', {hasText: 'Ember Data'});
    await page.click('.nav[data-view="jobs"]');
    await page.click('.stat[data-stat="interviews"]');
    await ember().waitFor({timeout: 30000});
    if (!/Interview scheduled/.test(await ember().innerText())) throw new Error('the Ember Data row should start as "Interview scheduled"');
    await ember().getByRole('button', {name: 'More actions'}).click();
    await page.getByRole('menuitem', {name: 'Dismiss'}).click();
    // At once: no waiting for a refresh. The screen must not claim a change Notion has not taken.
    await ember().waitFor({state: 'detached', timeout: 5000}).catch(() => { throw new Error('the dismissed job is still in the In process list 5 seconds after Dismiss'); });
    const stageInNotion = async () => (await ctx.data('applications', 'list', {})).find(item => item.company === 'Ember Data')?.stage;
    const {value: stage} = await pollUntil(stageInNotion, stage => stage === 'Closed', {capMs: stepTimeLeft()});
    if (stage !== 'Closed') throw new Error(`the store's stage for the dismissed job should be Closed, it is "${stage}"`);
    await page.reload();
    await page.waitForSelector('.view:not([hidden])', {timeout: 60000});
    await page.click('.nav[data-view="jobs"]');
    await page.click('.stat[data-stat="interviews"]');
    await stepWait('the Jobs list finished loading', timeout => page.waitForFunction(() => !document.querySelector('#jobs-body .list-loading')
      && !/Loading|Refreshing|updating/.test(document.querySelector('#jobs-stats')?.textContent || ''), null, {timeout}));
    if (await ember().count()) throw new Error(`after a reload the dismissed job is back in the In process list: "${(await ember().innerText()).replace(/\s+/g, ' ')}" (the store says ${await stageInNotion()})`);
    await goFocus();   // the next step starts on Focus
  }, {needs: ctx.needs});

  await ctx.run('Focus renders without layout problems, with data and without', async () => { finish(ctx); }, {needs: ctx.needs});
}
