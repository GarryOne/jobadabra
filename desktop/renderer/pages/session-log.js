// Session page: opening a session and its log.
import {ai} from '../ai-name.js';
import {el, moreButton, pill} from '../components.js';
import {resumeOffered} from '../claude-help.js';
import {latestStep, readSessionMessage} from '../session-message.js';
import {passWheel, wheelLines} from '../wheel.js';
import {shared} from './shared.js';
import {clockTime} from './activity.js';
import {$, show} from './core.js';
import {renderJobs} from './jobs.js';
import {openView, remembered} from './nav.js';
import {isSubmitted, pageLine, tabAddress} from '../session-state.js';
import {checkingTab, tabLost, formGone, formReady, redirecting, reviewStates, silentChrome, waitingChrome} from './session-needs.js';
import {nudgeMissingDetails} from './contact-proposals.js';
import {sessionPanels} from '../sessions-cache.js';
import {cancelSession, isLive, logChoice, openLog, refreshSessions, renderNextStep, restartSession, resumeSession, sessionCompany, sessionDuration, sessionJob, sessionList, sessionLogo, sessionMenu, sessionReview, sessionState, sessionTail, sessionTitle, sessionsFromCache, sessionsLoaded, ticking} from './sessions.js';
import {richText} from './rich-text.js';
import {renderSteps, terminalShown, toggleTechnicalLog} from './session-steps.js';
import {toastMessage} from './startup.js';
import {syncTips} from '../tips.js';
import {storeName} from '../store-words.js';
import {NO_PLACE} from '../targets.js';

