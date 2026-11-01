/* global document, window */
// The real first-run path, step by step (Notion later, 3 Oct 2026): the setup wizard with a key, a CV and a strategy built by the AI, finished WITHOUT Notion
// (the app only tries: the Jobs list opens, Focus asks to connect), then Notion connected with a token: the workspace is built and the strategy moves in.
// The wizard suite runs it on an emptied page; any other suite runs it once to build its own Notion workspace when its page has none yet, and then keeps the workspace.
// Job: run the backbone
import fs from 'node:fs';
import path from 'node:path';
import {pageText} from './notion.mjs';
import {pollUntil, stepTimeLeft} from './wait-on-state.mjs';

// The CV-facts schema is the one background question newly reached when setup goes straight to Jobs.
function setupBackgroundAnswer(body, previous) {
  const properties = body?.output_config?.format?.schema?.properties || {};
  const how = properties.facts?.items?.properties?.how?.enum || [];
  // Why (31 Oct 2026, #2659): cv_queue has a declared invalid-key fixture; never send this optional background read to a live relay.
  if (Object.keys(properties).length === 1 && how.includes('stated') && how.includes('inferred')) return {refuse: 'invalid-key'};
  return previous?.(body) ?? null;
}

export async function runWizard(ctx) {
  const {page, appKey: KEY} = ctx;
  const previous = ctx.proxy.canned();
  ctx.proxy.setCanned(body => setupBackgroundAnswer(body, previous));
  try {
  await ctx.run('the app starts on the welcome screen', async () => {
    await ctx.expectStep('welcome');
    await page.getByRole('button', {name: 'Start'}).waitFor();
    // Start opens the AI step; its cards are checked by integration/app/screen-wizard.test.js (moved 1 Nov 2026).
    await page.locator('.step[data-step="welcome"] [data-next]').click();
    await ctx.expectStep('ai');
  });
  if (ctx.engine === 'codex' || ctx.engine === 'openai') {
    // The OpenAI family (lib/engine.mjs rotation): its small card first, then its two cards. A Mac picks Codex (confirmed once, then checked); CI types the OpenAI test key.
    // The OpenAI side of the switch shows its two cards: integration/app/screen-wizard.test.js (moved 1 Nov 2026).
    if (ctx.engine === 'codex') {
      await ctx.run('Codex is chosen (confirmed once, then checked) and the AI step continues', async () => {
        await page.locator('[data-choice="family-openai"]').click();
        await page.locator('[data-choice="codex"]').click();
        await page.locator('[data-notice="yes"]').click({timeout: 5000}).catch(() => {});   // the notice shows only the first time (found by structure, fdfeacd)
        await page.waitForFunction(() => !document.getElementById('ai-save')?.disabled, null, {timeout: 90000});
        await page.click('#ai-save');
        await ctx.expectStep('cv');
      });
    } else {
      await ctx.run('a valid OpenAI API key is accepted and saved', async () => {
        await page.locator('[data-choice="family-openai"]').click();
        await page.locator('[data-choice="openai"]').click();
        await page.locator('#openai-key').waitFor();
        if (!(await page.locator('#ai-save').isDisabled())) throw new Error('"Check and save" is enabled with no key typed');
        await page.fill('#openai-key', ctx.appKey);
        await page.click('#ai-save');
        await ctx.expectStep('cv');
      }, {needs: ctx.needsKey});
    }
  } else if (ctx.engine === 'cli') {
    // A Mac: no key is ever typed (lib/engine.mjs). The app asks once whether to use Claude Code, then checks it, and the step continues.
    await ctx.run('Claude Code is chosen (confirmed once, then checked) and the AI step continues', async () => {
      await page.locator('[data-choice="family-claude"]').click();
      await page.locator('[data-choice="cli"]').click();
      await page.locator('[data-notice="yes"]').click({timeout: 5000}).catch(() => {});   // the notice shows only the first time
      await page.waitForFunction(() => !document.getElementById('ai-save')?.disabled, null, {timeout: 90000});
      await page.click('#ai-save');
      await ctx.expectStep('cv');
    });
  } else if (ctx.family === 'free') {
    // CI on Free AI (lib/engine.mjs freeAi): the Free card, pressed as a person would. The app takes the relay's JPF1 key (JOB_PILOTTO_E2E_FREE_AI_KEY,
    // desktop/lib/ai-free.js start) instead of asking the website; the API key field takes only sk-ant- keys (26 Oct 2026, beta 40261885119: wizard red).
    await ctx.run('Free AI is chosen and the AI step continues on it', async () => {
      await page.locator('[data-choice="free"]').click();
      await page.waitForFunction(() => !document.getElementById('ai-save')?.disabled, null, {timeout: 10000});
      await page.click('#ai-save');
      await ctx.expectStep('cv');
      const settings = await page.evaluate(() => window.pilot.state().then(state => state.settings));
      if (!settings.aiFree || settings.aiEngine !== 'api') throw new Error(`after "Use Free AI" the app is on ${JSON.stringify({aiFree: settings.aiFree, aiEngine: settings.aiEngine})}, not Free AI`);
    }, {needs: ctx.needsKey});
  } else {
    // The step will not continue without a key, and an invalid key is rejected without saving: integration/app/screen-wizard.test.js and setup-ai-handlers.test.js (moved 1 Nov 2026).
    await ctx.run('a valid API key is accepted and saved', async () => {
      await page.locator('[data-choice="family-claude"]').click();
      await page.locator('[data-choice="api"]').click();
      await page.locator('#anthropic-key').waitFor();
      await page.evaluate(() => window.pilot.saveSettings({anthropicKeyTest: 'accept'}));
      try {
        await page.fill('#anthropic-key', KEY);
        await page.click('#ai-save');
        await ctx.expectStep('cv');
        const state = await page.evaluate(() => window.pilot.state());
        if (!state.secrets.ANTHROPIC_API_KEY || state.settings.aiEngine !== 'api') throw new Error('the accepted API key or engine was not saved');
      } finally { await page.evaluate(() => window.pilot.saveSettings({anthropicKeyTest: null})); }
    }, {needs: [{name: 'E2E_ANTHROPIC_KEY', value: KEY}]});
  }
  await ctx.run('a CV is chosen and read', async () => {
    await ctx.pickCv();
    await page.click('#cv-choose');
    await page.waitForFunction(() => !document.getElementById('cv-file')?.hidden, null, {timeout: 30000});
    await page.waitForFunction(() => !document.getElementById('cv-next')?.disabled, null, {timeout: 30000});
    await page.click('#cv-next');
    await ctx.expectStep('draft');
  }, {needs: ctx.needs});
  await ctx.run('the strategy is built from the CV and shows roles to search for', async () => {
    await page.click('#draft-build');
    await page.locator('#draft-view').waitFor({state: 'visible', timeout: 300000});
    // The cards are the Strategy page's own (pages/setup-strategy.js): Main goals names the roles, Locations the places.
    const goals = await page.locator('#setup-strategy-slot #strategy-main-goals .main-goals').innerText();
    if (!goals || /No roles yet/.test(goals)) throw new Error('the strategy has no roles to search for');
  }, {needs: ctx.needs});
  await ctx.run('saving the strategy reaches the finish action', async () => {
    await saveWizardStrategy(ctx);
  }, {needs: ctx.needs});
  await ctx.run('finishing the setup without Notion opens the Jobs list, with the strategy kept on this Mac', async () => {
    await page.click('#finish');
    await page.waitForFunction(() => !!document.querySelector('.view:not([hidden])'), null, {timeout: 60000});
    const view = await page.evaluate(() => document.querySelector('.view:not([hidden])')?.dataset.view);
    if (view !== 'jobs') throw new Error(`after a setup without Notion the app shows "${view}", not the Jobs list`);
    const state = await page.evaluate(() => window.pilot.state());
    if (state.notion) throw new Error('the app says Notion is connected, but it was never connected');
    if (!state.hasProfile) throw new Error('the strategy was not kept on this Mac');
    if (!fs.existsSync(path.join(ctx.profile, 'profile.md'))) throw new Error('profile.md is not in the app folder');
  }, {needs: ctx.needs});
  // Nothing starts behind the person's back (owner, 24 Oct 2026): Jobs shows the big Find jobs card, and the first search starts when it is pressed.
  await ctx.run('Jobs opens on the Find jobs card; pressing it starts the first search', async () => {
    await page.waitForFunction(() => document.body.dataset.findCard === 'empty', null, {timeout: 30000});
    if (!(await page.locator('#find-card .magic-go').count())) throw new Error('the Find jobs card has no button');
    await page.click('#find-card .magic-go');
    await page.waitForFunction(() => document.body.dataset.findCard === 'searching', null, {timeout: 30000});
  }, {needs: ctx.needs});
  // A new install (the wizard suite: no store at launch, ctx.newInstall): the app gives it this Mac at first start (lib/store-handlers.js settleStore),
  // so it is never "trying"; on the stand-in it then connects Notion while the store is still empty, and the store becomes Notion ("Start using Notion").
  if (ctx.newInstall) {
    await ctx.run('a new install keeps its data on this Mac: the store is set once at first start', async () => {
      const store = JSON.parse(fs.readFileSync(path.join(ctx.profile, 'settings.json'), 'utf8')).store;
      if (store !== 'sqlite') throw new Error(`a new install started on "${store}", not this Mac`);
    }, {needs: ctx.needs});
  }
  // This Mac's store: no page carries the Notion prompt and there is nothing to connect.
  if (ctx.store === 'sqlite' || ctx.newInstall) {
    // On this Mac's store no page asks to connect Notion: integration/app/screen-wizard.test.js (moved 1 Nov 2026).
    if (ctx.store === 'sqlite') return;
    await connectNotion(ctx, {startedOnNotion: true});
    return;
  }
  // Focus without Notion shows only Get started; Interviews carries the prompt: integration/app/screen-wizard.test.js (moved 1 Nov 2026).
  await connectNotion(ctx);
  } finally { ctx.proxy.setCanned(previous); }
}

