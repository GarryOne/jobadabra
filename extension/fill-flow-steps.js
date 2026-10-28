// The fill flow's Apply, ladder, handover and after-fill steps; tab memories stay owned by fill-flow.js.
// Invariants (flow core: read before editing; changing one is the owner's call, said in the commit; each names the test that guards it):
//  1. Apply is pressed once per tab and page; only a reload or the person's "Apply on this page" clears that, never a press itself (dede94a, 6065c87; desktop/e2e/test/real-extension.test.mjs).
//  2. A popup is closed before the page is read, and a link that leaves the page is never pressed (fdd9638; worker/test/visit-consent.test.js, worker/test/popup-page.test.js).
//  3. A fill that put nothing in climbs the closer-look ladder, then reports 'incomplete', kept until something is filled (c1a2fcc; desktop/test/session-flow.test.js).
//  4. After a fill the AI is asked what the page needs next; a middle step's Next is pressed under the Submit floors, Submit never (worker/test/form-ready.test.js).
import {apiFor, forgetGivenUp, settings} from './flow.js';
import {decide} from './log.js';
import {laterLookIsForm} from './later-look.js';
import {noteRole} from './account.js';
import {closerLook, lastLook} from './ladder/rung4-picture.js';
import {formNext, handGivenUpToPerson} from './form-ready.js';
import {accountStep} from './account-step.js';
import {applyPressed, moveTab} from './tabs.js';
import {noJobPage} from './page-kind-final.js';
import {markPage} from './page-mark.js';
import {pageStill} from './page-still.js';
import {restartFromPosting} from './restart-from-posting.js';
import {applyPhrases, pressApply} from './apply-press.js';
import {noEffectOf, noteNoEffect} from './no-effect.js';
import {clickTrace} from './ladder/press-why.js';
import {startRoute} from './start-route.js';
import {emailReport} from './ladder/outcomes.js';
import {closedReport} from './ladder/site-broken.js';
import {noteProgress} from './ladder/progress.js';
import {blindOn, blindOr, claimFrame, climbOnStall, confirmedBody, controlsOf, frameSrcOf, notePressed, otherReport, toldReport, verifiedBody} from './ladder/climb.js';

// Press Apply once on a posting, then follow that attempt's result.
export async function pressPosting(step) {
  const {tab, key, kind, role, host} = step, {triedApply} = step.flow;
  // Tier 2: the posting before its form. Press its "Apply" button once (by rule), then wait for the form.
  let pressed = false, buttonsSeen = [], lookAfterPress = null;   // lookAfterPress: the fresh page-kind answer asked after an Apply that brought no form (the frame it lists may have come with the press)
  Object.assign(step, {pressed, buttonsSeen, lookAfterPress});
  if (role === 'no-form' && !triedApply.has(key)) {
    triedApply.add(key);
    // The shared phrases, and the button the page-kind AI named on this page (any language; already checked against the page and the schema).
    const phrases = [...await applyPhrases(), ...(kind?.applyButton ? [{key: 'apply_button', phrase: kind.applyButton}] : [])];
    applyPressed.set(tab.id, {at: Date.now(), url: tab.url});   // before the click: the site opens its new tab during it (same-tab.js)
    notePressed(tab.id, confirmedBody(kind, tab.url, controlsOf(tab.id), 'pressed'));   // before the click too: the page it opens can be judged before this press's own wait ends (ladder/climb.js)
    const attempt = await pressApply(tab.id, phrases, '', kind?.applyButton || '', noEffectOf(key));
    if (!attempt.pressed) { applyPressed.delete(tab.id); notePressed(tab.id, null); }
    const label = attempt.pressed;
    buttonsSeen = attempt.buttons;
    if (!label) decide('fill', 'no Apply button to press', {host, listed: attempt.buttons?.length ?? 0, named: !!kind?.applyButton, ...(attempt.why || {})});   // why nothing was pressed (Hornbach, 10 Oct 2026: no line said); the named control's flags: found, visible, enabled, submits, href kinds, pickable
    step.buttonsSeen = buttonsSeen;
    if (label) return afterApply(step, attempt);
  }
  return true;
}

