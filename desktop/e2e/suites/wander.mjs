/* global document */
// Wander: a seeded random walk (lib/wander.mjs). It starts from a state nobody scripted (setup left half-way, the CV gone), takes steps nobody scripted (three pages in a row without
// waiting, a control pressed twice, a dialog left open while the page changes, a reload, a hard crash and restart) and has Notion or the AI fail for a stretch of the walk.
// Nothing here asserts one right answer: after every step the page must still answer, show no technical text or broken layout (the layout checks), and the whole walk must raise no
// uncaught exception (lib/journey.mjs). The seed replays the walk: E2E_SEED=<n> node suite.mjs wander. No seed = a short fixed walk (the release gate).
import fs from 'node:fs';
import path from 'node:path';
import {finish} from '../lib/layout.mjs';
import {settle} from '../lib/app.mjs';
import {ensureSetUp} from '../lib/seed.mjs';
import {LIMITS, inspect} from '../lib/uicheck.mjs';
import {isSafe, probePage} from '../lib/interact.mjs';
import {createVariation} from '../lib/variation.mjs';
import {describe, planWalk} from '../lib/wander.mjs';
import {goView} from '../lib/go-view.mjs';

// Why (30 Oct 2026, ap): wander checks UI resilience with declared answers; no live AI key or transport is needed.
export const offlineAi = true;
export const realAi = false;
export const name = 'wander';
export const keepGoing = true;
export const notionProxy = true;
// Why (30 Oct 2026, ap): stored answers need one store path; the stand-in keeps wander's injected Notion faults reachable, unlike SQLite.
export const store = 'standin';
export const variesPlace = true;
export const varies = true;
export const minutes = 15;
export const env = {JOB_PILOTTO_E2E_EXPECTS_FAILURES: '1'};   // the AI is made to fail on purpose in some walks: its Sentry reports are tagged expected
export const watches = ['desktop/renderer/', 'desktop/lib/'];

