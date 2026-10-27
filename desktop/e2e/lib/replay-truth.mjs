/* global document, CSS, getComputedStyle, window */
// The false readings a replay must never pass (owner, 12 Oct 2026, after #507: Recruitee's country box held Israel, FNAC's panel said ready with a required field left,
// a CV slot counted in with no file). They make a row look better, so a "did it get worse" check never sees them. At each replay's end:
//  TRUTH: every field the case's AI answers name holds THAT answer, compared by the value itself on the runner (a value class is too weak: Israel and Switzerland are both countries);
//  AGREEMENT: the panel's missing == the fill record's left (/extension/run trace) >= the page's own empty required controls; no "ready" with one left; no CV counted in with no file.
// The applicant and the answers are the case's fake data; nothing here is sent anywhere. Used by lib/page-replay.mjs judgeCase.
// Guards: e2e/test/replay-truth.test.mjs (pure parts), e2e/test/recorded-pages.test.mjs (every case).

import fs from 'node:fs';
import vm from 'node:vm';
import {FALSE_READINGS} from './recorded-false-readings.mjs';

// The extension's one grouping rule (page/option-groups.js), injected into the page before the required controls are read: readRequiredInPage runs in the page's MAIN world, where the
// extension's own content scripts are not (and a plain page has none: e2e/test/replay-truth-page.test.mjs).
const OPTION_GROUPS = fs.readFileSync(new URL('../../../extension/page/option-groups.js', import.meta.url), 'utf8');

// The file the stand-in app gives as the CV (real-extension.mjs pdf('cv.pdf')), named here, not imported: that file loads playwright, and lib/record-sites.mjs (desktop's unit
// tests import it) reaches this file through lib/live-readings.mjs (test/unit-tests-no-playwright.test.js).
const CV_NAME = 'cv.pdf';

// The false readings already found, per case (lib/recorded-false-readings.mjs): each is a bug to fix, never a loosened assert. A listed one is said as KNOWN BUG and does not fail;
// a new one fails; a listed one that does not show is said (GONE?: remove its line once the fix landed), never a failure: some depend on timing, and a flaky required check blocks every PR.
export const loadLedger = () => FALSE_READINGS;
export function againstLedger(name, failures, ledger = loadLedger()) {
  const known = ledger[name] || [], out = [], seen = [];
  for (const line of failures) (known.includes(line) ? seen : out).push(line);
  return {failures: out, known: seen, gone: known.filter(line => !seen.includes(line))};
}

const answerBodies = body => !body ? [] : Array.isArray(body) ? body.map(entry => entry?.answer) : body.byHost ? Object.values(body.byHost).flatMap(answerBodies) : [body];

// The case's answers, field -> value: every variant of /extension/answer. A field two variants answer differently is left out (which one the run got is not known here).
export function expectedAnswers(item) {
  const seen = new Map();
  for (const body of answerBodies(item?.ai?.['/extension/answer'])) {
    for (const one of body?.answers || []) {
      const value = String(one?.value ?? '').trim();
      if (!one?.field || !value) continue;
      seen.set(one.field, seen.has(one.field) && seen.get(one.field) !== value ? null : value);
    }
  }
  return new Map([...seen].filter(([, value]) => value != null));
}

// The choices the case's picker gives (/extension/pick-choice: the AI matched the answer to an option in the page's own words): an answered field may hold one of them.
export const pickedChoices = item => answerBodies(item?.ai?.['/extension/pick-choice']).map(body => String(body?.choice || '').trim()).filter(Boolean);

const words = text => String(text || '').normalize('NFKD').replace(/[̀-ͯ]/g, '').toLowerCase().split(/[^\p{L}\p{N}]+/u).filter(Boolean);
const holdsRun = (outer, inner) => inner.length > 0 && outer.some((_, at) => inner.every((word, k) => outer[at + k] === word));
const digits = text => String(text || '').replace(/\D/g, '');

// Does what the page shows (a box's value, a choice's text and value) hold the answer? By words in a row either way (a longer option holding the answer; a type-to-search option in its own
// shorter wording, "Geneva" for "Geneva, Switzerland"), or a phone by its digits. Never a different word: Israel is not Switzerland, "Not sure" is not "No".
// A calling code's country, by the extension's own dial-code table (extension/page/dial-codes.js, named by the browser): the fill ladder's repair picks "Switzerland" for the answer "+41"
// (choose_option: the same answer in another writing, checked in the page; recorded dial-code-in-country-1), so the truth reads it as that answer.
const DIAL = (() => { const window = {}; try { vm.runInNewContext(fs.readFileSync(new URL('../../../extension/page/dial-codes.js', import.meta.url), 'utf8'), {window, Intl}); } catch { /* no table: no country */ } return window.__jobPilottoDial || {}; })();
const countryOfCode = text => { const code = String(text || '').trim().replace(/^00(?=\d)/, '+').replace(/\s/g, ''); return /^\+\d{1,4}$/.test(code) ? DIAL[code] || '' : ''; };

