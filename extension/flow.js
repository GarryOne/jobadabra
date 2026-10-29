// One fill run on a tab: read the form, get answers (AI and/or the drafted kit), fill, report.
// Shared by the popup (the tab you're on) and the background worker (tabs the app opens to fill).
import {prepareFillPage, resolveFillContact, resolveFillAnswers, recordFillForm, rememberedFillChoices, fillKnownFields} from './fill-tab-inputs.js';
import {noteFirstFill, chooseFillMenus, fillLaterAnswers, snapshotFill, retryFill, settleFill, reportFill} from './fill-tab-finish.js';
import {KEY} from './tab-identity.js';
import {attachDebugger, detachDebugger} from './stop-state.js';
import {StepTimeout, within} from './step-bound.js';
import {askEnded, askStarted} from './ladder/silence.js';
import {clickCombo} from './combo-click.js';
import {selectForReplacement} from './text-replace.js';
import {keysFor} from './fill-verify.js';
import {kitStance} from './tab-pages.js';
import {driving} from './input-gap.js';
import {PAGE_FILES} from './page-files.js';
import {hasEarly, keepEarly} from './early-answers.js';
import {decide} from './log.js';
import {guarded} from './read-gen.js';   // the one guard for every AI answer applied to a page (a newer judgment of the same page, a page left)
import './popup-guard.js';   // the worker's answer to the page's gate (page/guard-gate.js)
import {readReply} from './ai-reply.js';   // the AI's reply checked in one place; error texts a person sees
import {verdictFields} from './eligibility-verdict.js';   // a cycle (log.js reads settings from here) that ES modules allow: both use the other only at run time
export const JOB_SITES = [
  'https://*.greenhouse.io/*', 'https://jobs.lever.co/*', 'https://jobs.ashbyhq.com/*',
  'https://*.myworkdayjobs.com/*', 'https://*.smartrecruiters.com/*', 'https://apply.workable.com/*',
  // Employer application sites common in Switzerland and Europe (a job board's Apply often leads there).
  'https://*.successfactors.eu/*', 'https://*.successfactors.com/*', 'https://*.jobs.personio.de/*', 'https://*.jobs.personio.com/*', 'https://*.teamtailor.com/*',
  'https://*.recruitee.com/*', 'https://*.softgarden.io/*', 'https://*.umantis.com/*', 'https://*.taleo.net/*', 'https://*.icims.com/*', 'https://*.bamboohr.com/*',
];

