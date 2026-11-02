/* global document */
// The AI explorer (lib/explore.mjs): Claude uses the app on a path no suite scripted, and reports what looks wrong with a CHECK a script can verify. Every report is then REPLAYED
// without AI from a fresh page; only a bug whose check holds again becomes a finding (source explorer). BY HAND ONLY: it spends the owner's AI credit (a budget of about $0.50 a run),
// so it never runs on a schedule or a push:   gh workflow run e2e.yml -f suite=explore     or     node suite.mjs explore   (a Mac needs Claude Code and E2E_NOTION_TOKEN_EXPLORE; CI also E2E_ANTHROPIC_KEY).
import {modelFetch} from '../lib/model.mjs';
import fs from 'node:fs';
import path from 'node:path';
import {finish} from '../lib/layout.mjs';
import {settle} from '../lib/app.mjs';
import {ensureSetUp} from '../lib/seed.mjs';
import {VIEWS} from '../lib/uicheck.mjs';
import {PRICES, usageCost} from '../lib/vision.mjs';
import {SYSTEM, explore, observePage, replay, stepWords, tools} from '../lib/explore.mjs';
import {goView} from '../lib/go-view.mjs';

export const name = 'explore';
export const keepGoing = true;
export const cadence = 'manual';   // never chosen by a schedule or a push (lib/plan.mjs); a person names it
// Why (2 Nov 2026, owner: "I want the guardrail to be general, for any e2e or itnegrations"): a live measurement, never a gate; its unanswered asks go on to the model (every other suite's are refused, test/ai/one-answer-rule.test.mjs).
export const realAi = true;
export const minutes = 20;
export const watches = ['desktop/e2e/lib/explore.mjs'];

const MODEL = process.env.E2E_EXPLORER_MODEL || 'claude-haiku-5-5';
const MAX_USD = Number(process.env.E2E_EXPLORER_USD) || 0.5;
const MAX_STEPS = Number(process.env.E2E_EXPLORER_STEPS) || 40;
const PRICED = PRICES[MODEL] ? MODEL : 'claude-haiku-5-5';   // Haiku: cheap; its thinking blocks go back unchanged (lib/explore.mjs appends each reply whole)