export async function run(ctx) {
  ctx.findings = [];
  const vary = createVariation();
  const plan = planWalk(vary.seed);
  fs.writeFileSync(path.join(ctx.ARTIFACTS, 'seed.json'), JSON.stringify({seed: vary.seed, fixed: vary.fixed, detail: describe(plan)}));
  console.log(vary.fixed ? '  variation: fixed walk' : `  variation: seed ${vary.seed}; ${describe(plan)}; replay with E2E_SEED=${vary.seed}`);
  await ensureSetUp(ctx);
  const ipc = () => ({
    mark: () => ctx.app.evaluate(() => (globalThis.__jpIpc || []).at(-1)?.seq || 0),
    since: mark => ctx.app.evaluate((_electron, from) => (globalThis.__jpIpc || []).filter(call => call.seq > from).map(({channel, start, ms, failed}) => ({channel, start, ms, failed})), mark),
  });
  // The app is showing a page or a setup step. When it is not, say what IS on screen: a blank window after a reload is the finding, and the words say where it stopped.
  const ready = async () => {
    await ctx.page.waitForSelector('.view:not([hidden]), .step:not([hidden])', {state: 'attached', timeout: 30000}).catch(async error => {
      const seen = await ctx.page.evaluate(() => ({text: (document.body.innerText || '').replace(/\s+/g, ' ').slice(0, 160), views: [...document.querySelectorAll('.view, .step')].map(el => `${el.className.split(' ')[0]}${el.dataset.view || el.dataset.step ? `:${el.dataset.view || el.dataset.step}` : ''}${el.hidden ? '(hidden)' : ''}`).slice(0, 12)})).catch(() => null);
      throw new Error(`no page or setup step is showing (${error.message.split('\n')[0]}); the window shows ${seen ? `"${seen.text}", blocks ${seen.views.join(' ')}` : 'nothing (it is closed)'}`);
    });
  };
  const hasNav = () => ctx.page.locator('.nav[data-view]').first().isVisible().catch(() => false);   // setup left half-way hides the menu: only the setup steps can be pressed
  // A modal dialog left open by an earlier step covers the menu, as it should: a person closes it (Escape) and goes on. A dialog that does not close that way is the finding.
  const goto = async view => {
    if (!await hasNav()) return;
    const click = () => goView(ctx.page, view, {timeout: 5000});
    try { await click(); } catch (error) {
      if (!await ctx.page.locator('dialog[open]').count()) throw error;
      await ctx.page.keyboard.press('Escape');
      await ctx.page.locator('dialog[open]').first().waitFor({state: 'hidden', timeout: 5000}).catch(() => { throw new Error(`a modal dialog left open does not close on Escape, so the menu stays covered (${error.message.split('\n')[0]})`); });
      await click();
    }
  };
  // The page still answers, and what it shows is not technical text or a broken layout. `where` names the step in a finding.
  const check = async where => {
    const alive = await Promise.race([ctx.page.evaluate(() => 1 + 1), new Promise(resolve => setTimeout(() => resolve(null), 8000))]);
    if (alive !== 2) throw new Error(`the window stopped answering after ${where}`);
    const found = await ctx.page.evaluate(inspect, {view: 'wander', limits: LIMITS});
    ctx.findings.push(...found.map(item => ({...item, view: item.chrome ? 'app-chrome' : 'wander', detail: `${item.detail} (after ${where}; ${plan.state.id}${plan.fault ? `, ${plan.fault.id}` : ''})`})));
  };
  const safeControls = () => ctx.page.$$eval('.view:not([hidden]) button, .step:not([hidden]) button', buttons => buttons.filter(el => el.offsetParent !== null && !el.disabled)
    .map((el, at) => ({at, text: (el.getAttribute('aria-label') || el.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 60), cls: String(el.className || ''), href: ''})));
  const pressNth = async (at, times) => { for (let i = 0; i < times; i++) await ctx.page.locator('.view:not([hidden]) button, .step:not([hidden]) button').and(ctx.page.locator(':visible')).nth(at).click({timeout: 2000, noWaitAfter: true, delay: 0}).catch(() => {}); };

  // The start state.
  await ctx.run(`start state: ${plan.state.note}`, async () => {
    if (plan.state.removeCv) fs.rmSync(path.join(ctx.profile, 'cv.pdf'), {force: true});
    if (plan.state.settings) await ctx.page.evaluate(settings => window.pilot.saveSettings(settings), plan.state.settings);   // eslint-disable-line no-undef
    await ctx.page.reload();
    await ready();
    await check('the start state');
  }, {needs: ctx.needs});

  for (const [i, step] of plan.steps.entries()) {
    const fault = plan.fault;
    const where = `step ${i + 1} (${step.move}${step.view ? `: ${step.view}` : ''})`;
    if (fault && i === fault.from) { if (fault.target === 'notion') ctx.notion.fail(fault.mode, {times: fault.times ?? null, writes: !!fault.writes, every: fault.every || 0}); else ctx.proxy.setMode(fault.mode); console.log(`  fault on: ${fault.id}`); }
    if (fault && i === fault.until) { ctx.notion.pass(); ctx.proxy.setMode('pass'); console.log(`  fault off: ${fault.id}`); }
    await ctx.run(`${where}${fault && i >= fault.from && i < fault.until ? ` while ${fault.id}` : ''}`, async () => {
      const {page} = ctx;
      if (step.move === 'visit') { await goto(step.view); await settle(page); }
      else if (step.move === 'hop') for (const view of step.views) await goto(view);   // no waiting: a page abandoned while it loads
      else if (step.move === 'double-press') {
        await goto(step.view); await settle(page);
        const choices = (await safeControls()).filter(isSafe);
        if (choices.length) await pressNth(vary.pick(choices).at, 2);
      } else if (step.move === 'half-open') {
        await goto(step.view); await settle(page);
        const choices = (await safeControls()).filter(isSafe);
        if (choices.length) await pressNth(vary.pick(choices).at, 1);   // left open on purpose: the next step changes the page under it
      } else if (step.move === 'resize') await ctx.app.evaluate(({BrowserWindow}, [w, h]) => BrowserWindow.getAllWindows()[0].setSize(w, h), step.size);
      else if (step.move === 'reload') { await page.reload(); await ready(); }
      else if (step.move === 'crash') { await ctx.relaunch(); await ready(); }
      else if (step.move === 'idle') await page.waitForTimeout(step.ms);
      else if (step.move === 'probe') {
        await goto(step.view); await settle(page);
        const view = step.view, {findings} = await probePage({page, view, ipc: ipc(), scope: (await hasNav()) ? `.view[data-view="${view}"]` : 'body', idleMs: 0, max: 6, arrange: vary.shuffle, settleMs: 1500,
          reset: async () => { await goto(view); await settle(page); }});
        ctx.findings.push(...findings.map(item => ({...item, view: `wander-${item.view}`})));
      }
      await check(where);
    }, {needs: ctx.needs, faults: !!fault && i >= fault.from && i < fault.until});
  }
  ctx.notion.pass(); ctx.proxy.setMode('pass');
  await ctx.run('wander findings are written', async () => { finish(ctx); }, {needs: ctx.needs});
}
