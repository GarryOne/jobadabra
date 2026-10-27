// The AI's veto on an APPLICATION form's "Ready to submit" (owner, 8 Oct 2026: the account page's "ready?" judgment, ported). The panel counts required boxes by HTML; when that count says
// everything is filled, the AI reads the page's real state (a consent that is a link, a custom picklist, an error shown) and may say "needs you: <label>"; the worker then sets the page's
// data-jobpilotto-needs, which the panel shows instead of "Ready". It only ever VETOES a ready claim: it never accepts a consent, never presses Submit, and without AI nothing changes.
// The answer is kept per tab for the sketch it was given (asked again only when the page changed), one look at a time. Guards: worker/test/form-ready.test.js, desktop/test/form-judge.test.js.
import {apiFor, gaveUpOn, settings} from './flow.js';
import {decide} from './log.js';
import {flagAccount} from './account-fill.js';
import {sketchOf} from './judge-sketch.js';
import {pressNext} from './next-step.js';
import {onTop} from './on-top.js';
import {retryRefusedFormats} from './format-retry.js';
import {endSilence, handedToPerson} from './ladder/silence.js';

// What the panel says for each kind of block the AI named (fixed words of the product, not a reading of the page).
const BLOCKED_WORDS = {dialog: 'a dialog is open over the form', error: 'the site shows an error about what was entered', overlay: 'something is covering the form', gone: 'the application is no longer on the page'};
export const blockedWords = kind => BLOCKED_WORDS[kind] || BLOCKED_WORDS.overlay;

// A blocked page is judged once more a little later (11 Oct 2026, Louis Vuitton: a "wait, importing" dialog covered the form for a few seconds and then went): a page that recovers is not a failure, one that does not stays blocked.
export const timing = {recheckMs: 8000};
// A page the judge never answers (no AI, an answer that is not one of the fixed words) is asked a few times, then left to the panel's own count until the page changes: every look
// before this asked again (beta 17 Oct 2026, a sign-in form ending at the person: 595 account-judge calls in 5 minutes, one a second, to the end of the run). Guard: worker/test/form-ready.test.js.
export const MAX_NO_ANSWER = 3;
const looking = new Set(), judged = new Map(), unanswered = new Map();
// The structure says the form is ready: every counted required field is filled, on an application page (not an account page).
export const claimsReady = payload => !!payload && !payload.account && Number(payload.total) > 0 && Number(payload.left) === 0;

// world 'MAIN': the page's own world, where the fill kit's field-name reader lives (the judge's sketch and its layer name fields as the panel does).
const run = (tab, frameId, func, args = [], world) => chrome.scripting.executeScript({target: {tabId: tab.id, frameIds: [frameId ?? 0]}, func, args, ...(world ? {world} : {})}).then(rows => rows?.[0]?.result).catch(() => undefined);

// The fill of this tab still running (fill-flow.js writes <html data-jobpilotto-fill> on the top page): the page is half filled while the AI's answers are on their way, so the panel's count can
// look ready over boxes not written yet (12 Oct 2026, HelloFresh in the app: "needs First Name*" 0.6 s after the first fields, over a sketch with every box empty; the stale flag stayed and the
// phone retry never ran). The panel's claim is not judged then: the fill's own end judges the settled page (formNext). Guard: worker/test/form-ready.test.js, recorded case judge-waits-for-fill-1.
const fillRunning = tab => run(tab, 0, () => { try { return JSON.parse(document.documentElement?.dataset.jobpilottoFill || '{}').state === 'running'; } catch { return false; } }).then(Boolean);

export async function formReady(tab, frameId, payload) {
  if (!claimsReady(payload)) return;
  if (await fillRunning(tab)) return;
  return askForm(tab, frameId);
}

// After a fill, whatever the panel's count says (owner, 9 Oct 2026: the CV was in, the step was done, nothing asked what comes next because the count of HTML-required boxes was not "ready"):
// the AI looks at the page's real state once per page state, and a middle step's own next button is pressed (next-step.js).
export const formNext = (tab, frameId = 0) => askForm(tab, frameId);
/**
 * Forget this tab's last page judgment, so the next formNext asks the AI again even when the page looks as it did.
 * Why (#2221, owner 27 Oct 2026: "clicking check again does nothing"): the panel's Check again and Fill again want a fresh look; a "needs you" the person has dealt with is cleared.
 * @param {number} tabId the tab whose judgment is dropped
 * @returns {void} never throws (a tab never judged is a no-op)
 */
export const forgetJudged = tabId => { judged.delete(tabId); unanswered.delete(tabId); };

// The fill ladder's fill_verify in SHADOW (spec docs/superpowers/specs/2026-10-12-fill-ladder.md, PR 3; owner, 12 Oct 2026: one zoo pass + one pool pass, then repair goes live): asked
// on the same settled sketch when a control did not keep what the fill gave it (match "no"), or the judge names as missing a control the fill's match says it kept. Its verdicts are only
// logged; nothing acts on them. Not awaited: the panel never waits for it. Guard: worker/test/form-ready.test.js.
// The kinds of value that are contact details: one that sits in a sentence asking something (a phone number in a yes/no question) is asked about too, though the box holds it (13 Oct 2026).
const CONTACT_KINDS = ['phone', 'email_shaped', 'dial_code'];
const asksQuestion = label => { const words = String(label || '').replace(/[\s*]+$/, '').split(/\s+/).filter(Boolean); return words.length >= 4 && /[?？]$/.test(words.at(-1)) || words.length > 8; };
export const wantsFillCheck = (sketch, answer) => (sketch?.controls || []).some(item => item.match === 'no' || item.match === 'yes' && CONTACT_KINDS.includes(item.answer) && asksQuestion(item.label))
  || (!!answer?.needs && (sketch?.controls || []).some(item => item.match === 'yes' && item.label === answer.needs));