// "Fill drop-down menus too": searchable dropdowns (Greenhouse react-select) open only for real input, so
// the extension clicks each armed one through Chrome's debugger (trusted input; Chrome shows a debugging
// bar meanwhile); the page script then picks the kit's answer in the opened menu. Returns how many got picked.
// One at a time: a second call (the app's own ask for one field, the later pass) while a slow type-to-search menu is still being typed waits its turn,
// instead of failing on "Another debugger is already attached" and leaving the menu empty.
let comboQueue = Promise.resolve();
export function clickCombos(tabId) {
  return debuggerTurn(() => clickCombosNow(tabId));
}
// One debugger user at a time on this worker (the menus' clicks, the real typing of fill-verify.js, the fill ladder's repair clicks: ladder/fill-climb.js).
export function debuggerTurn(work) {
  const turn = comboQueue.then(work);
  comboQueue = turn.catch(() => {});
  return turn;
}
// Every awaited step of the clicks has a deadline, and a whole menu too: a control that never answers is given up on, the rest of the fill goes on (step-bound.js).
const STEP_MS = {attach: 8000, page: 8000, mouse: 8000, type: 8000, choose: 20000, combo: 35000};
// Menus given up on in this fill (a timeout, or the ceiling): a later pass does not wait on the same menu again, so one control costs the fill one wait, not one per pass (tab -> labels).
const givenUp = new Map();
export const forgetGivenUp = tabId => { givenUp.delete(tabId); };
export const gaveUpOn = tabId => [...(givenUp.get(tabId) || [])];   // the labels of the menus this tab's fill stopped waiting on (fill-flow.js hands a required one to the person)
const giveUp = (tabId, label) => { if (!givenUp.has(tabId)) givenUp.set(tabId, new Set()); givenUp.get(tabId).add(label); };
async function clickCombosNow(tabId) {
  let gaveUp = false, lastStep = null, steps = 0;   // a step timed out: the work still running behind it stops at its next step (the debugger is detached below)
  const bound = (label, fn) => (...args) => { if (gaveUp) return Promise.reject(new Error('given up')); steps += 1; const at = Date.now(); lastStep = {label, at, done: 0}; const mine = lastStep; return within(STEP_MS[label], label, () => fn(...args)).finally(() => { mine.done = Date.now(); if (Date.now() - at > 1500) decide('fill', 'a dropdown step was slow', {step: label, ms: Date.now() - at}).catch(() => {}); }); };
  const page = bound('page', (func, args = []) => chrome.scripting.executeScript({target: {tabId}, world: 'MAIN', func, args})
    .then(([r]) => r?.result));
  const results = [];
  if (!(await page(() => window.__jobPilottoArmedCount?.() || 0))) return results;
  const target = {tabId};
  await within(STEP_MS.attach, 'attach', () => attachDebugger(tabId));
  const mouse = bound('mouse', (type, x, y) => chrome.debugger.sendCommand(target, 'Input.dispatchMouseEvent',
    {type, x, y, button: 'left', clickCount: 1}));
  const click = async (x, y) => { if ((await page((px, py) => globalThis.__jobPilottoSubmitPress?.markAt(px, py), [x, y]).catch(() => true)) === false) return; await driving(tabId, async () => { await mouse('mouseMoved', x, y); await mouse('mousePressed', x, y); await mouse('mouseReleased', x, y); }); };   // the extension's own press: marked first (page/submit-press.js markAt)
  // A type-to-search box (page/fill-menus.js typeToSearch): the text typed over the box's content for real, and the AI's pick by meaning among the options it showed.
  const type = bound('type', (text, keys = false) => driving(tabId, async () => {
    await chrome.debugger.sendCommand(target, 'Input.dispatchKeyEvent', {type: 'rawKeyDown', key: 'a', code: 'KeyA', windowsVirtualKeyCode: 65, modifiers: 4, commands: ['selectAll']});
    await chrome.debugger.sendCommand(target, 'Input.dispatchKeyEvent', {type: 'keyUp', key: 'a', code: 'KeyA', windowsVirtualKeyCode: 65, modifiers: 4});
    // A suggest-only box (page/suggest-box.js) is typed the way a person types: each character a real key event (its key press AND its input), whichever of the two its search listens to.
    if (keys) { for (const char of [...String(text)]) for (const key of keysFor(char)) await chrome.debugger.sendCommand(target, 'Input.dispatchKeyEvent', key); return; }
    await chrome.debugger.sendCommand(target, 'Input.insertText', {text});
  }));
  const choose = bound('choose', async ({label, asked, choices, searchable = false, tried = [], consent = false}) => {
    const config = await settings().catch(() => null), reply = config ? await apiFor(tabId, config, '/extension/pick-choice', {method: 'POST', body: JSON.stringify({label, value: asked, options: choices, searchable, tried, consent})}).catch(() => null) : null;
    return searchable ? {choice: reply?.choice || '', searches: Array.isArray(reply?.searches) ? reply.searches.slice(0, 3) : []} : reply?.choice || '';   // a search box: also what to type in it next (page/fill-menus.js searchFor)
  });
  const skip = [];   // the ids of the menus passed over in this pass (page/fill-menus.js __jobPilottoNextCombo): never a count, a disarmed one shifted the rest
  try {
    for (let i = 0; i < 40; i++) {
      const spot = await page(n => window.__jobPilottoNextCombo(n), [skip]);
      if (!spot) break;
      if (givenUp.get(tabId)?.has(spot.label)) { skip.push(spot.id); continue; }
      const started = Date.now();
      let outcome;
      const marks = [];
      try { outcome = await within(STEP_MS.combo, 'dropdown', () => clickCombo({page, click, spot, skip, type, choose, marks})); }
      catch (error) {   // this menu never settled (a suggest-only box whose list never opens): given up, the others and the late answers go on
        gaveUp = true;
        giveUp(tabId, spot.label);
        decide('fill', 'a dropdown did not settle: given up', {step: error instanceof StepTimeout ? error.step : 'error', ms: error.ms ?? 0, field: spot.label.slice(0, 60), steps, last: lastStep?.label || '', lastAgo: lastStep ? Date.now() - lastStep.at : 0, lastDone: !!lastStep?.done, marks: marks.slice(-14).join(' ')}).catch(() => {});
        results.push({label: spot.label, picked: false, matched: null, ms: Date.now() - started, opened: null, found: null, selectedAfter: null, trusted: null});
        break;
      }
      const {picked, last} = outcome;
      if (outcome.capped && !outcome.picked) giveUp(tabId, spot.label);
      if (outcome.capped) decide('fill', 'a dropdown kept the wait going: stopped waiting', {tab: tabId, field: spot.label.slice(0, 60), ms: Date.now() - started}).catch(() => {});
      // Did the page pick what it was asked for? (8 Oct 2026: an automatic click selected the item after "Suisse".) A yes/no, never the value.
      const matched = !picked || !last ? null : last.same === true || String(last.asked).trim().toLowerCase() === String(last.got).trim().toLowerCase();
      // What was observed for this menu (fill card reasons: opened, found, selectedAfter, trusted), never assumed.
      results.push({label: spot.label, picked, matched, ms: Date.now() - started, opened: last?.opened ?? null, found: last?.found ?? null, selectedAfter: last?.selectedAfter ?? null, trusted: last?.trusted ?? null});
      if (!picked && last && last.found === false) decide('fill', 'a menu showed no choice that matched', {tab: tabId, field: spot.label.slice(0, 60), choices: last.choices || [], peek: last.peek || ''}).catch(() => {});   // the form's wording, not the answer
      if (!picked) skip.push(spot.id);
    }
    // A phone widget whose country was just picked: type the number for real, so the form registers it.
    const phone = await page(() => window.__jobPilottoPhoneSpot?.());
    if (phone) {
      await click(phone.x, phone.y);
      const typed = await driving(tabId, async () => {
        if (!await selectForReplacement(page, phone.field)) return false;
        await chrome.debugger.sendCommand(target, 'Input.insertText', {text: phone.text});
        return true;
      });
      results.push({label: 'Phone (typed for real)', picked: typed, ms: 0});
    }
  } finally {
    await detachDebugger(tabId);
  }
  return results;
}

