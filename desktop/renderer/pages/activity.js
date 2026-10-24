// Recent activity: the bar at the bottom of every screen and its panel. This file keeps init() (the start-up wiring) and re-exports the rest of the panel,
// which lives in activity-*.js (basics, visits, results, render, run-card, mail, cards, panel, few-jobs). Guarded by the tests that read activity-*.js (test/activity-source.js).
import {openMenu, toggleOnBar} from '../components.js';
import {shared} from './shared.js';
import {openSetting} from './settings.js';
import {$, show} from './core.js';
import {loadJobs, renderJobs} from './jobs.js';
import {loadFocus} from './focus.js';
import {openView} from './nav.js';
import {showFullReport} from './full-report.js';
import {renderSessionPage} from './session-log.js';
import {renderDock} from './sessions.js';
import {CHECK_MS} from '../session-state.js';
import {toastMessage} from './startup.js';
import {stopRunning} from '../stop-task.js';
import {showSearchStatus} from './activity-basics.js';
import {renderFindCard} from './jobs-find.js';
import {showKeptStatusBar} from './activity-results.js';
import {rerunKind} from './activity-problem-box.js';
import {lastActivity, PANEL_HEIGHT, setPanelHeight, foldedWarnings, detailRunId, renderActivity, showMoreRuns, setFoldedWarnings} from './activity-render.js';
import {showJumpToLatest, refreshActivity} from './activity-run-card.js';
import {filterMenu, openActivity, announceRuns, refreshCv, QUESTIONS, currentAnswers} from './activity-panel.js';
let wasRunning = false;
let answersTimer;
// Run at start-up, in the order the window has always done it (app.js calls each page's init in turn).
// Every upcoming check shows, unless they don't fit the strip: then only the soonest and "+N" (style.css .is-tight).
export async function init() {
  showKeptStatusBar();
  $('log').addEventListener('click', event => {
    const link = event.target.closest('a.log-link');
    if (!link) return;
    event.preventDefault();
    if (/notion\.(so|com)\//.test(link.href)) window.pilot.openNotion(link.href, event.metaKey);
    else window.pilot.openExternal(link.href);
  });
  $('activity-stop').addEventListener('click', event => stopRunning(event.currentTarget));
  for (const id of ['activity-notion', 'activity-github']) $(id).addEventListener('click', event => {
    event.preventDefault();
    if (event.currentTarget.dataset.url) window.pilot.openExternal(event.currentTarget.dataset.url);
  });
  $('activity-filter').addEventListener('click', () => openMenu($('activity-filter'), filterMenu()));
  // ↑/↓ walk Recent activity while the panel is open: the neighbouring run opens, as if clicked. It does not depend on where
  // the focus is (every redraw of the list can drop it, and with live data one does come at any moment): it starts from the
  // current row. Typing in a field, an open menu and modifier keys keep their own arrows. Waiting runs have nothing to open.
  document.addEventListener('keydown', event => {
    if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return;
    if ($('activity-panel').hidden || event.defaultPrevented || event.metaKey || event.ctrlKey || event.altKey || event.shiftKey) return;
    if (event.target.closest?.('input, textarea, select, [contenteditable], [role="menu"], [role="listbox"], .menu')) return;
    const rows = [...$('activity-recent').querySelectorAll('.recent-row:not([data-state="queued"])')];
    const next = rows[rows.findIndex(row => row.classList.contains('current')) + (event.key === 'ArrowDown' ? 1 : -1)];
    event.preventDefault();
    if (!next) return;
    next.click();
    $('activity-recent').querySelector('.recent-row.current')?.scrollIntoView({block: 'nearest'});
  });
  // The panel's top edge drags: taller upward (it sits on the bottom bar), kept for next time, re-clamped when the
  // window changes. Between PANEL_MIN and 90% of the window.
  try { const saved = Number(localStorage.getItem(PANEL_HEIGHT) || 0); if (saved) setPanelHeight(saved, false); } catch {}
  $('activity-resize').addEventListener('pointerdown', event => {
    event.preventDefault();
    const grip = $('activity-resize'), startY = event.clientY, startHeight = $('activity-panel').getBoundingClientRect().height;
    try { grip.setPointerCapture(event.pointerId); } catch {}
    grip.classList.add('is-dragging');
    const move = moved => setPanelHeight(startHeight + (startY - moved.clientY), false);
    const stop = () => {
      grip.classList.remove('is-dragging');
      grip.removeEventListener('pointermove', move);
      grip.removeEventListener('pointerup', stop);
      grip.removeEventListener('pointercancel', stop);
      setPanelHeight($('activity-panel').getBoundingClientRect().height);
    };
    grip.addEventListener('pointermove', move);
    grip.addEventListener('pointerup', stop);
    grip.addEventListener('pointercancel', stop);
  });
  window.addEventListener('resize', () => {
    const height = $('activity-panel').getBoundingClientRect().height;
    if (height) setPanelHeight(height, false);
  });
  // The Anthropic console, where the spending limit lives: the warning card's one action.
  // Focus was read again (an answer saved in the popup, or a refresh): the question's state on the open card changes with it.
  document.addEventListener('focus-rendered', () => { if (lastActivity && !$('activity-panel').hidden) renderActivity(lastActivity); });
  $('activity-warnings-fix').addEventListener('click', event => {
    event.preventDefault();
    const {view, rerun, sites} = event.currentTarget.dataset;
    if (rerun) rerunKind(rerun, sites ? JSON.parse(sites) : null); else if (view) openView(view);   // a browser run's dialog ticks this run's sites (pages/actions.js)
  });
  $('log').addEventListener('scroll', showJumpToLatest);
  $('log-latest').addEventListener('click', () => { $('log').scrollTop = $('log').scrollHeight; showJumpToLatest(); });
  $('activity-log').addEventListener('click', event => { if ($('activity-log').classList.contains('is-empty') && event.target.closest('summary')) event.preventDefault(); });
  $('activity-warnings-log').addEventListener('click', event => {
    event.preventDefault();
    $('activity-log').open = true;
    $('activity-log').scrollIntoView({block: 'nearest', behavior: 'smooth'});
  });
  $('activity-partial-details').addEventListener('click', () => {
    $('activity-log').open = true;
    $('activity-log').scrollIntoView({block: 'nearest', behavior: 'smooth'});
  });
  $('activity-warnings-external').addEventListener('click', event => { const url = event.currentTarget.dataset.url; if (url) window.pilot.openExternal(url); });
  $('activity-warnings-limit').addEventListener('click', event => { event.preventDefault(); window.pilot.openExternal('https://console.anthropic.com/settings/limits'); });
  $('activity-warnings-fold').addEventListener('click', () => {
    setFoldedWarnings(foldedWarnings === String(detailRunId) ? '' : String(detailRunId));
    renderActivity(lastActivity);
  });
  toggleOnBar(document.querySelector('#activity-warnings .ap-warn-head'), () => $('activity-warnings-fold').click());
  $('check-mail').addEventListener('click', async () => {
    if ($('check-mail').dataset.connect) { openView('settings'); return; }
    $('check-mail').disabled = true;
    shared.selectedRun = null;
    try {
      const result = await window.pilot.checkMail();
      if (result.cloud) toastMessage('Gmail check started in your GitHub repo', 'Results arrive in Notion and Telegram in a few minutes.');   // about Notion
    } finally {
      $('check-mail').disabled = false;
      refreshActivity();
    }
  });
  $('activity-toggle').addEventListener('click', () => openActivity($('activity-panel').hidden));
  $('activity-close').addEventListener('click', () => openActivity(false));
  $('activity-warnings-more').addEventListener('click', () => {
    const open = $('activity-warnings-list').hidden;
    show($('activity-warnings-list'), open);
    $('activity-warnings-more').textContent = open ? 'Hide details' : `View ${$('activity-warnings-list').children.length} details`;
  });
  $('activity-report').addEventListener('click', () => {
    const run = lastActivity?.runs?.find(each => each.id === detailRunId);
    if (run?.pageId) showFullReport(run.pageId, {close: () => openActivity(false)});
  });
  $('activity-go').addEventListener('click', () => {
    openActivity(false);
    openView('jobs');
    $('sort-by').value = 'newest';  // the new ones first
    renderJobs();
  });
  $('activity-all').addEventListener('click', () => { showMoreRuns(); renderActivity(lastActivity); });
  $('activity-backdrop').addEventListener('click', () => openActivity(false));
  $('activity-manage').addEventListener('click', event => {
    event.preventDefault();
    openActivity(false);
    openView('settings');
    openSetting('schedule');
  });
  // Close it with Escape, its ✕, the bar ("Hide activity"), or a press outside it and its bar. On pointerdown, so a button
  // that opens it (View activity, Run) still does: it closes first, then the click opens it again.
  document.addEventListener('pointerdown', event => {
    if ($('activity-panel').hidden || event.target.closest('#activity, .ui-menu, .toast, dialog')) return;
    if (event.button === 3 || event.button === 4) return;   // the mouse's back/forward buttons: pages/nav.js steps through history
    openActivity(false);
  });
  // Close it with Escape, its ✕, or the bar ("Hide activity").
  document.addEventListener('keydown', event => { if (event.key === 'Escape' && !$('activity-panel').hidden) openActivity(false); });
  window.addEventListener('focus-updated', () => { if (!$('activity-panel').hidden && lastActivity) renderActivity(lastActivity); });
  window.pilot.runs().then(renderActivity).catch(() => {});  // at once, not after the first 2 s tick
  // Which session tabs are open, at once too: until it is known the session cards say they are checking (CHECK_MS at most).
  window.pilot.formsOpen().then(forms => { shared.formsOpen = forms; renderSessionPage(); renderDock(); }).catch(() => {});
  setTimeout(() => { renderSessionPage(); renderDock(); }, CHECK_MS + 100);
  setInterval(async () => {
    if ($('app').hidden) return;
    const runsNow = await window.pilot.runs();
    const {running} = runsNow;
    renderActivity(runsNow);
    renderFindCard(runsNow);   // the Find jobs card on top of Jobs
    const tabs = new Set(await window.pilot.openTabs());
    if (tabs.size !== shared.openedInChrome.size || [...tabs].some(url => !shared.openedInChrome.has(url))) { shared.openedInChrome = tabs; renderJobs(); }
    const forms = await window.pilot.formsOpen().catch(() => null);
    if (forms && JSON.stringify(forms) !== JSON.stringify(shared.formsOpen)) { shared.formsOpen = forms; renderSessionPage(); }
    if (wasRunning && !running) { loadJobs(); loadFocus(); }  // a check just finished: its jobs, and what it asks of you
    wasRunning = !!running;
    announceRuns(runsNow);
    showSearchStatus();
  }, 2000);
  $('cv-choose').addEventListener('click', async () => {
    const name = await window.pilot.chooseCv();
    if (name) { shared.state = await window.pilot.state(); refreshCv(); }
  });
  for (const [key, id] of Object.entries(QUESTIONS)) if (shared.state.settings.questionnaire?.[key]) $(id).value = shared.state.settings.questionnaire[key];
  for (const id of Object.values(QUESTIONS)) $(id).addEventListener('input', () => {
    clearTimeout(answersTimer);
    answersTimer = setTimeout(() => window.pilot.saveSettings({questionnaire: {...shared.state.settings.questionnaire, ...currentAnswers()}}), 400);
  });
}


export {clockTime, showSearchStatus, stepWords, liveCount, searchPhase, KIND, kindOf, hhmm, capital, outcome, refreshGmailConnection, COMMAND_KIND, TASK_BUTTONS, mailReportOf, cardFor} from './activity-basics.js';
export {renderVisitsCard} from './activity-visits.js';
export {lastActivity, prepareActions, unqueue, renderActivity} from './activity-render.js';
export {showJob, refreshActivity} from './activity-run-card.js';
export {renderMailCard} from './activity-mail.js';
export {renderInsightCard, renderInterviewCard, renderKitsCard, renderWeeklyCard} from './activity-cards.js';
export {PANEL_KEY, panelMemory, openActivity, refreshCv, currentAnswers, buildDraft} from './activity-panel.js';
