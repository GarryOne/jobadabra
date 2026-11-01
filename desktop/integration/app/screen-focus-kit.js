/* global document, window */
// Layer 2, Focus: what runs inside the window (window-probe.js `use`) to open Focus and read it as a person does, and the Node side's shared pieces.
// Moved from the e2e `focus` suite's helpers (desktop/e2e/suites/focus.mjs, 1 Nov 2026), unchanged in what they read.
import {scenario} from '../../e2e/lib/focus-data.mjs';
import {newStore, seed} from './screen-store.js';

/** In the window: open Focus and wait for it to finish refreshing; read its rows, numbers and buttons. Serialised: no closure over this file. */
export const focusKit = base => {
  const $ = selector => document.querySelector(selector);
  const ready = () => /^Updated/.test($('#focus-status')?.textContent || '') && !$('#focus-refresh').disabled && !$('.view[data-view="focus"] .skeleton, .view[data-view="focus"] .spinner');
  const rowsIn = list => [...document.querySelectorAll(`${list} .focus-item`)].map(li => ({
    headline: li.querySelector('.focus-headline')?.textContent.trim() || '', badge: li.querySelector('.ui-pill')?.textContent.trim() || '',
    meta: li.querySelector('.focus-meta')?.textContent.trim() || '', kind: li.dataset.suggestion || '',
    buttons: [...li.querySelectorAll('.focus-actions > button:not(.ui-more)')].map(button => button.textContent.trim()), hasMore: !!li.querySelector('.focus-actions .ui-more')}));
  // The window's own rows (cover letter, Fill your details, What we learned, the LinkedIn offer) lead Suggestions and are not the engine's (renderer/question-entries.js).
  const DRAWERS = ['linkedin', 'letter', 'details', 'learned', 'questions-error', 'skills'];   // 'skills': the Experience bank row (focus-suggestions.js experienceGet), the demo candidate has one
  const numbers = () => {
    const steps = list => [...document.querySelectorAll(`${list} .funnel-step`)].map(li => ({name: li.querySelector('.funnel-name')?.textContent.trim(),
      count: li.querySelector('.funnel-count')?.textContent.trim(), share: li.querySelector('.muted.small')?.textContent.trim()}));
    return {count: $('#focus-count').textContent.trim(), of: $('#focus-of').textContent.trim(), pct: $('#focus-pct').textContent.trim(), bar: $('#focus-bar').style.width,
      chartSum: $('#focus-chart-sum').textContent.trim(), funnel: steps('#funnel-steps'), inbound: $('#focus-inbound').hidden ? [] : steps('#inbound-steps'), actions: $('#focus-count-note').textContent.trim()};
  };
  return {
    focusReady: ready, rowsIn, numbers, DRAWERS,
    open: async () => { await base.go('focus'); await base.until(ready, 'Focus to finish loading'); },
    refresh: async () => {
      const redrawn = new Promise(resolve => window.addEventListener('focus-updated', resolve, {once: true}));
      $('#focus-refresh').click();
      await redrawn;
      await base.until(ready, 'Focus to finish refreshing');
    },
    upNext: () => rowsIn('#focus-list'),
    suggested: () => rowsIn('#focus-suggestions-list').filter(row => !DRAWERS.includes(row.kind)),
    drawers: () => rowsIn('#focus-suggestions-list').filter(row => DRAWERS.includes(row.kind)),
    all: () => [...rowsIn('#focus-list'), ...rowsIn('#focus-suggestions-list')],
    showAll: () => { const all = $('#focus-suggestions-all'); if (all && all.offsetParent !== null && /^Show all/.test(all.textContent)) all.click(); },
    row: headline => [...document.querySelectorAll('#focus-list .focus-item, #focus-suggestions-list .focus-item')].find(li => li.querySelector('.focus-headline')?.textContent.includes(headline)),
    press: (li, name) => { const button = [...li.querySelectorAll('.focus-actions > button')].find(one => one.textContent.trim() === name); if (!button) throw new Error(`no "${name}" button on "${li.querySelector('.focus-headline').textContent}"`); button.click(); },
  };
};

/** The store of the Focus suite's dummy search (e2e/lib/focus-data.mjs scenario), seeded. -> {store, made, data}. */
export function focusStore(now = new Date()) {
  const store = newStore(), data = scenario(now);
  return {store, data, made: seed(store, data)};
}

/** What the engine hands Focus for this store now (`python -m src.focus`, no AI). */
export const enginePayload = store => store.engine('src.focus');
