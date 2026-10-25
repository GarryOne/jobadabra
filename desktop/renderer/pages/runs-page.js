// Status card and the Actions page.
import {el, pill} from '../components.js';
import {icon} from '../icons.js';
import {shared} from './shared.js';
import {COMMAND_KIND, KIND, TASK_BUTTONS, capital, clockTime, hhmm, kindOf, stepWords, openActivity, outcome} from './activity.js';
import {$, runWhen, show} from './core.js';
import {openView} from './nav.js';
import {runPill, telegramHealth} from '../run-status.js';
import {showStop, stopRunning} from '../stop-task.js';
import {refreshBusy} from '../search-changed.js';
import {showRunsTab} from './runs-tab.js';

// Status: what's running, the last and next search, the last and next Gmail check, as a small card.
export async function showStatusCard() {
  const data = await window.pilot.runs();
  const {running, runs, nextSearchAt, nextMailAt} = data;
  const lastSearch = runs.find(run => kindOf(run) === 'search'), lastMail = runs.find(run => kindOf(run) === 'mail');
  const when = at => (at <= Date.now() ? 'due now' : `${new Date(at).toLocaleDateString([], {weekday: 'short'})} ${hhmm(at)}`);
  const rows = [
    running && ['▶️', 'Running now', `${KIND[kindOf(running)].icon} ${KIND[kindOf(running)].name} · ${stepWords(running.step) || 'starting'}`],
    ['🔎', 'Last refresh', lastSearch ? `${clockTime(lastSearch.endedAt || lastSearch.startedAt)} · ${capital(outcome(lastSearch))}` : 'none yet'],
    ['⏭', 'Next refresh', nextSearchAt ? when(nextSearchAt) : 'only when you ask'],
    ['📧', 'Last Gmail check', lastMail ? `${clockTime(lastMail.endedAt || lastMail.startedAt)} · ${capital(outcome(lastMail))}` : 'none yet'],
    ['⏭', 'Next Gmail check', nextMailAt ? when(nextMailAt) : 'off'],
  ].filter(Boolean);
  const card = $('status-card');
  card.replaceChildren(el('h2', '', '🩺 Status'), ...rows.map(([glyph, label, value]) => {
    const row = el('div', 'status-row');
    row.append(el('span', 'status-glyph', glyph), el('span', 'muted', label), el('b', '', value));
    return row;
  }));
  const more = Object.assign(el('a', 'link small', 'View all runs →'), {href: '#'});
  more.addEventListener('click', event => { event.preventDefault(); showRunsTab(); });
  card.append(more);
  show(card);
  show($('command-answer'), false);
  card.scrollIntoView({behavior: 'smooth', block: 'nearest'});
}

// Actions page: the live banner (what runs now), Recent runs, and Telegram's state. Fed by the activity data.
const TASK_ICON = {search: 'search', mail: 'mail', insight: 'chart', weekly: 'file', today: 'send', scout: 'building', kits: 'file-text', tailor: 'scissors'};
const TASK_TITLE = {search: 'Find jobs', mail: 'Gmail & Calendar check', insight: 'Insight', weekly: 'Analyze my job search', kits: 'Prepare top matches', tailor: 'Tailor CV + cover letter for top matches',
  today: "Today's matches", scout: 'More employers'};
