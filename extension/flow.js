// One fill run on a tab: read the form, get answers (AI and/or the drafted kit), fill, report.
// Shared by the popup (the tab you're on) and the background worker (tabs the app opens to fill).
import {addressNow, stillOnPage} from './one-fill.js';
import {KEY} from './tab-identity.js';
import {attachDebugger, detachDebugger, isStopped, pageStarted} from './stop-state.js';
import {StepTimeout, within} from './step-bound.js';
import {askEnded, askStarted} from './ladder/silence.js';
import {MENU_REASONS, OLD_MENU_REASON, applyCombos} from './menu-reason.js';
import {clickCombo} from './combo-click.js';
import {keysFor, typeNotTakenOnTab} from './fill-verify.js';
import {climbFill} from './ladder/fill-climb.js';
import {kitStance} from './tab-pages.js';
import {driving} from './input-gap.js';
import {fillCard} from './fill-card.js';
import {readBackCounts, settleTrace} from './trace-settle.js';
import {armRecordUpdate, runUpdateBody} from './ladder/record-update.js';
import {expandSections} from './sections.js';
import {PAGE_FILES} from './page-files.js';
import {hasEarly, keepEarly, takeEarly} from './early-answers.js';
import {decide} from './log.js';
import {guarded} from './read-gen.js';   // the one guard for every AI answer applied to a page (a newer judgment of the same page, a page left)
import {closePopupOrLayer} from './consent.js';   // a cycle again (consent.js uses api and settings from here at run time)
import {HELD, clearBeforeFill, layerOnTop} from './dialog-after-fill.js';
import {markCauses} from './ladder/control-marks.js';
import {controlDoor} from './ladder/control-door.js';
import './popup-guard.js';   // the worker's answer to the page's gate (page/guard-gate.js)
import {plainWhy, readReply} from './ai-reply.js';   // the AI's reply checked in one place; error texts a person sees
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
  const choose = bound('choose', async ({label, asked, choices, searchable = false, tried = []}) => {
    const config = await settings().catch(() => null), reply = config ? await apiFor(tabId, config, '/extension/pick-choice', {method: 'POST', body: JSON.stringify({label, value: asked, options: choices, searchable, tried})}).catch(() => null) : null;
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
      await driving(tabId, async () => {
        await chrome.debugger.sendCommand(target, 'Input.dispatchKeyEvent', {type: 'rawKeyDown', key: 'a', code: 'KeyA',
          windowsVirtualKeyCode: 65, modifiers: 4, commands: ['selectAll']});
        await chrome.debugger.sendCommand(target, 'Input.dispatchKeyEvent', {type: 'keyUp', key: 'a', code: 'KeyA', windowsVirtualKeyCode: 65, modifiers: 4});
        await chrome.debugger.sendCommand(target, 'Input.insertText', {text: phone.text});
      });
      results.push({label: 'Phone (typed for real)', picked: true, ms: 0});
    }
  } finally {
    await detachDebugger(tabId);
  }
  return results;
}

// The approved cover letter PDF travels inside the resume argument: the page helper attaches it to a file input labelled Cover letter.
const withLetterFile = (resume, file) => (file ? {...(resume || {}), coverLetterFile: file} : resume);

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

