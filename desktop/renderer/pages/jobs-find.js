// Jobs page, the "Find jobs" card on top (owner, 16 Oct 2026; centered magic card + moving searching card 24 Oct 2026): a big card on an empty first run, then the live progress of the search (steps, last
// lines, counts) with the list growing below it, then a one-line result; a failure says what to do. Built from the shared header, number strip, pills and
// rows (no new look). Data: renderer/find-card-model.js. Guarded by: test/find-card.test.js.
import {cardHead, el, liveRows, pill, tile} from '../components.js';
import {icon} from '../icons.js';
import {wire} from '../magic.js';
import {jobCounts} from '../jobs-view.js';
import {findCard, readProgressModel} from '../find-card-model.js';
import {jobsState} from './jobs-state.js';
import {$, show} from './core.js';

let signature = '', wasSearching = false, finishedHere = false;
let start = () => {};
let liveOpen = true;
export const wireFindCard = startSearch => { start = startSearch; };

const button = (text, handler, className = 'primary') => Object.assign(el('button', className, text), {type: 'button', onclick: handler});

// This search's one number (find-card-model.js addedSoFar): the jobs it added to your list, a green "+9 added" beside the title (owner, 24 Oct 2026: scoring and its
// queue are internal, never shown). A search that added nothing yet shows no pill while it runs, and a quiet "No jobs added" when it is done.
const addedPill = (model, done) => (model.added ? pill(`+${model.added.toLocaleString('en-US')} added`, 'good') : done ? pill('No jobs added', 'neutral') : null);
function findHead(title, model, lead, {done = false, spinner = false} = {}) {
  const row = el('div', 'find-head'), pillNode = addedPill(model, done);
  if (spinner) row.append(Object.assign(el('span', 'spinner'), {ariaHidden: 'true'}));
  row.append(el('h3', 'find-title', title), ...(pillNode ? [pillNode] : []), el('span', 'muted find-scope', 'This search'));
  const box = el('div', 'find-head-box');
  box.append(row, el('p', 'muted find-lead', lead));
  return box;
}

// Employers read as progress (bar + "1,953 of 2,251"); before the first count the bar slides, so the card never looks still. The raw count of
// downloaded listings is not shown: 130k+ is noise (owner, 19 Oct 2026).
function readProgress(model) {
  const box = el('div', 'find-progress'), n = value => value.toLocaleString('en-US'), progress = readProgressModel(model.employers);
  const head = el('div', 'progress-head'), bar = el('div', progress.kind === 'count' ? 'bar' : 'bar is-sliding'), fill = el('span');
  if (progress.kind === 'count') fill.style.width = `${progress.percent}%`;
  bar.append(fill);
  head.append(el('span', '', 'Employers checked'), el('span', 'muted', progress.kind === 'count' ? `${n(progress.done)} / ${n(progress.total)}` : 'Starting…'));
  box.append(head, bar);
  return box;
}

// The empty first run: the shared magic card (renderer/magic.css, like the Welcome card), the whole card is the Find jobs button (owner, 24 Oct 2026).
function drawEmpty(card) {
  card.className = 'card find-card is-empty magic';
  const twinkles = [0, 1, 2].map(() => Object.assign(el('span', 'magic-twinkle'), {ariaHidden: 'true'}));
  twinkles.forEach(node => node.append(icon('sparkle')));
  card.replaceChildren(...twinkles, tile('search'), el('span', 'eyebrow', 'Get started'), el('h2', 'magic-title', 'Find jobs'),
    el('p', 'muted subtitle magic-sub', 'Reads employer sites and job boards, scores each job against your profile, and lists the first matches in under a minute. The rest keeps coming.'),
    button('Find jobs', () => start(), 'primary magic-go'));
  wire(card);
}

function draw(model) {
  const card = $('find-card');
  card.className = `card find-card is-${model.state}`;
  if (model.state === 'empty') {
    drawEmpty(card);
  } else if (model.state === 'searching') {
    const chips = el('div', 'chip-row find-steps');
    chips.append(...model.chips.map(chip => {
      const node = pill(chip.label, chip.state === 'active' ? 'signal' : chip.state === 'done' ? 'good' : 'neutral', {dot: chip.state === 'active'});
      node.classList.add('find-step', `is-${chip.state}`);   // the active step pulses, a finished one shows a tick, a waiting one a clock (find-card.css)
      if (chip.state === 'pending') node.prepend(icon('clock'));
      return node;
    }));
    const lines = el('ul', 'run-card-rows');
    lines.append(...liveRows(model.lines));
    // The live updates fold (owner, 24 Oct 2026): a native <details>, open by default; the choice survives the card's redraws.
    const live = Object.assign(el('details', 'find-live'), {open: liveOpen});
    live.append(el('summary', '', 'Live updates'), lines);
    live.addEventListener('toggle', () => { liveOpen = live.open; });
    const steps = el('div', 'find-steps-row');
    steps.append(chips);
    card.replaceChildren(findHead('Finding jobs…', model, model.added ? 'New matches appear below as they’re found.' : 'Looking for your first jobs…', {spinner: true}), readProgress(model), steps, live);
  } else if (model.state === 'done') {
    card.replaceChildren(findHead('Search done', model, 'The best matches are first. Find jobs again any time.', {done: true}));
  } else if (model.state === 'failed') {
    card.replaceChildren(cardHead('Search stopped', 'The search did not finish', {subtitles: [model.problem || 'Nothing is lost. Try again; if it keeps stopping, check your AI settings.']}),
      button('Try again', () => start()));
  }
  show(card, model.state !== 'none');
  document.body.dataset.findCard = model.state;
}

// Called every 2 s with the runs state, and after the list loads.
export function renderFindCard(runsNow) {
  if (!$('find-card') || !runsNow) return;
  const searching = !!runsNow.running && (runsNow.running.kind || 'search') === 'search';
  if (wasSearching && !searching) finishedHere = true;
  if (searching) finishedHere = false;
  wasSearching = searching;
  const counts = jobCounts(jobsState.lastJobsData);   // the same numbers as the counters below (jobs-view.js)
  const model = findCard({running: runsNow.running, last: (runsNow.runs || []).find(run => (run.kind || 'search') === 'search') || null,
    lastSearchAt: runsNow.lastSearchAt, listed: runsNow.listed ?? counts.total, finishedHere});   // runsNow.listed: only the screenshots set it
  const key = JSON.stringify(model);
  if (key === signature) return;
  signature = key;
  draw(model);
}

// The Find jobs card is showing its searching state: the rows without a score say Scoring… instead of Not scored.
export const searchingNow = () => document.body.dataset.findCard === 'searching';