export async function openSession(id) {
  if (!id) return;
  if (id !== shared.openSessionId) shared.termShownFor = null;  // the log shows this session's output once it's open
  shared.openSessionId = id;
  shared.openWanted = {id, at: Date.now()};   // asked for now: a render with a list from before it existed must not swap it for another
  openView('sessions');  // the list we already have, before the log is read (that read is what made the page feel stuck)
  if (!sessionTail[id]) {
    const output = await window.pilot.sessionOutput(id).catch(() => '');
    if (shared.openSessionId === id) sessionTail[id] = String(output || '').slice(-6000);
  }
  await refreshSessions();
}
// The header has nothing to say about a session that isn't there (or isn't known yet).
function clearHeader() {
  $('ss-title').textContent = 'Application sessions';
  $('ss-role').textContent = '';
  $('ss-status').replaceChildren();
  $('ss-more').replaceChildren();
}
// A form session whose Chrome tab was closed is not "Form open" any more (the tab report says so within seconds).
const stateOf = item => (checkingTab(item) ? ['Checking…', 'neutral'] : redirecting(item) ? [pageLine(reviewStates.get(item.id)?.page, true), 'neutral'] : waitingChrome(item) ? ['Waiting for Chrome…', 'neutral'] : silentChrome(item) ? ['Chrome not reporting', 'warn'] : tabLost(item) ? ['Tab not found', 'warn'] : formGone(item) ? ['Form closed', 'neutral'] : sessionState(item));
export function renderSessionPage() {
  // The session shown is the open one; after a reload (⌘R) the one open before it, else the first. It becomes the
  // open session, so the log, replies and buttons act on the session you see (with none set, the log stayed empty).
  shared.openSessionId = shared.openSessionId || remembered('session') || null;
  const item = sessionList.find(entry => entry.id === shared.openSessionId) || sessionList[0];
  // A session opened a moment ago (Take over, a notification) may not be in this list yet: keep it asked for; the next list has it.
  // (9 Oct 2026: after Take over the app showed the oldest session, Manor, instead of the new one.)
  const wanted = shared.openWanted && Date.now() - shared.openWanted.at < 15000 ? shared.openWanted.id : null;
  if (item && item.id !== shared.openSessionId && shared.openSessionId !== wanted) { shared.openSessionId = item.id; shared.termShownFor = null; }
  if (item) remembered('session', item.id);
  // Nothing read yet → the spinner. A remembered list, even an empty one, is the page (Updating… until the app
  // answers). The app's own empty list → the empty state. The shell never paints before one of those is known.
  const panels = sessionPanels({loaded: sessionsLoaded, count: sessionList.length, fromCache: sessionsFromCache});
  show($('ss-loading'), panels.loading);
  show($('ss-empty'), panels.empty);
  show($('ss-grid'), panels.grid);
  show($('ss-refreshing'), panels.refreshing);
  syncTips({active: panels.grid, url: item?.url});
  if (panels.loading) { clearHeader(); return; }  // nothing to describe yet
  $('ss-list').replaceChildren(...sessionList.slice().reverse().map(entry => {
    const [label, tone] = stateOf(entry);
    const li = el('li', `ss-row tone-${tone}${entry.id === item?.id ? ' is-current' : ''}`);
    const words = el('div', 'ss-row-words');
    const top = el('div', 'ss-row-top');
    top.append(el('b', '', sessionCompany(entry)), el('span', 'muted small', clockTime(entry.startedAt)));
    const role = el('span', 'small ss-row-role', sessionTitle(entry));
    role.title = sessionTitle(entry);  // one line in the list; the whole title on hover
    words.append(top, role, pill(label, tone, {dot: true}));
    li.append(sessionLogo(entry), words);
    li.addEventListener('click', () => openSession(entry.id));
    return li;
  }));
  if (!item) { clearHeader(); return; }
  const [label, tone] = stateOf(item);
  $('ss-title').textContent = sessionCompany(item);
  $('ss-role').textContent = sessionTitle(item);
  $('ss-status').replaceChildren(pill(sessionReview(item, formReady(item)) && tone !== 'good' && item.kind !== 'form' && !item.inChrome ? 'Ready for review' : label, tone, {dot: true}));
  // Start again and Cancel beside ⋯: the two ways out of a session that isn't going well.
  const again = Object.assign(el('button', 'secondary', '↺ Start again'), {title: 'Close this session and start a new one on the same job'});
  again.addEventListener('click', () => busy(again, 'Restarting…', () => restartSession(item)));
  const cancel = Object.assign(el('button', 'secondary', 'Cancel application'), {title: ai('{AI} stops, the form tab closes, the job goes back to Kit ready')});
  cancel.addEventListener('click', () => busy(cancel, 'Cancelling…', () => cancelSession(item)));
  if (item.kind === 'form') cancel.title = 'The form tab closes and the job goes back to Kit ready';
  $('ss-more').replaceChildren(...(isSubmitted(item) ? [] : item.kind === 'form' ? [cancel] : [again, cancel]), moreButton(sessionMenu(item), 'More'));
  show($('ss-log'), terminalShown(item));   // the terminal only for a Claude conversation with Claude help on, or when asked (session-steps.js)
  renderSteps(item);   // no terminal behind a form session: the form in Chrome is the whole story
  const job = sessionJob(item);
  const head = el('div', 'ss-job-card');
  const words = el('div', 'ss-job-words');
  const place = [...String(item.location || job.location || '').split(/\s*;\s*/), item.workMode || job.work_mode].filter(Boolean).join(' · ');
  words.append(el('b', '', `${sessionCompany(item)} · ${sessionTitle(item)}`), el('span', 'muted', place));
  // Its Chrome tab: where it is now, when it opened, for how long (owner, 8 Oct 2026). Closed: the last address it had.
  const tab = reviewStates.get(item.id), address = tabAddress(tab?.url);
  if (address) {
    const line = el('span', 'muted small ss-job-tab');
    const link = Object.assign(el('a', 'link', address), {href: '#', title: tab.url});
    link.addEventListener('click', event => { event.preventDefault(); window.pilot.openExternal(tab.url); });
    const opened = tab.tabAt ? new Date(tab.tabAt).toLocaleTimeString([], {hour: '2-digit', minute: '2-digit'}) : '';
    // Unknown while Chrome is checked or silent: its last address, never "open for" a tab nobody can see (owner, 8 Oct 2026).
    const unknown = checkingTab(item) || waitingChrome(item) || silentChrome(item) || tabLost(item);
    line.append(formGone(item) ? 'Chrome tab (closed): ' : unknown ? 'Chrome tab (last seen): ' : 'Chrome tab: ', link);
    if (opened) line.append(` · opened ${opened}`);
    if (opened && !formGone(item) && !unknown) line.append(ticking(el('span'), ' · open for ', new Date(tab.tabAt).toISOString()));
    words.append(line);
  }
  const view = Object.assign(el('a', 'link small', 'View job ↗'), {href: '#'});
  view.addEventListener('click', event => { event.preventDefault(); window.pilot.openExternal(item.url); });
  head.append(sessionLogo(item), words, view);
  $('ss-job').replaceChildren(head);
  renderNextStep(item);
  const review = sessionReview(item, formReady(item));
  const [logLabel, logTone] = isSubmitted(item) ? [label, tone] : item.status === 'running' ? ['Working', 'info']
    // Claude stopped on a list for you ("Needs you: tick the robot box, reply ok") in a live window: it waits, it has not completed (8 Oct 2026).
    : review && isLive(item) && readSessionMessage(item.question || '').needs.length ? ['Waiting for you', 'warn']
    : review ? ['Completed', 'good']
    : item.status === 'input' && !isLive(item) ? ['Closed with the app', 'neutral']
    : item.status === 'input' ? ['Waiting for your reply', 'warn'] : [label, tone];
  const livePill = pill(`${logLabel} · ${sessionDuration(item)}`, logTone, {dot: true});
  if (item.status === 'running') ticking(livePill, `${logLabel} · `, item.startedAt);
  $('ss-live-state').replaceChildren(livePill);
  $('ss-log-last').textContent = `> ${isSubmitted(item) ? `Submitted. Marked Applied in ${storeName()}.` : review ? 'Form filled in Chrome. Waiting for your review.' : item.note || 'Starting…'}`;
  // A session that isn't running (closed with the app, or ended) takes no typing: say so, with Resume one click away.
  const offline = !isLive(item);
  show($('ss-offline'), offline);
  show($('ss-replies'), !offline);
  $('ss-offline-resume').hidden = !item.resumable || isSubmitted(item) || !resumeOffered();
  $('ss-offline').querySelector('span').textContent = isSubmitted(item)
    ? `Submitted. This application is marked Applied in ${storeName()}.`
    : item.resumable
    ? (resumeOffered() ? ai('{AI} isn\'t running. This is its conversation; resume it to answer or ask for more.') : 'The session isn\'t running. This is its conversation, kept for reference.')
    : 'This session has ended. Start a new session from the job to continue.';
  openLog(logChoice[item.id] ?? item.status === 'running', false);
}
// A button that waits on the main process (a confirmation, the form tab closing, Notion) says so and cannot be pressed twice.
async function busy(button, label, work) {
  const was = button.textContent;
  button.disabled = true; button.classList.add('is-busy'); button.textContent = label;
  try { await work(); } finally { button.disabled = false; button.classList.remove('is-busy'); button.textContent = was; }
}
function cssVar(name) { return getComputedStyle(document.documentElement).getPropertyValue(name).trim(); }
export async function attachTerminal(id) {
  const {Terminal} = await import('../../node_modules/@xterm/xterm/lib/xterm.mjs');
  const {FitAddon} = await import('../../node_modules/@xterm/addon-fit/lib/addon-fit.mjs');
  if (!shared.xterm) {
    shared.xterm = new Terminal({fontFamily: cssVar('--font-mono'), fontSize: 12, lineHeight: 1.35, cursorBlink: true, cursorStyle: 'bar', convertEol: false, scrollback: 5000,
      theme: {background: cssVar('--navy'), foreground: cssVar('--on-navy'), cursor: cssVar('--signal'), selectionBackground: cssVar('--navy-active')}});
    shared.xtermFit = new FitAddon();
    shared.xterm.loadAddon(shared.xtermFit);
    shared.xterm.open($('ss-terminal'));
    shared.xterm.onData(data => {
      if (!shared.openSessionId) return;
      const item = sessionList.find(entry => entry.id === shared.openSessionId);
      // Keys typed into a session that isn't running: point at Resume instead of losing them silently.
      if (item && !isLive(item)) { if (!/^\x1b\[[IO]$/.test(data)) $('ss-offline').classList.add('is-flash'), setTimeout(() => $('ss-offline').classList.remove('is-flash'), 900); return; }
      window.pilot.sessionWrite(shared.openSessionId, data);
    });
    // The wheel scrolls the log (see wheel.js); a live Claude on its own full screen gets it instead.
    let carry = 0;
    shared.xterm.attachCustomWheelEventHandler(event => {
      const live = sessionList.find(entry => entry.id === shared.openSessionId)?.live !== false;
      if (passWheel({live, mouse: shared.xterm.modes.mouseTrackingMode !== 'none'})) return true;
      event.preventDefault();
      const lineHeight = $('ss-terminal').querySelector('.xterm-rows')?.firstElementChild?.offsetHeight || 16;
      const step = wheelLines(event, shared.xterm.rows, lineHeight, carry);
      carry = step.carry;
      if (step.lines) shared.xterm.scrollLines(step.lines);
      return false;
    });
    new ResizeObserver(() => fitTerminal()).observe($('ss-terminal'));
  }
  // Drawn only while the log is open: a terminal laid out while hidden has no size and stays blank.
  if ($('ss-log-body').hidden) { shared.termShownFor = null; return; }
  // A finished session reads as its conversation (page text, full width); the terminal is for a running Claude
  // (Resume brings it back). Without a transcript, the recorded screen.
  const item = sessionList.find(entry => entry.id === id);
  const talk = item && !isLive(item) ? await window.pilot.sessionTranscript(id).catch(() => null) : null;
  const asText = !!talk?.length;
  show($('ss-transcript'), asText);
  show($('ss-terminal'), !asText);
  if (asText) { renderTranscript(talk); shared.termShownFor = id; return; }
  // The session's screen at the size it was drawn for, then fitted to the log (a running Claude redraws for it).
  const {data, cols, rows} = await window.pilot.sessionSnapshot(id);
  shared.xterm.reset();
  shared.xterm.resize(cols, rows);
  shared.xterm.write(data, () => { fitTerminal(); shared.xterm.scrollToBottom(); shared.xterm.refresh(0, shared.xterm.rows - 1); });
  shared.termShownFor = id;
}
// One font for every session, the page's size. A running Claude redraws for the log's width; a finished session is
// a recording wrapped at the width it had, so it may leave room on the right (bigger text to fill it looked out of
// place next to the page, 29 Sep 2026).
const hhmm = iso => (iso ? new Date(iso).toLocaleTimeString([], {hour: '2-digit', minute: '2-digit'}) : '');
function renderTranscript(talk) {
  const box = $('ss-transcript');
  box.replaceChildren(...talk.map(entry => {
    if (entry.kind === 'steps') {
      const fold = el('details', 'ss-tr-steps');
      const count = entry.count || entry.steps.length;
      fold.append(el('summary', '', `${count} step${count === 1 ? '' : 's'} · ${entry.steps.at(-1)}`));
      const list = el('ul');
      list.append(...entry.steps.map(text => el('li', '', text)));
      fold.append(list);
      return fold;
    }
    const row = el('div', `ss-tr-msg is-${entry.kind}`);
    const head = el('div', 'ss-tr-who');
    head.append(el('b', '', entry.kind === 'you' ? 'You' : ai('{AI}')), el('span', '', entry.time || hhmm(entry.at)));
    const body = el('div', 'ss-tr-text');
    body.append(...(entry.kind === 'claude' ? richText(entry.text) : [el('p', '', entry.text.length > 400 ? `${entry.text.slice(0, 400)}…` : entry.text)]));
    row.append(head, body);
    return row;
  }));
  box.scrollTop = box.scrollHeight;
}
export function fitTerminal() {
  if (!shared.xterm || document.querySelector('.view[data-view="sessions"]').hidden || $('ss-log-body').hidden) return;
  try { shared.xtermFit.fit(); } catch { return; }
  if (shared.openSessionId) window.pilot.sessionResize(shared.openSessionId, shared.xterm.cols, shared.xterm.rows);
}
// Typing a reply: the text, then Enter (Claude Code sends a message on Return).
export function say(text) {
  if (!shared.openSessionId || !text.trim()) return;
  window.pilot.sessionWrite(shared.openSessionId, text.trim());
  setTimeout(() => window.pilot.sessionWrite(shared.openSessionId, '\r'), 60);
  shared.xterm?.focus();
}

// Run at start-up, in the order the window has always done it (app.js calls each page's init in turn).
export async function init() {
  document.querySelectorAll('[data-say]').forEach(button => button.addEventListener('click', () => say(button.dataset.say)));
  $('ss-steps-log').addEventListener('click', () => { const item = sessionList.find(entry => entry.id === shared.openSessionId); if (item) { toggleTechnicalLog(item); renderSessionPage(); } });
  window.addEventListener('claude-help', () => { if (shared.openSessionId) renderSessionPage(); });   // Settings' Claude switch: the session's buttons follow it at once
  $('ss-offline-resume').addEventListener('click', () => { const item = sessionList.find(entry => entry.id === shared.openSessionId); if (item) resumeSession(item); });
  $('ss-copy').addEventListener('click', async () => {
    const text = (await window.pilot.sessionOutput(shared.openSessionId)).replace(/\x1b\[[0-9;?]*[ -/]*[@-~]/g, '').replace(/\x1b\][^\x07]*\x07/g, '');
    await navigator.clipboard.writeText(text);
    toastMessage('Log copied', 'The session\'s output is on the clipboard.', NO_PLACE.done, 'good');
  });
  // The whole header bar opens and closes the log (Copy log does its own thing).
  $('ss-log-head').addEventListener('click', event => { if (!event.target.closest('#ss-copy')) openLog($('ss-log-body').hidden); });
  $('ss-log-last').addEventListener('click', () => openLog(true));
  window.pilot.onSession((event, payload) => {
    if (event === 'data') {
      sessionTail[payload.id] = ((sessionTail[payload.id] || '') + payload.data).slice(-6000);
      if (payload.id !== shared.openSessionId) return;
      const step = $('ss-step') && latestStep(sessionTail[payload.id]);
      if (step) $('ss-step').textContent = step;
      if ($('ss-log-body').hidden) shared.termShownFor = null;  // replayed in full when the log opens
      else if (shared.termShownFor === payload.id) shared.xterm?.write(payload.data);
      return;
    }
    if (event === 'open') { openSession(payload.id); return; }
    if (event === 'update' && (payload?.kind === 'form' || payload?.inChrome)) nudgeMissingDetails();   // a form is being filled: details it will ask for
    refreshSessions().then(() => { if (!document.querySelector('.view[data-view="jobs"]').hidden) renderJobs(); });
  });
  if (!sessionList.length) renderSessionPage();  // nothing remembered: the spinner, not an empty workspace
  refreshSessions();
}