export function sameAnswer(expected, shown = []) {
  const want = words(expected), wantDigits = digits(expected), country = words(countryOfCode(expected));
  return shown.some(text => {
    if (country.length && holdsRun(words(text), country)) return true;   // "+41" shown as its country, Switzerland
    const have = words(text);
    if (holdsRun(have, want) || holdsRun(want, have)) return true;
    return wantDigits.length >= 6 && want.every(word => /^\d+$/.test(word)) && digits(text).length >= 6 && (digits(text).endsWith(wantDigits.slice(-9)) || wantDigits.endsWith(digits(text).slice(-9)));
  });
}

// read: field -> {state: 'value'|'empty'|'unreadable'|'missing', shown: [text]} (readFields). An empty answered field is the agreement check's (it must be counted left).
export function truthFailures(expected, read, picked = []) {
  const failures = [], counts = {compared: 0, empty: 0, unreadable: 0, missing: 0};
  for (const [field, value] of expected) {
    const got = read.get(field) || {state: 'missing', shown: []};
    if (got.state !== 'value') { counts[got.state] = (counts[got.state] || 0) + 1; continue; }
    counts.compared += 1;
    if (!sameAnswer(value, got.shown) && !picked.some(choice => sameAnswer(choice, got.shown))) failures.push(`truth: ${field} holds "${String(got.shown[0] || '').slice(0, 60)}", its answer is "${value.slice(0, 60)}"`);
  }
  return {failures, counts};
}

const named = list => (list.length ? list.map(text => text.slice(0, 60)).join(', ') : 'none');   // every name: which one the other reading misses is the bug
// trace: the fill record's rows ([{label, required, outcome, source}]) or null (no fill); review: the panel's last report ({missing}) or null; panel: {present, ready};
// required: the page's own visible required controls [{name, empty}]; files: how many file boxes hold a file.
export function agreementFailures({trace, review, panel, required = [], files = 0, slots = 0}) {   // slots: the page's upload slots (file boxes, control-less required groups)
  const failures = [];
  const cvRow = (trace || []).find(row => row.source === 'your CV');   // the fill's own CV row (page/fill.js): counted when left (the panel lists the slot); its "in" is checked below
  // The CV row is always in the record ("no place to attach it"): counted only where the page has an upload slot, or it balances a duplicate on the panel (fill-ladder, 13 Oct 2026).
  // A written answer we drafted is typed but left until the person reads it (owner, 16 Oct 2026; page/fill.js reason "drafted: review it" / "outline: ..."): the panel counts it left, so does this.
  const drafted = row => row.outcome === 'filled' && /^(drafted|outline):/.test(String(row.reason || ''));
  const traceLeft = (trace || []).filter(row => row.required && (row.outcome === 'left' || drafted(row)) && (row !== cvRow || slots > 0)).map(row => String(row.label));
  const panelLeft = review ? (review.missing || []).map(String) : null;
  const pageLeft = required.filter(one => one.empty).map(one => String(one.name));
  // The record is written once, at the fill's end; the panel reads the page later. Fewer left in the record than on the panel makes the row look better: that fails.
  // More left is a record older than the page (a box the page emptied and we typed again after it was written): a timing, not a better-looking row.
  if (trace && panelLeft && traceLeft.length < panelLeft.length) failures.push(`agreement: the fill record leaves ${traceLeft.length} required (${named(traceLeft)}), the panel ${panelLeft.length} (${named(panelLeft)})`);
  if (panelLeft && pageLeft.length > panelLeft.length) failures.push(`agreement: the page has ${pageLeft.length} required control${pageLeft.length === 1 ? '' : 's'} empty (${named(pageLeft)}), the panel counts ${panelLeft.length} (${named(panelLeft)})`);
  if (panel?.present && panel.ready) {
    const left = [panelLeft || [], pageLeft].find(list => list.length) || [];   // the live readings: a fill record older than the page is the agreement line's
    if (left.length) failures.push(`ready: the panel says ready with ${left.length} required left (${named(left)})`);
  }
  if (cvRow?.outcome === 'filled' && !files) failures.push('cv: the fill record counts the CV in, no file box on the page holds a file');
  return failures;
}