// Wait for Apply and keep its navigation, learning and no-effect order.
async function afterApply(step, attempt) {
  const {tab, key, counts, host} = step, {started, formAfterPress, reportFlow} = step.flow;
  const label = attempt.pressed;
  step.pressed = true;
  decide('fill', 'pressed the Apply button', {host, label, tag: attempt.tag, aimed: attempt.aimed, sameTab: attempt.same});   // sameTab: a link/form aimed at a new tab, pointed at this one
  const after = await formAfterPress(tab.id, tab.url, 8000, counts);
  decide('fill', `after the press: ${after === 'navigated' ? 'the page moved' : after ? 'a form came' : 'no form came'}`, {host, label, ...(after ? {} : await clickTrace(tab.id))});   // what the press did (Aldi, 10 Oct 2026: no line said)
  if (attempt.via) reportFlow(tab, null, {aliasUse: [{phrase: attempt.via, ok: after !== null}]});   // did a phrase from the service open the form?
  if (after === 'navigated') { started.delete(key); return false; }   // the next page decides for itself (onUpdated); if it takes the fill, this press is confirmed (notePressed above)
  notePressed(tab.id, null);   // no other page: a form here is confirmed just below, no form is nothing
  if (after) await rememberPressedForm(step);
  else if (!await routeAfterApply(step, label)) return false;
  return true;
}

// Keep the proof only after the Apply press has brought a form.
async function rememberPressedForm(step) {
  const {tab, kind} = step;
  let {role} = step;
  role = 'form'; await noteRole(tab.id, tab.url, role); const proof = verifiedBody(kind, tab.url, controlsOf(tab.id)) || confirmedBody(kind, tab.url, controlsOf(tab.id), 'pressed'); if (proof) apiFor(tab.id, await settings(), '/extension/page-kind', {method: 'POST', body: JSON.stringify(proof)}).catch(() => {});   // the press led to a form: a digest's answer may be kept, the fast tier's is counted (ladder/learning.js)
  step.role = role;
}

// Try the manual route and retain the newer form verdict after a dead Apply.
async function routeAfterApply(step, label) {
  const {tab, key, counts, host} = step;
  const {started, formAfterPress, askKind, forgetKind} = step.flow;
  let {role, kind, pressed, lookAfterPress} = step;
  noteNoEffect(key, label);   // pressed, nothing came: never pressed again on this page, and the AI's next look is told so (no-effect.js)
  // No form and the page did not move: it may be a step that offers several ways to start (Workday's dialog). The AI names the route of its button; only the manual one is pressed (start-route.js).
  // A look that names the form frame is the way on: no route is pressed ahead of it (15 Oct 2026: a "here" link to a PDF went first, the frame it named was never opened).
  const chosen = await startRoute(key, {ask: async () => { lookAfterPress = await askKind(tab, {fresh: true}); return Number.isInteger(lookAfterPress?.form_frame) && lookAfterPress.form_frame >= 0 && frameSrcOf(tab.id, lookAfterPress.form_frame) ? null : lookAfterPress; }, press: async routePhrases => {
    applyPressed.set(tab.id, {at: Date.now(), url: tab.url});
    const next = await pressApply(tab.id, routePhrases, routePhrases[0]?.phrase || '', '', noEffectOf(key));
    if (!next.pressed) applyPressed.delete(tab.id);
    return next;
  }});
  if (chosen.route) decide('fill', chosen.pressed ? 'pressed the start route: manual' : `start route not pressed: ${chosen.route}`, {host, route: chosen.route, label: chosen.pressed});
  if (chosen.pressed) {
    const afterRoute = await formAfterPress(tab.id, tab.url, 8000, counts);
    if (afterRoute === 'navigated') { started.delete(key); return false; }
    if (afterRoute) { role = 'form'; pressed = true; await noteRole(tab.id, tab.url, role); } else noteNoEffect(key, chosen.pressed);
  }
  // The look after the press says this page IS the form, as sure as the first answer: filled, never handed over as a bot check (later-look.js).
  if (laterLookIsForm(kind, lookAfterPress)) {   // also after a form came by the route: the later look is the newer answer
    decide('fill', 'a later look says this page is the form: filled', {host, first: kind?.kind || '', confidence: lookAfterPress.confidence});
    await forgetKind(tab, kind, 'a later look says form'); kind = lookAfterPress; role = 'form'; await noteRole(tab.id, tab.url, role);
  }
  Object.assign(step, {role, kind, pressed, lookAfterPress});
  return true;
}

