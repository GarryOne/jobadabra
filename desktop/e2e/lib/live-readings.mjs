/* global document, getComputedStyle */
// The false readings at a live row's end (the canary on flow PRs, owner 12 Oct 2026; the replays' own: lib/replay-truth.mjs). A live row has no kept AI answers and no
// request list, so it reads the page: TRUTH for the applicant's contact boxes, known by the HTML autocomplete token or an email type (a standard, never a label word);
// AGREEMENT between the panel's count and the page's own empty required controls; no "ready" with one left. A line never carries a value (a live box can hold the site's
// words). Used by lib/live-row.mjs (prints the line), lib/record-sites.mjs parseLive (reads it) and lib/pool-ci.mjs (red). Guard: e2e/test/live-readings.test.mjs.
import {readTab, sameAnswer} from './replay-truth.mjs';

const TOKENS = {'given-name': 'first_name', 'family-name': 'last_name', name: 'full_name', email: 'email', tel: 'phone', 'tel-national': 'phone', 'postal-code': 'postal_code', 'address-line1': 'street', 'street-address': 'street'};
// box: {autocomplete, type} -> the applicant's contact key, or ''. The token is the attribute's last word ("section-a billing family-name").
export function contactKeyOf(box) {
  const token = String(box?.autocomplete || '').trim().toLowerCase().split(/\s+/).at(-1);
  return TOKENS[token] || (String(box?.type || '').toLowerCase() === 'email' ? 'email' : '');
}

const named = list => list.slice(0, 6).join(', ') || 'none';
// boxes: [{autocomplete, type, value}]; contact: the applicant's; panel: {present, ready, left: number | null}; required: [{name, empty}] (the page's own). -> [failure]
export function liveFailures({boxes = [], contact = {}, panel = {}, required = []}) {
  const failures = [];
  for (const box of boxes) {
    const key = contactKeyOf(box), want = contact[key];
    if (!key || !want || !String(box.value || '').trim()) continue;
    if (!sameAnswer(want, [box.value])) failures.push(`truth: the ${String(box.autocomplete || '').trim().split(/\s+/).at(-1) || box.type} box holds another value than the applicant's ${key}`);
  }
  const pageLeft = required.filter(one => one.empty).map(one => String(one.name));
  if (panel.present && Number.isInteger(panel.left) && pageLeft.length > panel.left) failures.push(`agreement: the page has ${pageLeft.length} required control${pageLeft.length === 1 ? '' : 's'} empty (${named(pageLeft)}), the panel counts ${panel.left}`);
  if (panel.present && panel.ready && pageLeft.length) failures.push(`ready: the panel says ready with ${pageLeft.length} required left (${named(pageLeft)})`);
  return failures;
}

export const readingsLine = readings => `live: readings: ${JSON.stringify(readings)}`;
export function parseReadings(output) {
  const hit = String(output || '').split('\n').reverse().find(line => line.startsWith('live: readings: '));
  try { return hit ? JSON.parse(hit.slice('live: readings: '.length)) : null; } catch { return null; }
}

// On the tab: the contact boxes (every frame) and the panel's count (its ring: a number, ✓ for none left, – for none counted).
const boxesInPage = () => [...document.querySelectorAll('input[autocomplete], input[type=email]')].filter(el => el.getClientRects().length && getComputedStyle(el).visibility !== 'hidden')
  .map(el => ({autocomplete: el.getAttribute('autocomplete') || '', type: el.type, value: el.value || ''}));
const ringInPage = () => (document.getElementById('jobpilotto-review-host')?.shadowRoot?.querySelector('.ring span')?.textContent || '').trim();

// The whole reading of a live row's last application tab. -> {failures, boxes} (boxes: how many contact boxes were read: 0 says truth had nothing to judge)
export async function readLive(page, contact) {
  const boxes = [];
  for (const frame of page.frames()) boxes.push(...await frame.evaluate(boxesInPage).catch(() => []));
  const tab = await readTab(page, []);
  const ring = await page.evaluate(ringInPage).catch(() => '');
  const left = ring === '✓' ? 0 : /^\d+$/.test(ring) ? Number(ring) : null;
  return {failures: liveFailures({boxes, contact, panel: {...tab.panel, left}, required: tab.required}), boxes: boxes.filter(box => contactKeyOf(box)).length};
}
