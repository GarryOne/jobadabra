/* global document, window, MutationObserver */
// Focus: what a person sees on the first page they open each day. Dummy applications in every stage are written to the app's store (ctx.data: this
// Mac's or Notion), then the page is judged as a person would: the Up next rows in the right order with the right buttons, every number against the store's records, the target, finishing
// an action, the Insight card, a fresh account. Starts from a set-up install; resets only this suite's own rows (never the workspace).
import {call} from '../lib/notion.mjs';
import {LIMITS, inspect} from '../lib/uicheck.mjs';
import {journey} from '../lib/journey.mjs';
import {actionScenario, addApplication, addFocusData, expectedNumbers, compareNumbers, EXPECTED_SUGGESTIONS, EXPECTED_UP_NEXT, HAND_EDITS, readData, resetFocusData, savedTarget, scenario} from '../lib/focus-data.mjs';
import {finish, snap} from '../lib/layout.mjs';
import {ensureSetUp} from '../lib/seed.mjs';

export const minutes = 15;
// What a step needs from an earlier one when E2E_STEPS picks it (lib/runner.mjs wantedWords).
// Why (#2338, #2350): a step that reads Focus without opening it needs the step that opens it; the app may open on Jobs (a re-run of "Edit target"
// alone found no Edit target, #2338), and picked alone on a PR, "Up next" read a Focus drawn mid-seed (#2350).
const OPENS_FOCUS = 'Focus finishes loading';
const READS_OPEN_FOCUS = ['"Up next" lists', 'every number on Focus', 'Suggestions lead with', 'clicking an Up next', '"Edit target"', 'marking an action Done', 'Skip dismisses', 'a fresh account'];
export const stepNeeds = {...Object.fromEntries(READS_OPEN_FOCUS.map(step => [step, [OPENS_FOCUS]])),
  'in-app hold': ['five more Up next', 'removes it for good'], 'removes it for good': ['five more Up next']};
export const name = 'focus';
// Two suites from this file (6 Oct 2026, under 5 minutes each): `focus` (lists, numbers, target, Done, Skip, hand edits, a fresh account) and `focusdismiss`
// (suites/focusdismiss.mjs: the five ways to dismiss a card, the hold, Dismiss in process), each on its own real Notion page. `focus` moves to the in-memory Notion next.
const DISMISS_STEPS = ['five more Up next cards', 'removes it for good', 'in-app hold', 'Dismiss on a job in process'];
const SHARED_STEPS = ['a search with applications in every stage', 'Focus finishes loading', 'nothing was queued', 'render without layout problems'];
export const partOf = name => (SHARED_STEPS.some(head => name.startsWith(head) || name.includes(head)) ? 'both' : DISMISS_STEPS.some(head => name.includes(head)) ? 'dismiss' : 'main');
export const run = ctx => runFocus(ctx, ['main']);
// One failed step never hides the rest: the runner records it and goes on (lib/runner.mjs); only the setup steps marked `critical` stop the suite.
export const keepGoing = true;