// The approved cover letter PDF travels inside the resume argument: the page helper attaches it to a file input labelled Cover letter.
const withLetterFile = (resume, file, status) => ({...(resume || {}), ...(file ? {coverLetterFile: file} : {}), ...(status ? {coverLetterStatus: status} : {})});

export async function settings() {
  return chrome.storage.local.get(['workerUrl', 'token', 'profile', 'resume', 'checkEligibility', 'testMode', 'clickDropdowns', 'acceptConsents', 'ladderAct']);   // ladderAct: the e2e harness's switch only (ladder/fill-climb.js)
}

// The Jobadabra Mac app gives its connection to this extension only (it checks the extension's ID).
export const APP = 'http://127.0.0.1:47111';
export const NOT_CONNECTED = "the Jobadabra app didn't accept this extension, even after reconnecting";
export const NO_APP = "can't reach the Jobadabra app: is it open?";
const usesApp = config => !config.workerUrl || config.workerUrl.startsWith(APP);
// Connect to the app (the Settings button, and by itself whenever the app turns the token down).
export async function pair() {
  const response = await fetch(`${APP}/extension/pair`);
  if (!response.ok) throw new Error(`the app answered ${response.status}`);
  const {url, token} = await response.json();
  await chrome.storage.local.set({workerUrl: url, token});
  return {workerUrl: url, token};
}

