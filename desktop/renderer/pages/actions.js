// Actions: every Telegram command.
import {setFilters} from './jobs-filter-menu.js';
import {ai} from '../ai-name.js';
import {shared} from './shared.js';
import {COMMAND_KIND, openActivity, refreshActivity} from './activity.js';
import {$, message, show} from './core.js';
import {el} from '../components.js';
import {openCvChange, showCvChanged} from './cv-change.js';
import {openView} from './nav.js';
import {showStatusCard} from './runs-page.js';
import {initBoard} from './actions-board.js';
import {initActionsLayout} from './actions-layout.js';
import {initReadyCard} from './ready-card.js';
import {initFocusReady} from './focus-ready.js';
import {initFocusIncognito} from './focus-incognito.js';
import {initFocusCheck} from './focus-check.js';

// A pressed task button is held off (syncRunButtons in runs-page.js turns it on again when its task ends); a refusal releases it at once.
const hold = button => { button.disabled = true; button.dataset.runBusy = '1'; };
const release = button => { button.disabled = false; delete button.dataset.runBusy; };

// ---------- actions (every Telegram command) ----------
export function answer(text) { const box = $('command-answer'); delete box.dataset.fallback; show(box); box.textContent = text; box.scrollIntoView({behavior: 'smooth'}); }
// Lists the app already shows: the Jobs list with that filter (the Telegram bot sends them as messages).
const COMMAND_FILTER = {saved: 'saved', applied: 'applied'};

