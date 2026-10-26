// The next-step card of an application session (the decision card: its state, Claude's question, the form's needs, what happened, the actions), moved out of sessions.js
// as a pure move (13 Oct 2026) so both files stay one concern under 500 lines. The session list and its shared state stay in sessions.js and are imported from it (a cycle, as
// session-log.js already has: nothing here runs at load). Guards read this file's source: desktop/test/claude-offer, claude-help, claude-safety-net, session-state,
// session-optional, resume-secondary and terminals tests.
import {ai} from '../ai-name.js';
import {el, pill} from '../components.js';
import {icon} from '../icons.js';
import {PROBLEM, isDevTalk, latestStep, readSessionMessage, sortChecks, splitLabel} from '../session-message.js';
import {accountProgress, askOutdated, pageLine, asksYou, leftForYou, firstLine, isLive, isSubmitted, panelAnswered, sessionReview, sessionStage, accountRecordLine} from '../session-state.js';
import {resumeOffered} from '../claude-help.js';
import {offerParts} from '../claude-offer.js';
import {$, osText, show} from './core.js';
import {shared} from './shared.js';
import {initOptional, showOptional} from './session-optional.js';
import {jobsChanged} from './jobs.js';
import {richText} from './rich-text.js';
import {openSession, renderSessionPage, say} from './session-log.js';
import {applyFormStates, askRow, reviewStates, opening, openForm, reopenClosedTab, checkingTab, redirecting, silentChrome, waitingChrome, tabLost, formGone, formReady, emptyFields, emptyRow, explainExtension, needRow, showFormState, showSendBar, updateNeedsCount, watchAgreements} from './session-needs.js';
import {toastMessage} from './startup.js';
import {pauseSession, removeSession, resumeSession, skipSession} from './session-actions.js';
import {storeName} from '../store-words.js';
import {INFORM_STUCK} from '../session-steps-list.js';
import {openLog, refreshSessions, sessionCompany, sessionJob, sessionTail, ticking} from './sessions.js';
import {NO_PLACE, sessionPlace} from '../targets.js';

