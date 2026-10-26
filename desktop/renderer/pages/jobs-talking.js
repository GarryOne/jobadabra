// Jobs page, In conversation (moved from pages/jobs-render.js, 26 Oct 2026): the opportunities that found you and are still open, above the
// search box. In the page's first paint as last drawn (renderer/late-blocks.js). Guarded by: test/late-blocks.test.js, test/notion-parity.test.js.
import {el, pill} from '../components.js';
import {icon} from '../icons.js';
import {isInbound} from '../origin.js';
import {inConversation, talkingBar} from '../jobs-view.js';
import {keepBlock, keptBlock} from '../late-blocks.js';
import {shared} from './shared.js';
import {$, show} from './core.js';
import {jobsState} from './jobs-state.js';
import {openJobPanel} from './job-panel.js';

// In conversation: the opportunities that found you and are still open, one Focus-style row each; a click opens the
// job in Notion (⌘-click: in a Jobadabra window), or its link when it has no page.
// It gives way to the list whenever the list is narrowed to something (a counter or Focus step clicked, the Inbound or
// Everything menu choice, words typed): the same jobs would show twice.
// Folded by default; open if you last left it open (a click on the bar).
export const TALKING_OPEN = 'jobsTalkingOpen';
export function renderTalkingBar() {
  const bar = talkingBar(inConversation(shared.allJobs), $('jobs-talking').open);
  $('jobs-talking-title').textContent = bar.title;
  $('jobs-talking-count').textContent = bar.detail;
}
export function renderTalking(narrowed = false) {
  if (!jobsState.lastJobsData && !jobsState.jobsRead) return;   // the list is not read yet: the first paint stays (paintTalkingFirst)
  const talking = inConversation(shared.allJobs);
  show($('jobs-talking'), talking.length > 0 && !narrowed);
  const found = talking.filter(isInbound).length;
  renderTalkingBar();
  const mixed = found > 0 && found < talking.length;  // a tag per row only tells something when both kinds are listed
  $('jobs-talking-list').replaceChildren(...talking.map(job => {
    const li = Object.assign(el('li', 'focus-item tone-info'), {tabIndex: 0, role: 'button',
      title: job.notion_url ? 'Open in Notion' : 'Open its page'});
    const round = el('span', 'focus-round');
    round.append(icon('chat'));
    const top = el('div', 'focus-top');
    top.append(el('span', 'focus-headline', job.title || 'Role'), pill(job.stage || 'Recruiter lead', 'info', {dot: true}));
    const meta = el('div', 'focus-meta muted small');
    const who = [job.company, job.via && job.via !== job.company ? `via ${job.via}` : ''].filter(Boolean).join(' ');
    [who, mixed ? (isInbound(job) ? 'Inbound' : 'Outbound') : '', job.next_step ? `Next: ${job.next_step}` : ''].filter(Boolean).forEach((part, i) => {
      if (i) meta.append(el('span', 'sep', '·'));
      meta.append(el('span', '', part));
    });
    const body = el('div', 'focus-body');
    body.append(top, meta);
    li.append(round, body);
    // Its Notion page when the store has one, else the job's page here (pages/job-panel.js): the conversation, its messages and history.
    const open = event => (job.notion_url ? window.pilot.openNotion(job.notion_url, event.metaKey) : openJobPanel(job));
    li.addEventListener('click', open);
    li.addEventListener('keydown', event => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); open(event); } });
    return li;
  }));
  if (!narrowed) keepBlock('jobs-talking', {shown: talking.length > 0, title: $('jobs-talking-title').textContent, detail: $('jobs-talking-count').textContent, rows: talking.length});
}

// The first paint (pages/jobs.js init): the bar as it was last drawn, its rows as skeletons when it is open, so the search box and the list below
// it never move when the list is read (renderer/late-blocks.js).
export function paintTalkingFirst() {
  const kept = keptBlock('jobs-talking');
  if (!kept?.shown) return;
  $('jobs-talking-title').textContent = kept.title || 'In conversation';
  $('jobs-talking-count').textContent = kept.detail || '';
  $('jobs-talking-list').replaceChildren(...Array.from({length: Math.min(Number(kept.rows) || 0, 20)}, () => {
    const li = el('li', 'focus-item is-loading'), body = el('div', 'focus-body');
    body.append(el('span', 'skeleton w-60 tall'), el('span', 'skeleton w-40'));
    li.append(el('span', 'focus-round skeleton-round'), body);
    return li;
  }));
  show($('jobs-talking'), true);
}
