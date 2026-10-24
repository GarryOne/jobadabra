// Recent activity: the run card (a run's message as counts and items), its skeleton and the job box.
// Split out of activity.js as a pure move. Guarded by the tests that read the activity-*.js sources (desktop/test/activity-source.js) and the e2e activity suites.
import {el, pill} from '../components.js';
import {fitTooltip} from '../jobs-view.js';
import {jobActions, jobHeadline, withListJob} from '../job-link.js';
import {byFit, runItems, runNewCount} from '../run-cards.js';
import {shared} from './shared.js';
import {$, show} from './core.js';
import {fullKey, showJobsIn} from './jobs.js';
import {openView} from './nav.js';
import {hhmm} from './activity-basics.js';
import {lastActivity, renderActivity} from './activity-render.js';
import {openActivity} from './activity-panel.js';
import {withFewJobsHelp} from './activity-few-jobs.js';
import {problemBox} from './activity-problem-box.js';
export function showJumpToLatest() {
  const log = $('log');
  show($('log-latest'), !!log && $('activity-log').open && !!lastActivity?.running && log.scrollHeight - log.scrollTop - log.clientHeight >= 40);
}
export function showRunJob(runJob) {
  const job = withListJob(runJob, shared.allJobs || []);
  show($('activity-job'), !!job);
  if (!job) return;
  $('activity-job-title').textContent = jobHeadline(job);
  const key = JSON.stringify([job.url, job.jobUrl, job.title]);
  if ($('activity-job-links').dataset.for === key) return;  // redrawn every 2 s: keep the buttons (and their focus)
  $('activity-job-links').dataset.for = key;
  $('activity-job-links').replaceChildren(jobActions(job, {openNotion: window.pilot.openNotion, show: showJob}));
}
export function showJob(job) {
  openActivity(false);
  openView('jobs');
  showJobsIn(job.title || 'Logged job', [job.jobUrl]);
}
// Text with its web addresses as links (the run's Notion page, a GitHub run…); the log's click handler opens them.
export function linked(text) {
  return text.split(/(https?:\/\/[^\s<>"')\]]+)/).map((part, i) => i % 2
    ? Object.assign(document.createElement('a'), {href: part, textContent: part, className: 'log-link'})
    : document.createTextNode(part));
}
// Re-render soon (log lines arrive in bursts; one read of the run state per burst).
let activityTimer = null;
export function refreshActivity() {
  if (activityTimer) return;
  activityTimer = setTimeout(async () => { activityTimer = null; renderActivity(await window.pilot.runs()); }, 250);
}
let expandedCard = '';  // the employers card showing all its rows (by its companies)
// A run's message as a card: a row of counts, then one line per item (the full text: Open in Notion).
export function renderRunCard(card, run = null, target = $('activity-card')) {
  // One light line of counts ("37 open · 2 in your places · 18 applied"), then one line per item.
  // A count the message does not carry is left out, never drawn as "–" (#309: three dashes beside "4 new this run").
  const stat = (value, label) => { if (value == null) return ''; const cell = el('span', 'run-card-stat'); cell.append(el('b', '', String(value)), ` ${label}`); return cell; };
  const stats = el('div', 'run-card-stats');
  const rows = el('ol', 'run-card-rows');
  let heading, more = null, help = null;
  if (card.kind === 'digest') {
    // One number leads (owner, 24 Oct 2026: "too many numbers"): the jobs this run added to the list, as the toast and footer say (#1408). Scoring and its queue are
    // internal and never drawn; the digest's open, in-your-places and applied counts are not shown either (owner, 24 Oct 2026: "Do we need them? I don't think so"). The digest's "N new" counts jobs first seen since the last digest, which can include earlier runs'.
    const fresh = runNewCount(run, card);
    stats.append(stat(fresh, `job${fresh === 1 ? '' : 's'} added to your list`));
    // A run that found nothing new lists no jobs: the digest's "top matches" are the best open jobs from any run, and shown here they read as
    // this run's finds (owner, 6 Oct 2026: two runs in a row "found" the same two jobs). Its open jobs stay one click away, in Jobs.
    const nothingNew = fresh === 0;
    // Only this run's finds: the older jobs that fill the digest's page are not this run's, and stay in Jobs (run-cards.js runItems).
    const items = nothingNew ? [] : runItems(card);
    const onlyNew = items.length < card.items.length || items.some(item => item.section === 'new');
    heading = nothingNew ? 'No new jobs this run' : onlyNew ? 'Top new since your last digest' : 'Top matches';
    rows.append(...byFit(items).slice(0, 3).map(item => {   // highest fit first, unscored last
      const row = el('li', 'run-card-row');
      // Two lines: the job, then who it is with. Its fit as a pill when it has a score; the posting opens from the arrow.
      const words = el('span', 'run-card-words');
      words.append(el('b', '', item.title), el('span', 'muted', [item.company, item.percent != null ? `${item.percent}%` : ''].filter(Boolean).join(' · ')));
      const scored = item.fit != null;
      // A job with no score shows no pill (owner, 24 Oct 2026: no scoring words on a basic card); a scored one shows its fit.
      const fit = scored ? pill(String(item.fit), item.fit >= 70 ? 'warn' : 'neutral') : null;
      if (fit) fit.title = fitTooltip(item.fit);
      const view = Object.assign(el('a', 'run-card-open', '↗'), {href: '#', title: 'Open the job posting'});
      view.dataset.link = item.url;
      row.append(words, ...(fit ? [fit] : []), ...(item.url ? [view] : []));
      return row;
    }));
    // "View all 9 in Jobs" shows exactly those nine, not the whole list: the Jobs page gets a filter for this run's
    // matches (pages/jobs.js showJobsIn, the same one a Focus funnel step uses), with its own label to clear. The count
    // is what the list really holds: a "new since last run" posting that was never scored (an AI limit) has no row
    // there, and the button must not promise it (owner, 30 Sep: 9 on the card, 8 on the page).
    const label = `${heading}${run?.startedAt ? ` · ${hhmm(Date.parse(run.startedAt))}` : ''}`;
    const urls = items.map(item => item.url).filter(Boolean);   // nothing new: Jobs as it is, not a filter of older jobs
    const known = new Set((shared.allJobs || []).map(job => fullKey(job.url)));
    const here = urls.length && known.size ? urls.filter(url => known.has(fullKey(url))).length : urls.length;
    const total = items.length;
    if (!total || nothingNew) rows.append(el('li', 'muted', nothingNew ? 'Nothing new since the last check. Jobs found before are in Jobs.'
      : 'This run found nothing new to show. Your saved jobs are in Jobs.'));
    // Fewer in Jobs than listed: the button counts what it opens, and a line says where the rest are ("7 of 10" read as a mismatch, 7 Oct 2026).
    // "of these N", not "N more": some of them are the Not scored rows just above (8 Oct 2026: "4 more" under two of those four).
    if (here && here < total) rows.append(el('li', 'muted', `${total - here} of these ${total} ${total - here === 1 ? 'is' : 'are'} not in Jobs yet: still waiting.`));
    const words = !total || nothingNew ? 'Open Jobs →' : !here ? 'View in Jobs →' : here === total ? `View all ${total} in Jobs →` : `View ${here} in Jobs →`;
    const view = el('button', 'link', words);
    view.addEventListener('click', () => {
      openActivity(false);
      openView('jobs');
      if (urls.length) showJobsIn(label, urls, 'activity');  // no links in the message: the whole list is all there is
    });
    // Few new jobs: why, and what would bring more (the Strategy page's suggestions; owner, 6 Oct 2026), as cards under this one: in the
    // run pane its own place (#activity-help), elsewhere after the card.
    const few = runNewCount(run, card) < 3;
    more = el('div', 'run-card-foot');
    more.append(view);
    if (few) help = withFewJobsHelp(run?.id ?? card.items.map(item => item.url).join('|'));
  } else {
    // New to the search or checked again after its wait: a run never re-reads the same list (an older message has neither number).
    // Every count says its word for 1 and for many (7 Oct 2026: "1 new job feeds"); the bottom line says why some were set aside.
    const s = n => (n === 1 ? '' : 's');
    // The one number: the employers this run added. Nothing else is shown (checked, checked again, set aside).
    stats.append(stat(card.fresh ?? 0, `new employer${s(card.fresh ?? 0)} added`));
    heading = 'New employers';
    // Five at first; "+2 more" shows the rest here (Show less folds them), and the Employers database has them all.
    const all = card.items.length > 5 && expandedCard === card.items.map(item => item.company).join('|');
    rows.append(...card.items.slice(0, all ? undefined : 5).map(item => {
      const row = el('li', 'run-card-row');
      const words = el('span', 'run-card-words');
      words.append(el('b', '', item.company), el('span', 'muted', [item.ats, item.roles != null && `${item.roles} matching role${item.roles === 1 ? '' : 's'}`,
        item.yours != null && `${item.yours} in your places`].filter(Boolean).join(' · ')));
      row.append(words, ...(item.tier ? [el('span', 'run-card-fit', item.tier.replace('Tier ', 'T'))] : []));
      return row;
    }));
    more = el('div', 'run-card-foot');
    const rest = card.items.length - 5;
    if (rest > 0) {
      const toggle = el('button', 'link', all ? 'Show less' : `+${rest} more`);
      toggle.addEventListener('click', () => { expandedCard = all ? '' : card.items.map(item => item.company).join('|'); renderRunCard(card, run, target); });
      more.append(toggle);
    }
    // The whole list in the app, on every store (pages/employers.js); a Notion user also gets the database as an extra.
    const list = Object.assign(el('button', 'arrow-link', 'All employers'), {type: 'button'});
    list.addEventListener('click', () => { openActivity(false); openView('employers'); });
    more.append(list);
    const employers = shared.state?.notion?.NOTION_EMPLOYERS_DB;
    if (employers) {
      const open = Object.assign(el('a', 'arrow-link', 'All employers in Notion ↗'), {href: '#'});
      open.addEventListener('click', event => { event.preventDefault(); window.pilot.openNotion(employers, event.metaKey || event.ctrlKey); });
      more.append(open);
    }
    if (card.note) more.append(el('span', 'muted', card.note));
  }
  // The counts sit above a bordered box that holds the heading and the rows (nested in the card, as the mockup shows);
  // the link to the whole list stays in the card, under it.
  // Counts on their own band, then the heading, the rows and the link in the card's plain body: one surface, not a
  // box inside a box (the owner, 30 Sep: "a table in table").
  const body = el('div', 'run-card-body');
  body.append(el('h4', 'run-card-title', heading), rows, ...(more && more.childNodes.length ? [more] : []));
  // The few-jobs cards are siblings of this card, never inside it (a card in a card): the pane's own slot, else after the card.
  const slot = target.id === 'activity-card' ? $('activity-help') : null;
  if (slot) { slot.replaceChildren(...(help ? [help] : [])); show(slot, !!help); }
  // The headline is one rounded box, like every card (owner, 24 Oct 2026: "the border is not rounded").
  const top = el('div', 'run-card-top');
  top.append(...(stats.childElementCount ? [stats] : []));
  target.replaceChildren(...(top.childElementCount ? [top] : []), body, ...(help && !slot ? [help] : []));
}

// A run's card while its Notion page is being read: the card's own shape, in the app's skeleton bars, so the pane
// keeps its size and nothing pops in when the data lands (renderer/pages/focus.js does the same for a first load).
export function renderCardSkeleton(target = $('activity-card')) {
  const bar = (className = '') => el('span', `skeleton ${className}`);
  const stats = el('div', 'run-card-stats');
  stats.append(bar('w-30'), bar('w-20'), bar('w-20'));
  const rows = el('div', 'run-card-rows');
  for (const width of ['w-60', 'w-40', 'w-60']) {
    const row = el('div', 'run-card-row');
    const words = el('span', 'run-card-words');
    words.append(bar(`${width} tall`), bar('w-20'));
    row.append(words, bar('w-20'));
    rows.append(row);
  }
  const body = el('div', 'run-card-body');
  body.append(rows);
  target.replaceChildren(stats, body);
}


// A finished run whose page holds no result (the read came back empty after its retries, or the app was closed while it ran): the amber box Recent activity draws
// for the same outcome, with what a person can do next. Never skeleton bars: those mean a read is in flight (18 Oct 2026, a Find jobs card that never filled).
export function renderNoResult(head, {fix, log} = {}, target = $('activity-card')) {
  target.replaceChildren(problemBox(head, {onFix: fix, onLog: log}));
}