// Sessions whose form page has just failed to answer the app: only those are offered the "Reload the tab" repair
// (it reloads a form page, so it must not sit in the row by default). Cleared when the page answers again.
const panelDead = new Set();
const hhmmOf = iso => new Date(iso).toLocaleTimeString([], {hour: '2-digit', minute: '2-digit'});
function sessionButton(text, kind, run, glyph) {
  const button = el('button', `${kind}${glyph ? ' with-icon' : ''}`);
  if (glyph) button.append(icon(glyph));
  button.append(el('span', '', text));
  button.addEventListener('click', run);
  return button;
}
// A row that shows one line and unfolds the rest on click (a › that turns).
function foldRow(short, more) {
  const li = el('li', 'ss-check');
  const line = el('div', 'ss-check-line');
  const words = el('span', 'ss-check-text');  // one flow of text (a `code` chip would otherwise be its own column)
  words.append(...richText(short).flatMap(node => [...node.childNodes]));
  line.append(icon('chevron'), words);
  li.append(line);
  if (!more) return li;
  const detail = el('div', 'muted small ss-check-more');
  detail.append(...richText(more));
  detail.hidden = true;
  li.classList.add('has-more');
  li.addEventListener('click', () => { detail.hidden = !detail.hidden; li.classList.toggle('is-open', !detail.hidden); });
  li.append(detail);
  return li;
}
let fullFor = null, reportFor = null;  // the session whose Claude's message the banner shows (folded again for another one)
// "I submitted it": you sent the application and the app missed it (the Jobs row and Notion move to Applied). On every
// unsubmitted state of a session, so a missed submit can always be put right by hand.
const submittedButton = item => sessionButton('I submitted it', 'secondary', async event => {
  const button = event.currentTarget;
  button.disabled = true;
  const result = await window.pilot.setStatus(item.url, 'applied').catch(error => ({ok: false, error: error.message}));
  if (!result.ok) { button.disabled = false; toastMessage('Not marked Applied', result.error || 'Try again.', sessionPlace(item)); return; }
  jobsChanged(sessionJob(item), {stage: 'Applied', status: 'applied'});   // its Jobs row too, not only this button
  button.textContent = '✓ Marked Applied';
}, 'check');
// Where to answer: the button opens the reply box in the log below (a quick reply there sends one tap of text).
const answerHint = () => el('p', 'rich-p muted small', 'Press Answer, then type your reply in the log below, or use a quick reply there.');
// While the app checks Chrome for the session's tab: a loading card (the existing .skeleton lines), nothing from the last state.
function renderChecking() {
  $('ss-decision').className = 'ss-next tone-neutral';
  $('ss-next-title').textContent = 'Checking Chrome for this application\u2026';
  $('ss-next-state').textContent = '';
  $('ss-stage').replaceChildren();
  $('ss-form-state').replaceChildren();
  $('ss-question').replaceChildren(el('span', 'skeleton w-80'), el('span', 'skeleton w-60'));
  $('ss-actions').replaceChildren(el('span', 'skeleton button'), el('span', 'skeleton button small'));
  for (const id of ['ss-form-card', 'ss-needs-card', 'ss-happened-card', 'ss-optional-card', 'ss-full-toggle', 'ss-full']) show($(id), false);
}
// Chrome hasn't reported (closed, or the extension isn't running): the card can't know the tab, so it says that, with the way
// back (the extension's own page, which starts it reporting); it updates by itself once Chrome reports.
const START_MS = 30 * 1000;   // as lib/chrome-launch-once.js: how long one press keeps the button on "Starting Chrome…"
// The app only just started: Chrome has had no time to report, so a neutral wait with the same way back, no warning.
function renderWaiting() {
  renderChecking();
  $('ss-next-title').textContent = 'Waiting for Chrome\u2026';
  $('ss-question').replaceChildren(el('p', 'rich-p', 'The app just started. This card updates by itself once Chrome\'s Jobadabra extension reports.'));
  $('ss-actions').replaceChildren();   // nothing to press while it waits
}
// The tab is on a posting whose Apply the extension presses (or just pressed): nothing else of the session is true for this page, so no counts, no ready, no asks (owner, 15 Oct 2026).
function renderRedirecting(item) {
  renderChecking();
  $('ss-next-title').textContent = pageLine(reviewStates.get(item.id)?.page);
  $('ss-question').replaceChildren();
  $('ss-actions').replaceChildren();
}
function renderSilent(item) {
  renderChecking();
  $('ss-decision').className = 'ss-next tone-warn';
  $('ss-next-title').textContent = 'Chrome isn\'t reporting';
  const starting = Date.now() - shared.chromeStartedAt < START_MS;
  const retried = shared.chromeStartedAt && !starting;   // pressed before, and Chrome still has not reported
  $('ss-question').replaceChildren(el('p', 'rich-p', retried ? 'Chrome didn\'t report within 30 seconds. Check that Chrome is open with the Jobadabra extension on, or try Open Chrome again.'
    : 'Jobadabra can\'t see this application\'s tab: Chrome is closed, or its Jobadabra extension isn\'t running. Open Chrome and this card updates by itself.'));
  const button = sessionButton(starting ? 'Starting Chrome\u2026' : 'Open Chrome', 'primary', async event => {
    const result = await opening(event.currentTarget, () => window.pilot.extensionOptions());
    window.pilot.uiLog('sessions: Chrome not reporting, Open Chrome pressed', {opened: !!result?.opened, starting: !!result?.starting});
    if (!result?.opened) { toastMessage('Chrome didn\'t open', 'Open Google Chrome yourself; the card updates once its Jobadabra extension reports.', NO_PLACE.outside); return; }
    shared.chromeStartedAt = result.since || Date.now();
    renderNextStep(item);
    setTimeout(() => { if (silentChrome(item)) renderNextStep(item); }, START_MS + 100);   // offered again, with the reason
  }, 'link');
  if (starting) button.disabled = true;
  $('ss-actions').replaceChildren(button);
}
// The first look is over and no tab is known for the session: it says so and offers the one way forward, the same reopen every closed-tab button uses.
function renderLost(item) {
  renderChecking();
  $('ss-decision').className = 'ss-next tone-warn';
  $('ss-next-title').textContent = 'Tab not found';
  $('ss-question').replaceChildren(el('p', 'rich-p', 'Jobadabra can\'t find this application\'s tab in Chrome. It may still be open under another address. Open it again and the extension fills it from your kit; if the tab shows up by itself, this card updates.'));
  $('ss-actions').replaceChildren(sessionButton('Open it again', 'primary', event => reopenClosedTab(item, event.currentTarget), 'link'));
}
export function renderNextStep(item) {
  if (checkingTab(item)) { renderChecking(); return; }
  if (waitingChrome(item)) { renderWaiting(); return; }
  if (redirecting(item)) { renderRedirecting(item); return; }
  if (silentChrome(item)) { renderSilent(item); return; }
  if (tabLost(item)) { renderLost(item); return; }
  const submitted = isSubmitted(item);
  // Its Chrome tab was closed: that wins over "can't reach this form" (nothing to reach) and over what Claude last asked (about that tab).
  const stopped = !submitted && item.kind === 'form' && item.stuck === 'stopped';   // the person pressed Stop: Reopen form starts it again
  const gone = !submitted && formGone(item);
  const stuck = !submitted && item.kind === 'form' && !!item.stuck && !gone && !stopped;   // the extension can't reach this form
  // Claude closed with the app, and the form's own tab since reported an application page with fields: the frozen ask is outdated, the live page leads (owner, 15 Oct 2026).
  const liveForm = reviewStates.get(item.id), outdatedAsk = !submitted && askOutdated(item, liveForm);
  const review = !submitted && !stuck && !stopped && sessionReview(item, formReady(item)), asking = !submitted && !stuck && !stopped && !review && !outdatedAsk && (item.status === 'input' || (item.status === 'done' && item.kind !== 'form' && !item.inChrome && leftForYou(item))), running = !submitted && item.status === 'running';
  const open = !submitted && !stuck && !stopped && !review && !asking && (item.kind === 'form' || item.inChrome || outdatedAsk) && (item.status === 'done' || outdatedAsk);
  const {checks, needs: forYou, audit, done, intro} = readSessionMessage(submitted ? '' : item.question);
  const tone = submitted ? 'good' : review || asking || stuck || stopped ? 'warn' : running ? 'info' : item.status === 'failed' ? 'bad' : 'neutral';
  $('ss-decision').className = `ss-next tone-${tone}`;
  const brief = item.brief || '';
  const ask = asksYou(item) && /\?$/.test(brief) ? brief : '';
  $('ss-next-title').textContent = submitted ? 'Submitted'
    : stuck ? (item.stuck === 'account' ? (item.accountStep === 'sign_in' ? `Sign in${item.accountHost ? ` to ${item.accountHost.replace(/^www\./, '')}` : ''}` : 'This site needs an account') : item.stuck === 'incomplete' ? 'The extension filled nothing here' : item.stuck === 'email' ? 'Send your application by email' : item.stuck === 'told' ? 'The page tells you what to do' : item.stuck === 'other' ? 'Jobadabra could not tell how to apply' : item.stuck === 'site_broken' ? 'The site is not answering' : 'The extension can\'t reach this form')
    : stopped ? 'You stopped the extension'
    : gone ? 'The form tab was closed'
    : review ? 'Review the filled application'
    : asking ? ask || (item.stage === 'account' ? 'Account step needs your input' : 'Application needs your input')
    : open ? 'Complete the application in Chrome'
    : running ? ai('{AI} is filling the application') : item.status === 'failed' ? 'The session stopped' : 'The session ended';
  // Its state, after the title: finished (when), waiting (since when) or working (for how long).
  const since = item.needsYouSince || item.endedAt || item.startedAt;
  const state = $('ss-next-state');
  state.textContent = submitted ? `· ended at ${hhmmOf(since)}`
    : stuck ? (item.stuck === 'account' ? accountProgress(reviewStates.get(item.id)) : INFORM_STUCK.includes(item.stuck) ? '' : '· nothing filled yet')
    : review ? (item.kind === 'form' || item.inChrome ? `· form opened at ${hhmmOf(since)}` : ai(`· {AI} finished at ${hhmmOf(since)}`)) : asking ? (isLive(item) ? `· waiting since ${hhmmOf(since)}` : ai('· {AI} closed with the app'))
    : running ? '· working' : `· ended at ${hhmmOf(since)}`;
  const stage = sessionStage(item, review);
  $('ss-stage').replaceChildren(...(stage ? [pill(stage.text, stage.tone, {dot: true})] : []));
  if (running) ticking(state, '· working for ', item.startedAt); else { delete state.dataset.since; delete state.dataset.prefix; }
  // What to read: one line when the form is ready (Claude's words one click away), else Claude's own text.
  const said = intro.filter(line => line.replace(/\*/g, '') !== ask && !isDevTalk(line));
  $('ss-question').replaceChildren(...(submitted ? [el('p', 'rich-p', `Marked Applied in ${storeName()}. The confirmation page in Chrome is what decided it.`)]
    : stuck ? [el('p', 'rich-p', item.stuck === 'account'
      ? 'The form is behind a sign-in or sign-up. The extension fills it in Chrome; a robot check or a choice there is yours. If it stays stuck, Claude can take over; you still submit the application.'
      : item.stuck === 'other' ? 'Jobadabra read the page and could not tell how to apply: there may be no form, or the way is not written on it. Open it in Chrome and look. Jobadabra never acts on it for you.'
      : item.stuck === 'site_broken' ? `${item.accountNeeds || 'The site did not answer'}. Open it in Chrome to check, or try again later. Jobadabra never acts on it for you.`
      : item.stuck === 'told' ? `The page says: "${item.accountNeeds || ''}". Open it in Chrome to read it. Jobadabra never acts on it for you.`
      : item.stuck === 'email' ? `This job is applied to by email, not through a form. Send your CV and cover letter to ${item.accountNeeds || 'the address on the page'}. Jobadabra never sends it for you.`
      : item.stuck === 'incomplete' ? 'The form is open in Chrome, but the extension could not fill any of it and required fields are still empty. Fill them there, or let Claude take over; you still submit the application.'
      : 'This page has no form the extension can open by itself (no Apply button it may press, or it leads to another site). Open it in Chrome to go on; if it stays stuck, Claude can find the form and fill it; you still submit it.'),
      // The next press, in the AI's own words (e.g. 'Solve the check, then press "Créer un compte"'): what is left for you on this page.
      ...(['account', 'incomplete'].includes(item.stuck) && item.accountNeeds ? [el('p', 'rich-p', el('b', '', 'Left for you: '), item.accountNeeds)] : [])]
    : stopped ? [el('p', 'rich-p', 'Nothing runs on this application until you start it again. Reopen form opens it in a new Chrome tab and the extension fills it from your kit; the form already open in Chrome is left as it is.')]
    : gone && asking ? [el('p', 'rich-p', 'This application was open in the Chrome tab you closed, so its last question was about that tab. Reopen form opens it again (you choose whether to start over).')]
    : gone ? [el('p', 'rich-p', item.kind === 'form' ? 'You closed the form\'s Chrome tab. Reopen it and the extension fills it again from your kit. If you submitted it, the extension has already marked it Applied.' : 'The filled form was in the Chrome tab you closed. Reopen it to fill it again from your kit, or mark it submitted if you already sent it.')]
    : open ? [el('p', 'rich-p', 'The form is open in Chrome. Complete the remaining fields shown below, then review the answers before submitting.') ]
    : review ? [el('p', 'rich-p', item.kind === 'form' || item.inChrome ? 'The extension fills the form in Chrome. Check the answers and legal boxes there, then submit it yourself.' : 'Check the answers and legal boxes in Chrome, then submit it yourself.')]
    : asking ? (forYou.length
      // Claude listed what it needs: its first sentence for context, then each thing as a line, then where to answer.
      // Why Claude stopped stays in sight here (owner, 12 Oct 2026: it was folded away); each thing it needs is a row of the card below, with its answer box.
      ? [...(said.length ? richText(said.join('\n')) : []), ...(isLive(item) ? [answerHint()] : [])]
      : [...(said.length ? richText(said.join('\n')) : [el('p', 'rich-p', ai('{AI} is waiting for you.'))]), ...(isLive(item) ? [answerHint()] : [])])
    : [Object.assign(el('p', 'rich-p muted', (running && latestStep(sessionTail[item.id] || '')) || item.note || ''), {id: running ? 'ss-step' : ''})]));
  const full = $('ss-full');
  full.replaceChildren(...(review && item.question ? richText(item.question) : []));
  if (fullFor !== item.id) { full.hidden = true; fullFor = item.id; }
  // At the bottom of "What happened", folded: once the form is filled the cards say what to do; the report is there
  // for its exact words.
  const record = accountRecordLine(item);   // "Account created on X · terms accepted: '…' · code from your email" (session-state.js)
  if (record) $('ss-question').append(el('p', 'muted small', record));
  const toggle = $('ss-full-toggle');
  const label = () => { toggle.textContent = ai(full.hidden ? '{AI}\'s full report ▾' : '{AI}\'s full report ▴'); };
  show(toggle, !!(review && item.question));
  label();
  toggle.onclick = () => { full.hidden = !full.hidden; label(); };
  const actions = [], live = isLive(item);
  if (stuck) {
    // Tier 3: the cheap ways ran out. Chrome first, Claude the safety net (owner, 9 Oct 2026: "remove the 'Apply with Claude' from being orange";
    // the panel's "Take over with Claude" is there while the form tab is open, this one when it isn't).
    if (item.url) actions.push(sessionButton('Open in Chrome', 'primary', async event => { await openForm(item, event.currentTarget); }, 'link'));
    const offer = INFORM_STUCK.includes(item.stuck) ? {buttons: [], notes: []} : offerParts(item, {rerender: () => renderNextStep(item), after: async result => { await refreshSessions(); if (result?.session?.id) openSession(result.session.id); }});   // claude-offer.js
    actions.push(...offer.buttons);
    if (offer.notes.length) $('ss-question').append(...offer.notes);
  }
  // Claude is the safety net, never the main action (owner, 9 Oct 2026: "remove Resume Claude from being orange"): always secondary; the way to the form is promoted below.
  const resume = () => sessionButton('Resume Claude', 'secondary', () => resumeSession(item), 'refresh');
  const pushResume = () => { if (resumeOffered()) actions.push(resume()); };   // off for now: see resumeOffered in claude-help.js
  if (gone || stopped) {
    // Nothing to bring forward: the tab is gone. The app opens the job with the fill mark, the way "Fill in Chrome" does.
    actions.push(sessionButton('Reopen form', 'primary', event => reopenClosedTab(item, event.currentTarget), 'link'));
  }
  if (review) {
    if (!gone) actions.push(sessionButton('Open filled form', 'primary', async event => {
      const result = await opening(event.currentTarget, () => window.pilot.showBrowser(item.url, sessionCompany(item), item.id));
      // The page's panel answered: nothing to repair. When it didn't, the repair appears right here, and the row is
      // redrawn so it is there before the next click.
      if (panelAnswered(result)) {
        if (panelDead.delete(item.id)) renderSessionPage();
        return;
      }
      if (result?.went === 'none') { await reopenClosedTab(item, event.currentTarget); return; }   // no tab to bring forward: open the form again
      panelDead.add(item.id);
      renderSessionPage();
      toastMessage('Form tab not found', osText('The form\'s page didn\'t answer, so the extension isn\'t attached to it. '
        + 'Press Reload the tab — or ⌘R in that tab — then try again.'), sessionPlace(item));
    }, 'link'));
    // A form page whose panel died (the extension was uninstalled and installed again) can't answer the app: reload
    // that tab, which is what puts the extension back onto it — then the focus handshake works again. Offered only
    // after a page has just failed to answer (panelDead), never as an everyday action: a reload loses whatever was
    // typed in the form since the last save (1 Oct 2026).
    if (panelDead.has(item.id) && !gone) actions.push(sessionButton('Reload the tab', 'secondary', async event => {
      const result = await opening(event.currentTarget, () => window.pilot.reviewReload(item.id, item.url, sessionCompany(item)));
      if (result?.result === 'reloaded' || result?.result === 'reloaded-chrome') {
        panelDead.delete(item.id);
        renderSessionPage();
        if (result.went !== 'tab') toastMessage('Reloaded, but no answer yet', 'The tab is fresh; give the extension a few seconds, then press Open filled form again.', NO_PLACE.outside);
        return;
      }
      if (result?.outdated) {
        toastMessage('Reload the Chrome extension once', `Chrome runs Jobadabra ${result.extension}; this app has ${result.latest}. ` +
          'In Chrome open chrome://extensions and click ↻ on Jobadabra, then press again — it updates itself from then on.', {card: 'extension'});
        return;
      }
      const why = {permission: 'macOS won\'t let Jobadabra control Chrome: System Settings → Privacy & Security → Automation → Jobadabra → Google Chrome. Or press ⌘R in that tab.',
        // Chrome running with no windows means an automation's headless Chrome holds the scripting connection, not
        // the window the user is working in: say so, rather than "no tab matches" about a tab that is right there.
        'no-window': osText('Chrome answered with no windows: a background Chrome (an automation\'s) holds the scripting connection, not the window you use. Press ⌘R in the tab you are reviewing.'),
        'no-tab': osText('No Chrome tab matches this job. If you apply in another browser or Chrome window, press ⌘R in its tab.'),
        'no-chrome': 'Google Chrome isn\'t running.',
        // Chrome's scripting is macOS-only. Saying "Chrome isn't running" on Windows would be untrue, and the
        // generic advice names ⌘R, which isn't a key there.
        manual: 'Reloading a Chrome tab can only be asked of a Mac: press Ctrl+R in the form\'s tab.'}[result?.result];
      toastMessage('Couldn\'t reload the form tab', why || osText('Press ⌘R in the form\'s tab instead.'), sessionPlace(item));
    }, 'refresh'));
    if (item.kind !== 'form') actions.push(submittedButton(item));  // you pressed Submit in Chrome: say so here too (a form session's submit is seen by the extension)
    if (live) actions.push(sessionButton('Skip this role', 'secondary', () => skipSession(item)));
    else if (item.resumable) pushResume();
    const never = el('span', 'ss-never muted small');
    never.append(icon('info'), el('span', '', 'Jobadabra never clicks Submit.'));
    actions.push(never);
  } else if (asking && !live) {
    if (item.resumable) pushResume();
    // Claude closed with the app, but the form may still be open in Chrome.
    if (item.url && !gone) actions.push(sessionButton('Open in Chrome', 'secondary', async event => {
      await openForm(item, event.currentTarget);
    }, 'link'));
    actions.push(submittedButton(item));
    actions.push(sessionButton('Remove from the list', 'secondary', () => removeSession(item)));
  } else if (asking) {
    // Continue only means something after a pause (Esc). When Claude asked for something, "Continue." gives it nothing
    // new and it asks again (a 4-hour loop on 1 Oct 2026): the main action is to answer it.
    if (/^Paused/i.test(item.note || '')) {
      actions.push(sessionButton('Continue', 'primary', () => say('Continue.')));
      actions.push(sessionButton('Answer in your own words', 'link', () => openLog(true), 'chat'));
    } else {
      actions.push(sessionButton('Answer', 'primary', () => openLog(true), 'chat'));
    }
    // The form is waiting in Chrome while Claude asks: one click to look at it, as when it works.
    if (item.url) actions.push(sessionButton('Open in Chrome', 'secondary', async event => {
      await openForm(item, event.currentTarget);
    }, 'link'));
    actions.push(submittedButton(item));
    actions.push(sessionButton('Skip this role', 'secondary', () => skipSession(item)));
  } else if (running) {
    if (item.url) actions.push(sessionButton('Open in Chrome', 'primary', async event => {
      await openForm(item, event.currentTarget);
    }, 'link'));
    actions.push(sessionButton('Pause', 'secondary', pauseSession));
    actions.push(submittedButton(item));
    actions.push(sessionButton('Watch the log', 'link', () => openLog(true), 'eye'));
  } else if (item.resumable && !submitted) {
    pushResume();
    actions.push(submittedButton(item));
  }
  // Every state with a job keeps a way to its form (owner, 8 Oct 2026: an ended session showed only Resume Claude).
  const toForm = /^(Open in Chrome|Reopen form|Open filled form)$/;
  if (item.url && !submitted && !actions.some(button => toForm.test(button.textContent))) {
    actions.splice(1, 0, sessionButton('Open in Chrome', actions.length ? 'secondary' : 'primary', async event => {
      await openForm(item, event.currentTarget);
    }, 'link'));
  }
  // One main action: with none, the way to the form is it, first in the row (a Claude button is never the orange one).
  if (!actions.some(button => button.classList.contains('primary'))) {
    const toIt = actions.find(button => toForm.test(button.textContent));
    if (toIt) { toIt.classList.replace('secondary', 'primary'); actions.splice(actions.indexOf(toIt), 1); actions.unshift(toIt); }
  }
  $('ss-actions').replaceChildren(...actions);
  // Two sections under the step: what Claude needs from you (answer, agree, confirm), then what happened
  // (what it filled, the problems it hit, its audit). Its other report sections join what happened.
  const sorted = sortChecks(checks), mine = sortChecks(forYou, {forYou: true});
  const needs = [...mine.needs, ...sorted.needs], filled = sorted.filled;
  const empty = gone ? [] : emptyFields(item, needs);   // a closed tab has no empty fields to open
  show($('ss-needs-card'), needs.length + empty.length > 0 && !gone);   // a closed tab's rows are stale: Reopen form asks what to keep
  $('ss-needs-title').textContent = 'Needs your attention';
  $('ss-needs-sub').textContent = review ? 'Check these items before submitting.' : asking ? ai('What {AI} needs from you to carry on.') : 'Complete these items in Chrome.';
  $('ss-needs').replaceChildren(...needs.map(need => (need.kind === 'ask' ? askRow(need, item) : needRow(need, item))), ...empty.map(label => emptyRow(label, item)));
  watchAgreements(item, needs.filter(need => need.kind === 'agree' || need.kind === 'ask'));
  applyFormStates(item);
  showFormState(item);
  updateNeedsCount();
  showOptional(item, {gone, listed: empty});   // the optional ones, folded below (session-optional.js)
  showSendBar(item);   // answers not sent yet stay with their send button when the page redraws
  // The live field list ("In the form") says what was filled, field by field: Claude's "Filled:" summary only without it.
  const listed = !!reviewStates.get(item.id)?.filled?.length;
  const happened = [
    ...done.filter(section => !(listed && /^filled$/i.test(section.label || ''))).map(section => {
      // "**Filled:**" with its details on the bullets under it: the line shows the first of them (+ how many more);
      // the list is one click away.
      const extra = !section.text && section.items.length > 1 ? ` (+${section.items.length - 1} more)` : '';
      const lead = firstLine(section.text || section.items[0] || '') + extra;
      return {short: section.label ? `**${section.label}:** ${lead}`.trim() : lead, problem: section.label === 'Problems' || PROBLEM.test(section.text),
        more: section.text ? [section.text.slice(firstLine(section.text).length).trim(), ...section.items.map(line => `- ${line}`)].filter(Boolean).join('\n')
          : section.items.length > 1 ? section.items.map(line => `- ${line}`).join('\n') : ''};
    }),
    ...filled.map(({text, problem}) => {
      const {label, text: rest} = splitLabel(text);
      const short = label || firstLine(rest);
      return {short, problem, more: label ? rest : rest.slice(short.length).trim()};
    })];
  // Problems first: they explain the rest.
  happened.sort((x, y) => Number(y.problem) - Number(x.problem));
  $('ss-happened').replaceChildren(...happened.map(({short, more, problem}) => {
    const row = foldRow(short, more);
    // A problem Claude worked around, on a form that's now ready: history, not a warning.
    if (problem) row.classList.add(formReady(item) ? 'is-solved' : 'is-problem');
    if (problem && /extension/i.test(`${short} ${more}`)) explainExtension(row);
    return row;
  }));
  show($('ss-audit-card'), !!audit);
  $('ss-audit-pill').replaceChildren();
  if (audit) {
    const capital = audit.charAt(0).toUpperCase() + audit.slice(1);
    const summary = firstLine(capital, 160), rest = capital.slice(summary.length).trim();
    const fixes = (audit.match(/\b(?:corrected|removed|fixed|by hand)\b/gi) || []).length;
    $('ss-audit-pill').replaceChildren(...(fixes ? [pill(`${fixes} correction${fixes === 1 ? '' : 's'}`, 'warn', {dot: true})] : [pill('Checked', 'good', {dot: true})]));
    $('ss-audit-summary').replaceChildren(...richText(summary).flatMap(node => [...node.childNodes]));
    $('ss-audit-detail').replaceChildren(...richText(rest));
    show($('ss-audit-more'), !!rest);
  }
  show($('ss-happened-card'), happened.length > 0 || !!audit || !!(review && item.question));
  // Claude's report, from when it finished: folded (the cards above are today's state), open while a problem it hit
  // still stands (the form isn't ready).
  $('ss-happened-when').textContent = `· ${hhmmOf(item.needsYouSince || item.endedAt || item.startedAt)}`;
  if (reportFor !== item.id) {
    reportFor = item.id;
    $('ss-happened-card').classList.toggle('is-open', happened.some(entry => entry.problem) && !formReady(item));
  }
  initOptional();
  $('ss-happened-head').onclick = event => { if (!event.target.closest('a, button')) $('ss-happened-card').classList.toggle('is-open'); };
}