// Keep the original field-based correction and mark after the Apply attempt.
export async function correctPosting(step) {
  const {tab, kind, pressed, ruled, host} = step, {forgetKind} = step.flow;
  let {role} = step;
  // Self-correction: called a posting, but there was no Apply to press and the page has an application form's fields: it is the form.
  // Never for an "other", at any confidence: fields do not make a page a job page (13 Oct 2026, the owner's Chrome: a pull request was filled); the AI's answer stands, a weak one is asked again next visit (page-kind-final.js).
  if (kind?.role === 'no-form' && !pressed && ruled === 'form') {
    if (noJobPage(kind)) decide('fill', 'the AI says this is no job page: its fields do not make it a form', {host, confidence: kind.confidence});
    else { await forgetKind(tab, kind, 'a posting with no Apply but a form\'s fields'); role = 'form'; await noteRole(tab.id, tab.url, role); }
  }
  await markPage(tab.id, role, pressed, kind, {working: true});   // after the Apply press: the form came (cleared) or is opening; the climbs below still work
  step.role = role;
}

// The application form is inside a frame of this page (Datadog, 10 Oct 2026): the page-kind AI named it by index; its stored address is opened in this same tab, https only, once per tab and page.
// The numbered digest names a frame too (rung 2 unsure, 14 Oct 2026: a posting with its form in a frame got no frame from the unsure rung): the same opening, from the answer that carries it.
// Open one AI-named form frame in this tab under the existing frame floors.
export async function openFormFrame(step, answer) {
  const {tab, key, role, host} = step, {started} = step.flow;
  if (role !== 'no-form' || !Number.isInteger(answer?.form_frame) || answer.form_frame < 0) return false;
  const src = frameSrcOf(tab.id, answer.form_frame);
  if (!src || !claimFrame(key)) return false;
  decide('fill', 'opening the application form frame as the page', {host, frame: new URL(src).hostname, by: answer.by || 'ai'});
  await moveTab(tab.id, src); started.delete(key); return true;
}

// Try named form frames and the stalled page digest before the closer look.
export async function climbPosting(step) {
  const {tab, key, kind, lookAfterPress, gen} = step;
  const {askKind, late} = step.flow;
  let {role, pressed} = step;
  if (await openFormFrame(step, lookAfterPress) || await openFormFrame(step, kind)) return false;   // the look after the press first: the form frame often loads only after Apply (14 Oct 2026)
  // Nothing to press and no form: the numbered digest looks once (ladder/climb.js). It may name a control the sketch lost (Aldi, 10 Oct 2026: 20 menu links ahead of "Postuler"): pressed through the same floors as any Apply button.
  let stall = null;
  if (role === 'no-form' && kind?.botCheck !== true && !emailReport(kind) && !toldReport(kind)) {
    stall = await climbOnStall(tab, askKind, key, kind);
    if (late(tab, gen, 'stall climb')) return false;
    if (await openFormFrame(step, stall)) return false;
    if (stall?.applyButton) {
      Object.assign(step, {role, pressed});
      if (!await pressDigest(step, stall)) return false;
      ({role, pressed} = step);
    }
  }
  Object.assign(step, {role, pressed, stall});
  return true;
}

// Press the digest control and check whether its form arrived.
async function pressDigest(step, stall) {
  const {tab, key, counts, host} = step, {started, formAfterPress} = step.flow;
  let {role, pressed} = step;
  applyPressed.set(tab.id, {at: Date.now(), url: tab.url});
  const attempt = await pressApply(tab.id, [{key: 'apply_button', phrase: stall.applyButton}], stall.applyButton, '', noEffectOf(key));
  if (!attempt.pressed) applyPressed.delete(tab.id);
  else {
    decide('fill', 'pressed the control the digest named', {host, label: attempt.pressed});
    const afterDigest = await formAfterPress(tab.id, tab.url, 8000, counts);
    if (afterDigest === 'navigated') { started.delete(key); return false; }
    if (afterDigest) { role = 'form'; pressed = true; await noteRole(tab.id, tab.url, role); } else noteNoEffect(key, attempt.pressed);
  }
  Object.assign(step, {role, pressed});
  return true;
}

