// Actions → Runs (owner, 25 Oct 2026: "all the activity runs in-app, not in the drawer"; "I don't want us to keep 2 different views"): the Tasks | Runs
// tabs, the one run list + run panel (.ap-grid) moved between the drawer and this tab (never copied: one design), the list's Task / Status / Date filters,
// the narrow list → detail layout with "Back to runs", and the drawer's "N tasks queued · View queue →". Which run shows: renderer/run-pick.js.
// Guarded by test/run-view.test.js.
import {openMenu} from '../components.js';
import {DATES, STATUS, labelOf, listFilter} from '../run-filters.js';
import {defaultRun, idOf} from '../run-pick.js';
import {shared} from './shared.js';
import {$} from './core.js';
import {openView} from './nav.js';
import {KIND, kindOf, refreshGmailConnection} from './activity-basics.js';
import {lastActivity, renderActivity, unqueue} from './activity-render.js';
import {kindCounts} from '../run-list.js';

let tab = 'tasks';
export const runsTabShown = () => tab === 'runs' && !$('actions-runs').hidden && !document.querySelector('.view[data-view="actions"]')?.hidden;

// Move the list + run panel into a container, keeping what the person had there: open folds and typed answers move with the nodes; scroll
// positions do not survive a move in Chromium, so they are put back.
function mountGrid(host) {
  const grid = document.querySelector('.ap-grid');
  if (!grid || grid.parentElement === host) return;
  const scrolled = ['log', 'activity-recent'].map(id => [$(id), $(id)?.scrollTop || 0]).concat([[grid.querySelector('.ap-detail'), grid.querySelector('.ap-detail')?.scrollTop || 0]]);
  host.append(grid);
  for (const [node, top] of scrolled) if (node) node.scrollTop = top;
}
export const mountInDrawer = () => mountGrid($('activity-panel'));

// The generic entry (no run named): the running task, else the next queued one, else the latest; then kept, whatever starts or ends.
export function pinDefault() {
  if (shared.selectedRun == null && lastActivity) shared.selectedRun = idOf(defaultRun(lastActivity)) || null;
}

export function showTab(name) {
  tab = name;
  document.querySelectorAll('[data-actions-tab]').forEach(button => {
    const on = button.dataset.actionsTab === name;
    button.classList.toggle('is-active', on);
    button.setAttribute('aria-selected', String(on));
  });
  $('actions-tasks').hidden = name !== 'tasks';
  $('actions-runs').hidden = name !== 'runs';
  if (name === 'runs') {
    if (!$('activity-panel').hidden) $('activity-close').click();   // the drawer closes: its run panel moves here
    mountGrid($('actions-runs-body'));
    pinDefault();
    if (lastActivity) renderActivity(lastActivity);
    refreshGmailConnection();   // like the drawer's open (activity-panel.js): Gmail as it is now, for the header button, the schedule and a Gmail run's notes
  }
}

// Open Actions → Runs on a run (its id), or on the one already picked. `filter` sets the list's filters first (View queue → status: queued).
export function showRunsTab(runId, {filter = null} = {}) {
  if (runId !== undefined) shared.selectedRun = runId;
  if (filter) Object.assign(listFilter, filter);
  openView('actions');
  showTab('runs');
  $('actions-runs').classList.toggle('is-detail', runId != null);
}
// Actions opened again: Runs shows its list and panel even if the drawer borrowed them meanwhile.
export function actionsShown() { if (tab === 'runs') mountGrid($('actions-runs-body')); }

// The three filter buttons, with what each keeps now.
export function drawFilters() {
  $('activity-filter').textContent = listFilter.kind ? `Task: ${KIND[listFilter.kind]?.name || listFilter.kind}` : 'Any task';
  $('activity-filter-status').textContent = labelOf(STATUS, listFilter.status);
  $('activity-filter-date').textContent = labelOf(DATES, listFilter.date);
  for (const [id, on] of [['activity-filter', listFilter.kind], ['activity-filter-status', listFilter.status], ['activity-filter-date', listFilter.date]]) $(id).classList.toggle('is-active', !!on);
}
const pick = (key, value) => () => { listFilter[key] = value; renderActivity(lastActivity); };
const menuOf = (key, options) => options.map(([value, label]) => ({label: `${listFilter[key] === value ? '✓ ' : ''}${label}`, run: pick(key, value)}));
const taskMenu = () => [{label: `${listFilter.kind ? '' : '✓ '}Any task`, run: pick('kind', '')}, '-',
  ...kindCounts(lastActivity?.runs || [], kindOf).map(({kind, count}) => ({label: `${listFilter.kind === kind ? '✓ ' : ''}${KIND[kind]?.name || kind} · ${count}`, run: pick('kind', kind)}))];

// The drawer's quiet line when several tasks wait: "3 tasks queued · View queue →" (the queue itself is in Runs, never in the drawer).
export function drawQueueNote(queue = []) {
  $('activity-queue').hidden = queue.length < 2;
  $('activity-queue-text').textContent = `${queue.length} tasks queued`;
}

// A row picked in a narrow window shows its run alone, with Back to runs; the focus follows.
export function rowPicked() {
  $('actions-runs').classList.add('is-detail');
  if (runsTabShown()) $('activity-selected').closest('.ap-detail')?.focus?.({preventScroll: true});
}

export function init() {
  document.querySelectorAll('[data-actions-tab]').forEach(button => button.addEventListener('click', () => showTab(button.dataset.actionsTab)));
  $('activity-filter').addEventListener('click', () => openMenu($('activity-filter'), taskMenu()));
  $('activity-filter-status').addEventListener('click', () => openMenu($('activity-filter-status'), menuOf('status', STATUS)));
  $('activity-filter-date').addEventListener('click', () => openMenu($('activity-filter-date'), menuOf('date', DATES)));
  $('activity-back').addEventListener('click', () => {
    $('actions-runs').classList.remove('is-detail');
    $('activity-recent').querySelector('.recent-row.current')?.focus({preventScroll: true});
  });
  $('activity-open-runs').addEventListener('click', event => { event.preventDefault(); showRunsTab(shared.selectedRun); });
  $('activity-queue-view').addEventListener('click', event => { event.preventDefault(); showRunsTab(undefined, {filter: {status: 'queued'}}); });
  $('activity-unqueue').addEventListener('click', () => { const id = $('activity-unqueue').dataset.id; if (id) unqueue({id}); });
  drawFilters();
}
