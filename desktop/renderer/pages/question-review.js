// Application questions, one at a time (owner's mockup, 17 Oct 2026: "THIS IS TOO CROWDED/OVERWHELMING... Move the questionnaire out of the Jobs
// page"): a right drawer over the main column, in the job drawer's frame (job-drawer.css) and its overlay slot (renderer/overlay-slot.js), so it
// never stacks over Recent activity or a job. A fixed header (title, "Question 2 of 9", the navigator: renderer/question-nav.js), one question with the
// control of its kind (renderer/question-control.js), a suggested answer told apart from a missing one, its source on demand, and a fixed footer:
// Back · Skip · Save. Drafts are kept when it closes. Two drawers, one frame (Why (28 Oct 2026, owner, superseding 18 Oct "One queue for all"): "Fill your
// details" walks the Your details items, "What we learned" the reusable questions with Later · Confirm / Save change); each is one list of
// pages/jobs-questions.js questionsNow, so its count is the card's and the tab's. Set-aside questions are listed apart in What we learned's navigator.
// Opened from Jobs' cards, the Profile tabs and ⌘K (nav.js). Guarded by test/question-drawers.test.js, test/question-review.test.js, test/question-kinds-screens.test.js.
import {el, pill} from '../components.js';
import {icon} from '../icons.js';
import {answerControl} from '../question-control.js';
import {markFor} from '../question-kind.js';
import {needsCheck} from '../question-values.js';
import {KEEP_AS_IS} from '../question-filter.js';
import {claimOverlay, registerOverlay, releaseOverlay} from '../overlay-slot.js';
import {button, skeleton, stateCard} from '../job-drawer/parts.js';
import {loadQuestions, questionsNow} from './jobs-questions.js';
import {$} from './core.js';
import {fromDetailsLine} from '../answered-from-details.js';
import {alsoKeys} from '../question-wordings.js';
import {ASKS, questionNav, shortTitle, sourceOf} from '../question-nav.js';

export {shortTitle};

const DRAFTS = 'questionDrafts';
// Each drawer's words (owner's sketch, 28 Oct 2026).
export const DRAWERS = {
  details: {title: 'Fill your details', lead: 'Forms ask these every time. Saved in Your details.', skip: 'Skip', save: 'Save',
    done: 'Your details are complete', doneText: 'A detail shows here when a form asks for one you have not given.'},
  learned: {title: 'What we learned', lead: 'Answers forms reuse. Confirm, change or add them.', skip: 'Later', save: 'Save', confirm: 'Confirm', change: 'Save change',
    done: 'Nothing to check', doneText: 'A question shows here when a form asks something your answers do not cover.'},
};
const state = {open: false, kind: 'details', queue: [], setAside: [], consent: 0, fromDetails: 0, at: 0, aside: null, saved: '', error: '', busy: false, loading: false, failed: ''};
const drafts = new Map();
try { for (const [key, value] of Object.entries(JSON.parse(localStorage.getItem(DRAFTS) || '{}'))) drafts.set(key, String(value)); } catch {}
const keepDrafts = () => { try { localStorage.setItem(DRAFTS, JSON.stringify(Object.fromEntries(drafts))); } catch {} };

const current = () => state.aside || state.queue[state.at] || null;

function header() {
  const head = el('header', 'jd-head qr-head');
  const top = el('div', 'jd-top');
  const close = Object.assign(el('button', 'ghost icon-btn jd-control'), {type: 'button', title: 'Close', ariaLabel: 'Close'});
  close.append(icon('close'));
  close.addEventListener('click', closeQuestionReview);
  const title = el('div', 'jd-title');
  const words = DRAWERS[state.kind];
  title.append(el('h2', '', words.title), el('p', 'muted', words.lead));
  // Why (28 Oct 2026, owner: "Saved answers… It's getting dropped"): the header's way out is "What we learned", the whole Profile tab (was Saved answers, 19 Oct).
  const saved = Object.assign(el('button', 'secondary with-icon qr-saved-btn'), {type: 'button', id: 'review-learned-tab'});
  saved.append(icon('bookmark'), el('span', '', 'What we learned'));
  saved.addEventListener('click', () => manageAnswers('', 'all'));
  top.append(el('span', 'qr-head-icon', icon(state.kind === 'details' ? 'user' : 'sparkle')), title, ...(state.kind === 'learned' ? [saved] : []), close);
  head.append(top);
  if (state.kind === 'details' && state.fromDetails > 0) head.append(el('p', 'muted small qr-details', fromDetailsLine(state.fromDetails)));
  if (!state.queue.length && !state.aside) return head;
  head.append(questionNav(state, drafts, go));
  return head;
}