// Notion connected with a token: the workspace is built inside the test page and the strategy moves in. startedOnNotion: the store was this Mac's, still
// empty, so the connect itself makes Notion the store (lib/store-handlers.js startOnNotionIfEmpty) and says so.
async function connectNotion(ctx, {startedOnNotion = false} = {}) {
  const {page, token: NOTION} = ctx;
  await ctx.run('a Notion token connects: the workspace is built inside the test page and the strategy moves in', async () => {
    const result = await page.evaluate(token => window.pilot.notionConnect(token), NOTION);
    if (!result?.ok) throw new Error(`Notion did not connect: ${result?.error || (result?.problems || []).map(p => p.title).join(', ') || 'unknown'}`);
    if (startedOnNotion) {
      const store = JSON.parse(fs.readFileSync(path.join(ctx.profile, 'settings.json'), 'utf8')).store;
      if (!result.startedOnNotion || store !== 'notion') throw new Error(`an empty store did not become Notion at connect (startedOnNotion ${result.startedOnNotion}, store ${store})`);
    }
    const started = Date.now();
    let text = '';
    while (text.length < 200) {   // the Profile page holds the strategy's Profile once the move-in has run
      if (Date.now() - started > 240000) throw new Error('the strategy did not reach the Notion Profile page in 4 minutes');
      text = await pageText(NOTION, 'Profile — CV and Preferences');
      if (text.length < 200) await page.waitForTimeout(3000);
    }
    const state = await page.evaluate(() => window.pilot.state());
    if (!state.notion) throw new Error('the app does not know it is connected');
    if (fs.existsSync(path.join(ctx.profile, 'profile.md'))) throw new Error('profile.md is still on this Mac after it moved to Notion');
    // The connect was the app's call, not the window's prompt (which refreshes the window and reopens the page): reload, as lib/seed.mjs fastSeed does, so the
    // window knows. Without it a page that needs Notion stayed on its gate (9 Oct 2026, the stand-in: every suite builds its workspace through here).
    await page.reload();
    await page.waitForSelector('.view:not([hidden])', {timeout: 60000});
    if (!await page.evaluate(() => !!window.__jp?.shared?.state?.notion?.NOTION_PROFILE_PAGE_ID)) throw new Error('the window does not know Notion is connected after a reload');
  }, {needs: ctx.needs});
}