// A call to the app (or your own Worker). The app's token changes when it's reinstalled, reset or switched to
// another Notion workspace: a 401 from the app reconnects once and retries, so the user never has to.
// tabId: the tab whose silent dead-end clock stands still while this ask is out (ladder/silence.js); none: a tab-less ask pauses nothing. Use apiFor on the fill path.
export async function api(config, path, init = {}, retry = true, tabId = null) {
  const ask = askStarted(tabId);
  try { return await guarded(tabId, path, init, () => apiCall(config, path, init, retry), (what, fields) => decide('fill', what, fields)); } finally { askEnded(ask); }
}
export const apiFor = (tabId, config, path, init = {}) => api(config, path, init, true, tabId);
async function apiCall(config, path, init, retry) {
  if (usesApp(config) && !config.token) Object.assign(config, await pair());
  const response = await fetch(`${config.workerUrl.replace(/\/$/, '')}${path}`, {
    ...init, headers: {Authorization: `Bearer ${config.token}`, 'Content-Type': 'application/json', ...(init.headers || {})},
  });
  if (response.status === 401 && retry && usesApp(config)) {
    const fresh = await pair().catch(() => null);
    if (fresh && fresh.token !== config.token) return apiCall(Object.assign(config, fresh), path, init, false);
  }
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw Object.assign(new Error(response.status === 401 ? NOT_CONNECTED : data.error || `HTTP ${response.status}`), {status: response.status, data});
  return data;
}

const inPage = (tabId, func, args = []) => chrome.scripting.executeScript({target: {tabId}, world: 'MAIN', func, args})
  .then(([result]) => result?.result);

// useAI: ask the Worker to answer every open field. force: fill even when the AI says you're not eligible.
// onStep(text): what's happening now, for the popup and the on-page panel.
// Claude's reply for a tab (answers + eligibility), kept for the tab's session so the popup shows the result of
// an automatic fill and "Fill anyway" reuses the answers instead of asking (and paying) again.
const cacheKey = tab => `fill:${tab.id}`;
// open: the questions this fill would ask. A reply is reused only for a form it was asked about: a single-page app keeps one address from sign-in to the form, and the
// sign-in page's reply (a password) was taken for the form's own (16 Oct 2026, Workday My Information: its questions were never asked).
export async function cachedAI(tab, open = null) {
  const entry = (await chrome.storage.session.get(cacheKey(tab)))[cacheKey(tab)];
  const {testMode = false} = await chrome.storage.local.get('testMode');
  if (!entry || entry.url !== tab.url.split('#')[0] || !!entry.test !== testMode) return null;
  const asked = new Set(entry.asked || (entry.ai?.answers || []).map(a => a.field));
  return !open || open.every(f => asked.has(f.field)) ? entry.ai : null;
}
export function forgetAI(tab) { return chrome.storage.session.remove(cacheKey(tab)); }
// The form as the AI is told about it: its fields and its checkbox questions (page scripts loaded).
const readForm = tab => inPage(tab.id, async () => [...await window.__jobPilottoDescribeForm(),
  ...window.__jobPilottoCheckboxQuestions().map(g => ({field: `group:${g.question}`, label: g.question, type: 'checkbox-group', options: g.options}))]);
