// Ready to send, the window's calls (private spec jobadabra-lab:docs/specs/2026-10-17-ready-to-send.md): is this install the owner's (else why not: the card says it), what tonight would send, send it, start it now, the morning's rows, Done, the two numbers.
// Registered once from kit-handlers.js (main.js is at its size limit). Nothing here presses Submit or leaves data on the site beyond what ready-batch.js builds; the site deletes it on Done, after 24 h, or on Delete everything. Guard: test/ready-handlers.test.js.
import fs from 'node:fs';
import * as pipeline from './pipeline.js';
import {extensionStore} from './store/extension-store.js';
import {me} from './server-contact.js';
import * as viewCache from './view-cache.js';
import {buildBatch, nightOf, ownKeyFor, pickToRefill, pickToSend, withOwnAi} from './ready-batch.js';
import {fillNowPlan, waitingOn} from './ready-fill-now.js';
import {CHIPS, costLine, pickTop} from './ready-top.js';
import {costVisible} from './ai/names.js';
import {createAutoSend, startAutoSend} from './ready-auto.js';
import {isTwin} from './twin.js';
import {log as appLog} from './log.js';
import {keysOf} from './ai/index.js';
import {complete, settingsOf} from './ready.js';
import * as site from './ready-site.js';
import * as handoffs from './ready-handoff.js';
import {setVisitRoute} from './server-hooks.js';
import {readyToSubmit, waitingOf} from '../renderer/pages/ready-rows.js';
import {applyChosen} from '../renderer/apply-settings-model.js';   // nothing is sent by itself before the first-Apply choice (lib/apply-choice-gate.js)

// What the AI may answer a form from: the same texts the normal Apply gives it (Profile, standard answers, search settings, the CV's facts).
async function facts(storage) {
  const [{profile = '', answers = ''} = {}, {configForPrompt}, {cvFactsOf}] = await Promise.all([
    import('./strategy.js').then(strategy => strategy.profileTexts(storage)).catch(() => ({})), import('./config-text.js'), import('./server-env.js')]);
  return {profile, standard: answers, search: await configForPrompt(storage, 'search.json'), cvFacts: cvFactsOf(storage), knowledge: ''};
}