// The navigator's moves: a question of the queue ('q') or a set-aside one ('s') by index, or a step (-1 / +1) like Back and Skip.
function go(kind, index) {
  if (kind === 'step') { step(index); return; }
  state.aside = kind === 's' ? state.setAside[index] : null;
  if (kind === 'q') state.at = index;
  state.saved = state.error = '';
  draw();
}

function question(q) {
  const body = el('div', 'jd-body qr-body');
  const mine = q.details;   // a Your details item: no form asked it, it is a fact about you
  const asked = el('p', 'muted small qr-asked', sourceOf(q));
  if (mine) asked.append(' ', pill(mine.source, 'warn'));
  if (state.aside) asked.append(' ', pill('Set aside', 'neutral'));
  body.append(asked, el('h3', 'qr-question', q.question));
  if (mine?.line) body.append(el('p', 'qr-line', mine.line));
  const suggested = Boolean(q.proposal);
  const box = el('div', `qr-answer ${suggested ? 'is-suggested' : 'is-missing'}`);
  const kind = el('p', 'qr-answer-kind');
  kind.append(icon(suggested ? 'sparkle' : 'alert'), el('span', '', suggested ? 'Suggested from saved answer' : mine ? ASKS[mine.kind] || 'Missing answer' : 'Missing answer'));
  box.append(kind);
  const label = el('label', 'qr-label', mine?.kind === 'which' || mine?.kind === 'where' ? 'Your pick' : 'Your answer');
  // Why (28 Oct 2026, owner: "a textarea… please describe… different scenarios… Be as specific as possible"): a learning's free-text answer holds its
  // conditions ("Contract only if remote"), so What we learned writes it in a few lines with the cases asked for; choices keep their pickers.
  const written = state.kind === 'learned' && (q.format?.control || 'text') === 'text';
  const control = answerControl(written ? {...q.format, control: 'textarea'} : q.format, drafts.get(q.key) ?? q.proposal ?? q.value ?? '', value => {
    if (String(value) === String(q.proposal || '')) drafts.delete(q.key); else drafts.set(q.key, String(value));
    keepDrafts();
    word.textContent = saveWord(q, value);
    confirm.disabled = state.busy || !ready();
  }, {placeholder: 'Type your answer', ariaLabel: q.question, chips: Boolean(mine)});
  control.id = 'qr-control';
  // A value to make exact is ready only once its parts read (the same rule as the line's Check chip); an unclear answer once it changed ("Keep as is" keeps it).
  const ready = () => control.complete && !(mine?.kind === 'check' && needsCheck(q.format?.kind, control.value))
    && !(mine?.kind === 'unclear' && String(control.value).trim() === String(q.value ?? '').trim());
  box.append(label, ...(written ? [el('p', 'muted small qr-cases', 'Think about the different cases and what you would answer in each. Be as specific as you can.')] : []), control);
  body.append(box);
  if (mine?.kind === 'which') body.append(el('p', 'muted small', `${q.hint}. The other is set aside, never deleted: Undo in Your details.`));
  if (q.coveredBy) {
    const source = el('details', 'plain qr-source');
    const view = Object.assign(el('button', 'link small', 'View source →'), {type: 'button', id: 'qr-source-go'});
    view.addEventListener('click', () => manageAnswers(q.coveredBy));
    source.append(el('summary', '', 'Source'), el('p', 'muted small', `From your saved answer “${q.coveredBy}”.`), view);
    body.append(source);
  }
  if (q.hint && mine?.kind !== 'which') body.append(el('p', 'muted small', q.hint));
  const drop = Object.assign(el('button', 'link small qr-drop', 'Don’t keep an answer for this'), {type: 'button', id: 'qr-drop',
    title: q.hint !== undefined ? 'Forms leave this field empty (the line stays, answered "— (leave blank)")' : 'Not a question to keep an answer for'});
  drop.addEventListener('click', () => answer(q, ''));
  if (!mine || mine.kind === 'open') body.append(drop);   // a choice or an exact value always has an answer
  if (mine?.kind === 'unclear') {   // the AI found it unclear; the person may know better: never asked again for this value
    const keepIt = Object.assign(el('button', 'link small qr-drop', 'Keep as is'), {type: 'button', id: 'qr-keep', title: 'It is right as it is: not asked again unless it changes'});
    keepIt.addEventListener('click', () => answer(q, KEEP_AS_IS));
    body.append(keepIt);
  }
  if (state.saved) body.append(el('p', 'muted small qr-saved', state.saved));
  if (state.error) body.append(el('p', 'message error', state.error));
  if (state.consent) body.append(el('p', 'muted small qr-consent', 'Terms and consent boxes are ticked for you on each form (Settings → Consent boxes turns that off).'));
  const word = el('span', '', saveWord(q, drafts.get(q.key) ?? q.proposal ?? q.value ?? ''));
  const confirm = Object.assign(el('button', 'primary'), {type: 'button', id: 'qr-confirm'});
  confirm.append(word, icon('chevron'));
  confirm.disabled = state.busy || !ready();
  confirm.addEventListener('click', () => ready() && answer(q, String(control.value).trim()));
  if (control.tagName === 'INPUT') control.addEventListener('keydown', event => { if (event.key === 'Enter' && control.value.trim()) answer(q, control.value.trim()); });
  return {body, confirm};
}

