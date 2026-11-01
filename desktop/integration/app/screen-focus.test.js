/* global document, window, KeyboardEvent */
// Focus, layer 2 (1 Nov 2026, owner: "I'd like the beta to have only the critical e2e/user journeys"): moved from the e2e `focus` suite. A real SQLite store in a temp folder
// is seeded with the suite's dummy search; the engine (`python -m src.focus`) hands Focus its payload exactly as the app does; the app's own window, in demo mode with that
// payload, is read as a person reads it. Writes (Done, Skip, the daily target) go through the engine's own commands, and the next payload shows their effect.
// No browser, no Notion, no AI, no real clock for the page: the dummy search is dated from one injected `now`.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {after, before, test} from 'node:test';
import {EXPECTED_SUGGESTIONS, EXPECTED_UP_NEXT, compareNumbers, expectedNumbers} from '../../e2e/lib/focus-data.mjs';
import {setDailyTarget} from '../../lib/strategy-settings.js';
import {focusKit, focusStore, enginePayload} from './screen-focus-kit.js';
import {needsElectron} from '../../test/needs-electron.js';
import {probeWindow} from './window-probe.js';

const ERROR_WORDS = /\b(undefined|null|NaN|\[object|TypeError|Traceback|ENOENT|ECONN|could not load|stack)\b/i;
const NOW = new Date();   // one moment for the dummy search and its oracle; the engine reads the real clock for "today", the same day
const SETTINGS = {store: 'sqlite'};
let search, payload, first, after3, rows, events;

const page = {use: [focusKit], settings: SETTINGS};
const ids = (payloadOf, kind, who) => payloadOf.items.find(item => item.kind === kind && JSON.stringify(item).includes(who))?.page_id;

before(() => {
  search = focusStore(NOW);
  payload = enginePayload(search.store);
  rows = search.store.call('applications', 'list', {});
  events = search.store.call('events', 'list', {});
  if (!needsElectron.skip) {
    first = probeWindow({...page, files: {'focus.json': payload}, script: async kit => {
      const out = {errors: []};
      window.addEventListener('error', event => out.errors.push(event.message));
      await kit.until(() => document.querySelector('.nav[data-view=focus]:not([hidden])'), 'the menu');
      await kit.open();
      out.text = document.querySelector('.view[data-view="focus"]').innerText;
      out.upNext = kit.upNext();
      // The drawers' rows draw when the open questions are read, a little after Focus; Suggestions' head says 3 of N, then one press lists every row.
      out.folded = document.querySelector('#focus-suggestions-count').textContent.trim();
      kit.showAll();
      out.suggested = kit.suggested(); out.drawers = kit.drawers(); out.kinds = kit.rowsIn('#focus-suggestions-list').map(row => row.kind);
      out.note = document.querySelector('#focus-count-note').textContent.trim();
      out.summary = document.querySelector('#focus-summary').textContent.trim();
      out.numbers = kit.numbers();
      out.hint = {greyed: document.querySelector('#focus-funnel').classList.contains('is-empty'), shown: !document.querySelector('#funnel-empty').hidden};
      out.chartDays = document.querySelectorAll('#focus-chart .focus-chart-col').length;
      out.layout = kit.severe('focus');
      // The rejection lesson, and its button.
      const lesson = '#focus-suggestions-list .focus-item[data-suggestion="rejection"]';
      out.lesson = {first: kit.suggested()[0]?.kind, text: document.querySelector(lesson)?.innerText || '', button: document.querySelector(`${lesson} .focus-actions > button`)?.textContent.trim()};
      document.querySelector(`${lesson} .focus-actions > button`).click();
      await kit.until(() => document.querySelector('#job-panel:not([hidden]) .tabs [data-job-tab="review"].is-active'), 'the Review tab of the job panel');
      out.panel = document.querySelector('#job-panel').textContent;
      document.dispatchEvent(new KeyboardEvent('keydown', {key: 'Escape', bubbles: true}));
      await kit.go('focus'); await kit.until(() => !document.querySelector('#job-drawer-layer')?.checkVisibility?.(), 'the job drawer to close');
      // Rows open the right place: the mail, the feedback box, Jobs.
      kit.press(kit.row('Huxley Partners'), 'Open email');
      kit.press(kit.row('Fjord Networks'), 'Add feedback');
      await kit.until(() => document.querySelector('#feedback-dialog[open]'), 'the feedback box');
      out.feedback = document.querySelector('#feedback-context').textContent;
      document.querySelector('#feedback-dialog').close();
      kit.press(kit.row('Apply to'), 'Browse jobs');
      await kit.until(() => document.querySelector('.view[data-view="jobs"]:not([hidden])'), 'Jobs');
      await kit.open();
      // Edit target: typing, a redraw while typing, then the save (the demo takes the typed value as the saved one).
      document.querySelector('#focus-edit-target').click();
      const box = document.querySelector('#focus-target');
      box.value = '3'; box.dispatchEvent(new Event('input', {bubbles: true}));
      await kit.refresh();
      out.typed = box.value;
      box.dispatchEvent(new Event('change', {bubbles: true}));
      await kit.until(() => document.querySelector('#focus-target-row').hidden, 'the saved target to close its box');
      out.savedBox = box.value;
      // Done on the recruiter, Skip on the unknown employer.
      kit.showAll();
      const beforeDone = kit.upNext().length;
      kit.press(kit.row('Huxley Partners'), 'Done');
      await kit.until(() => !kit.row('Huxley'), 'the answered recruiter to leave');
      out.done = {before: beforeDone, after: kit.upNext().length, note: document.querySelector('#focus-count-note').textContent.trim()};
      await kit.refresh();
      out.doneRefreshed = kit.all().some(item => item.headline.includes('Huxley'));
      kit.showAll();
      kit.press(kit.row('Kestrel'), 'Skip');
      await kit.until(() => !kit.row('Kestrel'), 'the skipped employer to leave');
      await kit.refresh();
      out.left = [...kit.upNext(), ...kit.suggested()].map(item => item.headline);
      return out;
    }});
  }
});
after(() => search?.store.remove());

const live = {skip: needsElectron.skip};

test('a search with applications in every stage is in the store (dummy employers, target 5)', () => {
  assert.equal(rows.length, 10);
  assert.equal(events.length, 14);
  assert.equal(payload.today.target, 5, 'the engine reads the first-run target');
});

test('Focus finishes loading with no error text', live, () => {
  assert.equal(first.result.text.match(ERROR_WORDS)?.[0], undefined, 'error-like text on Focus');
  assert.deepEqual(first.result.errors, [], 'the window threw');
});

test('"Up next" lists what can\'t wait and Suggestions the rest, in the right order, each with the right buttons', live, () => {
  const check = (where, items, expected) => {
    const lines = items.map(item => `${item.headline} [${item.badge}] (${item.buttons.join(', ') || 'no button'})`);
    assert.equal(items.length, expected.length, `expected ${expected.length} rows in ${where}, Focus lists:\n    ${lines.join('\n    ')}`);
    expected.forEach((want, i) => {
      const got = items[i];
      assert.ok(got.headline.includes(want.who), `${where} row ${i + 1} should be about "${want.who}", it is "${got.headline}". Order: ${lines.join(' | ')}`);
      assert.ok(want.badge instanceof RegExp ? want.badge.test(got.badge) : got.badge === want.badge, `${where} row ${i + 1} (${want.who}) has the badge "${got.badge}", expected ${want.badge}`);
      assert.deepEqual(got.buttons, want.buttons, `${where} row ${i + 1} (${want.who}) buttons`);
    });
  };
  check('Up next', first.result.upNext, EXPECTED_UP_NEXT);
  check('Suggestions', first.result.suggested, EXPECTED_SUGGESTIONS);
  // The window's own rows lead Suggestions in the owner's order: LinkedIn offer, cover letter (High priority, one button), Fill your details, What we learned.
  const order = ['linkedin', 'letter', 'details', 'learned', 'questions-error', 'skills'];
  const lead = first.result.drawers;
  assert.deepEqual(first.result.kinds.slice(0, lead.length), lead.map(row => row.kind), `the drawers' rows should lead Suggestions: ${first.result.kinds.join(', ')}`);
  assert.deepEqual(lead.map(row => order.indexOf(row.kind)), lead.map(row => order.indexOf(row.kind)).sort((a, b) => a - b), 'the drawers\' rows are out of order');
  for (const row of lead) {
    if (['linkedin', 'details', 'learned'].includes(row.kind)) assert.equal(row.buttons.length, 1, `"${row.headline}" should carry one button`);
    if (row.kind === 'letter') assert.ok(row.badge === 'High priority' && row.buttons.length === 1, 'the cover letter row is "High priority" with one button');
  }
  assert.match(first.result.folded, /^3 of \d+$/, 'Suggestions shows 3 first');
  assert.ok(![...first.result.upNext, ...first.result.suggested].some(item => /waiting/.test(item.headline)), '"1 application waiting" has no button: it should have left Focus');
  assert.equal(first.result.note, '2 actions');
  assert.equal(first.result.summary, 'Reply to recruiters first, then prepare for your interview.');
});

test('every number on Focus matches the store (today, target, 14-day chart, funnel, inbound funnel)', live, () => {
  const shown = first.result.numbers;
  assert.deepEqual(compareNumbers(shown, expectedNumbers(rows, events, {now: NOW, target: 5})), []);
  // The oracle is itself checked against hand-counted numbers, so a wrong oracle cannot pass a wrong page.
  assert.deepEqual([shown.count, shown.funnel.map(step => step.count).join(), shown.inbound.map(step => step.count).join()], ['2', '8,6,2,2,0', '2,1,1,0']);
  assert.deepEqual(first.result.hint, {greyed: false, shown: false}, 'the "fills in later" hint shows although the funnel has data');
  assert.equal(first.result.chartDays, 14);
});

test('Suggestions lead with the latest rejection lesson, with a button to review it', live, () => {
  const {lesson, panel} = first.result;
  assert.equal(lesson.first, 'rejection', 'the rejection lesson is the first of Suggestions\' own rows');
  assert.match(lesson.text, /Seniority mismatch/);
  assert.match(lesson.text, /Hard skills/i);
  assert.match(lesson.text, /Gale Robotics/);
  assert.equal(ERROR_WORDS.test(lesson.text), false);
  assert.equal(lesson.button, 'Review rejection');
  assert.match(panel, /Gale Robotics/, 'the Review tab opens on the rejected job');
});

test('clicking an Up next or Suggestions row opens the right place: the mail, Jobs, the feedback box', live, () => {
  const {host} = first;
  const mail = host.filter(call => call.api === 'shell.openExternal' && /mail\.google\.com.*e2e-lead-1/.test(call.args[0]));
  assert.equal(mail.length, 1, `"Open email" should open the lead's own message once: ${host.map(call => call.args[0]).join(', ') || 'nothing'}`);
  assert.match(first.result.feedback, /Fjord Networks/);
  assert.match(first.result.feedback, /Cloud Engineer/);
});

test('"Edit target" keeps what is typed through a redraw and saves it; the saved target changes the progress ratio and survives a restart', live, () => {
  assert.equal(first.result.typed, '3', 'Focus drawn again while the target was typed put another value back');
  assert.equal(first.result.savedBox, '3');
  // The engine keeps the target in config/preferences.json (lib/strategy-settings.js setDailyTarget); the next payload is built from it, as after a restart.
  const storage = {settings: () => SETTINGS, secret: () => '', path: name => path.join(search.store.profile, name), readText: name => fs.readFileSync(path.join(search.store.profile, name), 'utf8'), writeText: (name, text) => fs.writeFileSync(path.join(search.store.profile, name), text)};
  return setDailyTarget(storage, 3, {run: async () => ({code: 0}), ensurePage: async () => null, writePage: async () => null}).then(() => {
    after3 = enginePayload(search.store);
    assert.equal(after3.today.target, 3);
    const second = probeWindow({...page, files: {'focus.json': after3}, script: async kit => {
      await kit.until(() => document.querySelector('.nav[data-view=focus]:not([hidden])'), 'the menu');
      await kit.open(); kit.showAll();
      return {numbers: kit.numbers(), apply: kit.suggested().find(item => item.headline.startsWith('Apply to'))};
    }});
    assert.deepEqual(compareNumbers(second.result.numbers, expectedNumbers(rows, events, {now: NOW, target: 3})), []);
    assert.equal(second.result.numbers.pct, '67%', '2 of 3 reads 67%');
    assert.match(second.result.apply.headline, /1 more/);
    assert.match(second.result.apply.meta, /2 of 3 today/);
  });
});

test('marking an action Done removes it, writes it to the store and updates the counts', live, () => {
  const {done, doneRefreshed} = first.result;
  assert.equal(done.after, done.before - 1, 'Done removes exactly one row');
  assert.match(done.note, /^1 action\b/);
  assert.equal(doneRefreshed, false, 'the answered recruiter came back after Focus was read again');
  // The button asks the engine for `src.focus done <page id> replied` (lib/pipeline-commands.js focusDone); one Replied event, and the next payload no longer lists the lead.
  const pageId = ids(payload, 'reply', 'Huxley');
  assert.ok(pageId, 'the lead has a page id in the payload');
  search.store.engine('src.focus', 'done', pageId, 'replied');
  const written = search.store.call('events', 'list', {app_id: pageId, kind: 'Replied'});
  assert.equal(written.length, 1, 'Done should write one "Replied" event');
  const next = enginePayload(search.store);
  assert.ok(!JSON.stringify(next.items).includes('Huxley'), 'the answered recruiter is still listed by the engine');
  assert.deepEqual(compareNumbers(first.result.numbers, expectedNumbers(search.store.call('applications', 'list', {}), search.store.call('events', 'list', {}), {now: NOW, target: 5})).filter(line => !/Replied/.test(line)), []);
});

test('Skip dismisses "Add details" for good: it leaves, the store records it, a refresh does not bring it back', live, () => {
  assert.equal(first.result.left.some(headline => headline.includes('Kestrel')), false, 'the skipped employer question came back after a refresh');
  assert.equal(first.result.left.length, 5, `5 rows should remain (prepare; the rejection lesson, analyze, apply, add feedback): ${first.result.left.join(' | ')}`);
  const pageId = ids(payload, 'details', 'Kestrel');
  search.store.engine('src.focus', 'done', pageId, 'details_skipped');
  assert.equal(search.store.call('events', 'list', {app_id: pageId, kind: 'Details skipped'}).length, 1, 'Skip should write one "Details skipped" event');
  assert.ok(!JSON.stringify(enginePayload(search.store).items).includes('Kestrel'), 'the engine lists the skipped question again');
});

test('Focus renders without layout problems, with data', live, () => {
  assert.deepEqual(first.result.layout, []);
});
