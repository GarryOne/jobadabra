// Application sessions: the dock, the list, the next step.
import {badgeLabel} from '../badge-label.js';
import {el, pill} from '../components.js';
import {avatar} from '../jobs-view.js';
import {applyingBadge, dockCounts, dockOrder, firstLine, isLive, isSubmitted, pageLine, sessionDuration, tickSessionClocks, sessionReview, sessionState, sessionsFoot} from '../session-state.js';
import {shared} from './shared.js';
import {resumeOffered} from '../claude-help.js';
import {hasSessionCache, rememberSessions, rememberedSessions} from '../sessions-cache.js';
import {$, show} from './core.js';
import {pageKey} from './jobs.js';
import {attachTerminal, fitTerminal, openSession, renderSessionPage} from './session-log.js';
import {checkingTab, redirecting, reviewStates, silentChrome, waitingChrome, tabLost, formGone, formReady} from './session-needs.js';
import {cancelSession, closeSession, pauseSession, removeSession, restartSession, resumeSession, skipSession} from './session-actions.js';
export {renderNextStep} from './session-next-step.js';   // the next-step card, moved out as a pure move (13 Oct 2026)
export {cancelSession, removeSession, restartSession, resumeSession, skipSession};

// Other pages import these from here.
// The state other pages show uses the form page's state too: ready to submit once the form says so.
const closedForm = item => formGone(item);  // its Chrome tab was closed (a form or a Claude session's)
const sessionStatus = item => (checkingTab(item) ? ['Checking…', 'neutral'] : redirecting(item) ? [pageLine(reviewStates.get(item.id)?.page, true), 'neutral'] : waitingChrome(item) ? ['Waiting for Chrome…', 'neutral'] : silentChrome(item) ? ['Chrome not reporting', 'warn'] : tabLost(item) ? ['Tab not found', 'warn'] : closedForm(item) ? ['Form closed', 'neutral'] : sessionState(item, formReady(item)));
export {firstLine, isLive, sessionDuration, sessionReview, sessionStatus as sessionState};
export const SESSION_PILL = {running: {label: 'Applying', tone: 'info'}, input: {label: 'Needs input', tone: 'warn'}, done: {label: 'Form filled', tone: 'good'}};
export let sessionList = [], logChoice = {};
// Set once the app has answered with its sessions: until then "no open session" can't be told from "not loaded yet".
export let sessionsLoaded = false;
// True while the page shows the remembered list: the heading says "Updating…" until the app's own list is in.
export let sessionsFromCache = false;

// ---------- Application sessions: Apply with Claude inside the app (lib/terminals.js) ----------
// A dock of cards above the activity bar (one per session) and a session page with the live terminal (xterm.js),
// Claude's question when it waits for you, quick answers and a message box. Sessions report their state through
// Claude Code hooks; the app notifies you when one needs you.
export function sessionFor(url) {
  const key = pageKey(url || '');
  return sessionList.filter(item => pageKey(item.url) === key).pop() || null;
}
export const sessionJob = item => shared.allJobs.find(job => pageKey(job.url) === pageKey(item.url)) || {};
export const sessionTitle = item => item.title || sessionJob(item).title || 'Application';
export const sessionCompany = item => item.company || sessionJob(item).company || new URL(item.url || 'https://job').hostname.replace(/^www\./, '');
// A submitted application is finished work: it lives on Jobs, not on this screen. A Read with Claude session is not an application at all
// (owner, 7 Oct 2026: "this is only for applying to jobs"): its result is in Recent activity. This list feeds the page, the badge, the dock and
// "N sessions need you", so leaving it out here leaves it out of all of them.
const stillOpen = items => (items || []).filter(item => !isSubmitted(item) && item.kind !== 'read');
export async function refreshSessions() {
  const fresh = await window.pilot.sessions().catch(() => null);
  if (fresh) { sessionList = stillOpen(fresh); rememberSessions(sessionList); }  // a failed read keeps what we have, it doesn't blank it
  sessionsLoaded = true;
  sessionsFromCache = false;
  // Paint before listeners run: one of them throwing used to skip the paint and leave the spinner up.
  const page = document.querySelector('.view[data-view="sessions"]');
  if (page && !page.hidden) renderSessionPage();
  document.dispatchEvent(new Event('sessions-loaded'));
  renderDock();
}
// The last known sessions paint at once on the next load (the app's own list replaces them in refreshSessions).
// Here rather than in a page module: an imported binding is read-only, so only this module can set it.
if (!sessionList.length) {
  const kept = rememberedSessions();
  // An empty remembered list is an answer too (the last sessions were submitted): the page shows that, not the spinner.
  if (kept.length || hasSessionCache()) { sessionList = stillOpen(kept); sessionsFromCache = true; }
}

export function sessionLogo(item) {
  const {initials, hue} = avatar(sessionCompany(item));
  const badge = el('span', 'logo', initials);
  badge.style.setProperty('--hue', hue);
  return badge;
}
// The sessions most worth opening first: waiting for your answer, a review whose form isn't complete yet, working,
// ready to submit, then the rest (latest first).
const urgency = item => (item.status === 'input' && !sessionReview(item, formReady(item)) ? 0 : sessionReview(item, formReady(item)) && !formReady(item) ? 1
  : isLive(item) && item.status === 'running' ? 2 : sessionReview(item, formReady(item)) ? 3 : 4);
