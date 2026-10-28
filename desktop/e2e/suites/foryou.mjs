// What the shared pool tells a person, in the real window on demo data (7 Oct 2026): the Strategy card "Where people like you get interviews" and its way
// into the Jobs list, the job sources card staying away while key sources are not offered, the "Few new jobs" chips after a check, and that every one of
// these recommendations is recorded as shown / taken / dismissed in fixed words (app.log area "advice"; the same event goes to technical reports).
// Its own demo window: no Notion, no AI, no engine run.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {DESKTOP, launch} from '../lib/app.mjs';
import {appLogLines} from '../lib/app-log.mjs';
import {LEAVE_DIALOG} from '../lib/leave-prompt.mjs';
import {backToList, openRunsList} from '../lib/runs-list.mjs';
const BAR = '#strategy-bar-host .page-save-bar';   // Strategy's one save bar (renderer/pages/strategy-cards.js)

export const name = 'foryou';
export const minutes = 3;
// No schedule, push or release gate runs it: the e2e audit dropped it (no catch in 30 days; owner's yes, 26 Oct 2026). Run it by name (cadence 'manual', lib/plan.mjs).
export const cadence = 'manual';
export const light = true;
export const keepGoing = true;

const text = (page, selector) => page.locator(selector).first().innerText().catch(() => '');
const advice = profile => { try { return appLogLines(profile).filter(line => /\badvice\b/.test(line)); } catch { return []; } };
const waitFor = async (check, ms = 5000) => { for (let waited = 0; waited < ms; waited += 200) { if (await check()) return true; await new Promise(done => setTimeout(done, 200)); } return false; };