const LIST_LAG_MS = 15000;   // the stand-in's listing lag for the dismissal steps (lib/notion-fake.mjs setLag)
const ERROR_WORDS = /\b(undefined|null|NaN|\[object|TypeError|Traceback|ENOENT|ECONN|could not load|stack)\b/i;

export async function runFocus(ctx, parts) {
  const {page, app, token: NOTION} = ctx;
  ctx.findings = [];
  const now = new Date();
  let rows, events, target = 5;

  const focusReady = () => page.waitForFunction(() => /^Updated/.test(document.querySelector('#focus-status')?.textContent || '')
    && !document.querySelector('.view[data-view="focus"] .skeleton, .view[data-view="focus"] .spinner'), null, {timeout: 60000});
  const refresh = async () => { await page.click('#focus-refresh'); await page.waitForTimeout(300); await focusReady(); };
  const goFocus = async () => { await page.click('.nav[data-view="focus"]'); await page.waitForSelector('.view[data-view="focus"]:not([hidden])'); };
  const rowsIn = list => page.evaluate(list => [...document.querySelectorAll(`${list} .focus-item`)].map(li => ({
    headline: li.querySelector('.focus-headline')?.textContent.trim() || '', badge: li.querySelector('.ui-pill')?.textContent.trim() || '',
    meta: li.querySelector('.focus-meta')?.textContent.trim() || '', kind: li.dataset.suggestion || '',
    buttons: [...li.querySelectorAll('.focus-actions > button:not(.ui-more)')].map(button => button.textContent.trim()),
    hasMore: !!li.querySelector('.focus-actions .ui-more')})), list);
  // Up next holds what can't wait; Suggestions the rest (pages/focus-suggestions.js; owner, 28 Oct 2026). Both lists: a card is looked for in either.
  const LISTS = '#focus-list .focus-item, #focus-suggestions-list .focus-item';
  const upNext = () => rowsIn('#focus-list');
  // The drawers' rows (cover letter, Fill your details, What we learned) lead Suggestions and belong to the window, not the engine (renderer/question-entries.js,
  // insights PR 1c): `suggested` is the engine's rows, `drawers` those, so each step names what it counts.
  const DRAWER_KINDS = ['letter', 'details', 'learned', 'questions-error'];
  const suggested = async () => (await rowsIn('#focus-suggestions-list')).filter(row => !DRAWER_KINDS.includes(row.kind));
  const drawers = async () => (await rowsIn('#focus-suggestions-list')).filter(row => DRAWER_KINDS.includes(row.kind));
  const anyRow = headline => page.locator(LISTS, {has: page.locator('.focus-headline', {hasText: headline})});
  // Suggestions shows 3, then "Show all N"; the choice is remembered, so one press lists every row from here on (a folded row is not drawn at all).
  const showAll = async () => { const all = page.locator('#focus-suggestions-all'); if (await all.isVisible() && /^Show all/.test(await all.textContent())) await all.click(); };
  const shownNumbers = () => page.evaluate(() => {
    const steps = list => [...document.querySelectorAll(`${list} .funnel-step`)].map(li => ({name: li.querySelector('.funnel-name')?.textContent.trim(),
      count: li.querySelector('.funnel-count')?.textContent.trim(), share: li.querySelector('.muted.small')?.textContent.trim()}));
    return {count: document.querySelector('#focus-count').textContent.trim(), of: document.querySelector('#focus-of').textContent.trim(),
      pct: document.querySelector('#focus-pct').textContent.trim(), bar: document.querySelector('#focus-bar').style.width,
      chartSum: document.querySelector('#focus-chart-sum').textContent.trim(), funnel: steps('#funnel-steps'),
      inbound: document.querySelector('#focus-inbound').hidden ? [] : steps('#inbound-steps'),
      actions: document.querySelector('#focus-count-note').textContent.trim()};
  });
  const readStore = async () => ({rows, events} = await readData(ctx));
  // The helper every count goes through: what Focus shows against what Notion says (an independent oracle, lib/focus-data.mjs).
  // Notion's query API is eventually consistent: a read a moment after a write can miss it, and the engine and this oracle read at different moments.
  // So a difference is checked again (Notion re-read, Focus refreshed) for up to ~30 s; a real bug does not go away, and the log says how long agreement took.
  const numbersMatchSource = async label => {
    let diffs = [];
    for (let attempt = 0; attempt < 7; attempt++) {
      if (attempt) { await page.waitForTimeout(5000); if (attempt % 2 === 0) await refresh(); }
      await readStore();
      diffs = compareNumbers(await shownNumbers(), expectedNumbers(rows, events, {now, target}));
      if (!diffs.length) { if (attempt) console.log(`  ${label}: the store and Focus agreed after ${attempt} re-read(s)`); return; }
    }
    throw new Error(`${label}: ${diffs.join('; ')} (the store has ${rows.length} application(s) and ${events.length} event(s); still different after 30 s)`);
  };
  // The events of one kind on one application (found by who it is for), for up to 30 s: Notion shows a write a moment after it returns.
  const eventsOf = async (kind, who) => {
    let found = [];
    for (let i = 0; i < 10 && !found.length; i++) {
      const row = (await ctx.data('applications', 'list', {})).find(item => item.company === who || item.via === who);
      found = row ? await ctx.data('events', 'list', {app_id: row.id, kind}) : [];
      if (!found.length) await page.waitForTimeout(3000);
    }
    return found;
  };

  await ensureSetUp(ctx);
  const all = ctx.run;   // after setup: the wizard's own steps are never filtered
  ctx.run = (name, fn, options) => (partOf(name) === 'both' || parts.includes(partOf(name)) ? all(name, fn, options) : undefined);
  await app.evaluate(({shell}) => { globalThis.__opened = []; shell.openExternal = async url => { globalThis.__opened.push(String(url)); }; });
  const urlsOpened = () => app.evaluate(() => globalThis.__opened.slice());

  await ctx.run('a search with applications in every stage is written to the store (dummy employers, target 5)', async () => {
    await resetFocusData(ctx, {data: scenario(now)});
    for (let i = 0; i < 12; i++) { await readStore(); if (rows.length === 10 && events.length === 14) break; await page.waitForTimeout(5000); }   // Notion lists new rows a moment later
    if (rows.length !== 10 || events.length !== 14) throw new Error(`expected 10 applications and 14 events in the store, found ${rows.length} and ${events.length}`);
  }, {needs: ctx.needs, critical: true});

  await ctx.run('Focus finishes loading within 20 seconds, with no error text', async () => {
    const started = Date.now();
    await goFocus();
    await focusReady();
    const seconds = (Date.now() - started) / 1000;
    if (seconds > 20) throw new Error(`Focus took ${seconds.toFixed(1)} s to finish loading (limit 20 s)`);
    const text = await page.evaluate(() => document.querySelector('.view[data-view="focus"]').innerText);
    const bad = text.match(ERROR_WORDS);
    if (bad) throw new Error(`Focus shows error-like text "${bad[0]}"`);
    console.log(`  loaded in ${seconds.toFixed(1)} s`);
    await snap(ctx, 'focus', {situation: 'a search with applications in every stage'});
  }, {needs: ctx.needs});

  await ctx.run('"Up next" lists what can\'t wait and Suggestions the rest, in the right order, each with the right buttons', async () => {
    const check = (where, items, expected) => {
      const lines = items.map(item => `${item.headline} [${item.badge}] (${item.buttons.join(', ') || 'no button'})`);
      if (items.length !== expected.length) throw new Error(`expected ${expected.length} rows in ${where}, Focus lists ${items.length}:\n    ${lines.join('\n    ')}`);
      expected.forEach((want, i) => {
        const got = items[i];
        if (!got.headline.includes(want.who)) throw new Error(`${where} row ${i + 1} should be about "${want.who}", it is "${got.headline}". Order: ${lines.join(' | ')}`);
        const badgeOk = want.badge instanceof RegExp ? want.badge.test(got.badge) : got.badge === want.badge;
        if (!badgeOk) throw new Error(`${where} row ${i + 1} (${want.who}) has the badge "${got.badge}", expected ${want.badge}`);
        if (JSON.stringify(got.buttons) !== JSON.stringify(want.buttons)) throw new Error(`${where} row ${i + 1} (${want.who}) has the buttons [${got.buttons.join(', ')}], expected [${want.buttons.join(', ')}]`);
      });
    };
    check('Up next', await upNext(), EXPECTED_UP_NEXT);
    const folded = (await page.textContent('#focus-suggestions-count')).trim();
    await showAll();
    check('Suggestions', await suggested(), EXPECTED_SUGGESTIONS);   // first: on a wrong count it names every row
    // The drawers' rows, when the account has any (what is open to fill depends on the store: desktop/test/question-entries.test.js holds each state), lead Suggestions in the
    // owner's order, the blocking cover letter first (28 Oct 2026), each with its own button.
    await page.waitForSelector('#focus-suggestions-list .focus-item[data-suggestion="letter"], #focus-suggestions-list .focus-item[data-suggestion="details"]', {timeout: 20000}).catch(() => {});   // they draw when the open questions are read, a little after Focus
    const lead = await drawers(), kinds = (await rowsIn('#focus-suggestions-list')).map(row => row.kind);
    const RANK = ['letter', 'details', 'learned'], BUTTON = {details: 'Fill your details', learned: 'Check what we learned'};
    if (kinds.slice(0, lead.length).join() !== lead.map(row => row.kind).join() || lead.some((row, i) => i && RANK.indexOf(row.kind) < RANK.indexOf(lead[i - 1].kind))) {
      throw new Error(`the drawers' rows should lead Suggestions in the order cover letter, Fill your details, What we learned; the rows are: ${kinds.join(', ')}`);
    }
    for (const row of lead) {
      if (row.kind in BUTTON && row.buttons.join() !== BUTTON[row.kind]) throw new Error(`"${row.headline}" has the buttons [${row.buttons.join(', ')}], expected [${BUTTON[row.kind]}]`);
      if (row.kind === 'letter' && (row.badge !== 'High priority' || row.buttons.length !== 1)) throw new Error(`the cover letter row should be "High priority" with one button, it is [${row.badge}] (${row.buttons.join(', ')})`);
    }
    const total = EXPECTED_SUGGESTIONS.length + (await drawers()).length;
    if (folded !== `3 of ${total}`) throw new Error(`Suggestions should show 3 of ${total} at first, its head says "${folded}"`);
    if ((await upNext()).concat(await suggested()).some(item => /waiting/.test(item.headline))) throw new Error('"1 application waiting" has no button: it should have left Focus');
    const note = (await page.textContent('#focus-count-note')).trim();
    if (note !== '2 actions') throw new Error(`the Up next header should count "2 actions", it says "${note}"`);
    const summary = (await page.textContent('#focus-summary')).trim();
    if (summary !== 'Reply to recruiters first, then prepare for your interview.') throw new Error(`the focus summary should lead with the reply, then the interview; it says "${summary}"`);
  }, {needs: ctx.needs});

  await ctx.run('every number on Focus matches the Notion rows (today, target, 14-day chart, funnel, inbound funnel)', async () => {
    await numbersMatchSource('first load');
    const shown = await shownNumbers();
    // The oracle is itself checked against hand-counted numbers, so a wrong oracle cannot pass a wrong page.
    if (shown.count !== '2' || shown.funnel.map(step => step.count).join() !== '8,6,2,2,0' || shown.inbound.map(step => step.count).join() !== '2,1,1,0') {
      throw new Error(`the hand-counted numbers are 2 applied today, funnel 8,6,2,2,0 and inbound 2,1,1,0; Focus shows ${shown.count}, ${shown.funnel.map(step => step.count)} and ${shown.inbound.map(step => step.count)}`);
    }
    const hint = await page.evaluate(() => ({greyed: document.querySelector('#focus-funnel').classList.contains('is-empty'), shown: !document.querySelector('#funnel-empty').hidden}));
    if (hint.greyed || hint.shown) throw new Error('the "fills in later" hint is showing although the funnel has data');
    const chartDays = await page.evaluate(() => document.querySelectorAll('#focus-chart .focus-chart-col').length);
    if (chartDays !== 14) throw new Error(`the progress chart draws ${chartDays} days, expected 14`);
  }, {needs: ctx.needs});

  await ctx.run('Suggestions lead with the latest rejection lesson, with a button to review it', async () => {
    const lesson = '#focus-suggestions-list .focus-item[data-suggestion="rejection"]';
    const card = await page.evaluate(lesson => ({shown: !document.querySelector('#focus-suggestions').hidden, first: [...document.querySelectorAll('#focus-suggestions-list .focus-item')].find(li => !['letter', 'details', 'learned', 'questions-error'].includes(li.dataset.suggestion))?.dataset.suggestion,
      text: document.querySelector(lesson)?.innerText || '', button: document.querySelector(`${lesson} .focus-actions > button`)?.textContent.trim()}), lesson);
    if (!card.shown || !card.text) throw new Error('Suggestions show no rejection lesson although a rejection with a lesson was saved today');
    if (card.first !== 'rejection') throw new Error(`the rejection lesson should be the first of Suggestions' own rows (after the drawers' rows), the first is "${card.first || 'a Focus item'}"`);
    if (!/Seniority mismatch/.test(card.text) || !/Hard skills/i.test(card.text) || !/Gale Robotics/.test(card.text)) throw new Error(`the lesson row does not show the saved lesson: "${card.text}"`);
    if (ERROR_WORDS.test(card.text)) throw new Error(`the lesson row shows error-like text: "${card.text}"`);
    if (card.button !== 'Review rejection') throw new Error(`the lesson's button says "${card.button}", expected "Review rejection"`);
    // The button opens the rejection: its Notion page on the Notion store; on this Mac's store the job's panel on its Review tab (pages/focus-suggestions.js RUN).
    const opened = (await urlsOpened()).length;
    await page.click(`${lesson} .focus-actions > button`);
    if (ctx.store === 'sqlite') {
      try {
        await page.waitForSelector('#job-panel:not([hidden]) .tabs [data-job-tab="review"].is-active', {timeout: 15000}).catch(async () => {
          throw new Error(`"Review rejection" did not open the job's Review tab: ${JSON.stringify(await page.evaluate(() => ({hidden: document.querySelector('#job-panel')?.hidden, tabs: [...document.querySelectorAll('#job-panel .tabs button')].map(b => `${b.dataset.jobTab}${b.classList.contains('is-active') ? '*' : ''}`), text: document.querySelector('#job-panel')?.innerText.slice(0, 160)})))}`);
        });
        await page.waitForFunction(() => /Seniority mismatch/.test(document.getElementById('job-panel')?.textContent || ''), null, {timeout: 20000}).catch(() => {});   // the drawer draws its header first, the tab's body once its data is read
        const panel = await page.textContent('#job-panel');
        if (!/Gale Robotics/.test(panel) || !/Seniority mismatch/.test(panel)) throw new Error(`the Review tab is not Gale Robotics' rejection: "${panel.replace(/\s+/g, ' ').slice(0, 200)}"`);
      } catch (error) { await page.keyboard.press('Escape'); throw error; }   // a failed step must not leave the drawer over the steps after it
      await goFocus();
      if (await page.locator('#job-drawer-layer').isVisible()) throw new Error("the job's drawer stayed open after going to another page");   // it covers the page it was opened from (pages/nav.js openView)
    } else {
      await page.waitForTimeout(500);
      if ((await urlsOpened()).length !== opened + 1) throw new Error(`"Review rejection" opened nothing (opened: ${(await urlsOpened()).join(', ') || 'none'})`);
    }
  }, {needs: ctx.needs});

  await ctx.run('clicking an Up next or Suggestions row opens the right place: the mail, Jobs, the feedback box', async () => {
    const row = anyRow;
    await showAll();
    await row('Huxley Partners').getByRole('button', {name: 'Open email'}).click();
    await page.waitForTimeout(500);
    const mail = (await urlsOpened()).filter(url => /mail\.google\.com.*e2e-lead-1/.test(url));
    if (mail.length !== 1) throw new Error(`"Open email" should open the lead's own message (e2e-lead-1), the app opened: ${(await urlsOpened()).join(', ') || 'nothing'}`);
    await row('Fjord Networks').getByRole('button', {name: 'Add feedback'}).click();
    await page.waitForSelector('#feedback-dialog[open]', {timeout: 5000});
    const context = await page.textContent('#feedback-context');
    if (!/Fjord Networks/.test(context) || !/Cloud Engineer/.test(context)) throw new Error(`the feedback box is about "${context}", expected Fjord Networks · Cloud Engineer`);
    await page.evaluate(() => document.querySelector('#feedback-dialog').close());
    await row('Apply to').getByRole('button', {name: 'Browse jobs'}).click();
    await page.waitForSelector('.view[data-view="jobs"]:not([hidden])', {timeout: 5000});
    await goFocus();
  }, {needs: ctx.needs});

  await ctx.run('"Edit target" saves to Notion, survives a reload and changes the progress ratio', async () => {
    await page.evaluate(() => { window.__toasts = []; new MutationObserver(() => document.querySelectorAll('#toasts .toast').forEach(toast => { if (!window.__toasts.includes(toast.textContent)) window.__toasts.push(toast.textContent); })).observe(document.querySelector('#toasts'), {childList: true}); });
    await page.click('#focus-edit-target');
    await page.fill('#focus-target', '3');
    // Focus drawn again while the box is being typed in (a Gmail check ending, the page's own late load) keeps what was typed: on main after #2331
    // a load that landed mid-edit put 5 back and Tab saved nothing (issue #2338). Refresh is pressed from the page, so the box keeps the keyboard.
    const redrawn = await page.evaluate(() => new Promise(resolve => {   // a load already running draws too (Refresh is off meanwhile)
      window.addEventListener('focus-updated', () => resolve(true), {once: true});
      document.querySelector('#focus-refresh').click();
      setTimeout(() => resolve(false), 20000);
    }));
    if (!redrawn) throw new Error('Focus was not drawn again within 20 s while the target was being typed: the step proved nothing');
    const typed = await page.inputValue('#focus-target');
    if (typed !== '3') throw new Error(`Focus drawn again while the target was being typed put "${typed}" back in the box, not the "3" typed`);
    await page.press('#focus-target', 'Tab');
    await page.waitForFunction(() => document.querySelector('#focus-of').textContent.includes('/ 3 '), null, {timeout: 60000})
      .catch(async () => { throw new Error(`the page never showed the new target. Messages the app showed: ${JSON.stringify(await page.evaluate(() => window.__toasts))}. State: ${JSON.stringify(await page.evaluate(() => ({of: document.querySelector('#focus-of').textContent, input: document.querySelector('#focus-target').value, rowHidden: document.querySelector('#focus-target-row').hidden, disabled: document.querySelector('#focus-target').disabled, status: document.querySelector('#focus-status').textContent})))}`); });
    await focusReady();
    target = 3;
    await numbersMatchSource('after the target changed to 3');
    const shown = await shownNumbers();
    if (shown.pct !== '67%') throw new Error(`2 of 3 should read 67%, Focus shows ${shown.pct}`);
    await showAll();
    const apply = (await suggested()).find(item => item.headline.startsWith('Apply to'));
    if (!apply || !/1 more/.test(apply.headline) || !/2 of 3 today/.test(apply.meta)) throw new Error(`the Apply row should ask for 1 more and say "2 of 3 today", it says: ${apply?.headline} / ${apply?.meta}`);
    const written = await page.evaluate(async () => (await window.pilot.state()).settings.notionIds?.NOTION_SEARCH_SETTINGS_PAGE || '');
    if (!written && ctx.store !== 'sqlite') throw new Error('changing the target did not save a Search settings page id in the app');
    let line = NaN, last = '';
    for (let i = 0; i < 20 && line !== 3; i++) {   // Notion shows a rewritten page a moment after the write returns (a page of 26+ blocks: up to a minute)
      try { line = await savedTarget(ctx, written); } catch (error) { last = error.message; }
      if (line !== 3) await page.waitForTimeout(3000);
    }
    if (line !== 3 && last) throw new Error(`the target was not saved to Notion within 60 s: ${last}`);
    if (line !== 3 && ctx.store === 'sqlite') throw new Error(`this Mac's config/preferences.json says the daily target is ${line}, expected 3`);
    if (line !== 3) throw new Error(`Notion's "Daily applications target" is ${line}, expected 3 (page ${written}: ${JSON.stringify((await call(NOTION, 'GET', `blocks/${written}/children?page_size=100`)).results.map(block => (block[block.type].rich_text || []).map(part => part.plain_text).join('').slice(0, 30)).filter(Boolean).slice(0, 60))})`);
    await page.reload();
    await page.waitForSelector('.view:not([hidden])', {timeout: 60000});
    await goFocus();
    await focusReady();
    await numbersMatchSource('after a reload');
    if ((await shownNumbers()).of !== '/ 3 applications today') throw new Error('the target did not survive a reload');
  }, {needs: ctx.needs});

  await ctx.run('marking an action Done removes it, writes it to Notion and updates the counts', async () => {
    const before = await upNext();
    await page.locator('#focus-list .focus-item', {has: page.locator('.focus-headline', {hasText: 'Huxley Partners'})}).getByRole('button', {name: 'Done'}).click();
    await page.waitForFunction(() => ![...document.querySelectorAll('#focus-list .focus-headline')].some(node => node.textContent.includes('Huxley')), null, {timeout: 5000});
    const after = await upNext();
    if (after.length !== before.length - 1) throw new Error(`Done should remove exactly one row: ${before.length} before, ${after.length} after`);
    if (!/^1 action\b/.test((await shownNumbers()).actions)) throw new Error(`the Up next header should now count 1 action, it says "${(await shownNumbers()).actions}"`);
    await focusReady();
    if ((await upNext()).some(item => item.headline.includes('Huxley'))) throw new Error('the answered recruiter came back after Focus was read from Notion again');
    const written = await eventsOf('Replied', 'Huxley Partners');
    if (written.length !== 1) throw new Error(`Done should write one "Replied" event to the store, found ${written.length}: ${written.map(item => `${item.at} ${item.source} "${String(item.note || '').slice(0, 50)}" created ${item.created_at}`).join(' | ')}`);
    await numbersMatchSource('after Done');
  }, {needs: ctx.needs});

  await ctx.run('Skip dismisses "Add details" for good: it leaves, Notion records it, a refresh does not bring it back', async () => {
    await showAll();
    await anyRow('Kestrel').getByRole('button', {name: 'Skip'}).click();
    await page.waitForFunction(() => ![...document.querySelectorAll('#focus-suggestions-list .focus-headline')].some(node => node.textContent.includes('Kestrel')), null, {timeout: 5000});
    await focusReady();
    await refresh();
    const left = [...await upNext(), ...await suggested()];
    if (left.some(item => item.headline.includes('Kestrel'))) throw new Error('the skipped employer question came back after a refresh');
    if (left.length !== 5) throw new Error(`5 rows should remain (prepare; the rejection lesson, analyze, apply, add feedback), Focus lists ${left.length}: ${left.map(item => item.headline).join(' | ')}`);
    if ((await eventsOf('Details skipped', 'Kestrel Agency')).length !== 1) throw new Error('Skip should write one "Details skipped" event to the store');
    await numbersMatchSource('after Skip');
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
      for (let i = 0; i < 12 && !(await card().count()); i++) { await refresh(); if (!(await card().count())) await page.waitForTimeout(4000); }   // Notion lists new rows a moment later
      if (!(await card().count())) throw new Error(`no ${action.kind} card for ${action.who} appeared; Focus lists: ${[...await upNext(), ...await suggested()].map(item => item.headline).join(' | ')}`);
      await page.evaluate(({key, source}) => { localStorage.setItem('__e2eWatch', JSON.stringify([{key, source}])); sessionStorage.removeItem(`__e2eSeen_${key}`); }, {key: action.who, source: action.card || action.who});
      if (action.how.confirm) page.once('dialog', dialog => dialog.accept());
      if (how === 'button') await card().getByRole('button', {name: label, exact: true}).click();
      else { await card().getByRole('button', {name: 'More'}).click(); await page.getByRole('menuitem', {name: label}).click(); }
      await card().waitFor({state: 'detached', timeout: 5000}).catch(() => { throw new Error(`the ${action.kind} card for ${action.who} is still listed 5 seconds after ${label}`); });
      await page.evaluate(name => sessionStorage.removeItem(`__e2eSeen_${name}`), action.who);   // watch from here: it must not return
      await page.waitForTimeout(800);
      await focusReady();
      await refresh();
      if ((await card().count()) || await seenOf(action.who)) throw new Error(`the ${action.kind} card for ${action.who} came back after a refresh`);
      for (const [when, wait] of [['straight away', 0], ['once Notion has had time', 6000]]) {
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
    // covers that for a person). Read again for up to 90 s; a card still back then is reported with whether its dismissal is in Notion at all.
    const backNow = async () => [...await upNext(), ...await suggested()].filter(item => actions.actions.some(action => new RegExp(action.card || action.who).test(item.headline)));
    let back = [];
    for (const started = Date.now(); Date.now() - started < 90000;) { await refresh(); back = await backNow(); if (!back.length) break; await page.waitForTimeout(10000); }
    if (back.length) {
      const recorded = await Promise.all(back.map(async item => { const action = actions.actions.find(one => new RegExp(one.card || one.who).test(item.headline));
        if (action?.kind !== 'details') return item.headline;   // only a Skip of "Add details" leaves an event this step can look up
        return `${item.headline}: ${(await eventsOf('Details skipped', action.who).catch(() => [])).length ? 'its dismissal IS in Notion (the read lags)' : 'no dismissal event found in Notion'}`; }));
      throw new Error(`dismissed cards are still listed 90 s after the in-app hold ended: ${recorded.join(' | ')}`);
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
    let stage = null;
    for (let i = 0; i < 10 && stage !== 'Closed'; i++) { stage = await stageInNotion(); if (stage !== 'Closed') await page.waitForTimeout(3000); }
    if (stage !== 'Closed') throw new Error(`the store's stage for the dismissed job should be Closed, it is "${stage}"`);
    await page.reload();
    await page.waitForSelector('.view:not([hidden])', {timeout: 60000});
    await page.click('.nav[data-view="jobs"]');
    await page.click('.stat[data-stat="interviews"]');
    await page.waitForTimeout(3000);
    if (await ember().count()) throw new Error(`after a reload the dismissed job is back in the In process list: "${(await ember().innerText()).replace(/\s+/g, ' ')}" (the store says ${await stageInNotion()})`);
    await goFocus();   // the next step starts on Focus
  }, {needs: ctx.needs});

  // People edit Notion by hand (5 Oct 2026: the README listed the Notion starting state as "not varied yet"): a stage the app does not know, an empty title,
  // a 2,000-character note, other scripts and emoji. The app must still draw Focus with no error text and no window error, and its numbers must still be Notion's.
  await ctx.run('rows edited by hand in Notion (an unknown stage, an empty title, a very long note, other scripts) leave Focus working and its numbers right', async () => {
    const errorsBefore = journey.pageErrors.length + journey.consoleErrors.length;
    for (const fields of HAND_EDITS) await addApplication(ctx, fields);
    await goFocus();
    await refresh();
    const shownErrors = (await page.evaluate(inspect, {view: 'focus', limits: LIMITS})).filter(item => item.kind === 'error-shown');
    if (shownErrors.length) throw new Error(`Focus shows technical text after the hand edits: ${shownErrors.map(item => item.detail).join(' | ').slice(0, 300)}`);
    const errors = [...journey.pageErrors, ...journey.consoleErrors].slice(errorsBefore);
    if (errors.length) throw new Error(`the window threw after the hand edits: ${errors.join(' | ').slice(0, 300)}`);
    await numbersMatchSource('after hand edits in Notion');
  }, {needs: ctx.needs});

  await ctx.run('a fresh account gets a helpful Focus: nothing urgent, one suggested next step, zeros, a funnel that says it fills in later, no insight, no raw errors', async () => {
    await resetFocusData(ctx);   // every row to the trash: a new user's workspace
    target = 5;
    await page.evaluate(() => window.pilot.setDailyTarget(5));   // the app's own cache of the target, as a new install has it
    // Notion still lists a trashed row for up to a few minutes: refresh until Focus has caught up, and say how long that took (it must catch up).
    let tries = 0;
    for (; tries < 24; tries++) {   // trashed rows leave the engine's results one by one, over a minute or more on a CI runner
      await refresh();
      const [first, ...rest] = [...await upNext(), ...await suggested()];   // caught up: the one next step says there are no kits yet (a trashed kit row is listed for a while)
      if (first && !rest.length && /Prepare kits from your best matches/.test(first.meta) && (await shownNumbers()).funnel.every(step => step.count === '0')) break;
      await page.waitForTimeout(5000);
    }
    if (tries) console.log(`  Focus caught up with the emptied workspace after ${tries} refresh(es)`);
    if ((await upNext()).length) throw new Error(`a fresh account has nothing that can't wait, Up next lists: ${(await upNext()).map(item => item.headline).join(' | ')}`);
    const items = await suggested();
    if (items.length !== 1 || !items[0].headline.startsWith('Apply to your next role')) throw new Error(`a fresh account should see exactly one suggested next step ("Apply to your next role"), it sees: ${items.map(item => item.headline).join(' | ') || 'nothing'}`);
    if (!/Prepare kits from your best matches/.test(items[0].meta) || !items[0].buttons.includes('Browse jobs')) throw new Error(`the first step does not say what to do: "${items[0].meta}" ${items[0].buttons}`);
    const page$ = await page.evaluate(() => ({text: document.querySelector('.view[data-view="focus"]').innerText, funnel: !document.querySelector('#focus-funnel').hidden,
      inbound: !document.querySelector('#focus-inbound').hidden, funnelEmpty: document.querySelector('#focus-funnel').classList.contains('is-empty'),
      funnelHint: document.querySelector('#funnel-empty').hidden ? '' : document.querySelector('#funnel-empty').textContent.trim(), insight: [...document.querySelectorAll('#focus-suggestions-list [data-suggestion]')].some(li => !['letter', 'details', 'learned', 'questions-error'].includes(li.dataset.suggestion)),
      skeleton: !!document.querySelector('.view[data-view="focus"] .skeleton'), empty: !document.querySelector('#focus-empty').hidden, summary: document.querySelector('#focus-summary').textContent.trim()}));
    if (page$.skeleton) throw new Error('a skeleton is still showing on a fresh account');
    if (page$.inbound) throw new Error('an Inbound funnel is drawn although nothing found this account');
    if (!page$.funnel || !page$.funnelEmpty || page$.funnelHint !== 'Fills in as you prepare and send applications.') {
      throw new Error(`a fresh account's funnel should be greyed with the line "Fills in as you prepare and send applications."; it shows card=${page$.funnel}, greyed=${page$.funnelEmpty}, hint="${page$.funnelHint}"`);
    }
    if (page$.insight) throw new Error('Suggestions show an insight with nothing to say');
    if (!page$.empty) throw new Error('Up next is empty but does not say "Nothing waits for you right now"');
    if (ERROR_WORDS.test(page$.text)) throw new Error(`error-like text on a fresh Focus: ${page$.text.match(ERROR_WORDS)[0]}`);
    if (!page$.summary) throw new Error('the focus summary is empty on a fresh account');
    await numbersMatchSource('fresh account');
    await snap(ctx, 'focus-fresh', {view: 'focus', situation: 'a new account with no applications'});
  }, {needs: ctx.needs});

  await ctx.run('Focus renders without layout problems, with data and without', async () => { finish(ctx); }, {needs: ctx.needs});
}