// What goes to Claude is only what nothing else answers: not a field the kit covers (answered, or left empty on purpose: an optional question it
// chose to skip), not your contact details and CV (the app's, filled by the fill itself), not a file. A form the kit was drafted from needs no call.
async function openQuestions(tab, form, kitAnswers, me, config) {
  const consentsOn = (me?.acceptConsents ?? config.acceptConsents) !== false;
  const fromKit = new Set(kitAnswers.filter(a => !consentsOn || a.category !== 'legal').map(a => a.field).filter(Boolean));
  const contact = new Set((await inPage(tab.id, (rows, profile) => window.__jobPilottoProfileEntries(rows, profile).map(e => e.field),
    [form || [], me?.contact || config.profile || {}]).catch(() => [])) || []);
  const PERSONAL = /^(first_name|last_name|preferred_name|email|phone|resume|resume_text|cover_letter|cover_letter_text|longitude|latitude)$/;
  const ask = (form || []).filter(f => !f.filled && f.type !== 'file' && (f.legal ? consentsOn : !fromKit.has(f.field)) && !PERSONAL.test(f.field)).map(({field, label, type, custom, required, options, multiple}) => ({field, label, type: custom ? 'combobox' : type, required, options, ...(multiple ? {multiple} : {})}));
  // Why (#2200): contact boxes ride along when the AI is asked anyway, never alone (owner, 27 Oct 2026: no new call): its reading of a box beats the quick step's label pattern (page/fill.js)
  return {fromKit, open: ask.some(f => !contact.has(f.field)) ? ask : []};
}
// Claude's answers for a fill, or the news that they were dropped: the app call gives null when the tab had left the page the answer was asked for (read-gen.js), and the fill went on to read
// null.answers (beta 17 Oct 2026, "Cannot read properties of null (reading 'answers')" shown as "Claude did not answer"). A dropped answer is no error of the fill: the next read of the page asks again.
export function answersOrDropped(ai) {
  if (!ai) throw Object.assign(new Error('the tab left this page before Claude answered'), {dropped: true});
  return ai;
}
// An unreadable reply (ai-reply.js) is asked again once, then fails: never kept as sure; the fill goes on without it.
const askAnswers = async (tab, config, open) => {
  const body = JSON.stringify({url: tab.url, fields: open, page_text: await inPage(tab.id, () => window.__jobPilottoPageText()), test: !!config.testMode});
  const ask = () => apiFor(tab.id, config, '/extension/answer', {method: 'POST', body}).then(readReply);
  return ask().catch(error => { if (!error.unreadable) throw error; decide('fill', 'Claude reply unreadable: asking again once', {fields: open.length}); return ask(); });
};
// A page that already shows a form (fill-flow.js consider): its open questions go to the AI now, beside the page-kind ask; the fill takes the answer
// if this page is filled as a form with the same questions (early-answers.js). Not with a kit (Claude answers after that fill) or a cached answer.
export async function askEarly(tab, config, jobUrl = '') {
  if (hasEarly(tab.id, tab.url)) return false;
  const job = (jobUrl || tab.url).split('#')[0];
  const [kit, me] = await Promise.all([apiFor(tab.id, config, `/extension/kit?url=${encodeURIComponent(job)}`).catch(() => ({})),
    apiFor(tab.id, config, `/extension/me?url=${encodeURIComponent(job)}`).catch(() => null)]);
  if (kitStance({kitAnswers: kit?.kit?.answers || [], hasKit: !!kit?.kit}).withKit) return false;
  await chrome.scripting.executeScript({target: {tabId: tab.id}, world: 'MAIN', func: () => { window.__jobPilottoNoGuard = true; }});
  await chrome.scripting.executeScript({target: {tabId: tab.id}, world: 'MAIN', files: PAGE_FILES});
  try {   // the label meanings, as the fill loads them, so both read the form alike
    const packs = await apiFor(tab.id, config, '/extension/aliases', {method: 'POST', body: '{}'});
    await chrome.scripting.executeScript({target: {tabId: tab.id}, world: 'MAIN', args: [Array.isArray(packs?.aliases) ? packs.aliases.slice(0, 2000) : []], func: aliases => { window.__jobPilottoAliases = aliases; }});
  } catch { /* aliases are a bonus */ }
  const {open} = await openQuestions(tab, await readForm(tab), [], me, config);
  if (!open.length || await cachedAI(tab, open)) return false;
  keepEarly(tab.id, tab.url, open, askAnswers(tab, config, open));
  return true;
}

