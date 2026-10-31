/* global window, document, performance */
// The apply suite's silent-Chrome steps, one per apply mode (Standard, Background and Full automation: renderer/apply-settings-model.js MODES): what an Applying card says and offers when the app
// cannot hear Chrome. Why (30 Oct 2026, owner's demo: "I was not able to open the tab in Chrome on the applying… the cards in applying are just stuck in Checking"): a leaked test app held the
// app's port for 27 h and no suite played a silent Chrome. Every wait is on a state the card shows; the window's clock is moved on, never waited out (CHECK_MS 45 s, WAIT_MS 60 s).
// Job: wait on state
import fs from 'node:fs';
import net from 'node:net';
import path from 'node:path';
import {MODES} from '../../renderer/apply-settings-model.js';
import {FORMS} from './forms.mjs';
import {appLogText} from './app-log.mjs';

const PRODUCTION_PORT = 47111;   // the owner's own app (lib/server-listen.js DEFAULT_PORT): no step here ever opens, holds or starts an app on it
const wait = ms => new Promise(resolve => setTimeout(resolve, ms));

/** -> {port, release()}: a port of the harness's own that another "program" holds, as a leaked test app held the owner's. */
async function holdPort() {
  const server = net.createServer();
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
  const {port} = server.address();
  if (port === PRODUCTION_PORT) { server.close(); return holdPort(); }
  return {port, release: () => new Promise(resolve => server.close(resolve))};
}

async function until(what, check, ms) {
  const end = Date.now() + ms;
  for (;;) {
    const value = await check();
    if (value) return value;
    if (Date.now() > end) throw new Error(`${what} (not within ${Math.round(ms / 1000)} s)`);
    await wait(250);
  }
}

/** The session this step's card is about, written into the profile while the app is down: the mode saved as the person's, one form session, a hidden-browser one queued for the background modes. */
function seedProfile(profile, mode, form, id) {
  const file = path.join(profile, 'sessions.json'), settings = path.join(profile, 'settings.json');
  const now = new Date().toISOString(), kept = (() => { try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return []; } })();
  const background = mode === 'check' ? null : {mode, state: 'queued', reason: '', readyAt: 0, dueAt: 0, manualOverride: false};
  fs.writeFileSync(file, JSON.stringify([...(Array.isArray(kept) ? kept : []).filter(record => record.id !== id), {
    id, kind: 'form', url: form.url, title: form.title, company: form.company, location: '', workMode: '', stage: '', stuck: '', inChrome: true,
    claudeId: '', asked: false, transcript: '', events: [], outcome: '', status: 'done', note: 'Form open in Chrome', question: '', answered: false,
    startedAt: now, endedAt: null, exitCode: null, needsYouSince: now, background}]));
  const saved = (() => { try { return JSON.parse(fs.readFileSync(settings, 'utf8')); } catch { return {}; } })();
  fs.writeFileSync(settings, JSON.stringify({...saved, apply: {...(saved.apply || {}), mode, chosenAt: now, ...(mode === 'auto' ? {autoConfirmedAt: now} : {})}}));
}

/** The apply settings and the session list as they were, to put back after a step seeded its own. */
function savedApply(profile) {
  const read = name => { try { return JSON.parse(fs.readFileSync(path.join(profile, name), 'utf8')); } catch { return null; } };
  return {apply: (read('settings.json') || {}).apply, sessions: read('sessions.json')};
}
function restoreApply(profile, kept, id) {
  const settings = path.join(profile, 'settings.json'), saved = (() => { try { return JSON.parse(fs.readFileSync(settings, 'utf8')); } catch { return {}; } })();
  if (kept.apply === undefined) delete saved.apply; else saved.apply = kept.apply;
  fs.writeFileSync(settings, JSON.stringify(saved));
  const file = path.join(profile, 'sessions.json'), now = (() => { try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return []; } })();
  fs.writeFileSync(file, JSON.stringify((Array.isArray(now) ? now : []).filter(record => record.id !== id)));
}

/** Open the session's card on the Sessions page and read what it says: {title, question, buttons, pill}. */
async function openCard(page, form, id) {
  await page.click('.nav[data-view="sessions"]');
  const row = page.locator('#ss-list .ss-row').filter({hasText: form.company}).filter({hasText: form.title});
  await row.first().waitFor({state: 'visible', timeout: 30000}).catch(() => { throw new Error(`no session row for ${form.company} on the Sessions page`); });
  const pill = (await row.first().innerText()).replace(/\s+/g, ' ');
  await row.first().click();
  await page.waitForFunction(want => window.__jp?.openSession?.id === want, id, {timeout: 15000}).catch(() => {});
  return pill;
}
const readCard = page => page.evaluate(() => {
  const text = selector => (document.querySelector(selector)?.innerText || '').replace(/\s+/g, ' ').trim();
  return {title: text('#ss-next-title'), question: text('#ss-question'), buttons: [...document.querySelectorAll('#ss-actions button')].map(button => button.innerText.replace(/\s+/g, ' ').trim()).filter(Boolean)};
});
const rowPill = (page, form) => page.locator('#ss-list .ss-row').filter({hasText: form.company}).filter({hasText: form.title}).first().innerText().then(text => text.replace(/\s+/g, ' ')).catch(() => '');
/** Moves the window's clock on, so the app's 45 s look and 60 s wait at Chrome are over at once (renderer/session-state.js CHECK_MS, WAIT_MS). */
const clockOn = (page, ms) => page.evaluate(by => { const real = performance.now.bind(performance); performance.now = () => real() + by; }, ms);