export async function run(ctx) {
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'jp-foryou-'));
  for (const file of fs.readdirSync(path.join(DESKTOP, 'demo'))) fs.copyFileSync(path.join(DESKTOP, 'demo', file), path.join(profile, file));
  const demo = JSON.parse(fs.readFileSync(path.join(profile, 'coverage.json'), 'utf8'));
  const first = (demo.coverage || demo).for_you?.[0];
  let session = null, page = null;
  try {
    await ctx.run('the demo window opens on Strategy with the shared pool\'s answer', async () => {
      if (!first) throw new Error('desktop/demo/coverage.json has no for_you employers: the setup did not take');
      session = await launch({profile, env: {JOB_PILOTTO_DEMO: '1'}});
      page = session.page;
      await page.waitForSelector('.nav[data-view=focus]:not([hidden])', {timeout: 30000});
      await page.click('.nav[data-view=strategy]');
      await page.click('[data-tab=strategy-suggestions]');   // the rows live in the Suggestions tab
      if (!await waitFor(() => page.locator('#strategy-foryou:visible').count().then(n => n > 0), 15000)) throw new Error('the row "Employers hiring people like you" never showed');
    });

    await ctx.run('"Employers hiring people like you": Review lists employers with their interviews, and was recorded as shown', async () => {
      await page.click('#strategy-foryou [data-review]');
      const chips = await page.locator('#foryou-chips .option-row b').allInnerTexts();
      if (!chips.length || !chips[0].startsWith(first.company) || !/\binterviews?\b/.test(chips[0])) throw new Error(`chips: ${JSON.stringify(chips)}`);
      if (!await waitFor(async () => advice(profile).some(line => /shown employer on strategy/.test(line)))) throw new Error(`no "shown employer" in app.log: ${advice(profile).slice(-3).join(' | ')}`);
    });

    await ctx.run('a chip opens the Jobs list searched for that employer, and is recorded as taken', async () => {
      await page.locator('#foryou-chips button').first().click();
      await page.waitForSelector('.nav[data-view=jobs].active, .nav[data-view=jobs][aria-current]', {timeout: 5000}).catch(() => {});
      const query = await page.inputValue('#filter-text').catch(() => '');
      if (query !== first.company) throw new Error(`the Jobs search holds "${query}", not "${first.company}"`);
      if (!await waitFor(async () => advice(profile).some(line => /taken employer on strategy/.test(line)))) throw new Error('no "taken employer" in app.log');
      await page.fill('#filter-text', '');
      await page.dispatchEvent('#filter-text', 'input');
    });

    // 25 Oct 2026 (beta 0.8.30): the job sources row only ever lists the sources that need the person's own API key, and those are not offered
    // anywhere (renderer/key-sources.js, owner 24 Oct), so the row is not drawn; the step that waited for it went red on both platforms.
    await ctx.run('the job sources card is not offered: every source it could list needs a key of the person\'s own', async () => {
      await page.click('.nav[data-view=strategy]');
      await page.click('[data-tab=strategy-suggestions]');
      await page.waitForSelector('#strategy-foryou:visible', {timeout: 10000});   // the tab has drawn its rows
      if (await page.locator('#strategy-sources').count()) throw new Error('the job sources row is drawn although key sources are not offered');
    });

    // Insights PR 1b (owner, 28 Oct 2026): "Hide until the next search" became Not now (14 days) / Not true, the answer every suggestion takes.
    await ctx.run('⋯ Not now hides the employers row, records it, and it stays hidden on the next visit', async () => {
      await page.click('#strategy-foryou .ui-more');
      await page.getByRole('menuitem', {name: 'Not now'}).click();
      if (await page.locator('#strategy-foryou:visible').count()) throw new Error('still shown after "Not now"');
      if (!await waitFor(async () => advice(profile).some(line => /dismissed employer on strategy/.test(line)))) throw new Error('no "dismissed employer" in app.log');
      await page.click('.nav[data-view=focus]');
      await page.click('.nav[data-view=strategy]');
      await page.click('[data-tab=strategy-suggestions]');   // the rows live in the Suggestions tab
      await page.waitForTimeout(1500);
      if (await page.locator('#strategy-foryou:visible').count()) throw new Error('back after leaving and coming back');
    });

    await ctx.run('a jobs check with few new jobs offers the same advice as rows with a Review button, recorded as shown', async () => {
      await openRunsList(page);
      const rows = page.locator('#activity-recent li:not(.recent-group) button');
      let found = false;
      for (let i = 0; i < await rows.count() && !found; i++) {
        await backToList(page);
        await rows.nth(i).click();
        found = await waitFor(() => page.locator('.run-card-help:visible').count().then(n => n > 0), 1500);
      }
      if (!found) throw new Error('no run shows the "Few new jobs" box (the demo has a check with 0 new jobs)');
      const review = page.locator('.run-card-help .item-action', {hasText: /^Review /});
      if (!await waitFor(() => review.count().then(n => n > 0), 8000)) throw new Error(`no Review rows: "${(await text(page, '.run-card-help')).slice(0, 200)}"`);
      if (!await waitFor(async () => advice(profile).some(line => /shown \w+ on few-jobs/.test(line)))) throw new Error('no "shown … on few-jobs" in app.log');
    });

    await ctx.run('Review opens Strategy with that suggestion\'s options showing', async () => {
      await page.locator('.run-card-help .item-action', {hasText: /^Review /}).first().click();
      if (!await waitFor(() => page.locator('.suggestion-detail:visible .option-row').count().then(n => n > 0), 10000)) {
        const state = await page.locator('.suggestion-card').evaluateAll(list => list.map(row => `${row.id}:${row.querySelector('[data-review]')?.getAttribute('aria-expanded')}`));
        throw new Error(`no suggestion opened on Strategy; rows: ${state.join(', ') || 'none'}`);
      }
    });

    await ctx.run('a strategy draft: one card\'s editor, Unsaved badge, the page bar on every tab, typed text kept, leaving asks, Save clears it', async () => {
      await page.click('.nav[data-view=strategy]');
      await page.click('[data-tab=strategy-yours]');
      await page.locator('#strategy-main-goals .card-edit').first().click();
      if (await page.locator('.strategy-page .card-done').count() !== 1) throw new Error('Edit opened more than one editor');
      await page.fill('#strategy-main-goals input.add[data-list=roles]', 'cashier');
      if (!await page.locator(`${BAR}:visible`).count()) throw new Error('no save bar after typing');
      if (!await page.locator('#strategy-main-goals .unsaved-badge:visible').count()) throw new Error('no Unsaved badge on Main goals');
      if (!/Save strategy changes/.test(await text(page, BAR))) throw new Error(`the bar does not say what it saves: ${await text(page, BAR)}`);
      await page.click('[data-tab=strategy-scoring]');
      if (!await page.locator(`${BAR}:visible`).count()) throw new Error('the save bar left with the tab');
      await page.click('[data-tab=strategy-yours]');
      const kept = await page.inputValue('#strategy-main-goals input.add[data-list=roles]');
      if (kept !== 'cashier') throw new Error(`typed text after a tab switch: "${kept}"`);
      await page.click('.nav[data-view=focus]');
      if (!await waitFor(() => page.locator(LEAVE_DIALOG).count().then(n => n > 0), 3000)) throw new Error('leaving with a draft did not ask');
      await page.click(`${LEAVE_DIALOG} button[value=keep]`);
      if (await page.locator('.view[data-view=strategy]').isHidden()) throw new Error('Keep editing left the page anyway');
      await page.click(`${BAR} button.primary`);
      if (!await waitFor(() => page.locator(`${BAR}:visible`).count().then(n => n === 0), 8000)) throw new Error(`still unsaved: ${await text(page, BAR)}`);
    });

    await ctx.run('adding a suggested role says the next step: the pop-up offers Find jobs', async () => {
      await page.click('[data-tab=strategy-suggestions]');
      if (await page.locator('#strategy-ideas [data-review]').getAttribute('aria-expanded') !== 'true') await page.click('#strategy-ideas [data-review]');
      await page.locator('#ideas-chips .option-row button').first().click();
      const next = page.locator('#toasts .toast.toast-link .toast-next', {hasText: 'Find jobs'});   // no button: the pop-up's click runs it (owner, 27 Oct 2026)
      if (!await waitFor(() => next.count().then(n => n > 0), 8000)) throw new Error(`no Find jobs in the pop-up: ${await text(page, '#toasts')}`);
    });

    // Insights PR 1b (owner, 28 Oct 2026): Strategy's search rows also on Focus, the top option in one press and See all for the rest; one answer
    // for both places (the row's key in the store; held in this window in the demo).
    await ctx.run('Focus offers Strategy\'s search rows: the top option in one press, See both opens that row on Strategy, Not now hides it there too', async () => {
      await page.click('.nav[data-view=focus]');
      const row = kind => `#focus-suggestions-list .focus-item[data-suggestion="${kind}"]`;
      const all = page.locator('#focus-suggestions-all');
      if (!await waitFor(() => all.isVisible(), 15000)) throw new Error(`Focus has no Show all: ${await text(page, '#focus-suggestions')}`);
      if (/Show all/.test(await all.innerText())) await all.click();
      if (!await waitFor(() => page.locator(row('filters')).count().then(n => n > 0), 15000)) throw new Error(`no search rows on Focus: ${await text(page, '#focus-suggestions-list')}`);
      const buttons = kind => page.locator(`${row(kind)} .focus-actions > button:not(.ui-more)`).allInnerTexts();
      const places = await buttons('places'), filters = await buttons('filters');
      if (places[0] !== 'Add France') throw new Error(`the places row offers ${JSON.stringify(places)}, not "Add France" in one press`);
      if (JSON.stringify(filters) !== JSON.stringify(['Remove "senior"', 'See both'])) throw new Error(`the filters row offers ${JSON.stringify(filters)}`);
      await page.locator(`${row('filters')} .focus-actions > button`, {hasText: 'See both'}).click();
      if (!await waitFor(() => page.locator('#strategy-filters-detail:visible').count().then(n => n > 0), 15000)) throw new Error('See both did not open the filters row on Strategy');
      await page.click('.nav[data-view=focus]');
      await page.click(`${row('places')} .ui-more`);
      await page.getByRole('menuitem', {name: 'Not now'}).click();
      if (await page.locator(row('places')).count()) throw new Error('the places row is still on Focus after Not now');
      await page.click('.nav[data-view=strategy]');
      await page.click('[data-tab=strategy-suggestions]');
      await page.waitForTimeout(1500);
      if (await page.locator('#strategy-places:visible').count()) throw new Error('the places row is still on Strategy after Not now on Focus');
    });

    await ctx.run('what is recorded holds fixed words only: never a role word, a place or an employer\'s name', async () => {
      const lines = advice(profile);
      if (!lines.length) throw new Error('nothing recorded');
      const leaked = lines.filter(line => line.includes(first.company) || /Gen[eè]v|Zurich|photograph/i.test(line));
      if (leaked.length) throw new Error(`free words in: ${leaked.join(' | ')}`);
      const odd = lines.filter(line => !/(shown|taken|dismissed) (role|place|filter|source|explain|employer|visit) on (strategy|few-jobs|focus)/.test(line));
      if (odd.length) throw new Error(`not in the fixed shape: ${odd.join(' | ')}`);
    });
  } finally {
    await session?.app.close().catch(() => {});
    fs.rmSync(profile, {recursive: true, force: true});
  }
}