export function registerReadyHandlers({ipcMain, notify = () => {}, shell, storage, deps = {}, app, powerMonitor, prepare = deps.prepare}) {
  const settings = () => settingsOf(storage.settings().ready);
  const jobs = async () => (deps.jobs ? deps.jobs() : (await pipeline.jobs(storage)).jobs);   // deps.jobs: a test's list
  const cached = () => viewCache.recall(storage, 'jobs')?.result?.jobs || [];   // the last good list: the card never waits for a job read to say "owner" and show the night's rows
  const tonightOf = (all, mine) => ({tonight: pickToSend(all, mine).map(job => ({code: job.code, title: job.title, company: job.company, fit: job.fit})), names: Object.fromEntries(all.map(job => [job.code, `${job.title} · ${job.company}`]))});
  const build = async list => buildBatch(list, {store: extensionStore(storage), me: url => me(storage, url), facts: () => facts(storage), ...deps});
  // A form you marked "I submitted it" on the page: your word, so the job becomes Applied here and its data is deleted from the server.
  const settleSubmitted = async (rows, all) => {
    for (const row of (rows.jobs || []).filter(each => each.submitted_at && !each.cleared_at)) {
      const job = all.find(each => each.code === row.job);
      if (job && job.status !== 'applied') await pipeline.setStatus(storage, job.url, 'applied').catch(() => null);
      await site.done(storage, row.job);
      row.cleared_at = row.submitted_at;
    }
  };
  // The morning line, once per night: how many forms are ready (the app's notification, and Telegram when that is how you chose to be told).
  const tellMorning = rows => {
    const waiting = waitingOf(rows.jobs || []), night = rows.batch?.night;
    if (!waiting || !night || storage.settings().ready?.told === night) return;
    storage.saveSettings({ready: {...settings(), told: night}});
    notify('Ready to send ✓', `${waiting.ready} form${waiting.ready === 1 ? '' : 's'} filled overnight${waiting.left ? `, ${waiting.left} need you` : ''}. Open Actions to press Submit.`, {view: 'actions'});
  };
  // Which jobs the night filled and left ready to submit (ready-rows.js readyToSubmit): the Jobs list marks them. Light, no job read; a kept answer for 30 s.
  let codesAt = 0, codesKept = null;
  ipcMain.handle('readyCodes', async () => {
    if (process.env.JOB_PILOTTO_DEMO) { try { return {ok: true, codes: (JSON.parse(fs.readFileSync(storage.path('ready.json'), 'utf8')).site?.jobs || []).filter(readyToSubmit).map(job => job.job)}; } catch { return {ok: false}; } }
    if (codesKept && Date.now() - codesAt < 30000) return codesKept;
    const rows = await site.status(storage).catch(() => ({ok: false}));
    if (!rows.ok) return {ok: false};
    codesKept = {ok: true, codes: (rows.jobs || []).filter(readyToSubmit).map(job => job.job)}; codesAt = Date.now();
    return codesKept;
  });
  ipcMain.handle('readyState', async () => {
    if (process.env.JOB_PILOTTO_DEMO) { try { return JSON.parse(fs.readFileSync(storage.path('ready.json'), 'utf8')); } catch { return {owner: false}; } }   // the demo's fictional night (desktop/demo/ready.json)
    const rows = await site.status(storage);
    if (!rows.ok) return {owner: false, why: rows.why};   // the card shows this, its buttons off
    const mine = settings();
    if ((rows.jobs || []).some(each => each.submitted_at && !each.cleared_at)) await settleSubmitted(rows, await jobs());   // only then the list is read
    tellMorning(rows);
    const sent = storage.settings().ready?.sent;   // what went to the server for the coming night (by hand or by itself): the card says it
    return {owner: true, settings: mine, ...tonightOf(cached(), mine), site: rows, sent: sent?.night === nightOf().night ? sent : null};
  });
  // What tonight would send, from a fresh job read (joins one already running): the card asks after it has painted.
  ipcMain.handle('readyTonight', async () => { try { return {ok: true, ...tonightOf(await jobs(), settings())}; } catch { return {ok: false}; } });
  const sendTonight = async (list = null) => {
    const mine = settings(), {batch, skipped} = await build(list || pickToSend(await jobs(), mine));
    if (!batch.jobs.length) return {ok: false, error: 'No job has its kit, CV and cover letter ready yet.', skipped};
    const sent = await site.send(storage, withOwnAi(batch, ownKeyFor(storage.settings(), keysOf(storage))));
    return sent.ok ? {ok: true, queued: sent.queued, night: batch.night, skipped} : sent;
  };
  // Sent by itself when tonight's list changes and before the laptop goes off (lib/ready-auto.js); only on the owner's install (its owner key).
  // Not before the person chose how Jobadabra applies (the first-Apply dialog). The twin shares the owner's install: it never sends by itself (it would replace his night); nor do demo, test, CI and smoke runs.
  const ownApp = () => applyChosen(storage.settings()) && !isTwin() && !['JOB_PILOTTO_DEMO', 'JOB_PILOTTO_E2E', 'JOB_PILOTTO_SMOKE', 'CI'].some(name => process.env[name]) && !!site.ownerSecret(storage);
  const autoSend = createAutoSend({storage, eligible: ownApp, tonightCodes: () => pickToSend(cached(), settings()).map(job => job.code),
    sendNow: sendTonight, log: (message, extra) => appLog('ready', message, extra)});
  startAutoSend(autoSend.check, {app, powerMonitor});
  // What a press would do (lib/ready-fill-now.js): send at once, ask first (forms of this night still wait for you; or only opened jobs are left), or nothing to fill.
  const planFor = async ({again = false, confirmed = false, refill = true} = {}) => {
    const all = await jobs(), mine = settings(), rows = await site.rows(storage).catch(() => ({}));
    const plan = fillNowPlan({tonight: pickToSend(all, mine), opened: refill ? pickToRefill(all, mine) : [], waiting: waitingOn(rows, nightOf().night), again, confirmed});
    return plan.ask ? {ask: {...plan.ask, jobs: plan.ask.jobs.map(job => ({code: job.code, name: `${job.title} · ${job.company}`}))}} : plan;
  };
  const NOTHING = 'Nothing to fill: no good match is left to fill.';
  const sendPlanned = async plan => {
    const sent = await sendTonight(plan.send);
    autoSend.record(plan.send.map(job => job.code), sent);
    return sent;
  };
  ipcMain.handle('readySend', async (_, {confirmed = false} = {}) => {   // Fill tonight: never fills opened jobs again; asks before replacing forms still waiting
    const plan = await planFor({confirmed, refill: false});
    if (plan.nothing) return {ok: false, nothing: true, error: NOTHING};
    if (plan.ask) return {ok: false, ask: plan.ask};
    return sendPlanned(plan);
  });
  // The live view: the site gives a link for this form (10 minutes, only for you); your browser opens it, where you press Submit yourself.
  ipcMain.handle('readyLive', async (_, code) => {
    const made = await site.link(storage, String(code || ''));
    if (!made.ok) return made;
    await shell.openExternal(made.url);
    return {ok: true};
  });
  // Open in my browser (PR 5b): the night's hand-off for this job, then the normal Apply (a form session and its marked tab in the extension's browser).
  // The extension asks for the hand-off once when the tab loads (route below): it sets the page's cookies, loads the page the night ended on, puts back
  // the night's values, and its normal fill takes over for what is left. Nothing is submitted.
  ipcMain.handle('readyOpen', async (_, code) => {
    const mine = each => each.code === String(code || ''), job = cached().find(mine) || (await jobs().catch(() => [])).find(mine);   // the kept list first: a job read takes ~13 s
    if (!job?.url) return {ok: false, error: 'This job is not in your list any more.'};
    const made = await site.handoff(storage, job.code);
    if (!made.ok) return made;
    const {applyOne, formUrl} = deps.apply || await import('./apply.js');
    if (!handoffs.keep(made, [job.url, formUrl(job.url)])) return {ok: false, error: 'The server gave no page for this form.'};
    const opened = await applyOne(storage, job.url, {title: job.title, company: job.company, location: job.location});
    appLog('ready', 'open in my browser', {job: job.code, ok: opened.ok, fields: made.snapshot?.fields?.length || 0});
    return opened.ok ? {ok: true} : opened;
  });
  setVisitRoute('/extension/ready-handoff', payload => ({ok: true, handoff: handoffs.take(payload?.url)}));
  if (process.env.JOB_PILOTTO_E2E) globalThis.__jpReadyHandoffs = handoffs;   // the apply suite's Open in Chrome step hands the app a night's hand-off (a test has no Ready site)
  // Fill now (owner, 18 Oct 2026: "make the Fill now work"): one press sends tonight's ready jobs and starts them; after a yes, the jobs you opened and did not submit.
  // Started, nothing sent by itself replaces that night (ranNight).
  // Fill now's popup (owner, 19 Oct 2026): the top jobs not on the server yet, what each lacks, and the cost line for each chip. From the kept list at once; no AI, nothing sent.
  ipcMain.handle('readyTop', async () => {
    if (process.env.JOB_PILOTTO_DEMO) { try { return JSON.parse(fs.readFileSync(storage.path('ready-top.json'), 'utf8')); } catch { return {ok: false}; } }   // the demo's fictional pick (desktop/demo/ready-top.json)
    const all = cached().length ? cached() : await jobs().catch(() => []), rows = await site.rows(storage).catch(() => ({}));
    const picked = pickTop(all, Math.max(...CHIPS), {minFit: settings().minFit, skip: new Set((rows.jobs || []).filter(job => !job.cleared_at).map(job => job.job))});
    return {ok: true, picked: picked.map(({code, title, company, fit, needsKit, needsCv}) => ({code, name: `${title} · ${company}`, fit, needsKit, needsCv})), chips: CHIPS, lines: Object.fromEntries(CHIPS.map(count => [count, costLine(picked, count, {showCost: costVisible(storage)})]))};
  });
  // After the popup's yes: make what the chosen jobs lack (the Tailor task's own pieces: the kit, then the CV with its letter), then send the ones that are complete and start them.
  // It asks first, before any AI spend, when the send would replace forms of this night still waiting for you.
  const runTop = async (codes, confirmed) => {
    const all = await jobs(), chosen = codes.map(code => all.find(job => job.code === code)).filter(Boolean), rows = await site.rows(storage).catch(() => ({}));
    const waiting = waitingOn(rows, nightOf().night);
    if (waiting && !confirmed) return {ask: {again: false, jobs: chosen.map(job => ({code: job.code, name: `${job.title} · ${job.company}`})), replaces: waiting}};
    const failed = [];
    for (const job of chosen.filter(each => !complete(each))) {
      const name = `${job.title} · ${job.company}`;
      if (!job.kit) { const made = await prepare.kit(job.code, name); if (!made.ok) { failed.push(made.error || `${name}: no kit`); continue; } }
      if (!job.tailored || !job.letter) { const made = await prepare.cv(job.code, name); if (!made.ok) failed.push(made.error || `${name}: no CV`); }
    }
    const fresh = await jobs(), mine = new Set(codes), list = fresh.filter(job => mine.has(job.code) && complete(job));
    if (!list.length) return {ok: false, nothing: true, error: failed.length ? `Nothing could be prepared: ${failed[0]}` : NOTHING};
    const sent = await sendPlanned({send: list});
    if (!sent.ok) return sent;
    const started = await site.runNow(storage);
    if (started.ok) storage.saveSettings({ready: {...storage.settings().ready, ranNight: nightOf().night}});
    return started.ok ? {...started, queued: sent.queued, night: sent.night, skipped: sent.skipped, failed} : started;
  };
  ipcMain.handle('readyRun', async (_, {again = false, confirmed = false, top = null} = {}) => {
    if (Array.isArray(top) && top.length && prepare) return runTop(top.map(String), confirmed);
    const plan = await planFor({again, confirmed});
    if (plan.nothing) return {ok: false, nothing: true, error: NOTHING};
    if (plan.ask) return {ok: false, ask: plan.ask};
    const sent = await sendPlanned(plan);
    if (!sent.ok) return sent;
    const started = await site.runNow(storage);
    if (started.ok) storage.saveSettings({ready: {...storage.settings().ready, ranNight: nightOf().night}});
    return started.ok ? {...started, queued: sent.queued, night: sent.night, skipped: sent.skipped} : started;
  });
  // A row's Fill again (the card asked first): the server fills that form again from the night's own copy (site src/ready-again.js), never from this list
  // (18 Oct 2026: a job opened in the browser no longer counts as finished here, so the list refused it and nothing was filled).
  ipcMain.handle('readyAgain', (_, code) => site.again(storage, String(code || '')));
  ipcMain.handle('readyStop', (_, code) => site.stop(storage, code ? String(code) : ''));   // Stop: one form, or (no code) every form the night still fills
  ipcMain.handle('readyVideo', (_, code) => site.video(storage, String(code || '')));   // Watch the fill: the night's video of this form, played under its row
  ipcMain.handle('readyDone', (_, code) => site.done(storage, String(code || '')));
  ipcMain.handle('readyDeleteAll', () => site.deleteAll(storage));
  ipcMain.handle('readySettings', (_, patch) => { storage.saveSettings({ready: {...settings(), ...patch}}); return {ok: true, settings: settings()}; });
}