// ---- read on the page (each frame) ----
// A field key as the extension names it (page/propose.js): "aria:<group id>", "radio:<name>", else an element id or name. -> {state, shown}
const readFieldsInPage = keys => {
  const labelOf = el => [el.id && document.querySelector(`label[for="${CSS.escape(el.id)}"]`)?.textContent, el.closest('label')?.textContent, el.getAttribute('aria-label'), el.textContent].find(text => text && text.trim()) || '';
  const out = {};
  for (const key of keys) {
    const text = String(key);
    if (text.startsWith('aria:')) {
      const group = document.getElementById(text.slice(5)) || document.querySelector(`[data-jobpilotto-group="${CSS.escape(text.slice(5))}"]`);
      if (!group) continue;
      const on = [...group.querySelectorAll('[aria-checked="true"], [aria-pressed="true"], [aria-selected="true"], input:checked')];
      out[key] = on.length ? {state: 'value', shown: on.flatMap(el => [labelOf(el), el.value || '', el.getAttribute('data-option') || ''])} : {state: 'empty', shown: []};
      continue;
    }
    if (text.startsWith('radio:')) {
      const list = [...document.querySelectorAll(`input[type=radio][name="${CSS.escape(text.slice(6))}"]`)];
      if (!list.length) continue;
      const on = list.find(el => el.checked);
      out[key] = on ? {state: 'value', shown: [labelOf(on), on.value]} : {state: 'empty', shown: []};
      continue;
    }
    const el = document.getElementById(text) || document.querySelector(`[name="${CSS.escape(text)}"]`);
    if (!el) continue;
    const tag = el.tagName.toLowerCase(), type = (el.getAttribute('type') || '').toLowerCase();
    if (tag === 'select') {
      const chosen = [...el.selectedOptions].filter(option => option.value !== '');
      out[key] = chosen.length ? {state: 'value', shown: chosen.flatMap(option => [option.textContent.trim(), option.value])} : {state: 'empty', shown: []};
    } else if (type === 'checkbox' || type === 'radio' || type === 'file') out[key] = {state: 'unreadable', shown: []};   // a lone box's yes/no and a file are not a typed value: counted, judged elsewhere
    else if ('value' in el) out[key] = String(el.value || '').trim() ? {state: 'value', shown: [String(el.value)]} : {state: 'empty', shown: []};
    else out[key] = {state: 'unreadable', shown: []};
  }
  return out;
};
// The page's own visible required controls, by the HTML's structure (required, aria-required): a lower bound of what is required (a starred label without the attribute is not seen here).
// Not read: a type-to-search box (its text is the search, emptied after a choice; react-select keeps a hidden required input only while nothing is chosen, which is read).
// A choice option (role radio/checkbox/option) is answered when its group holds a checked one; an upload slot when it holds a file or shows the attached file's name (cvName).
// Whether a frame's <iframe> is on the page a person sees: laid out, not visibility:hidden, no ancestor at opacity 0 (a closed sidebar fades out and keeps its forms). Only for frames: a
// control's own opacity 0 stays read (react-select's required input). Runs in the page, so it is a plain function.
// Why (27 Oct 2026, pool run 40497749589): a careers page's faded-out sidebar held HubSpot iframes with 15 empty required boxes; the check counted them, the panel (rightly) did not.
function shownToPerson(el) {
  const box = el.getBoundingClientRect();
  if (!el.getClientRects().length || !box.width || !box.height) return false;
  return el.checkVisibility ? el.checkVisibility({opacityProperty: true, visibilityProperty: true}) : getComputedStyle(el).visibility !== 'hidden';
}
// A frame is shown when its <iframe> is shown in its parent, up to the top (a nested frame needs every level).
const frameShown = async frame => {
  for (let one = frame; one.parentFrame(); one = one.parentFrame()) {
    const box = await one.frameElement().catch(() => null);
    if (!box || !await box.evaluate(shownToPerson).catch(() => false)) return false;
  }
  return true;
};
const readRequiredInPage = cvName => {
  const visible = el => el.getClientRects().length > 0 && getComputedStyle(el).visibility !== 'hidden';   // opacity 0 stays read: react-select's own required input is one
  const on = '[aria-checked="true"], [aria-pressed="true"], [aria-selected="true"], input:checked';
  const shows = el => !!cvName && (el.textContent || '').includes(cvName);
  const slotEmpty = el => { const box = el.matches('input[type=file]') ? el : el.querySelector('input[type=file]'); return !(box?.files?.length) && !shows(el.closest('[aria-required="true"], .file-upload, label, div') || el); };
  const groups = new Set(), out = [];
  const slots = document.querySelectorAll('input[type=file]').length;   // plus the control-less required groups counted below
  for (const el of document.querySelectorAll('input[required], select[required], textarea[required], [aria-required="true"]')) {
    if (!visible(el) || el.disabled || el.closest('#jobpilotto-review-host')) continue;
    const labelled = (el.getAttribute('aria-labelledby') || '').split(/\s+/).map(id => id && document.getElementById(id)?.textContent).filter(Boolean).join(' ');
    const forLabel = el.id ? document.querySelector(`label[for="${CSS.escape(el.id)}"]`)?.textContent : '';
    const type = (el.getAttribute('type') || '').toLowerCase(), name = (el.getAttribute('aria-label') || labelled || forLabel || el.closest('label')?.textContent || el.getAttribute('name') || el.id || el.closest('[class*=field], [class*=question], fieldset')?.querySelector('label, legend')?.textContent || el.tagName.toLowerCase()).replace(/\s+/g, ' ').trim().slice(0, 60);
    if (['hidden', 'submit', 'button', 'reset', 'image'].includes(type) || el.getAttribute('role') === 'combobox' || el.hasAttribute('aria-autocomplete')) continue;
    const role = el.getAttribute('role') || '';
    // One question is one control, however its options are named (NICE's Greenhouse form, pool run 38325149096): options join into ONE group by the one rule the panel uses too
    // (extension/page/option-groups.js, injected into the page in readTab): the box holding only options (fieldset, ARIA group), else a shared name; answered when any option is ticked.
    const choice = ['checkbox', 'radio'].includes(type), og = window.__jobPilottoOptionGroups;
    const group = choice || ['radio', 'checkbox', 'option', 'switch'].includes(role) ? og.groupOf(el) : og.groupOfBox(el);
    if (group) { if (groups.has(group.key)) continue; groups.add(group.key); out.push({name: group.title || name, empty: !og.answered(group)}); continue; }
    // An upload slot: a file box, a group holding one, or a required group with no control of its own (Greenhouse's resume group: a chip with the file's name, no file input in the
    // captured page): read by the file it holds or the name it shows (chosen-picklist-judged-1, found by fill-ladder 13 Oct 2026).
    const noControl = !('value' in el) && !el.querySelector('input, select, textarea, [role=radio], [role=checkbox], [role=option], [role=switch]');
    if (type === 'file' || el.querySelector('input[type=file]') || noControl) { out.push({name, empty: slotEmpty(el), ...(noControl ? {slot: true} : {})}); continue; }
    if (type === 'radio') { if (groups.has(`radio:${el.name}`)) continue; groups.add(`radio:${el.name}`); out.push({name, empty: ![...document.querySelectorAll(`input[type=radio][name="${CSS.escape(el.name)}"]`)].some(one => one.checked)}); continue; }
    const empty = type === 'checkbox' ? !el.checked : 'value' in el ? !String(el.value || '').trim() : !(el.matches(on) || el.querySelector(on));
    out.push({name, empty});
  }
  return {required: out, slots: slots + out.filter(one => one.slot).length, files: [...document.querySelectorAll('input[type=file]')].filter(el => el.files?.length).length + (cvName && (document.body?.innerText || '').includes(cvName) ? 1 : 0)};   // a page that took the file and emptied its box shows the file's name
};
const readPanelInPage = () => {
  const root = document.getElementById('jobpilotto-review-host')?.shadowRoot;
  return {present: !!root?.querySelector('.jp'), ready: !!root?.querySelector('.jp.ready')};
};

