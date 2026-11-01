// Jobs → a job's drawer (owner's boards, 10 Oct 2026): a right-side overlay over the unchanged list or board, between the title bar and the
// bottom bars, with a fixed header (ring, title, previous / next, expand, close), the nine tabs (Overview, Match, Description, Application, Documents,
// Interviews, Review, Messages, Timeline) and the tab's content scrolling on its own. The page is read from the store (IPC jobPage,
// lib/job-page-handlers.js), so it is the same on every store. It shares one overlay slot with Recent activity (renderer/overlay-slot.js):
// opening one closes the other, and a job opened from a run says "Back to Recent activity". Opening it never resizes the list.
// Parts: job-drawer/ (header, tabs, parts, one file per tab). Pure words: renderer/job-page-view.js. Guards: test/job-drawer.test.js,
// test/job-panel.test.js, test/job-page-view.test.js.
import {el} from '../components.js';
import {pageParts, tabKey, TABS} from '../job-page-view.js';
import {claimOverlay, registerOverlay, releaseOverlay, reopenOverlay} from '../overlay-slot.js';
import {drawerHeader} from '../job-drawer/header.js';
import {button, skeleton, stateCard} from '../job-drawer/parts.js';
import {BODIES} from '../job-drawer/tabs-body.js';
import {tabStrip} from '../job-drawer/tabs.js';
import {$} from './core.js';
import {shared} from './shared.js';
import {plainError} from '../run-warnings.js';

const state = {url: '', job: null, page: null, stage: 'none', restError: '', tab: 'overview', tabs: new Map(), expanded: false, asked: 0, back: null};
export const panelUrl = () => state.url;

// The jobs on screen, in order (the list's rows or the board's cards): what previous / next walk through.
const shownUrls = () => [...document.querySelectorAll(`${$('jobs-board').hidden ? '#jobs-body .job-row' : '#jobs-board .board-card'}[data-url]`)]
  .map(node => node.dataset.url).filter(Boolean);

function neighbour(step) {
  const urls = shownUrls(), at = urls.indexOf(state.url) + step;
  const url = urls[at];
  return url && (shared.allJobs || []).find(job => job.url === url);
}

function footer(job, page) {
  const bar = el('footer', 'jd-foot');
  bar.append(button('Open posting ↗', () => window.pilot.openExternal(job.url)));
  if (page?.links && job.notion_url) bar.append(button('Open in Notion ↗', event => window.pilot.openNotion(job.notion_url, event.metaKey)));
  return bar;
}

// The next-interview bar's Prepare: the interview prep dialog (pages/prep.js, as Focus opens it) for this job's application. Loaded when asked: prep.js opens this panel.
async function prepare() {
  const {job, page} = state;
  const {openPrep} = await import('./prep.js');
  openPrep({page_id: page.app.id, job: job.title, company: job.company, via: '', url: job.url, notion_url: job.notion_url || '', badge: ''});
}

function pick(key) {
  state.tab = key;
  state.tabs.set(state.url, key);
  draw();
}