// Every button that starts a task is off while that task runs or waits (a second press would only join it), and back when it ends: the Actions cards, Tailor CVs, and the same
// task's other buttons (Jobs → Refresh jobs, Settings → Check Gmail now). `busy` is the kinds running or queued now. Only a button this turned off is turned on again.
export function syncRunButtons(busy) {
  refreshBusy(busy.includes('search'));   // "Your search changed" goes while a refresh applies it
  const set = (node, kind) => {
    if (!node) return;
    const now = busy.includes(kind);
    if (now) {
      if (!node.disabled) { node.disabled = true; node.dataset.runBusy = '1'; }
      if (node.dataset.title0 === undefined) node.dataset.title0 = node.title || '';
      node.title = `${(TASK_TITLE[kind] || KIND[kind]?.name || 'This task')} is running: follow it in the banner above`;
    } else if (node.dataset.runBusy) {
      node.disabled = false; delete node.dataset.runBusy;
    }
    if (!now && node.dataset.title0 !== undefined) { node.title = node.dataset.title0; delete node.dataset.title0; }
  };
  for (const node of document.querySelectorAll('.action[data-command]')) if (COMMAND_KIND[node.dataset.command]) set(node, COMMAND_KIND[node.dataset.command]);
  for (const [kind, ...selectors] of TASK_BUTTONS) for (const selector of selectors) set(document.querySelector(selector), kind);
}
let actWired = false;
export function renderActionsPage(data) {
  if (!actWired && $('run-banner-act')) { actWired = true; $('run-banner-act').addEventListener('click', () => window.pilot.focusBrowser()); }
  if (!data) return;
  const {running, runs = []} = data;
  const connected = !!(shared.state.settings.telegramChatId || shared.state.settings.telegramCloud);
  const blocked = connected && telegramHealth(runs) === 'blocked';   // the last message was refused: a saved token is not a working bot
  $('actions-telegram').replaceChildren(el('span', `dot ${blocked ? 'is-warn' : connected ? 'is-on' : ''}`),
    document.createTextNode(blocked ? 'Telegram not delivering' : connected ? 'Telegram connected' : 'Telegram not connected'));
  show($('run-banner'), !!running);
  showStop($('run-banner-stop'), running);
  syncRunButtons([running, ...(data.queued || [])].filter(Boolean).map(kindOf));
  // The menu says so too, on every screen: a spinner on Actions while a task runs (not a count: the other badges mean "waiting for you").
  const dot = $('nav-actions-running');
  dot.hidden = !running;
  dot.title = running ? `${TASK_TITLE[kindOf(running)] || KIND[kindOf(running)]?.name || 'A task'} is running` : '';
  dot.setAttribute('aria-label', dot.title);
  if (running) {
    const kind = kindOf(running);
    $('run-banner-title').textContent = `${TASK_TITLE[kind] || KIND[kind]?.name || 'A task'} is running`;
    $('run-banner-step').textContent = `Started ${new Date(running.startedAt).toLocaleTimeString([], {hour: '2-digit', minute: '2-digit'})} · ${stepWords(running.step) || 'starting'}`;
    // Waiting on the person (Find jobs using your browser: the one-time Allow in Chrome): the one action, as a primary button, not text only (owner, 7 Oct 2026).
    const waitsOnYou = /^⏳ Waiting for you in Chrome/.test(String(running.step ?? ''));
    $('run-banner-act').hidden = !waitsOnYou;
    $('run-banner-act').textContent = /press Read/.test(String(running.step ?? '')) ? 'Go to Chrome' : 'Go to Chrome and allow';   // a held board waits for Read, not for Allow
    const spinner = document.querySelector('#run-banner .spinner');
    if (spinner) spinner.hidden = waitsOnYou;   // blocked on the person: no "working" spinner, the button says what to do
    const log = $('run-banner-log');
    log.hidden = !running.rowUrl;
    log.dataset.url = /^https:\/\//.test(running.rowUrl || '') ? running.rowUrl : '';   // a store ref (data kept on this Mac: store:cron_runs/…) is no web page
  }
  const rows = runs.slice(0, 5).map(run => {
    const kind = kindOf(run);
    const [label, tone] = runPill(run);
    const li = el('li', 'runs-row');
    li.dataset.runId = run.id;   // which run this row is (the end-to-end suite opens a run by it)
    const tile = el('span', 'task-tile small');
    tile.append(icon(TASK_ICON[kind] || 'pulse'));
    li.append(tile, el('b', '', KIND[kind]?.name || 'Task'), pill(label, tone), el('span', 'muted', runWhen(run.endedAt || run.startedAt)),
      el('span', 'muted runs-result', capital(outcome(run))), el('span', 'runs-go', '›'));
    li.addEventListener('click', () => showRunsTab(run.id));   // in the app, on that run (owner, 25 Oct 2026)
    return li;
  });
  $('runs-table').replaceChildren(...(rows.length ? rows : [el('li', 'muted runs-empty', 'Nothing has run yet. Press Run on a task above.')]));
}

// Run at start-up, in the order the window has always done it (app.js calls each page's init in turn).
export async function init() {
  $('run-banner-log').addEventListener('click', event => { 
    event.preventDefault();
    const url = event.currentTarget.dataset.url;
    if (url) window.pilot.openExternal(url);
    else { shared.selectedRun = null; openActivity(true); }   // no web page for the log: the running task's own log, in Recent activity
  });
  $('run-banner-stop').addEventListener('click', event => stopRunning(event.currentTarget));
  $('run-banner-view').addEventListener('click', () => { shared.selectedRun = null; openActivity(true); });   // null = the running task, not whichever row was open last
  $('actions-result-close').addEventListener('click', () => show($('actions-result'), false));
  $('runs-all').addEventListener('click', event => { event.preventDefault(); showRunsTab(); });
  $('actions-automation').addEventListener('click', event => {
    event.preventDefault();
    openView('settings');
    document.getElementById('setting-schedule')?.scrollIntoView({behavior: 'smooth', block: 'start'});
  });
}
