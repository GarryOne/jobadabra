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
const BAR = '#strategy-bar-host .page-save-bar';   // Strategy's one save bar (renderer/pages/strategy-cards.js)

export const name = 'foryou';
export const minutes = 3;
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

    await ctx.run('⋯ "Hide until the next search" hides the employers row, records it, and it stays hidden on the next visit', async () => {
      await page.click('#strategy-foryou .ui-more');
      await page.getByRole('menuitem', {name: 'Hide until the next search'}).click();
      if (await page.locator('#strategy-foryou:visible').count()) throw new Error('still shown after "Hide until the next search"');
      if (!await waitFor(async () => advice(profile).some(line => /dismissed employer on strategy/.test(line)))) throw new Error('no "dismissed employer" in app.log');
      await page.click('.nav[data-view=focus]');
      await page.click('.nav[data-view=strategy]');
      await page.click('[data-tab=strategy-suggestions]');   // the rows live in the Suggestions tab
      await page.waitForTimeout(1500);
      if (await page.locator('#strategy-foryou:visible').count()) throw new Error('back after leaving and coming back');
    });

    await ctx.run('a jobs check with few new jobs offers the same advice as rows with a Review button, recorded as shown', async () => {
      await page.evaluate(async () => { (await import('./pages/activity.js')).openActivity(true); });
      for (let i = 0; i < 10 && await page.locator('#activity-all:visible').count(); i++) await page.click('#activity-all');
      const rows = page.locator('#activity-recent li:not(.recent-group) button');
      let found = false;
      for (let i = 0; i < await rows.count() && !found; i++) {
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
      const next = page.locator('#toasts .toast .toast-action', {hasText: 'Find jobs'});
      if (!await waitFor(() => next.count().then(n => n > 0), 8000)) throw new Error(`no Find jobs in the pop-up: ${await text(page, '#toasts')}`);
    });

    await ctx.run('what is recorded holds fixed words only: never a role word, a place or an employer\'s name', async () => {
      const lines = advice(profile);
      if (!lines.length) throw new Error('nothing recorded');
      const leaked = lines.filter(line => line.includes(first.company) || /Gen[eè]v|Zurich|photograph/i.test(line));
      if (leaked.length) throw new Error(`free words in: ${leaked.join(' | ')}`);
      const odd = lines.filter(line => !/(shown|taken|dismissed) (role|place|filter|source|explain|employer|visit) on (strategy|few-jobs)/.test(line));
      if (odd.length) throw new Error(`not in the fixed shape: ${odd.join(' | ')}`);
    });
  } finally {
    await session?.app.close().catch(() => {});
    fs.rmSync(profile, {recursive: true, force: true});
  }
}
