// Job: keep the scorecard
/* global document */
// What the person SEES along a journey, sampled while a row runs (journey tests): the card (the app's own words for the session, desktop/renderer/session-state.js
// cardWords on the app's session + the panel's counts and page step) and the panel (the extension's pill, count, note and its footer's Report button, read in the
// application tab's shadow root). One step each time either changes: [{at, card: {words, tone, page, total, left}, panel: {...}}]. Read-only: nothing is pressed.
// Used by replay-net.mjs --journey (live-row.mjs `watch`), judged by lib/journey-check.mjs. Guard: e2e/test/journey-watch.test.mjs.
import {cardWords} from '../../renderer/session-state.js';

// On the tab: the panel as drawn (all text trimmed; a panel not on the page is {present: false}).
const panelInPage = () => {
  const root = document.getElementById('jobadabra-review-host')?.shadowRoot;
  if (!root) return {present: false};
  const text = selector => (root.querySelector(selector)?.textContent || '').replace(/\s+/g, ' ').trim();
  const shown = selector => { const node = root.querySelector(selector); return !!node && !node.hidden; };
  return {present: true, open: shown('.card'), pill: text('.pill b'), sub: text('.pill small'), ring: text('.ring span'), headline: text('.progress-line b'), count: text('.progress-line span'),
    claude: shown('.claude') ? text('.claude span') : '', notes: [...root.querySelectorAll('.note')].filter(node => !node.hidden).map(node => node.textContent.replace(/\s+/g, ' ').trim()),
    button: text('.fill .label'), report: !!root.querySelector('.foot .report-btn') && !root.querySelector('.foot')?.hidden};
};

// item: the app's session; state: its review state (the panel's report or the worker's page step); panel: panelInPage's reading. -> one step
export function stepOf(item, state, panel) {
  const [words, tone] = item ? cardWords(item, state) : ['(no session)', 'neutral'];
  return {card: {words, tone, page: state?.page || '', total: state?.total ?? 0, left: state?.left ?? 0, ready: !!state?.ready, stuck: item?.stuck || '', status: item?.status || ''}, panel: panel || {present: false}};
}
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

// Starts sampling: app (lib/offline-app.mjs), context (the browser). -> {stop() -> steps}
export function watchJourney({app, context, intervalMs = 400, now = Date.now}) {
  const steps = [], started = now();
  let live = true;
  const tabOf = () => context.pages().filter(page => /^https?:/.test(page.url())).at(-1);
  const sample = async () => {
    const [sessions, states] = await Promise.all([app.call('sessions').catch(() => []), app.call('reviewStates').catch(() => [])]);
    const item = (sessions || []).filter(one => one.kind === 'form').at(-1) || (sessions || []).at(-1);
    const panel = await tabOf()?.evaluate(panelInPage).catch(() => null);
    const step = stepOf(item, (states || []).find(one => one.id === item?.id), panel);
    if (!steps.length || !same(steps.at(-1).card, step.card) || !same(steps.at(-1).panel, step.panel)) steps.push({at: Math.round((now() - started) / 100) / 10, ...step});
  };
  const loop = (async () => { while (live) { await sample().catch(() => {}); await new Promise(resolve => setTimeout(resolve, intervalMs)); } })();
  return {async stop() { live = false; await loop; await sample().catch(() => {}); return steps; }};
}