// Ask the closer look when the posting ladder ended at the person.
export async function lookAtPosting(step) {
  const {tab, key, counts, kind, stall} = step, {started, formAfterPress, blindVerdict} = step.flow;
  let {role, pressed} = step;
  // The ladder ended at the person with nothing to say (the digest answered nothing usable): the picture rung looks once at the posting, from the sketch alone. It may press ONE control the page lists that the AI
  // calls Apply and the Apply floor accepts (desktop/lib/ladder/rung4-picture.js vetPage); the press is the next-step press, which never presses a control that submits.
  if (role === 'no-form' && kind?.botCheck !== true && !emailReport(stall || kind) && !toldReport(stall || kind) && otherReport(stall || kind, tab.id)) {
    // A blind page (the digest said the way on is not in its list) is looked at with its PICTURE, in test runs only (the harness's ladderAct switch: the CI pool; owner, 13 Oct 2026, users keep it off);
    // the log says whether the picture confirmed the blind spot: the control it named led to a form, which the numbered list lacked.
    const blindLook = blindOn(tab.id) && (await settings().catch(() => null))?.ladderAct === true;
    const look = await closerLook(tab, 0, 'the ladder ended at the person', {kind: 'page', picture: blindLook}).catch(() => 'none');
    let led = false;
    if (look === 'click') {
      const afterLook = await formAfterPress(tab.id, tab.url, 8000, counts);
      if (afterLook === 'navigated') { blindVerdict(blindLook, look, true); started.delete(key); return false; }
      if (afterLook) { role = 'form'; pressed = true; led = true; await noteRole(tab.id, tab.url, role); }
    }
    blindVerdict(blindLook, look, led);
  }
  Object.assign(step, {role, pressed});
  return true;
}

// Finish a non-form page with its original watch, verdict and report.
export async function leavePage(step) {
  const {tab, jobUrl, role, kind, pressed, buttonsSeen, host} = step;
  const {deadEndHere, reportFlow, BOT_CHECK_NEED} = step.flow;
  if (!await watchPage(step)) return;
  const {botCheck} = step;
  const {said, email, told, closed, other} = nonFormReports(step);
  describeEnd(step, {botCheck, email, told, closed, other});
  if (other && await restartFromPosting(tab, jobUrl, {decide})) return;   // a broken page mid-application: from the posting again (restart-from-posting.js)
  if (other) apiFor(tab.id, await settings(), '/extension/page-kind', {method: 'POST', body: JSON.stringify({why: 'other', url: tab.url.split('#')[0], controls: controlsOf(tab.id)})}).catch(() => {});   // the shape is counted by the app (no text): the ladder ended at the person
  if (email || told || closed || other) deadEndHere(tab, jobUrl, host, (email || told || closed || other).why, (email || told || closed || other).needs, {role, rung: said?.rung, signal: blindOr(tab.id, said?.signal)});   // the address is the need: the card says where to send it
  else if (!(role === 'account' && kind?.accountStep)) deadEndHere(tab, jobUrl, host, role === 'account' ? 'account' : 'no-form', botCheck ? BOT_CHECK_NEED : '', {role, botCheck, pressed: !!pressed, rung: kind?.rung, signal: kind?.signal});   // tier 3: the app offers Apply with Claude; an account page the AI has a step for is the account step's (it reports when it cannot finish)
  reportFlow(tab, {role, pressed}, {buttons: pressed ? [] : buttonsSeen});
  return;
}