function shadowCheck(tab, config, sketch, answer, host) {
  if (!wantsFillCheck(sketch, answer)) return;
  apiFor(tab.id, config, '/extension/account-judge', {method: 'POST', body: JSON.stringify({phase: 'fill', sketch})}).then(found => {
    if (found?.counts) decide('fill', 'fill check (shadow)', {host, ...found.counts, contradiction: !!answer?.needs});
  }).catch(() => {});
}

async function askForm(tab, frameId, again = false) {
  if (looking.has(tab.id)) return;
  looking.add(tab.id);
  try {
    const config = await settings();
    if (config.workerUrl && !config.workerUrl.startsWith('http://127.0.0.1')) return;   // your own Worker: no app to ask
    const sketch = await sketchOf(tab.id, frameId, 'MAIN');   // with the one control reader loaded first (judge-sketch.js)
    if (!sketch) return;
    sketch.onTop = await run(tab, frameId, onTop, [], 'MAIN') || null;   // what sits on top of the form, by structure (on-top.js)
    const sig = JSON.stringify([sketch.controls, sketch.buttons, sketch.texts, sketch.frames, sketch.onTop]);
    if (judged.get(tab.id) === sig) return;   // the page is as it was when it was judged: the flag stays as it is
    const silent = unanswered.get(tab.id);
    if (silent?.sig === sig && silent.n >= MAX_NO_ANSWER) return;   // asked enough times without an answer: the same page is not asked again
    const answer = await apiFor(tab.id, config, '/extension/account-judge', {method: 'POST', body: JSON.stringify({phase: 'form', sketch})}).catch(() => null);
    if (!answer?.answer) { unanswered.set(tab.id, {sig, n: silent?.sig === sig ? silent.n + 1 : 1}); return; }   // no AI or no answer: the panel keeps its own count
    unanswered.delete(tab.id);
    judged.set(tab.id, sig);
    let host = ''; try { host = new URL(tab.url).hostname; } catch { /* no address */ }
    decide('panel', `application form ready?: ${answer.answer}`, {host, step: answer.step || '', ...(answer.answer === 'blocked' ? {blocked: answer.blockedKind || 'overlay'} : {}), ...(answer.needs ? {needs: answer.needs.slice(0, 60), seen: sketch.controls.filter(item => item.required).map(item => `${item.type}:${item.state}`).join(',').slice(0, 120)} : {})});   // seen: what the AI was shown of the required controls (types and states, never labels or values)
    shadowCheck(tab, config, sketch, answer, host);   // the fill ladder's fill_verify, logged only (below)
    if (handedToPerson(answer)) endSilence(tab.id);   // handed to the person: Submit or their choice is next (ladder/silence.js)
    await run(tab, frameId, flagAccount, [answer.answer === 'blocked' ? blockedWords(answer.blockedKind) : answer.answer === 'needs_person' ? answer.needs || '' : null]);
    if (answer.answer === 'blocked') decide('fill', `the page is blocked after the fill: ${answer.blockedKind || 'overlay'}`, {host});   // the fill log and the smoke verdict read this line
    // The site's own error about what was entered, on a phone number: it is typed again in another writing the AI names from the error text (format-retry.js, at most twice), then the page is judged anew.
    if (answer.answer === 'blocked' && answer.blockedKind === 'error' && await retryRefusedFormats(tab, frameId, config)) { setTimeout(() => { judged.delete(tab.id); askForm(tab, frameId, again).catch(() => {}); }, 2500); return; }
    if (answer.answer === 'blocked' && !again) setTimeout(() => { judged.delete(tab.id); askForm(tab, frameId, true).catch(() => {}); }, timing.recheckMs);
    await pressNext(tab, frameId, answer, sig);   // a multi-step form's next step, when the person turned it on (next-step.js)
  } finally { looking.delete(tab.id); }
}

// A fill that gave up on a REQUIRED control it can never settle (a suggest-only combobox whose list never offers a match) ends at the person, whatever the AI judge says or whether it answers
// (14 Oct 2026, the combo stall's required variant: the run had no end, "dead end: silent" fired 31 s after the fill): the same hand-off as the judge's needs_person (the page flag
// names the field, the silent clock ends). `trace`: the fill's own rows. -> the labels handed over. Guard: worker/test/form-ready.test.js.
export async function handGivenUpToPerson(tab, frameId, trace) {
  const gaveUp = new Set(gaveUpOn(tab.id));
  const owed = [...new Set((trace || []).filter(row => row.required && row.outcome === 'left' && gaveUp.has(row.label)).map(row => String(row.label).replace(/\s+/g, ' ').trim()).filter(Boolean))];
  if (!owed.length) return [];
  let host = ''; try { host = new URL(tab.url).hostname; } catch { /* no address */ }
  decide('panel', 'a required field the fill gave up on: handed to the person', {host, left: owed.length, needs: owed[0].slice(0, 60)});
  endSilence(tab.id);
  await run(tab, frameId, flagAccount, [owed.slice(0, 3).join(', ')]);
  return owed;
}
