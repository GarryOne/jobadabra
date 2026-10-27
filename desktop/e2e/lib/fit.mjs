/* global document, Event */
// Does the app speak to THIS candidate? A bug type, not one bug: tips, advice, examples, placeholders, insights and hints written for another kind of candidate (another profession or
// industry, country, seniority, language) read as an app made for someone else, while nothing in the layout is wrong (5 Oct 2026: a nurse and a photographer were shown IT examples).
// The Finder holds no list of professions or words. It collects what the app shows and judges it against who the candidate is, with a model; the checks around the model are plain code:
// its quotes must really be on the page (a quote it made up is dropped), and an unreadable reply is never a pass. Pure functions here; `judge` makes the one call.
import {modelFetch} from './model.mjs';
import {goView} from './go-view.mjs';
export const MODEL = process.env.E2E_JUDGE_MODEL || 'claude-haiku-5-5';   // Haiku in every suite (owner, 27 Oct 2026: the quality judge too; was Sonnet there since 7 Oct)
const MAX_PAGE_CHARS = 6000;

export const SYSTEM = `You review a job-search app for ONE candidate. You get the candidate (profession, roles, places, languages) and the text the app showed on its screens.
Find lines THE APP WROTE (tips, advice, examples, placeholders, labels, hints, empty-state text, insight and recommendation text) that assume a DIFFERENT kind of candidate:
another profession or industry, another country or labour-market convention, another seniority, another language.
Ignore the candidate's own data and everything the search brought in: their jobs and employers, names, the postings found, run logs, counts and dates.
Only report a line that clearly does not fit this candidate. Do not report advice that works for most people, a convention found in several countries (work permits, notice periods, application questions), or an example that is not about the candidate's field but is neutral.
Quote each line exactly as shown (at most 160 characters). Reply with ONE JSON object and nothing else:
{"issues":[{"quote":"<verbatim>","assumes":"<who it is written for, a few words>","why":"<one short sentence>"}]}. If nothing, {"issues":[]}.`;

export function buildRequest({candidate, pages, model = MODEL}) {
  const shown = pages.map(page => `=== ${page.view} ===\n${String(page.text).slice(0, MAX_PAGE_CHARS)}`).join('\n\n');
  return {model, max_tokens: 2000, system: SYSTEM, messages: [{role: 'user', content: `The candidate: ${candidate}\n\nWhat the app showed:\n\n${shown}`}]};   // no temperature: sonnet-5-5 rejects it
}

const squash = text => String(text).replace(/\s+/g, ' ').trim().toLowerCase();

// -> {issues: [{quote, assumes, why, view}], unverified, unreadable}. A quote that is not on the page it is said to be on is dropped and counted: the model's word is not enough.
export function parseIssues(reply, pages) {
  let data;
  try { data = JSON.parse(String(reply).slice(String(reply).indexOf('{'), String(reply).lastIndexOf('}') + 1)); } catch { return {issues: [], unverified: 0, unreadable: true}; }
  if (!Array.isArray(data?.issues)) return {issues: [], unverified: 0, unreadable: true};
  const texts = pages.map(page => ({view: page.view, text: squash(page.text)}));
  const issues = [];
  let unverified = 0;
  for (const item of data.issues) {
    if (!item || typeof item.quote !== 'string' || !item.quote.trim()) continue;
    const quote = squash(item.quote).slice(0, 160);
    const page = texts.find(entry => entry.text.includes(quote));
    if (!page) { unverified++; continue; }
    issues.push({quote: item.quote.trim().slice(0, 160), assumes: String(item.assumes || '').trim().slice(0, 80), why: String(item.why || '').trim().slice(0, 200), view: page.view});
  }
  return {issues, unverified, unreadable: false};
}

export const toFindings = issues => issues.map(item => ({view: item.view, severity: 'warning', kind: 'audience-mismatch',
  detail: `shows text written for ${item.assumes || 'another kind of candidate'}: "${item.quote}" (${item.why})`}));

export async function judge({key, candidate, pages, fetchImpl = modelFetch}) {
  const response = await fetchImpl('https://api.anthropic.com/v1/messages', {method: 'POST',
    headers: {'x-api-key': key, 'anthropic-version': '2023-06-01', 'content-type': 'application/json'}, body: JSON.stringify(buildRequest({candidate, pages}))});
  const data = await response.json();
  if (!response.ok) throw new Error(`the fit judge request was rejected (${response.status}): ${data.error?.message || 'no reason given'}`);
  return parseIssues((data.content || []).map(part => part.text || '').join(''), pages);
}

// ---- what the app showed (in the browser) ----

// The visible text of one page, with the examples inside input fields (placeholders): what a person reads on it.
export async function pageText(page, view) {
  return page.evaluate(name => {
    const root = document.querySelector(`.view[data-view="${name}"]`);
    if (!root) return '';
    const holders = [...root.querySelectorAll('input[placeholder], textarea[placeholder]')].filter(el => el.offsetParent).map(el => `[placeholder] ${el.placeholder}`);
    return [(root.innerText || '').replace(/\n{3,}/g, '\n\n'), ...holders].join('\n');
  }, view);
}

// Every line the visible tip bar can show: the window's own rotation is advanced through its pool (it never repeats a tip before all were shown), the text read each time.
export async function tipsOnPage(page, rounds = 60) {
  return page.evaluate(count => {
    const slot = [...document.querySelectorAll('.ss-tips[data-ready]')].find(el => el.offsetParent && el.querySelector('.ss-tip-text'));
    if (!slot) return [];
    const text = slot.querySelector('.ss-tip-text'), seen = new Set();
    for (let i = 0; i < count; i++) { text.dispatchEvent(new Event('animationiteration')); seen.add(text.textContent || ''); }
    return [...seen].filter(Boolean);
  }, rounds);
}

// Visits each page, reads it and the tips of its bar -> [{view, text}] for the judge.
export async function collect(page, views, {wait = ms => page.waitForTimeout(ms)} = {}) {
  const pages = [];
  for (const view of views) {
    await goView(page, view);
    await wait(900);
    const tips = await tipsOnPage(page);
    pages.push({view, text: [await pageText(page, view), tips.length ? `[tips this page can show]\n${tips.join('\n')}` : ''].filter(Boolean).join('\n')});
  }
  return pages;
}