// Mark or watch a non-form page before writing its final state.
async function watchPage(step) {
  const {tab, jobUrl, gen, role, kind, counts, pressed} = step;
  const {progress, emptyShape, watchForFields, late, writeState} = step.flow;
  await progress(tab.id, '', '', 'your-turn');   // no fill here: the panel's "Starting…" ends now, not after its 20 s (owner, 9 Oct 2026: it spun on a sign-in page left to them)
  // A check that the visitor is human in front of the page (the page-kind AI's bot_check): the person solves it in this tab; the form is watched for two
  // minutes and filled once it shows (SmartRecruiters, 9 Oct 2026: the check was read as an empty page, "no form", and nobody was told).
  const botCheck = role === 'no-form' && kind?.botCheck === true;
  const watching = botCheck || (role === 'no-form' && counts && emptyShape(counts));   // judged while still empty, or a check: look again if fields come
  // No verdict while the flow still works (owner, 27 Oct 2026: "don't show a verdict" ... "IF the extension didn't stop thinking"): stopped and sure, the verdict now; a watch that
  // may judge the page again keeps "Reading this page…" and says the verdict only when it ends with no form (Greenhouse: "no application", then filled seconds later).
  await markPage(tab.id, role, pressed, kind, {working: !!watching});
  if (watching) watchForFields(tab, jobUrl, undefined, botCheck ? 60 : 10, counts?.frameHosts || [], () => markPage(tab.id, role, pressed, kind)).catch(() => markPage(tab.id, role, pressed, kind));
  if (late(tab, gen, 'page state')) return false;   // a stale read never writes the page's state (worker/test/read-generation.test.js)
  await writeState(tab.id, {state: role});
  step.botCheck = botCheck;
  return true;
}

// Return the page's existing email, instruction, closed or other reports.
function nonFormReports(step) {
  const {tab, role, kind, counts, stall} = step;
  const said = stall || kind;   // the digest's answer at a stall, else what the page-kind said
  const email = role === 'no-form' ? emailReport(said) : null, told = role === 'no-form' && !email ? toldReport(said) : null, closed = email || told ? null : closedReport(kind, counts), other = role === 'no-form' && !email && !told && !closed ? otherReport(said, tab.id) : null;   // the page asks for email (ladder/outcomes.js) or tells what to do (ladder/climb.js)
  return {said, email, told, closed, other};
}

// Log the same non-form ending with the same precedence and evidence.
function describeEnd(step, reports) {
  const {role, kind, host} = step;
  decide('fill', endingLine(role, reports), {host, role, ...(kind?.applyBy ? {applyBy: kind.applyBy} : {})});
}

// Return the original ending words in their original condition order.
function endingLine(role, {botCheck, email, told, closed, other}) {
  if (role === 'account') return 'account page left for Claude';
  if (botCheck) return 'a bot check in front of the page: handed to the person';
  if (email) return 'the posting asks for the application by email: reported to the app';
  if (closed) return 'the posting is closed (the AI says so): reported to the app';
  if (told) return 'the page tells what to do: reported to the app';
  if (other) return 'the ladder ended at the person: reported as other';
  return 'no form on this page';
}

// Fill once and write the result only on the document that started it.
export async function fillPage(step) {
  const {tab, jobUrl, live, gen, kind, pressed, noted, carried, host} = step;
  const {late, writeState, fillOpenedTab, reportFlow} = step.flow;
  forgetGivenUp(tab.id);   // a new fill: its menus are tried afresh
  decide('fill', 'filling', {host, job: new URL(String(jobUrl || tab.url)).pathname, page: new URL(tab.url).pathname});   // which posting's kit this page uses
  if (late(tab, gen, 'fill start')) return false;   // the closer looks above wait too: only the tab's current read fills it
  const fillToken = crypto.randomUUID(); await writeState(tab.id, {state: 'running'}, fillToken);
  const result = await fillOpenedTab(live, String(jobUrl || tab.url).split('#')[0], false, {fast: true, quiet: true});
  // The end state is this page's: a tab that moved on during the fill (the person pressed the page's own "Create account") shows another page, which writes its own
  // (13 Oct 2026: a sign-up's fill error was read on the application form after it, as if the form had failed).
  const still = await chrome.tabs.get(tab.id).catch(() => null);
  if (!still || String(still.url || '').split('#')[0] === String(live.url || tab.url).split('#')[0]) await writeState(tab.id, result?.error ? {state: 'error', error: String(result.error).slice(0, 160)}
    : {state: 'done', filled: result?.filled || 0, left: (result?.todo || []).length, todo: (result?.todo || []).slice(0, 20)}, fillToken);
  else decide('fill', 'the tab moved on during the fill: its end state is left to the next page', {page: new URL(String(live.url || tab.url)).pathname}).catch(() => {});
  reportFlow(tab, {role: 'form', ok: !result?.error});
  const requiredIn = (result?.trace || []).filter(row => row.required && row.outcome === 'filled').length; if (!result?.error && requiredIn) noteProgress(tab.id, 'required_down', {filled: requiredIn});
  const filledProof = !result?.error && result?.filled > 0 && !pressed && !noted ? confirmedBody(kind?.role === 'form' ? kind : null, tab.url, controlsOf(tab.id), 'filled') : null;   // the page took the fill: the decision that called it a form is counted (a kind the structure overrode is the rule's, rung 0)
  for (const proof of filledProof ? [filledProof, carried].filter(Boolean) : []) apiFor(tab.id, await settings(), '/extension/page-kind', {method: 'POST', body: JSON.stringify(proof)}).catch(() => {});
  step.result = result;
  return true;
}