// Why a field was left that is the extension's fault, not missing data (desktop/lib/reports.js reports these).
const WRITTEN = 'written';   // page/fill.js's reason for an open question the AI read as the person's own words (category written)
const KIND_REASON = /^(legal|demographic|the AI gave no answer)/;   // words-ok: our own trace reasons (page/fill.js): a kind the AI returned with no value, kept from the later pass like written
const PROPOSED = 'proposed for you to confirm';   // page/fill.js's reason for a question the AI proposed an answer for (worker/test/fill-trace-proposed.test.js keeps them equal)
const MECHANICAL = [...MENU_REASONS.map(item => item.text), OLD_MENU_REASON,
  'answer given, but the field did not take it', 'question text not found on the page',
  'question on the page not read'];

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
  const fromKit = new Set(kitAnswers.map(a => a.field).filter(Boolean));
  const contact = new Set((await inPage(tab.id, (rows, profile) => window.__jobPilottoProfileEntries(rows, profile).map(e => e.field),
    [form || [], me?.contact || config.profile || {}]).catch(() => [])) || []);
  const PERSONAL = /^(first_name|last_name|preferred_name|email|phone|resume|resume_text|cover_letter|cover_letter_text|longitude|latitude)$/;
  const ask = (form || []).filter(f => !f.filled && !f.legal && f.type !== 'file' && !fromKit.has(f.field) && !PERSONAL.test(f.field)).map(({field, label, type, required, options, multiple}) => ({field, label, type, required, options, ...(multiple ? {multiple} : {})}));
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
export async function fillTab(tab, config, {useAI = true, force = false, kitAnswers = [], hasKit = false, onStep = () => {}, reuse = true, coverLetter = '', jobUrl = '', me: early = null} = {}) {
  const startedAt = new Date();
  const askedAnyway = force;   // the person's "Fill anyway", kept before a kit turns force on (the log line names who passed a "not eligible": eligibility-verdict.js)
  let kitSkips = false;
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
  // Nothing is typed under a dialog: what covers the form's controls is closed first (the AI's non-agreeing button, kept), or the fill is held and the person told (dialog-after-fill.js).
  const gate = await clearBeforeFill(tab.id, {close: closePopupOrLayer, look: layerOnTop});
  if (gate.closed.length) decide('fill', 'closed a dialog before the fill', {label: gate.closed[0].slice(0, 40), tab: tab.id});
  if (gate.held) return {held: true, layer: gate.layer, note: HELD, usd: 0};
  await expandSections(tab);   // collapsed sections open first, so their fields are read (a no-op when consider already did: sections.js marks what it opened)
  // No Submit guard for the extension: it never submits, and the user presses Submit themselves.
  await chrome.scripting.executeScript({target: {tabId: tab.id}, world: 'MAIN', func: () => { window.__jobPilottoNoGuard = true; }});
  await chrome.scripting.executeScript({target: {tabId: tab.id}, world: 'MAIN', files: PAGE_FILES});
  await chrome.scripting.executeScript({target: {tabId: tab.id, allFrames: true}, files: ['guard-bridge.js']}).catch(() => {});   // the gate's isolated-world half (guard-bridge.js); without it the fill never waits
  // Recipes for the kinds of control on this form, asked of the app by fingerprint (it asks the site, and remembers). A recipe
  // only configures a generic operator; no recipe, or no answer, and the operators work with their own defaults.
  try {
    const prints = await chrome.scripting.executeScript({target: {tabId: tab.id}, world: 'MAIN', func: () => window.__jobPilottoControls?.fingerprints?.() || []})
      .then(rows => rows?.[0]?.result || []);
    if (prints.length) {
      const found = await apiFor(tab.id, config, '/extension/recipes', {method: 'POST', body: JSON.stringify({fingerprints: prints})});
      await chrome.scripting.executeScript({target: {tabId: tab.id}, world: 'MAIN', args: [found?.recipes || {}], func: recipes => { window.__jobPilottoRecipes = recipes; }});
    }
  } catch { /* recipes are a bonus: the operators work without them */ }
  // Label meanings from the service (extension/alias-schema.js), asked of the app which asks the site and remembers: the filler uses them
  // only for a question no built-in pattern placed. No answer, and the built-in patterns work as before.
  try {
    const packs = await apiFor(tab.id, config, '/extension/aliases', {method: 'POST', body: '{}'});
    await chrome.scripting.executeScript({target: {tabId: tab.id}, world: 'MAIN', args: [Array.isArray(packs?.aliases) ? packs.aliases.slice(0, 2000) : []], func: aliases => { window.__jobPilottoAliases = aliases; }});
  } catch { /* aliases are a bonus */ }
  // Two or more upload slots that could take the CV (the page's own "import my details from my CV" feature has a file input of its own): the app's AI names the one that takes the
  // CV as a document, from their titles, kept (upload-pick.js). No answer: the operator behaves as before. page/upload.js reads window.__jobPilottoUploadChoice.
  try {
    const titles = await chrome.scripting.executeScript({target: {tabId: tab.id}, world: 'MAIN', func: () => window.__jobPilottoUpload?.cvCandidates?.() || []}).then(rows => rows?.[0]?.result || []);
    const picked = titles.length > 1 ? (await apiFor(tab.id, config, '/extension/pick-upload', {method: 'POST', body: JSON.stringify({titles})}))?.title : '';
    await chrome.scripting.executeScript({target: {tabId: tab.id}, world: 'MAIN', args: [picked || ''], func: title => { window.__jobPilottoUploadChoice = title ? {resume: title} : null; }});
  } catch { /* the choice is a bonus: the operator works without it */ }
  let answers = kitAnswers.map(a => ({field: a.field, value: a.answer, question: a.question, source: 'kit',
    confidence: a.needs_review ? 'low' : 'high', category: a.category || ''}));
  let ai = null, aiError = null, later = [], pendingAI = null;   // pendingAI: Claude's answers on their way while the known fields fill (below)
  // Contact details and CV come from the Jobadabra app each time (it's the one place they live).
  const me = early || await apiFor(tab.id, config, `/extension/me?url=${encodeURIComponent(job)}`).catch(error => {
    // No app or no connection: stop, rather than fill a form without your name and CV.
    if (usesApp(config) && (!error.status || error.status === 401)) throw new Error(error.status ? NOT_CONNECTED : NO_APP);
    debug.errors.push(`details from the app: ${error.message}`);
    return null;
  });
  // The best of both, like an Apply with Claude session: the kit's answers first (drafted when the kit was made),
  // then Claude only for the questions they don't cover, so nothing is left empty that could be answered. A form
  // the kit covers fully costs nothing (no call when nothing is open).
  if (useAI) {
    const form = await readForm(tab);
    step('read the form');
    debug.form = (form || []).map(({field, label, type, required, filled, legal, options}) =>
      ({field, label, type, required, filled, legal, options: (options || []).slice(0, 30)}));
    const {fromKit, open} = await openQuestions(tab, form, kitAnswers, me, config);
    debug.sentToClaude = open.map(f => f.field);
    // With a kit, applying was the user's decision (they prepared it): no eligibility stop, and no waiting: everything
    // known fills at once, and Claude answers what's left afterwards (below), while you already see the form filled.
    kitSkips = kitStance({kitAnswers, hasKit, matched: fromKit.size}).skipEligibility;
    if (kitSkips) force = true;
    if (withKit) later = open;
    const cached = reuse && !withKit ? await cachedAI(tab, open) : null;
    if (withKit) { /* Claude after the fill */ } else if (cached) {
      ai = cached;
      if (!ai.eligible && !force && config.checkEligibility !== false) return {ineligible: true, note: ai.eligibility_note || '', usd: 0, ...verdictFields({ai})};
      const byAI = new Set(ai.answers.map(a => a.field));
      answers = [...ai.answers.map(a => ({...a, source: 'Claude (on the page)'})), ...answers.filter(a => !byAI.has(a.field))];
    } else if (open.length) {
      // The fields your details and CV answer are filled at once; Claude's answers fill a second pass when they come, as after a kit (owner, 11 Oct 2026:
      // "fill them at once and let the AI fill the rest"; a "not eligible" answer then keeps what is filled and says so).
      const askedEarly = takeEarly(tab.id, tab.url, open);   // asked beside the page-kind ask (askEarly), when it was for these same questions
      debug.earlyAnswers = !!askedEarly;
      pendingAI = askedEarly ? askedEarly.then(found => found || askAnswers(tab, config, open)) : askAnswers(tab, config, open);
      pendingAI.catch(() => {});
      later = open;
    }
  }
  onStep('Filling the form…');
  if (!debug.form) {  // filled from the kit: still record the form as read, for the run log
    const seen = await inPage(tab.id, () => window.__jobPilottoDescribeForm()).catch(() => []);
    debug.form = (seen || []).map(({field, label, type, required, filled, legal, options}) =>
      ({field, label, type, required, filled, legal, options: (options || []).slice(0, 30)}));
  }
  // Learned notes (🧠 Form knowledge) answer fields nothing else did, matched by label and site.
  const host = new URL(tab.url).hostname, company = (tab.url.match(/\/([\w-]+)\/jobs\//) || [])[1] || '';
  const answered = new Set(answers.map(a => a.field));
  const labelKey = text => String(text || '').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
  for (const field of debug.form || []) {
    if (answered.has(field.field) || field.filled || field.legal) continue;
    const note = (me?.knowledge || []).find(n => labelKey(n.field) === labelKey(field.label) &&
      (n.scope === 'any' || host.includes(n.scope) || n.scope.toLowerCase() === company));
    if (note) { answers.push({field: field.field, value: note.value, source: 'form knowledge', question: field.label}); answered.add(field.field); }
  }
  // A menu answer this site showed under another wording is given as the menu's own choice (desktop/lib/menu-choices.js: "+41" -> "Suisse").
  // Every pass's answers: the first ones here, Claude's later ones below.
  const useRemembered = list => {
    for (const answer of list) {
      const field = (debug.form || []).find(f => f.field === answer.field);
      const known = field && (me?.menuChoices || []).find(c => (host === c.host || host.endsWith(`.${c.host}`)) && labelKey(c.label) === labelKey(field.label) && labelKey(c.value) === labelKey(answer.value));
      if (known) Object.assign(answer, {value: known.choice, note: 'the choice this site\'s menu uses for it'});
    }
    return list;
  };
  useRemembered(answers);
  debug.answers = answers.map(({field, question, value, source, confidence, note}) => ({field, question, value, source, confidence, note}));
  debug.details = {coverLetterFile: !!me?.coverLetterFile, fields: Object.keys(me?.contact || {}), source: me?.contactSource || null, cv: me?.resume?.name || null, tailoredCv: !!me?.resume?.tailored};
  if (me?.contactError) debug.errors.push(`your details: ${me.contactError}`);
  const letter = coverLetter || ai?.cover_letter || '';
  const summary = await pageStarted(tab.id).then(() => inPage(tab.id, (list, profile, resume, letter, consents) => window.__jobPilottoExtensionFill(list, profile, resume, letter, consents),   // pageStarted: a start just now cleared the page's own Stop first (stop.js startTab)
    [answers, me?.contact || config.profile || {}, withLetterFile(me?.resume || config.resume || null, me?.coverLetterFile), letter, (me?.acceptConsents ?? config.acceptConsents) !== false]));
  // The page fill threw or returned nothing (a control it did not expect, or the page went away): said as it is, never read as a result (page/fill.js reports the error and where).
  if (!summary || summary.error) {
    const why = summary?.error || 'the fill failed on this page: the page returned nothing';
    if (!summary?.stopped && !isStopped()) decide('fill', 'the page fill failed', {error: String(why).slice(0, 200), at: String(summary?.pageError || '').slice(0, 300)}).catch(() => {});
    return {error: why, pageError: summary?.pageError || '', filled: 0, trace: [], todo: [], usd: 0};
  }
  if (summary?.held) return {held: true, layer: await layerOnTop(tab.id), note: HELD, usd: 0};   // a layer opened mid-fill and nothing closed it: nothing more is typed (page/guard-gate.js)
  const armedLeft = () => inPage(tab.id, () => window.__jobPilottoArmedCount?.() || 0);
  step('filled the page');
  if (pendingAI) decide('fill', 'first fields filled', {fields: summary?.filled || 0, waiting: later.length}).catch(() => {});   // before Claude's answers
  // Your details couldn't be read (Notion failed and there was no earlier copy): say so on the fields it left,
  // not "no answer", and in the panel, so Fill again is the obvious next step.
  if (me?.contactError && !Object.keys(me.contact || {}).length && summary) {
    const why = `your details couldn't be read (${me.contactError}): Fill again in a minute`;
    for (const row of summary.trace || []) if (row.reason === 'no answer in the kit, Profile or your details' && /name|e-?mail|phone|country|city|location/i.test(row.label)) row.reason = why;
    summary.todo = [`Your name and email weren't filled: ${why}`, ...(summary.todo || [])];
  }
  const clickDropdowns = config.clickDropdowns !== false;  // on unless turned off in Settings
  // An armed menu no trusted click reached keeps its page reason until here: say so, with why (menu-reason.js "dropdown not clicked").
  const notClicked = why => { for (const row of summary.trace || []) if (row.reason === OLD_MENU_REASON) row.reason = `dropdown not clicked: ${why}`; };
  if (!clickDropdowns) notClicked('"Fill drop-down menus too" is off');
  if (!clickDropdowns && await armedLeft()) {
    // Say why they're left, and how to have them chosen automatically.
    summary.todo = [...(summary.todo || []), 'Tip: turn on "Fill drop-down menus too" in the extension Settings to have these chosen for you'];
  }
  if (clickDropdowns) {
    onStep('Choosing the drop-down answers…');
    try {
      const combos = await clickCombos(tab.id);
      debug.dropdowns = combos;
      step('clicked dropdowns');
      const picked = combos.filter(c => c.picked).length;
      applyCombos(summary.trace, combos);   // what the pick observed (menu-reason.js)
      notClicked('the pick never reached it');
      if (picked) {
        summary.filled = (summary.filled || 0) + picked;
        summary.todo = (summary.todo || []).filter(item => !/highlighted dropdown/.test(item));
        const left = await inPage(tab.id, () => window.__jobPilottoArmedCount());
        if (left) summary.todo.unshift(`Click the ${left} highlighted dropdown(s); each picks its answer when opened`);
      }
    } catch (error) {
      debug.errors.push(`dropdowns: ${error.message}`);
      notClicked('the click failed');
      summary.todo = [`Drop-downs not chosen automatically (${plainWhy(error)}): click each highlighted one`, ...(summary.todo || [])];
    }
  }
  // With a kit: the questions it doesn't cover, answered by Claude now that the rest is already on the page.
  if (later.length && useAI) {
    onStep(withKit ? `AI is answering ${later.length} more question${later.length === 1 ? '' : 's'}…`
      : `AI is answering ${later.length} question${later.length === 1 ? '' : 's'} and checking you're eligible (usually 10–30 s)…`);
    try {
      ai = answersOrDropped(pendingAI ? await pendingAI : await askAnswers(tab, config, later));
      step('AI answered (after the fill)');
      if (!withKit) {
        await chrome.storage.session.set({[cacheKey(tab)]: {url: tab.url.split('#')[0], ai, test: !!config.testMode, asked: later.map(f => f.field)}});
        // Settings → "Check eligibility before filling" off (for testing): fill regardless. Not eligible: what is filled stays (owner, 11 Oct 2026), the rest waits;
        // the first pass's rows go with the stop, so its fields are logged as on every other end (the smoke counted them as none, 11 Oct 2026).
        if (!ai.eligible && !force && config.checkEligibility !== false) return {...summary, ineligible: true, partly: true, note: ai.eligibility_note || '', usd: ai.usd, ...verdictFields({ai})};
      }
      const extra = useRemembered(ai.answers.filter(a => later.some(f => f.field === a.field)).map(a => ({...a, question: a.question || later.find(f => f.field === a.field)?.label, source: 'Claude (on the page)'})));
      if (extra.length) {
        // Only Claude's answers this time: no contact details or CV again (they're in already).
        const more = await inPage(tab.id, (list, letter, consents) => window.__jobPilottoExtensionFill(list, {}, null, letter, consents),
          [extra, withKit ? '' : coverLetter || ai?.cover_letter || '', (me?.acceptConsents ?? config.acceptConsents) !== false]);
        if (more?.held) return {held: true, layer: await layerOnTop(tab.id), note: HELD, usd: 0};   // the same, in the later pass
        const reach = more?.reach; if (reach) decide('fill', 'answers reached rows', reach).catch(() => {});   // counts only: asked, matched an id, matched by question, none (a page that re-created its controls)
        let clickError = '';
        const combos = config.clickDropdowns !== false ? await clickCombos(tab.id).catch(error => { clickError = plainWhy(error); return []; }) : [];
        debug.laterDropdowns = combos;
        summary.filled = (summary.filled || 0) + (more?.filled || 0) + combos.filter(c => c.picked).length;
        summary.unfilledRequired = more?.unfilledRequired ?? summary.unfilledRequired;
        // Claude's rows from this pass win: its answers, and the questions it proposed an answer for (no source: shown, never typed; Coop, 9 Oct 2026:
        // dropped here, the first pass's "no answer" stayed, and the site counted a proposal as declined).
        summary.trace = [...(summary.trace || []), ...(more?.trace || []).filter(row => row.source === 'Claude (on the page)' || row.reason === PROPOSED || String(row.reason || '').startsWith(WRITTEN) || KIND_REASON.test(String(row.reason || '')))];
        applyCombos(summary.trace, combos);   // the later pass's menus too: the observed reason, not the page's old label
        notClicked(config.clickDropdowns === false ? '"Fill drop-down menus too" is off' : clickError ? `the click failed (${clickError})` : 'the pick never reached it');
        step('filled the AI\'s answers');
      }
    } catch (error) {
      if (error.dropped) debug.errors.push(`Claude (after the fill): ${error.message}`);   // not an AI failure: nothing to tell the person
      else { aiError = plainWhy(error); debug.errors.push(`Claude (after the fill): ${error.message}`); }
    }
  }
  // Fields left for a mechanical reason (a widget the extension couldn't operate): a scrubbed HTML snapshot of each,
  // for the fill-failure report's replay test (page/snapshot.js). Your details are passed only to hide them.
  const snapshots = await inPage(tab.id, (targets, secrets) => window.__jobPilottoSnapshots?.(targets, secrets) || {},
    [(summary.trace || []).filter(row => MECHANICAL.some(reason => String(row.reason || '').startsWith(reason))).map(row =>
      ({label: row.label, field: (debug.form || []).find(f => f.label === row.label)?.field || ''})),
    Object.values(me?.contact || config.profile || {}).filter(value => typeof value === 'string')]).catch(() => ({}));
  // A page's own autofill after an upload can empty boxes we typed: they are typed again, once (now, and while the page is watched for 15 s) (page/browser-form-fastpath.js).
  const retyped = await inPage(tab.id, () => window.__jobPilottoRetypeWiped?.(15000) || 0).catch(() => 0);
  if (retyped) step(`typed ${retyped} box${retyped === 1 ? '' : 'es'} again that the page emptied`);
  // Rung 0 of the fill ladder: a text box that did not take its answer is typed again for real, one key at a time, and read back (extension/fill-verify.js); same debugger turn as the menus.
  const real = await debuggerTurn(() => typeNotTakenOnTab(tab.id)).catch(() => ({tried: 0, taken: 0}));
  if (real.tried) { step(`typed ${real.taken} of ${real.tried} box${real.tried === 1 ? '' : 'es'} again for real`); decide('fill', 'typed for real a box that did not take its answer', {tab: tab.id, tried: real.tried, taken: real.taken}).catch(() => {}); }
  // Every field's outcome as the page holds it once all passes are done (extension/trace-settle.js).
  const finalForm = await inPage(tab.id, () => window.__jobPilottoDescribeForm?.(true)).catch(() => null);   // settled: a real first choice is an answer
  const gaveUp = await inPage(tab.id, () => window.__jobPilottoRetypeGaveUp?.() || []).catch(() => []);
  // Rung 0 of the fill ladder: the one read of every control once the page settled (page/read-back.js), written on each control; the trace takes it, so it says what the panel says.
  const settleStart = Date.now(), readBack = (await inPage(tab.id, () => window.__jobPilottoReadBack?.pass() || []).catch(() => [])) || [];   // null: the page went away (a press during the fill)
  if (readBack.length) decide('fill', 'read back after the page settled', {...readBackCounts(readBack), ms: Date.now() - settleStart}).catch(() => {});   // ms: what the settle wait costs (spec budget: <= +1 s on a clean page)
  for (const spent of await inPage(tab.id, () => window.__jobPilottoAttempts?.drain() || []).catch(() => []) || []) { decide('fill', 'a control used its tries: left for the person', {kind: spent.kind, tries: spent.tries}).catch(() => {}); controlDoor({rung: 0, signal: 'stalled', reason: 'tries', tried: spent.tries}, decide); }   // once per control (page/attempts.js)
  const tries = await inPage(tab.id, () => window.__jobPilottoAttempts?.summary() || null).catch(() => null);
  if (tries && Object.keys(tries.byTries).length) decide('fill', 'tries per control', tries).catch(() => {});   // measures the attempt log's cap (spec amendment 1): counts only
  const lastRead = (await climbFill(tab, config, {turn: debuggerTurn}).catch(() => null))?.readBack || readBack;   // the fill ladder's repair (test switch only) and the read after a late retype (ladder/fill-climb.js)
  summary.trace = settleTrace(summary.trace || [], Array.isArray(finalForm) ? finalForm : [], gaveUp, Array.isArray(lastRead) ? lastRead : [], (me?.resume || config.resume)?.name || '');
  // One anonymous record of this fill for the learning digest (fill-card.js: counts and fixed words), and its id on the page so
  // the panel can add, at Submit, what you answered yourself.
  summary.card = fillCard({id: crypto.randomUUID(), trace: summary.trace || [], form: debug.form || [],
    sent: [...(debug.sentToClaude || []), ...later.map(f => f.field)], ai, aiError, useAI, kit: withKit, version: debug.version, startedAt});
  await markCauses(inPage, tab.id, summary.card);   // each left control carries its cause for the panel (ladder/control-marks.js)
  // Only into the page this fill filled: a tab that moved on (the sign-up's form) shows another page, whose own fill writes its own mark (extension/one-fill.js).
  if (stillOnPage(tab.url, await addressNow(tab.id))) await inPage(tab.id, id => { document.documentElement.dataset.jobpilottoFill = id; }, [summary.card.id]).catch(() => {});
  event('fill-done', {filled: summary.filled || 0, left: (summary.todo || []).length});
  // One row in 🎏 Job Apply — Agent Runs (Agent = Extension), comparable with the agent runs there.
  const runBody = {url: job, started: startedAt.toISOString(),
    ended: new Date().toISOString(), fields: summary.filled || 0, unfilled: summary.unfilledRequired || 0, usd: ai?.usd || 0, billed_to: ai?.billed_to || '',
    kit: withKit, todo: (summary.todo || []).slice(0, 8), trace: summary.trace || [], snapshots: snapshots || {}, debug: {...debug, aiUsd: ai?.usd || 0}};
  const logged = apiFor(tab.id, config, '/extension/run', {method: 'POST', body: JSON.stringify(runBody)})
    .then(done => { if (done?.url) chrome.storage.session.set({[`run:${tab.id}`]: done.url}); return done; }).catch(() => null);
  // The record was sent: a box the page empties after this and the retype types again updates it once (ladder/record-update.js): the log line, and that run's row when the store gave an id.
  let sentTrace = runBody.trace;
  armRecordUpdate(tab.id, {page: tab.url, trace: sentTrace, resumeName: (me?.resume || config.resume)?.name || '', inPage, decide, onUpdate: async next => {
    const id = (await logged)?.id, before = sentTrace; sentTrace = next;
    if (id) apiFor(tab.id, config, '/extension/run', {method: 'POST', body: JSON.stringify(runUpdateBody({...runBody, snapshots: {}}, before, next, String(id)))}).catch(() => {});
  }});
  return {...summary, usd: ai?.usd, aiError, coverLetter: ai?.cover_letter, ...verdictFields({ai, askedAnyway, kit: withKit || kitSkips, checkOff: config.checkEligibility === false})};
}