// Everything the checks read from a tab, over all its frames: the answered fields (first frame that has the key), the required controls and attached files (summed), the panel (top frame).
export async function readTab(page, keys, cvName = CV_NAME) {
  const read = new Map(), required = [];
  let files = 0, slots = 0;
  for (const frame of page.frames()) {
    const fields = await frame.evaluate(readFieldsInPage, keys).catch(() => ({}));
    for (const [key, value] of Object.entries(fields)) if (!read.has(key)) read.set(key, value);
    if (!await frameShown(frame)) continue;   // its boxes are not on the page a person sees
    await frame.evaluate(OPTION_GROUPS).catch(() => {});   // an expression: Chrome's evaluate is not held by the page's CSP
    const found = await frame.evaluate(readRequiredInPage, cvName).catch(() => ({required: [], files: 0}));
    required.push(...found.required);
    files += found.files;
    slots += found.slots || 0;
  }
  const panel = await page.evaluate(readPanelInPage).catch(() => ({present: false, ready: false}));
  return {read, required, files, slots, panel};
}

const parsed = request => { try { return JSON.parse(request.body); } catch { return null; } };
// The case's last fill record and the panel's last report from the requests the case's tab sent the stand-in app. The record is the fill's /extension/run, as the extension LATER corrected it:
// the rows of its last "fields (updated after a late retype)" log line (extension/ladder/record-update.js; the same rows the pool's ending takes, lib/record-sites.mjs) replace its trace.
export function recordsOf(requests) {
  const runs = requests.filter(request => request.route === '/extension/run'), reviews = requests.filter(request => request.route === '/extension/review');
  const run = runs.length ? parsed(runs.at(-1)) : null;
  const later = run && lateRows(requests, runs.at(-1));
  const review = reviews.length ? parsed(reviews.at(-1)) : null;
  // The record belongs to the page the fill ran on: the page the last page-kind ask BEFORE it named. A panel that reports on another page (a two-page case: the login page was filled and recorded, the apply page
  // is filled but its record is still on its way: the extension posts it after the 15 s the page is watched for a late retype) is not compared with the other page's record. That is `stale`, never a pass:
  // falseReadings waits for the page's own record and fails when none comes (13 Oct 2026, email-first-no-password-1).
  const pageOf = url => String(url || '').split('#')[0];
  const before = runs.length ? requests.slice(0, requests.indexOf(runs.at(-1))).filter(request => request.route === '/extension/page-kind').at(-1) : null;
  const ranOn = pageOf(before && parsed(before)?.url), reportedOn = pageOf(review?.url);
  const stale = !!(run && ranOn && reportedOn && ranOn !== reportedOn);
  return {run: stale ? null : later ? {...run, trace: later} : run, cut: runs.length > 0 && !run, stale, review};
}
const UPDATED_LINE = /^fields \(updated after a late retype\)/;
function lateRows(requests, lastRun) {
  let rows = null;
  for (const request of requests.slice(requests.indexOf(lastRun) + 1)) {
    if (request.route !== '/extension/log') continue;
    for (const entry of parsed(request)?.entries || []) if (UPDATED_LINE.test(String(entry?.text || '')) && Array.isArray(entry.fields?.fields)) rows = entry.fields.fields;
  }
  return rows;
}