// Climb after an empty fill, then hand required menus and the next step to their owners.
export async function afterFill(step) {
  const {tab, jobUrl, key, live, result, host, accountPage, accountAfterFill} = step;
  const {started, consider, deadEndHere} = step.flow;
  // A fill that put nothing in and left required fields open has no next move of its own (Deloitte's "how will you give your CV" step, 9 Oct 2026: "Form open",
  // 0 filled, 2 left, nobody told): the session says what is left and offers Claude. Counted from the fill's own rows, no word of any page.
  const open = (result?.trace || []).filter(row => row.required && row.outcome === 'left').map(row => String(row.label || '').replace(/\s+/g, ' ').trim()).filter(Boolean);
  if (!result?.error && !(result?.filled > 0) && result?.unfilledRequired > 0 && open.length) {
    const {moved, named} = await lookAtEmptyFill(step);
    if (moved) {   // the page moved on by that press: the fill looks at it once more (a new state, a new look, never more than once)
      started.delete(key);
      decide('fill', 'the closer look pressed a control: the page is filled again', {host});
      await pageStill(tab.id, {maxMs: 1500});
      await consider(tab, jobUrl).catch(() => {});
      return;
    }
    decide('fill', 'nothing filled, required fields left: the person is told, Claude is offered', {host, left: open.length, aiNamed: !!named});
    deadEndHere(tab, jobUrl, host, 'incomplete', [...new Set(open)].slice(0, 3).join(', ') + (named ? ` · try "${named}"` : ''), {left: open.length, aiNamed: !!named});
  }
  if (!result?.error && !accountPage) handGivenUpToPerson(live, 0, result?.trace).catch(() => {});   // a required menu the fill gave up on is the person's (form-ready.js)
  if (!result?.error && !accountPage) formNext(live, 0).catch(() => {});   // the AI says what this page needs next, and a middle step's Continue is pressed (next-step.js)
  if (accountAfterFill) accountStep(tab, 0).catch(() => {});   // the account page, now with your details in (above)
}

// Ask the text and picture rungs in order after an empty required-field fill.
async function lookAtEmptyFill(step) {
  const {tab, live} = step;
  // The ladder (owner, 9 Oct 2026: "3 levels of solving"): 1 the rules did their part; 2 the page AI looks again from the page's own controls (never the remembered answer);
  // 3 the same look with the picture; 4 the person is told, with the control the AI named when it may not press it. Levels 2 and 3 are the closer look (opt-in, capped, lib/ladder/rung4-picture.js).
  let moved = false, named = '';
  for (const picture of [false, true]) {
    const did = await closerLook(live, 0, 'the fill put nothing in and required fields are left', {kind: 'form', picture}).catch(() => 'none');
    if (did === 'click') { moved = true; break; }
    named = lastLook.get(tab.id)?.control || named;
    if (did === 'none' && !picture) break;   // off, capped or no AI: a picture would not change that
  }
  return {moved, named};
}