export async function run(ctx) {
  ctx.findings = [];
  const {page} = ctx;
  await ensureSetUp(ctx);
  const errors = [];
  page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
  page.on('pageerror', error => errors.push(String(error.message || error)));
  const ipc = {
    mark: () => ctx.app.evaluate(() => (globalThis.__jpIpc || []).at(-1)?.seq || 0),
    since: mark => ctx.app.evaluate((_electron, from) => (globalThis.__jpIpc || []).filter(call => call.seq > from).map(({channel, ms}) => ({channel, ms})), mark),
  };
  const tagged = i => page.locator(`[data-explore="${i}"]`);
  const act = {
    observe: () => page.evaluate(observePage),
    click: async i => { await tagged(i).scrollIntoViewIfNeeded({timeout: 2000}).catch(() => {}); await tagged(i).click({timeout: 3000, noWaitAfter: true}); await page.waitForTimeout(700); },
    type: async (i, text) => { await tagged(i).fill(String(text || '').slice(0, 200), {timeout: 3000}); await page.waitForTimeout(300); },
    press: async key => { await page.keyboard.press(key); await page.waitForTimeout(400); },
    go: async view => { await goView(page, view, {timeout: 4000}); await settle(page); },
    readText: () => page.evaluate(() => (document.querySelector('.view:not([hidden])')?.innerText || document.body.innerText || '')),
    errorMark: () => errors.length,
    errorsSince: mark => errors.slice(mark),
    // A press, measured the way the interaction probe does: did the page change, did a call reach the app.
    measure: async label => {
      const seen = await page.evaluate(observePage);
      const control = seen.controls.find(item => item.label === label && !item.disabled);
      if (!control) return null;
      const snapshot = () => page.evaluate(() => `${document.body.innerText.length}:${document.body.innerHTML.length}:${location.hash}`);   // eslint-disable-line no-undef
      const before = await snapshot(), mark = await ipc.mark();
      await tagged(control.i).click({timeout: 3000, noWaitAfter: true}).catch(() => {});
      await page.waitForTimeout(1200);
      return {changed: (await snapshot()) !== before, calls: (await ipc.since(mark)).length};
    },
  };
  const usage = {calls: 0, usd: 0, input: 0, output: 0};
  const ask = async messages => {
    const answer = await modelFetch('https://api.anthropic.com/v1/messages', {method: 'POST', headers: {'content-type': 'application/json', 'x-api-key': ctx.judgeKey, 'anthropic-version': '2023-06-01'},
      body: JSON.stringify({model: MODEL, max_tokens: 1024, system: SYSTEM, tools: tools(VIEWS), messages})});
    const body = await answer.json();
    if (!answer.ok) throw new Error(`${answer.status} ${body?.error?.message || ''}`);
    usage.calls++; usage.input += body.usage?.input_tokens || 0; usage.output += body.usage?.output_tokens || 0;
    return body;
  };
  const cost = used => usageCost(PRICED, used) ?? 0;

  let result = null;
  await ctx.run(`the AI explores the app (${MODEL}, at most ${MAX_STEPS} steps or $${MAX_USD})`, async () => {
    result = await explore({act, ask, cost, views: VIEWS, maxSteps: MAX_STEPS, maxUsd: MAX_USD, log: line => console.log(line)});
    usage.usd = Number(result.usd.toFixed(4));
    console.log(`  explorer stopped: ${result.stopped}; ${result.steps.length} step(s), ${result.bugs.length} report(s), $${usage.usd}`);
    if (result.stopped.startsWith('api:')) throw new Error(`the explorer could not finish thinking (${result.stopped}): nothing is filed from this run`);
  }, {needs: ctx.needs});
  fs.writeFileSync(path.join(ctx.ARTIFACTS, 'ai-explorer-usage.json'), JSON.stringify({...usage, model: MODEL, stopped: result?.stopped || 'failed'}, null, 2));
  if (!result) return;

  // Each report is proved again without AI, from a fresh page. Only what holds again is a finding.
  const proved = [];
  for (const [at, bug] of result.bugs.entries()) {
    await ctx.run(`report ${at + 1} replayed without AI: ${String(bug.title).slice(0, 50)}`, async () => {
      await page.reload();
      await page.waitForSelector('.view:not([hidden])', {state: 'attached', timeout: 60000});
      await settle(page);
      const outcome = await replay({act, bug});
      console.log(`  report ${at + 1} "${bug.title}" (${bug.check.type}): ${outcome.reproduced ? 'REPRODUCED' : 'not reproduced'}; ${outcome.why}`);
      proved.push({bug, outcome});
      if (outcome.reproduced) {
        const goes = bug.steps.filter(step => step.tool === 'go').at(-1);
        ctx.findings.push({view: goes?.view || 'focus', severity: bug.severity, kind: bug.kind, title: bug.title, source: 'explorer',
          detail: `${bug.what} Replayed without AI and it held again: ${outcome.why}. Steps: ${bug.steps.map(stepWords).join(' → ') || '(on the first page)'}.`});
      }
    }, {needs: ctx.needs});
  }
  fs.writeFileSync(path.join(ctx.ARTIFACTS, 'explorer.json'), JSON.stringify({steps: result.steps, stopped: result.stopped, reports: proved.map(({bug, outcome}) => ({...bug, reproduced: outcome.reproduced, why: outcome.why}))}, null, 2));
  fs.writeFileSync(path.join(ctx.ARTIFACTS, 'seed.json'), JSON.stringify({seed: 0, fixed: true, detail: `AI explorer (${MODEL}): ${result.steps.length} steps, ${result.bugs.length} report(s), ${proved.filter(item => item.outcome.reproduced).length} proved again`}));
  await ctx.run('explorer findings are written', async () => { finish(ctx); }, {needs: ctx.needs});
}