/** Save the setup strategy through the existing dummy-key seam, answering only its fictional CV details. */
export async function saveWizardStrategy(ctx) {
  const {page, proxy} = ctx;
  if (!proxy?.setCanned || typeof ctx.withApi !== 'function') throw new Error('wizard strategy proof requires the canned API seam');
  const previous = proxy.canned();
  const cv = JSON.parse(fs.readFileSync(new URL('../fixtures/cv.json', import.meta.url), 'utf8'));
  proxy.setCanned(body => wizardSetupAnswer(body, {cv}));
  try {
    await ctx.withApi(async () => {
      await page.click('#draft-save');
      const {value: visible} = await pollUntil(() => page.locator('#finish').isVisible(), Boolean, {capMs: stepTimeLeft()});
      if (!visible) throw new Error('strategy save did not reveal Go to my jobs');
    });
  } finally { proxy.setCanned(previous); }
}

/** Answer only setup's CV-details schema from fictional fixtures; unknown calls never pass through to a model. */
export function wizardSetupAnswer(body, {cv}) {
  const properties = body?.output_config?.format?.schema?.properties || {};
  if (Object.keys(properties).length !== 1) return {refuse: 'no-credit'};
  if (properties.proposals) {
    const [first, ...last] = cv.name.trim().split(/\s+/);
    const stated = {first_name: first, last_name: last.join(' '), location: cv.location};
    return JSON.stringify({proposals: Object.entries(stated).filter(([, value]) => value).map(([field, value]) => ({field, value, sure: true, source: 'cv', how: 'stated'}))});
  }
  return {refuse: 'no-credit'};
}