// The primary button's word: What we learned's suggested answer as it is → Confirm, changed → Save change; anything else → Save.
const saveWord = (q, value) => {
  const words = DRAWERS[state.kind];
  return state.kind === 'learned' && q.proposal ? (String(value) === String(q.proposal) ? words.confirm : words.change) : words.save;
};

function footer(confirm) {
  const bar = el('footer', 'jd-foot qr-foot');
  const back = button('← Back', () => step(-1), 'ghost');
  back.id = 'qr-back';
  back.disabled = !state.aside && state.at === 0;
  const skip = button(DRAWERS[state.kind].skip, () => step(1), 'secondary');
  skip.id = 'qr-skip';
  skip.disabled = !state.aside && state.queue.length < 2;
  bar.append(back, el('span', 'qr-gap'), skip, confirm);
  return bar;
}

function step(by) {
  if (state.aside) state.aside = null;
  else if (state.queue.length) state.at = (state.at + by + state.queue.length) % state.queue.length;
  state.saved = state.error = '';
  draw();
}

// Confirm (or "Don't keep", value ''): the answer goes to its home (lib/answer-home.js); the question leaves the queue; the next one shows. Why (28 Oct 2026, owner:
// "I don't get the use of this checkbox… We learn general things about the user… conclusions that help on any job/form"): no "Reuse for matching
// questions" switch; what reaches a drawer is reusable by the AI's verdict (lib/question-reuse.js), one job's questions never do.
async function answer(q, value) {
  state.busy = true;
  state.error = '';
  draw();
  const result = await window.pilot.answerQuestion(q.key, value, markFor(q.format), ...(q.also?.length ? [{also: alsoKeys(q)}] : [])).catch(error => ({ok: false, error: error.message}));
  state.busy = false;
  if (!result?.ok) { state.error = result?.error || 'It did not save; try again.'; draw(); return; }
  drafts.delete(q.key);
  keepDrafts();
  state.saved = value ? `✓ Saved to ${result.homeName || 'What we learned'}` : '✓ Not kept: forms will not ask you for it again';
  if (state.aside) { state.setAside = state.setAside.filter(each => each !== q); state.aside = null; }
  else { state.queue = state.queue.filter(each => each !== q); state.at = Math.min(state.at, Math.max(state.queue.length - 1, 0)); }
  draw();
  loadQuestions({force: true});   // Jobs' card counts again
}

export function draw() {
  const panel = $('review-panel');
  if (!panel || !state.open) return;
  if (state.loading) { const body = el('div', 'jd-body qr-body'); body.append(...skeleton()); panel.replaceChildren(header(), body); return; }
  if (state.failed) {
    panel.replaceChildren(header(), el('div', 'jd-body qr-body', stateCard({icon: 'alert', tone: 'bad', title: 'Could not read your questions', text: state.failed,
      actions: [button('Retry', () => openQuestionReview({force: true}))]})));
    return;
  }
  const q = current();
  if (!q) {
    const done = stateCard({icon: 'check', tone: 'good', title: DRAWERS[state.kind].done, text: DRAWERS[state.kind].doneText});
    const body = el('div', 'jd-body qr-body', done);
    if (state.saved) body.append(el('p', 'muted small qr-saved', state.saved));
    const foot = el('footer', 'jd-foot qr-foot', button('Close', closeQuestionReview, 'secondary'));
    panel.replaceChildren(header(), body, foot);
    return;
  }
  const {body, confirm} = question(q);
  panel.replaceChildren(header(), body, footer(confirm));
}