// jobUrl: the posting the kit belongs to, when the form lives elsewhere (a job board's Apply led to the employer's site).
// me: your contact details and CV when already fetched (the panel prefetches them), so the fill starts at once.
// The page scripts a fill needs, in order (also loaded for one field's "Use" from the app: fill-flow.js).
export {PAGE_FILES};   // extension/page-files.js
// Runs one fill through preparation, answers, typing, verification and reporting in that order.
export async function fillTab(tab, config, {useAI = true, force = false, kitAnswers = [], hasKit = false, onStep = () => {}, reuse = true, coverLetter = '', jobUrl = '', me: early = null} = {}) {
  const startedAt = new Date();
  const askedAnyway = force;   // the person's "Fill anyway", kept before a kit turns force on (the log line names who passed a "not eligible": eligibility-verdict.js)
  const job = (jobUrl || tab.url).split('#')[0];
  chrome.storage.session.set({[KEY.job(tab.id)]: job, [KEY.from(tab.id)]: job});
  const event = (type, extra = {}) => apiFor(tab.id, config, '/extension/event', {method: 'POST',
    body: JSON.stringify({type, url: job, ...extra})}).catch(() => {});
  event('fill-started');
  // A kit exists for this job (drafted when it was prepared, its eligibility already judged) even when none of its answers
  // matches this form's fields: the form's own questions are only visible now, so Claude answers those after the fill, but the
  // eligibility stop is not asked again (2 Oct 2026: a ready kit still waited 10-30 s and re-checked eligibility).
  const {withKit} = kitStance({kitAnswers, hasKit});
  // Everything about this fill, for debugging and improving the extension (saved with the run in Notion).
  const debug = {version: chrome.runtime.getManifest().version, browser: navigator.userAgent, steps: [], errors: []};
  let stepAt = Date.now();
  const step = name => { const now = Date.now(); debug.steps.push({step: name, ms: now - stepAt}); stepAt = now; };
  onStep('Reading the form…');
  const run = {tab, config, useAI, force, kitAnswers, hasKit, onStep, reuse, coverLetter, early, startedAt, askedAnyway, job, event, withKit, debug, step,
    inPage, readForm, openQuestions, askAnswers, cacheKey, usesApp, withLetterFile};
  const gate = await prepareFillPage(run);
  if (gate) return gate;
  run.answers = kitAnswers.map(a => ({field: a.field, value: a.answer, question: a.question, source: 'kit',
    confidence: a.needs_review ? 'low' : 'high', category: a.category || ''}));
  Object.assign(run, {ai: null, aiError: null, later: [], pendingAI: null, kitSkips: false});   // pendingAI: Claude's answers on their way while the known fields fill (below)
  run.me = await resolveFillContact(run);
  const answerStop = await resolveFillAnswers(run);
  if (answerStop) return answerStop;
  onStep('Filling the form…');
  await recordFillForm(run);
  run.useRemembered = rememberedFillChoices(run);
  const first = await fillKnownFields(run);
  if (!first.summary) return first;
  run.summary = first.summary;
  run.notClicked = noteFirstFill(run);
  await chooseFillMenus(run);
  const laterStop = await fillLaterAnswers(run);
  if (laterStop) return laterStop;
  run.snapshots = await snapshotFill(run);
  await retryFill(run);
  await settleFill(run);
  await reportFill(run);
  const {summary, ai, aiError, kitSkips} = run;
  return {...summary, usd: ai?.usd, aiError, coverLetter: ai?.cover_letter, ...verdictFields({ai, askedAnyway, kit: withKit || kitSkips, checkOff: config.checkEligibility === false})};
}