export function bestSession() {
  return [...sessionList].sort((a, b) => urgency(a) - urgency(b) || Date.parse(b.startedAt || 0) - Date.parse(a.startedAt || 0))[0] || null;
}
// The menu's foot: "1 session needs you" (amber), "2 sessions open" (blue), "1 session filled" (green), else how many there are.
function renderNavBadge() {
  const open = sessionList.filter(item => !item.endedAt || sessionReview(item, formReady(item)));
  const needs = open.filter(item => urgency(item) <= 1).length, working = open.filter(item => urgency(item) === 2).length;
  const ready = open.filter(item => urgency(item) === 3).length;
  const {text, tone} = sessionsFoot(needs, working, ready, sessionList.length);
  const {count, tone: countTone} = applyingBadge(sessionList, urgency);
  Object.assign($('nav-applying-badge'), {hidden: !count, textContent: badgeLabel(count), className: `nav-badge tone-${countTone}`, title: text});
  $('nav-sessions').hidden = !sessionList.length;
  $('nav-sessions').className = `nav-sessions tone-${tone}`;
  $('nav-sessions-text').textContent = text;
  $('nav-sessions').title = text;   // one row, cut with an ellipsis when narrow; the full text is here
}
export function renderDock() {
  renderNavBadge();
  const live = sessionList.filter(item => !item.endedAt || item.status === 'done');
  // Not on the sessions page itself (it lists them all): the tray would only repeat what's on screen.
  const onSessionsPage = !document.querySelector('.view[data-view="sessions"]')?.hidden;
  show($('sessions-dock'), sessionList.length > 0 && !onSessionsPage);
  if (!sessionList.length) return;
  const {active: running, waiting} = dockCounts(sessionList, closedForm);
  // Two pills: how many are active (blue), how many wait for you (amber).
  $('sd-summary').replaceChildren(pill(`${running} active`, 'info'), ...(waiting ? [pill(`${waiting} need${waiting === 1 ? 's' : ''} input`, 'warn')] : []));
  $('sd-toggle').setAttribute('aria-expanded', shared.dockOpen);
  $('sessions-dock').classList.toggle('is-closed', !shared.dockOpen);
  const shown = [...(live.length ? live : sessionList)].sort((a, b) => dockOrder(a, closedForm) - dockOrder(b, closedForm)).slice(0, 3);
  $('sd-cards').replaceChildren(...shown.map(item => {
    const [label, tone] = sessionStatus(item);
    const card = el('div', `sd-card tone-${tone}`);
    const words = el('div', 'sd-words');
    const title = el('b', 'focus-headline', `${sessionCompany(item)} · ${sessionTitle(item)}`);
    title.title = title.textContent;
    const state = el('div', 'sd-state');  // the badge, then what it's doing (or asking), on one line under the title
    const note = el('span', 'muted small sd-note', isSubmitted(item) ? 'Marked Applied' : item.status === 'input' ? item.brief || item.note || '' : item.note || '');
    note.title = note.textContent;
    state.append(pill(label, tone, {dot: item.status === 'running'}), note);
    words.append(title, state);
    const action = el('button', item.status === 'input' ? 'primary' : 'secondary', item.status === 'input' ? 'Respond' : item.status === 'done' ? 'Review' : 'Open session');
    action.addEventListener('click', () => openSession(item.id));
    card.addEventListener('click', event => { if (!event.target.closest('button')) openSession(item.id); });  // the whole card
    card.append(sessionLogo(item), words, action);  // stop / open posting: on the session page (⋯), keeping cards compact
    return card;
  }));
}
export function sessionMenu(item) {
  const menu = [{icon: 'external', label: 'Open posting', run: () => window.pilot.openExternal(item.url)}];
  if (isLive(item)) menu.push({label: '⏸ Pause Claude (Esc)', run: () => pauseSession()});
  if (item.resumable && !isSubmitted(item) && resumeOffered()) menu.push({label: '▶ Resume Claude', run: () => resumeSession(item)});
  if (isLive(item)) menu.push({label: '⏹ Stop Claude', run: () => window.pilot.sessionStop(item.id)});
  menu.push({label: '✕ Close this session', danger: true, run: () => closeSession(item)});
  return menu;
}
// Live while Claude works: a ticking duration, and its latest step from the log (the last "●" line it wrote).
export const sessionTail = {};  // the end of each session's output, for its latest step
export function ticking(node, prefix, since) {
  Object.assign(node.dataset, {since, prefix});
  node.textContent = prefix + sessionDuration({startedAt: since});
  return node;
}
// Open or closed as you last left it for this session; until then open while Claude works.
export function openLog(open, remember = true) {
  if (remember && shared.openSessionId) logChoice[shared.openSessionId] = open;
  show($('ss-log-body'), open);
  show($('ss-log-last'), !open);
  $('ss-expand').textContent = open ? 'Collapse log' : 'Expand log';
  $('ss-expand').setAttribute('aria-expanded', open);
  if (open) setTimeout(async () => {
    if (shared.termShownFor !== shared.openSessionId) await attachTerminal(shared.openSessionId);
    else fitTerminal();
    if (remember) shared.xterm?.focus();
  }, 30);
}

// Run at start-up, in the order the window has always done it (app.js calls each page's init in turn).
export async function init() {
  setInterval(() => {
    if (document.querySelector('.view[data-view="sessions"]')?.hidden) return;
    tickSessionClocks(document);
  }, 1000);
}