// The drawer's list and its set-aside ones (What we learned only); start: a key that names the drawer it is in.
const listOf = (now, kind) => ({queue: [...(now[kind] || [])], setAside: kind === 'learned' ? [...now.hidden] : []});
const drawerOf = (now, key, kind) => (key && (now.learned || []).some(q => q.key === key) ? 'learned' : key && (now.details || []).some(q => q.key === key) ? 'details' : kind);

// Opens a drawer (queue: 'details' | 'learned') on its questions (read once if Jobs has not read them yet). start: a question's key to show first.
export async function openQuestionReview({force = false, start = '', queue = 'details'} = {}) {
  claimOverlay('review');
  state.open = true;
  $('review-drawer-layer').hidden = false;
  let now = questionsNow();
  // The questions saved last time (Jobs' card shows them from this computer) open the drawer at once; the store's answer replaces them when it arrives.
  // Nothing saved: a loading card until the store answers.
  const background = !force && !now.read && now.details.length + now.learned.length > 0;
  if (!background && (force || !now.read)) {
    state.loading = true;
    state.failed = '';
    draw();
    await loadQuestions({force});   // not forced: a read Jobs already started is joined
    now = questionsNow();
    state.loading = false;
  }
  state.failed = now.error || '';
  state.kind = drawerOf(now, start, DRAWERS[queue] ? queue : 'details');
  Object.assign(state, listOf(now, state.kind));
  state.fromDetails = now.fromDetails || 0;
  state.consent = now.consent || 0;
  state.aside = null;
  state.saved = state.error = '';
  const at = state.queue.findIndex(q => q.key === start);
  state.at = at < 0 ? 0 : at;
  draw();
  $('qr-control')?.focus?.();
  if (background) {
    await loadQuestions();
    if (state.open) syncQueue();
  }
}

// The store answered after the drawer opened on the saved list: take its list, staying on the question being read when it is still open.
function syncQueue() {
  const now = questionsNow(), keep = current()?.key;
  state.failed = '';
  Object.assign(state, listOf(now, state.kind));
  state.fromDetails = now.fromDetails || 0;
  state.consent = now.consent || 0;
  if (state.aside) state.aside = state.setAside.find(q => q.key === keep) || null;
  if (!state.aside) { const at = state.queue.findIndex(q => q.key === keep); state.at = at < 0 ? Math.min(state.at, Math.max(state.queue.length - 1, 0)) : at; }
  draw();
}

export function closeQuestionReview() {
  if (!state.open) return;
  state.open = false;
  releaseOverlay('review');
  $('review-drawer-layer').hidden = true;
}

// Profile → What we learned on its Confirmed view (a question's "covered by"; the drawer header's button opens All), searched for a saved answer's name when one is given.
export async function manageAnswers(query = '', view = 'confirmed') {
  closeQuestionReview();
  const [{openView}, {settingsPage}, {profileTab}, answers] = await Promise.all([import('./nav.js'), import('./settings.js'), import('./profile.js'), import('./application-answers.js')]);
  answers.searchAnswers(query, view);
  openView('settings');
  settingsPage('profile');
  profileTab('answers');
}

registerOverlay('review', {close: closeQuestionReview, open: () => openQuestionReview()});
$('review-drawer-backdrop')?.addEventListener('click', closeQuestionReview);
$('questions-review')?.addEventListener('click', () => openQuestionReview({queue: 'details'}));
$('learned-review')?.addEventListener('click', () => openQuestionReview({queue: 'learned'}));
$('letter-setup-go')?.addEventListener('click', () => import('./settings.js').then(({openSetting}) => openSetting('letter')));   // the cover letter is a setting, not a question
$('questions-manage')?.addEventListener('click', event => { event.preventDefault(); manageAnswers(); });
document.addEventListener('keydown', event => { if (event.key === 'Escape' && state.open && !event.defaultPrevented) closeQuestionReview(); });