function draw() {
  const {job, page} = state, panel = $('job-panel');
  const urls = shownUrls(), index = urls.indexOf(state.url);
  const head = drawerHeader(job, page, {
    at: index < 0 ? null : {index, total: urls.length}, expanded: state.expanded,
    back: state.back && {label: state.back.label, run: goBack},
    on: {prev: () => go(-1), next: () => go(1), interviews: () => pick('interviews'), prepare: prepare, expand: () => { state.expanded = !state.expanded; draw(); }, close: closeJobPanel},
  });
  panel.classList.toggle('is-expanded', state.expanded);
  const tabs = tabStrip(TABS, state.tab, pick);
  const body = el('div', 'jd-body');
  const failed = page?.error || state.restError;
  if (page?.error) {
    body.append(stateCard({icon: 'alert', tone: 'bad', title: 'Could not read this job', text: plainError(page.error),
      actions: [button('Retry', () => load(job))]}));   // Retry only after a failure
  } else if (state.tab === 'overview' && (state.stage !== 'none' || job.fit != null)) {
    // The Overview reads the list row's own facts first (matchView), so it is drawn at once; the store's answer only adds to it.
    body.append(...BODIES.overview({job, page: page || {}, parts: pageParts(page || {}), close: closeJobPanel, pick, reload: () => load(job)}, draw));
  } else if (state.stage !== 'full') {
    if (failed) body.append(stateCard({icon: 'alert', tone: 'bad', title: 'Could not read this job', text: state.restError, actions: [button('Retry', () => load(job))]}));
    else body.append(...skeleton());
  } else body.append(...BODIES[state.tab]({job, page, parts: pageParts(page), close: closeJobPanel, pick, reload: () => load(job)}, draw));
  panel.replaceChildren(head, tabs, body, footer(job, page));
  panel.setAttribute('aria-label', `${job.title}, job details`);
}

function go(step) {
  const next = neighbour(step);
  if (next) openJobPanel(next);
}

// The page arrives in three reads (job-page-handlers.js): core (the header and the Overview), rest (the other tabs), files (screenshots and documents,
// downloaded, so last). Each one redraws; a later click wins (state.asked).
async function load(job) {
  state.page = null;
  state.stage = 'none';
  state.restError = '';
  draw();
  const asked = ++state.asked;
  const current = () => asked === state.asked && state.url === job.url;
  const ask = (name, ...args) => window.pilot[name](job.url, ...args).catch(error => ({error: error.message}));
  const core = await ask('jobPageCore');
  if (!current()) return;
  if (core?.error) { state.page = core; draw(); return; }
  state.page = {...core, sections: {}, kit: null, events: [], files: [], interviews: []};
  state.stage = core.app ? 'core' : 'full';   // no application: nothing more to read
  draw();
  if (!core.app) return;
  const rest = await ask('jobPageRest', core.app.id);
  if (!current()) return;
  if (rest?.error) { state.restError = rest.error; draw(); return; }
  state.page = {...state.page, ...rest};
  state.stage = 'full';
  draw();
  const files = await ask('jobPageFiles', core.app.id);
  if (!current() || !Array.isArray(files)) return;   // screenshots that fail to read are left out, never a failed page
  state.page = {...state.page, files};
  draw();
}

// Opens (or switches) the drawer on a job; `tab` picks a tab (a kit chip opens Application, the score ring's "Open full details" Match);
// the same job keeps the tab it was on.
export async function openJobPanel(job, tab = '') {
  const displaced = claimOverlay('job');
  if (displaced) state.back = {name: displaced, label: displaced === 'activity' ? 'Recent activity' : displaced};
  else if (!state.url) state.back = null;
  state.job = job;
  state.url = job.url;
  state.tab = tab ? tabKey(tab) : state.tabs.get(job.url) || 'overview';
  $('job-drawer-layer').hidden = false;
  for (const row of document.querySelectorAll('.job-row, .board-card')) row.classList.toggle('is-selected', row.dataset.url === job.url);
  await load(job);
}

export function closeJobPanel() {
  if (!state.url) return;
  state.url = '';
  state.asked++;
  releaseOverlay('job');
  $('job-drawer-layer').hidden = true;
  for (const row of document.querySelectorAll('.job-row.is-selected, .board-card.is-selected')) row.classList.remove('is-selected');
}

function goBack() {
  const name = state.back?.name;
  closeJobPanel();
  state.back = null;
  if (name) reopenOverlay(name);
}

registerOverlay('job', {close: closeJobPanel, open: () => state.job && openJobPanel(state.job)});
$('job-drawer-backdrop').addEventListener('click', closeJobPanel);
document.addEventListener('keydown', event => { if (event.key === 'Escape' && state.url && !event.defaultPrevented) closeJobPanel(); });