/** Throws when a step's port or the harness's app port is the production one (47111): no step here may touch the owner's app. */
function assertOwnPort(ctx, port) {
  if (port === PRODUCTION_PORT || String(ctx.appPort) === String(PRODUCTION_PORT)) throw new Error('a silent-Chrome step must never use the production port 47111');
}

const STUCK = /Checking|Chrome isn't reporting|Tab not found|Waiting for Chrome/i;

/** The Standard-automation step (the Chrome path): the app can't hear Chrome, then Chrome is silent. */
async function standardStep(ctx, form, id) {
  const mode = MODES.find(one => one.runner === 'chrome');
  const kept = savedApply(ctx.profile);
  try {
    const held = await holdPort();
    try {
      assertOwnPort(ctx, held.port);
      await ctx.relaunch({JOB_PILOTTO_PORT: String(held.port)}, profile => seedProfile(profile, mode.id, form, id));
      await until(`the app did not say it cannot open port ${held.port}`, () => appLogText(ctx.profile).includes(`connection off: port ${held.port} is used by another program`), 30000);
      await openCard(ctx.page, form, id);
      // Link off: said at once, never the 45 s "Checking" guess.
      const off = await until('the card did not say the app can\'t hear Chrome', async () => { const card = await readCard(ctx.page); return /can't hear Chrome/i.test(card.title) ? card : null; }, 30000);
      if (!/Connection off/i.test(await rowPill(ctx.page, form))) throw new Error(`the session's list pill does not say "Connection off": "${await rowPill(ctx.page, form)}"`);
      if (off.buttons.length) throw new Error(`a card whose cause is the app's own socket offers ${off.buttons.join(', ')}: none of them can help`);
      // Port free again: the app's retry opens it; Chrome still reports elsewhere, so the app is listening but hears nothing.
      await held.release();
      await until('the app did not take its port again', () => /connection back: port/.test(appLogText(ctx.profile)), 30000);
      // Why (30 Oct 2026, beta 41078746088): the clock moves only once the card has redrawn for the free port (the window's 2 s poll); moved before that redraw, the redraw itself read the moved clock
      // (green on Linux), moved after it, nothing redrew the card (red on macOS). Then the card must move on by itself within a few 2 s ticks: a 30 s wait let the one-shot CHECK_MS redraw pass it by luck.
      await until('the card still said the app can\'t hear Chrome after the port was free', async () => { const card = await readCard(ctx.page); return card.title && !/can't hear Chrome/i.test(card.title) ? card : null; }, 10000);
      await clockOn(ctx.page, 70000);
      const silent = await until('the card did not say Chrome isn\'t reporting by itself', async () => { const card = await readCard(ctx.page); return /Chrome isn't reporting/i.test(card.title) ? card : null; }, 10000);
      if (silent.buttons[0] !== 'Open it again') throw new Error(`the first button of the silent card is "${silent.buttons[0]}", not "Open it again" (buttons: ${silent.buttons.join(', ')})`);
      // Why (30 Oct 2026, #2586): the harness browser takes each page the app opens out of the opener's spool within milliseconds (lib/extension.mjs watcher), so a poll of the spool races it (2 of 4 runs missed the page). The app's own log line for the open stays.
    const opens = () => appLogText(ctx.profile).split('\n').filter(line => line.includes('[apply] opened the form tab') && line.includes(`"session":"${id}"`));
    const before = opens().length;
    await ctx.page.locator('#ss-actions button', {hasText: 'Open it again'}).click();
    const job = await until('Open it again opened no job tab', () => opens()[before] || null, 30000);
    if (!job.includes(`"host":"${new URL(form.url).hostname}"`)) throw new Error(`Open it again opened another page than the job ${form.url}: ${job}`);
    } finally { await held.release().catch(() => {}); }
    // Chrome's extension reports to the app again (the app on its own port): the card gives a verdict and an action, never the silent state or the first-look wait for ever.
    await ctx.relaunch({JOB_PILOTTO_PORT: String(ctx.appPort)});
    await openCard(ctx.page, form, id);
    await clockOn(ctx.page, 70000);
    const settled = await until('the card is still silent or checking after Chrome reported', async () => { const card = await readCard(ctx.page); return card.title && !STUCK.test(card.title) || (/Tab not found/i.test(card.title) && card.buttons.includes('Open it again')) ? card : null; }, 90000);
    console.log(`  after Chrome reported: "${settled.title}" · ${settled.buttons.join(' | ')}`);
  } finally {
    // The steps after this one run on the harness's own port and the person's saved mode, never the one this step seeded; also when it failed.
    await ctx.relaunch({JOB_PILOTTO_PORT: String(ctx.appPort)}, profile => restoreApply(profile, kept, id)).catch(error => console.log(`  could not put the app back: ${error.message}`));
  }
}

/** A hidden-browser mode's step (Background, Full): a queued job whose link is off says why. */
async function hiddenStep(ctx, form, id, mode) {
  const held = await holdPort(), kept = savedApply(ctx.profile);
  try {
    assertOwnPort(ctx, held.port);
    const submitted = ctx.forms?.fired?.length || 0;
    await ctx.relaunch({JOB_PILOTTO_PORT: String(held.port)}, profile => seedProfile(profile, mode.id, form, id));
    await until(`the app did not say it cannot open port ${held.port}`, () => appLogText(ctx.profile).includes(`connection off: port ${held.port} is used by another program`), 30000);
    await openCard(ctx.page, form, id);
    // The card follows the app's 2 s report of its own connection: wait on what it says, then read both places.
    const card = await until('the queued card did not say why it waits', async () => { const now = await readCard(ctx.page); return /can't hear/i.test(now.title) ? now : null; }, 30000).catch(async () => readCard(ctx.page));
    const pill = await rowPill(ctx.page, form);
    console.log(`  ${mode.title} with the link off: card "${card.title}" · "${card.question}" · pill "${pill}"`);
    if (/Chrome isn't reporting|Tab not found|Checking Chrome|Waiting for Chrome/i.test(`${card.title} ${pill}`)) throw new Error(`a hidden-browser job talks of the person's Chrome: "${card.title}" / "${pill}"`);
    if (!/Connection off/i.test(pill)) throw new Error(`the list pill of a queued ${mode.title} job does not say "Connection off": "${pill}"`);
    if (/Chrome/.test(card.question)) throw new Error(`a hidden-browser card names the person's Chrome: "${card.question}"`);
    if (!/can't hear|connection|link/i.test(`${card.title} ${card.question} ${pill}`)) throw new Error(`a queued ${mode.title} job says nothing of why it waits while the app's link is off: card "${card.title}", "${card.question}", pill "${pill}"`);
    if ((ctx.forms?.fired?.length || 0) !== submitted) throw new Error('a form was submitted while the app\'s link was off');
  } finally {
    await held.release().catch(() => {});
    // The steps after this one run on the harness's own port and the person's saved mode, never the one this step seeded.
    await ctx.relaunch({JOB_PILOTTO_PORT: String(ctx.appPort)}, profile => restoreApply(profile, kept, id));
  }
}

const STEPPED = ['check', 'fill', 'auto'];   // the apply modes that have a step below: a new mode in renderer/apply-settings-model.js MODES fails the run until it has one

/** Runs the silent-Chrome steps one after another (each relaunches the app): Standard automation (the Chrome path), then each hidden-browser mode. */
export async function runSilentChromeSteps(ctx) {
  const form = FORMS.multistep, hidden = [...ctx.needs, {name: 'a runtime link for the hidden browser (none on Windows)', value: process.platform !== 'win32'}];
  const missing = MODES.filter(mode => !STEPPED.includes(mode.id)).map(mode => mode.id);
  if (missing.length) throw new Error(`apply mode(s) ${missing.join(', ')} have no silent-Chrome step: add one in lib/apply-silent-steps.mjs`);
  const mode = id => MODES.find(one => one.id === id);
  await ctx.run('a silent Chrome in Standard automation: the card says the app can\'t hear Chrome at once, then asks for Chrome, and Open it again opens the job (not the extension\'s settings)', () => standardStep(ctx, form, 'silent-check'), {needs: ctx.needs});
  await ctx.run('a silent Chrome in Background automation: a queued hidden-browser job says why it waits when the app\'s link is off, and never talks of the person\'s Chrome', () => hiddenStep(ctx, form, 'silent-fill', mode('fill')), {needs: hidden});
  await ctx.run('a silent Chrome in Full automation: a queued hidden-browser job says why it waits when the app\'s link is off, and never talks of the person\'s Chrome; nothing is submitted', () => hiddenStep(ctx, form, 'silent-auto', mode('auto')), {safety: true, needs: hidden});
}