// The whole check at a case's end. scope: judgeCase's (page(), mine()). Waits for the fill's own record (until the case's deadline), then for the panel's next report.
export async function falseReadings(item, {page, mine}, {deadline = Date.now() + 10000, settleMs = 2500} = {}) {
  const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
  const filling = () => page().evaluate(() => { try { return JSON.parse(document.documentElement.dataset.jobpilottoFill || '{}').state === 'running'; } catch { return false; } }).catch(() => false);
  while (Date.now() < deadline && await filling()) await wait(300);
  await wait(settleMs);   // the panel reports on its own beat (review.js sync): its report after the fill's end
  const expected = expectedAnswers(item);
  let tab = await readTab(page(), [...expected.keys()]), records = recordsOf(mine());
  while (records.stale && Date.now() < deadline) { await wait(500); records = recordsOf(mine()); tab = await readTab(page(), [...expected.keys()]); }   // the page's own record is on its way
  const truth = truthFailures(expected, tab.read, pickedChoices(item));
  const failures = [...truth.failures];
  if (records.stale) failures.push(`agreement: the page was filled (${named((records.review?.filled || []).map(String))}) but its own fill record never reached the app; the record on file is another page's`);
  if (records.cut) failures.push('agreement: the fill record reached the stand-in cut short (real-extension.mjs keeps too little of /extension/run)');
  failures.push(...agreementFailures({trace: records.run?.trace || null, review: records.review, panel: tab.panel, required: tab.required, files: tab.files, slots: tab.slots}));
  const judged = againstLedger(item.name, failures);
  for (const line of judged.known) console.log(`KNOWN BUG ${item.name}: ${line}`);
  for (const line of judged.gone) console.log(`GONE? ${item.name}: not seen this run (remove it from lib/recorded-false-readings.mjs once its fix landed): ${line}`);
  return {failures: judged.failures, known: judged.known, counts: truth.counts};
}