// Run at start-up, in the order the window has always done it (app.js calls each page's init in turn).
export async function init() {
  document.querySelectorAll('[data-command]').forEach(button => button.addEventListener('click', async () => {
    const command = button.dataset.command;
    if (COMMAND_FILTER[command]) {
      openView('jobs');
      setFilters([COMMAND_FILTER[command]]);
      document.dispatchEvent(new CustomEvent('jobs-rerender'));
      return;
    }
    // Only a task that runs in the background opens Recent activity (its row and log); an instant answer
    // (Status, Help) shows right here, not behind the panel.
    const task = !!COMMAND_KIND[command];
    if (task) {
      // On the Actions page its banner and Recent runs follow it; from elsewhere (⌘K), Recent activity opens.
      if (document.querySelector('.view[data-view="actions"]').hidden) openActivity(true);
      show($('actions-result'), false);  // the last result makes way for the one coming
      refreshActivity();
    }
    if (command === 'status') { showStatusCard(); return; }
    hold(button);
    const result = await window.pilot.command(command);
    if (task && !/^⚠️/.test(result?.text || '')) { refreshActivity(); show($('command-answer'), false); return; }   // a started task keeps its button off until it ends (syncRunButtons)
    release(button);  // its row, then its result, show in Recent activity
    answer(result.text + (result.telegram ? '\n\n(Also sent to Telegram.)' : ''));
  }));
  // Tailor CVs for top matches: a tracked task like the others, so the banner, Recent activity and the result follow it; only a refusal (Notion, allowance, nothing to do) is answered here.
  $('tailor-top').addEventListener('click', async event => {
    const button = event.currentTarget, count = Math.max(1, Math.min(10, Number($('tailor-top-n').value) || 5));
    show($('actions-result'), false);
    hold(button);
    const result = await window.pilot.tailorTop(count).catch(error => ({text: `⚠️ ${error.message}`}));
    if (result?.started) { refreshActivity(); show($('command-answer'), false); return; }   // the Actions page keeps Run off while the task runs, and on again when it ends
    release(button);
    answer(result?.text || result?.error || 'Done.');
  });
  $('tailor-top-n').addEventListener('keydown', event => { if (event.key === 'Enter') { event.preventDefault(); $('tailor-top').click(); } });   // Enter in the count box = Run
  // Find jobs using your browser (owner, 7 Oct 2026): Run opens a dialog with the sites from the engine, all ticked but the ones read in the
  // last week; "Read N sites" opens them in Chrome `at once` at a time, where the extension filters and reads each; a tracked task like
  // Tailor CVs. The card itself is only Run, the same size as its siblings. How many at a time and the filter are remembered (this Mac).
  const VISIT_PREFS = 'visits-dialog', plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;
  try {
    const saved = JSON.parse(localStorage.getItem(VISIT_PREFS) || '{}');
    if (saved.atOnce) $('visits-at-once').value = saved.atOnce;
    if (typeof saved.filter === 'boolean') $('visits-filter').checked = saved.filter;
  } catch {}
  // The dialog's two tabs (the app's .tabs, as Strategy's): which list shows.
  let visitsTab = 'visits-sites';
  const showVisitsTab = id => {
    visitsTab = id;
    for (const tab of document.querySelectorAll('#visits-tabs [data-tab]')) {
      const on = tab.dataset.tab === id;
      tab.classList.toggle('is-active', on);
      tab.setAttribute('aria-selected', String(on));
      $(tab.dataset.tab).hidden = !on;
    }
  };
  const visitBoxes = () => [...document.querySelectorAll('#visits-sites input[type=checkbox]')];
  const unreadBoxes = () => [...document.querySelectorAll('#visits-unread input[type=checkbox]')];
  // One row of the dialog: a ticked box, its name and a muted line, and a link that drops it for good (Remove a site, Dismiss a job).
  const visitRow = ({value, ticked, name, note, title, drop, dropTitle, onDrop}) => {
    const row = document.createElement('li');
    const label = document.createElement('label');
    label.className = 'check-row';   // the shared checkbox row (components.css), inside the shared item-rows list
    const box = Object.assign(document.createElement('input'), {type: 'checkbox', checked: ticked, value});
    box.addEventListener('change', countVisits);
    const words = document.createElement('span');
    const bold = document.createElement('b');
    bold.textContent = name;
    const when = document.createElement('span');
    when.className = 'muted';
    when.textContent = note;
    if (title) when.title = title;
    words.append(bold, when);
    label.append(box, words);
    const remove = Object.assign(document.createElement('button'), {type: 'button', className: 'link visits-remove', textContent: drop, title: dropTitle});
    remove.addEventListener('click', async () => {
      remove.disabled = true;
      const done = await onDrop().catch(() => null);
      if (done?.ok) { row.remove(); countVisits(); } else remove.disabled = false;
    });
    row.className = 'visits-row';
    row.append(label, remove);
    return row;
  };
  let visitsLoading = false, visitsAgain = false;   // the list is on its way (the first of the day asks Claude which sites suit your roles: ~10 s)
  const countVisits = () => {
    if (visitsLoading) return;   // 7 Oct 2026: a click while loading said "No sites to read yet · Read 0 sites"
    const ticked = visitBoxes().filter(box => box.checked).length, all = visitBoxes().length;
    const jobs = unreadBoxes().filter(box => box.checked).length, unread = unreadBoxes().length;
    $('visits-lead').textContent = all ? `${plural(all, 'site')} · ${ticked} selected (${visitsAgain ? 'the ones that did not finish last time' : 'the ones not read this week'})` : 'No sites to read yet.';
    // Two tabs when there are jobs we couldn't read, each with its count ticked of all; else the sites alone, no tabs.
    $('visits-sites-count').textContent = `${ticked}/${all}`;
    $('visits-unread-count').textContent = `${jobs}/${unread}`;
    $('visits-tabs').hidden = !unread;
    if (!unread && visitsTab !== 'visits-sites') showVisitsTab('visits-sites');
    $('visits-start').textContent = jobs ? `Read ${ticked ? `${plural(ticked, 'site')}, ` : ''}${plural(jobs, 'job')}` : `Read ${plural(ticked, 'site')}`;
    $('visits-start').disabled = !ticked && !jobs;
  };
  const paintVisits = async () => {
    visitsLoading = true;
    $('visits-lead').textContent = 'The sites to read in your browser';
    for (const id of ['visits-start', 'visits-all', 'visits-none']) $(id).disabled = true;
    // While the list loads (Claude picks the sites that suit your roles, ~5 s): the Jobs list's loading look in the empty list, not a blank
    // dialog (owner, 8 Oct 2026). The list it replaces is not kept: it may be another run's.
    const loading = el('li', 'list-loading');
    loading.append(el('span', 'spinner'), el('div', '', 'Finding your sites…'), el('div', 'muted small', ai('{AI} checks which suit your roles, a few seconds')));
    $('visits-sites').replaceChildren(loading);
    $('visits-tabs').hidden = true;
    showVisitsTab('visits-sites');
    const [answer, stuck] = await Promise.all([window.pilot.visitsList().catch(() => null), window.pilot.visitsStuck().catch(() => null)]);
    visitsLoading = false;
    // Run again on a run: its sites, not this week's default (pages/activity.js, renderer/visits-card.js rerunSites)
    const again = shared.visitsPreselect;
    shared.visitsPreselect = null;
    const plainUrl = url => String(url || '').toLowerCase().replace(/^https?:\/\/(www\.)?/, '').replace(/[#?].*$/, '').replace(/\/$/, '');
    const wanted = again ? {names: new Set(again.map(site => site.name)), urls: new Set(again.map(site => plainUrl(site.url)))} : null;
    visitsAgain = !!wanted;
    for (const id of ['visits-all', 'visits-none']) $(id).disabled = false;
    const sites = answer?.visits || [];
    // Ticked: not read this week, and not failing twice in a row (that one says why, unticked). Remove: a dead or unwanted site leaves the list for good (owner, 7 Oct 2026).
    const tickedSite = site => (wanted ? wanted.names.has(site.name) || wanted.urls.has(plainUrl(site.url)) : !site.failing && (site.kind === 'portal' || !site.last_read));
    // The ticked ones first (owner, 8 Oct 2026: on Run again, the 4 ticked sites were below 12 unticked ones, out of sight).
    const ordered = [...sites.filter(tickedSite), ...sites.filter(site => !tickedSite(site))];
    $('visits-sites').replaceChildren(...ordered.map(site => visitRow({value: site.url,
      ticked: tickedSite(site),
      name: site.kind === 'portal' ? `${site.name} · your search` : `${site.name} (${new URL(site.url).hostname.replace(/^www\./, '')})`,
      note: site.last_read ? `read ${site.last_read.slice(0, 10)}` : 'never read', title: site.note,
      drop: 'Remove', dropTitle: 'Not offered again', onDrop: () => window.pilot.visitsHide(site.url)})));
    // Jobs in your places whose posting only your browser can open: ticked (not on Run again of a run, which is about its sites); Dismiss: not offered again.
    // A site that asked us to slow down (429) waits for its next try, unticked: a browser read now would be asked the same (owner, 20 Oct 2026).
    const nextTry = job => (job.waiting_until ? ` · waiting: the site asked us to slow down, next try ${new Date(job.waiting_until * 1000).toLocaleTimeString([], {hour: '2-digit', minute: '2-digit'})}` : '');
    $('visits-unread').replaceChildren(...(stuck?.jobs || []).map(job => visitRow({value: job.url, ticked: !wanted && !job.waiting_until,
      name: job.company ? `${job.title} · ${job.company}` : job.title, note: `${job.location ? `${job.location} · ` : ''}${new URL(job.url).hostname.replace(/^www\./, '')}${nextTry(job)}`,
      drop: 'Dismiss', dropTitle: 'Not offered again', onDrop: () => window.pilot.visitsDismiss(job.url)})));
    countVisits();
  };
  $('visits-run').addEventListener('click', () => {
    if (!$('visits-dialog').open) $('visits-dialog').showModal();
    paintVisits();
  });
  for (const id of ['visits-close', 'visits-cancel']) $(id).addEventListener('click', () => $('visits-dialog').close());
  // Select all / none: the open tab's list only.
  const shownBoxes = () => (visitsTab === 'visits-unread' ? unreadBoxes() : visitBoxes());
  $('visits-all').addEventListener('click', () => { for (const box of shownBoxes()) box.checked = true; countVisits(); });
  $('visits-none').addEventListener('click', () => { for (const box of shownBoxes()) box.checked = false; countVisits(); });
  for (const tab of document.querySelectorAll('#visits-tabs [data-tab]')) tab.addEventListener('click', () => showVisitsTab(tab.dataset.tab));
  $('visits-start').addEventListener('click', async () => {
    const urls = visitBoxes().filter(box => box.checked).map(box => box.value), postings = unreadBoxes().filter(box => box.checked).map(box => box.value);
    const atOnce = Math.min(5, Math.max(1, Number($('visits-at-once').value) || 2)), filter = $('visits-filter').checked;
    try { localStorage.setItem(VISIT_PREFS, JSON.stringify({atOnce, filter})); } catch {}
    $('visits-dialog').close();
    const button = $('visits-run');
    show($('actions-result'), false);
    hold(button);
    const result = await window.pilot.visitsRun({urls, postings, atOnce, filter}).catch(error => ({text: `⚠️ ${error.message}`}));
    if (result?.started) { refreshActivity(); show($('command-answer'), false); return; }
    release(button);
    answer(result?.text || result?.error || 'Done.');
  });
  initBoard({answer});   // Read this board: its card and dialog (actions-board.js)
  initFocusCheck();   // a captcha held in the hidden window: one line + Show the check (focus-check.js)
  initFocusIncognito();   // one line when refused sites wait for Chrome's Allow in Incognito (focus-incognito.js)
  initFocusReady();   // Ready to send on Focus: one line above Up next, owner only (focus-ready.js)
  initReadyCard();   // Ready to send: its card, only on the owner's install (ready-card.js)
  initActionsLayout();   // the More group for the smaller tasks, the schedule lines (actions-layout.js)
  $('visits-at-once').addEventListener('keydown', event => { if (event.key === 'Enter') { event.preventDefault(); if (!$('visits-start').disabled) $('visits-start').click(); } });
  // Replace CV: the new file is used for uploads at once; the review of what it changes in the Profile (and so in
  // the fit scores) is offered, never applied by itself.
  $('replace-cv').addEventListener('click', async () => {
    const name = await window.pilot.chooseCv();
    if (!name) return;
    shared.state = await window.pilot.state();
    $('contact-cv').textContent = name;
    message('strategy-message', `CV replaced: ${name}. New applications use it now. Review what it changes in your strategy when you're ready.`, 'ok');
    showCvChanged();
  });
  $('strategy-cv-review').addEventListener('click', openCvChange);
}
