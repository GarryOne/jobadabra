// Drawer → Description (owner's mock, 10 Oct 2026): a strip of facts (employer, posted, first found, the saved copy), the posting with its
// headings and bullets, and where it came from with "View original". The text is the page's own (a job you applied to), else the copy the
// search saved (IPC jobPosting, asked once per job and kept for the session). None saved: "Fetch original" reads the posting's page and
// "Paste description" saves your own text (both through IPC describeJob, for a job with an application). States: reading it, saved, none
// saved, fetching, could not be fetched (a saved copy stays readable), could not be read (Retry, only then). Words and blocks: job-page-view.js.
import {el} from '../components.js';
import {postingBlocks, postingFacts, postingSource, notSeen} from '../job-page-view.js';
import {button, closedCard, factStrip, postingBody, skeleton, sourceCard, stateCard} from './parts.js';
import {plainError} from '../run-warnings.js';

const read = new Map();   // job url → the answer of IPC jobPosting, for this session
const ICONS = {employer: 'building', posted: 'calendar', found: 'search', saved: 'file'};

function saved(text, job, found = {}) {
  const view = el('div', 'jd-description');
  view.append(factStrip(postingFacts(job, found, text).map(cell => ({...cell, icon: ICONS[cell.key]}))), el('h3', '', 'Description'), postingBody(postingBlocks(text)),
    sourceCard(postingSource(found), button('View original ↗', () => window.pilot.openExternal(job.url), 'soft-button')));
  return view;
}

// What the two buttons do, for a job with an application (a job nobody applied to has nowhere to keep a description: it says so).
function missing({job, page, reload}, box, paint, problem = '') {
  const app = page?.app?.id;
  const actions = [];
  const failed = text => { box.replaceChildren(stateCard({icon: 'alert', tone: 'bad', title: 'Could not retrieve the page', text: `${text} Try again, or paste the description.`, actions: buttons()})); };
  const done = async result => { if (result.ok) { read.delete(job.url); reload(); } else failed(plainError(result.text || result.error || 'The page did not answer.')); };
  const fetchOriginal = () => {
    box.replaceChildren(stateCard({icon: 'info', title: 'Fetching original…', text: 'Retrieving the posting from the employer\'s website.'}), ...skeleton());
    window.pilot.describeJob(app, '', job.url).catch(error => ({ok: false, text: error.message})).then(done);
  };
  const pasteIn = () => {
    const field = Object.assign(el('textarea', 'jd-paste'), {rows: 10, placeholder: 'Paste the job description here'});
    const save = button('Save description', () => {
      if (!field.value.trim()) return;
      window.pilot.describeJob(app, field.value, '').catch(error => ({ok: false, text: error.message})).then(done);
    }, 'primary');
    const actionsRow = el('div', 'jd-actions');
    actionsRow.append(save, button('Cancel', () => paint(read.get(job.url) || {ok: false}), 'soft-button'));
    box.replaceChildren(field, actionsRow);
  };
  function buttons() { return [button('Fetch original', fetchOriginal, 'soft-button'), button('Paste description', pasteIn, 'primary')]; }
  if (app) actions.push(...buttons());
  if (notSeen(page) && !problem) {   // the posting is gone and no copy of its text is kept: the facts and the score are
    return stateCard({icon: 'file', tone: 'warn', title: 'The saved copy is no longer available', text: 'The posting is no longer listed and no copy of its text is kept (the text of a posting you never acted on is removed 60 days after it was last seen). Its facts and score are kept.'});
  }
  return stateCard({icon: 'file', tone: 'warn', title: problem || 'This job has no saved description',
    text: app ? 'We haven\'t saved a copy of the original posting yet.' : 'A copy of the original posting is saved with the job once the search reads it. Save the job to add one yourself.', actions});
}

export function descriptionTab(ctx) {
  const {job, parts, page} = ctx;
  const lead = notSeen(page) ? [closedCard()] : [];
  if (parts.descriptionText) return [...lead, saved(parts.descriptionText, job)];
  const box = el('div', 'jd-async');
  const paint = answer => {
    if (answer.failed) {
      box.replaceChildren(stateCard({icon: 'alert', tone: 'bad', title: 'Could not read the saved posting', text: plainError(answer.error), actions: [button('Retry', () => ask(true))]}));
      return;
    }
    box.replaceChildren(answer.ok && answer.description ? saved(answer.description, job, answer) : missing(ctx, box, paint));
  };
  const ask = again => {
    if (!again && read.has(job.url)) { paint(read.get(job.url)); return; }
    box.replaceChildren(...skeleton());
    window.pilot.jobPosting(job.url).catch(error => ({ok: false, failed: true, error: error.message})).then(answer => {
      if (!answer.failed) read.set(job.url, answer);
      paint(answer);
    });
  };
  ask(false);
  return [...lead, box];
}
