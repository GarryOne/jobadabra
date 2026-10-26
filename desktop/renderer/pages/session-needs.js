// Session page: what Claude needs from you, and the form page in step.
import {el, pill} from '../components.js';
import {resumeOffered} from '../claude-help.js';
import {renderSteps} from './session-steps.js';
import {replyOf, splitLabel, unbold} from '../session-message.js';
import {checkingTabs, chromeSilent, chromeWaiting, tabClosed, tabNotFound, stepShown} from '../session-state.js';
import {icon} from '../icons.js';
import {sameQuestion} from '../labels.js';
import {answerOptions} from '../answer-options.js'; import {clearAnswers, queue, sendAnswer} from './need-send.js'; import {choiceButtons, choiceChips} from './need-choice.js'; import {proposalFor, proposedRow} from './need-proposal.js'; import {markKnockout} from './need-knockout.js';
import {shared} from './shared.js';
import {$} from './core.js';
import {openView} from './nav.js';
import {openSession, renderSessionPage} from './session-log.js';
import {firstLine, refreshSessions, renderDock, sessionCompany, sessionList} from './sessions.js';
import {toastMessage} from './startup.js';
import {showFormCard} from './session-form-card.js';
import {storeName} from '../store-words.js';
import {reasonFor} from '../reason-words.js';
import {NO_PLACE, sessionPlace} from '../targets.js';

// Something only you can do, with its most likely action one click away: a judgement call (Claude's proposed
// answer, or another you saved for the same question) or an agreement (open the form to tick it).
// A handled row stays, marked done, until the page is closed.
// What you did on each row ("Done", "Looks right", ticked in the form), kept across a reload (⌘R) and a restart: in this
// window's local storage (a note of what you clicked, not data: Notion and the form hold the answers).
const KEPT = 'jobpilotto.session-rows';
const keptRows = (() => { try { return JSON.parse(localStorage.getItem(KEPT) || '{}'); } catch { return {}; } })();
const keep = () => { try { localStorage.setItem(KEPT, JSON.stringify({handled: [...handled], synced: [...syncedDone], saved: [...savedAnswers], forgot: [...forgotten]})); } catch {} };
const remembered = (map, entries) => { for (const [key, value] of entries || []) map.set(key, value); return map; };
const handled = remembered(new Map(), keptRows.handled);  // `${session}|${text}` → what was done
const KEEP = /^(?:keep|leave|ok|fine|no change|looks right|as is|nothing)/i;
export const offline = item => (item.live === false ? 'The session has ended: resume it to send this' : '');
// The answers you already saved (Notion → Application Answers, the same page the Profile shows), for the rows that
// offer a choice: read once, on the side, the first time a row wants them. Offline or without Notion the row still
// offers Claude's own answer and "Change with Claude…".
let knownAnswers = [], answersAsked = false;
function loadAnswers() {
  if (answersAsked) return;
  answersAsked = true;
  window.pilot.standardAnswers().then(result => {
    if (!result?.ok) return;
    knownAnswers = (result.groups || []).flatMap(group => group.items || [])
      .filter(item => item?.question && item?.answer && !item.open && !item.guidance);
    if (knownAnswers.length && !$('ss-needs-card').hidden) renderSessionPage();
  }).catch(() => {});
}
// The answer you have for one question (this page's own memory first, then the ones saved in Notion).
const savedFor = question => (knownAnswers.find(item => sameQuestion(item.question, question)) || {}).answer || '';
// The row's badge: its place in the list (updateNeedsCount numbers the open ones), a tick once it's handled.
export const badge = () => el('span', 'ss-need-num', '');
// The row's two lines: a bold title, and under it Claude's own words about it (a judgement call's "**Pay:** below
// your minimum." reads as the title "Pay" and the line "below your minimum.").
function rowWords(need) {
  if (need.kind === 'ask') return {title: need.question || firstLine(need.text || '', 80), desc: need.why || ''};
  const {label, text} = splitLabel(need.text || '');
  const title = need.label || label || firstLine(text, 80);
  const desc = (need.label || label) ? text : text.slice(title.length).trim();
  return {title: unbold(title), desc: unbold(desc)};   // Claude's **bold** marks are not words to show (8 Oct 2026)
}
// A title keeps to one line (the row is a summary): the whole question on hover.
export function titleLine(text) {
  const node = el('b', 'ss-need-title', text);
  node.title = text;
  return node;
}
function doneRow(li, key, outcome) {
  handled.set(key, outcome);
  keep();
  li.classList.add('is-done');
  const number = li.querySelector('.ss-need-num');
  if (number) number.textContent = '✓';
  li.querySelector('.ss-need-actions')?.replaceChildren(el('span', 'small ss-need-outcome', `✓ ${outcome}`));
  updateNeedsCount();
}
// The form page says every required field is filled (the extension's ring is green).
export const formReady = item => !formGone(item) && !!reviewStates.get(item.id)?.ready;
// The form's Chrome tab was closed: the extension is reporting in and no open tab is this session's form (it was
// seen before, so a form never opened is not "closed"). Its cached count and "Ready to submit" are then stale.
// Still checking Chrome (just after the app started): the card shows a loading state, not the session's last state.
export const checkingTab = item => checkingTabs(item, shared.formsOpen, performance.now());
// Chrome reports, but no tab is known for the session after the first look: "Tab not found", with Open it again (neither open nor closed).
export const tabLost = item => tabNotFound(item, shared.formsOpen, performance.now());
// Chrome hasn't reported in time: nobody can say whether the session's tab is there.
export const silentChrome = item => chromeSilent(item, shared.formsOpen, performance.now());
// Chrome has not reported yet, but the app only just started: a neutral wait, not the warning.
export const waitingChrome = item => chromeWaiting(item, shared.formsOpen, performance.now());
// The session's tab is on a posting (or its Apply was just pressed): the extension marked it so, and the card says only that (owner, 15 Oct 2026: "Apply button detected. Redirecting…").
export const redirecting = item => stepShown(item, reviewStates.get(item?.id)) && !formGone(item) && !tabLost(item);   // a stop that needs the person keeps its own card   // a closed or lost tab redirects nothing (owner, 15 Oct 2026: "No tab open")
export const formGone = item => tabClosed(item, shared.formsOpen, !!reviewStates.get(item.id)?.total);
// What's left, said the way you act on it: "2 actions remaining". The split it counts (in the form, to check) is the
// pill's tooltip — the rows themselves say which is which.
export function updateNeedsCount() {
  const open = [...document.querySelectorAll('#ss-needs .ss-need:not(.is-done)')];
  const check = open.filter(li => li.classList.contains('is-confirm')).length, form = open.length - check;
  const detail = [form && `${form} in the form`, check && `${check} to check`].filter(Boolean).join(' · ');
  $('ss-needs-count').replaceChildren(open.length
    ? pill(`${open.length} action${open.length === 1 ? '' : 's'} remaining`, 'neutral', {title: detail})
    : pill('All handled', 'good', {dot: true}));
  // The open rows are the numbered list you work through, in order.
  open.forEach((li, i) => { const number = li.querySelector('.ss-need-num'); if (number) number.textContent = String(i + 1); });
  // Now: only what's still open. What was handled (by you or in the form) is the history, one click away.
  const done = document.querySelectorAll('#ss-needs .ss-need.is-done').length;
  // Expanded: the handled rows read as the history the footer counts, under the open ones.
  const list = $('ss-needs');
  if ($('ss-needs-card').classList.contains('show-history')) for (const li of list.querySelectorAll('.ss-need.is-done')) list.append(li);
  $('ss-needs-card').classList.toggle('is-all-done', !open.length);
  const history = $('ss-needs-history');
  history.hidden = !done;
  history.replaceChildren(icon('check'), el('span', '', `${done} completed action${done === 1 ? '' : 's'}`));
  history.title = $('ss-needs-card').classList.contains('show-history') ? 'Hide what you handled' : 'Show what you handled';
  const head = $('ss-needs-card').querySelector('.ss-fact-head .icon');
  if (head && head.dataset.state !== String(!open.length)) { const glyph = icon(open.length ? 'alert' : 'check'); glyph.dataset.state = String(!open.length); head.replaceWith(glyph); }
}
export function smallButton(text, kind, run, title = '') {
  const button = el('button', `${kind} ss-need-button`, text);
  if (title) { button.disabled = true; button.title = title; }
  button.addEventListener('click', run);
  return button;
}
// Enter in a row's answer box presses its button (Use, Fill it in, Send), unless the button is off or an IME is composing.
// Review in form: always the row's last button, a quiet one (owner, 27 Oct 2026: same-size buttons in one column).
export const reviewButton = (item, label) => smallButton('Review in form', 'secondary is-review', event => showInForm(item, label, event.currentTarget));
export function submitOnEnter(input, button) {
  input.addEventListener('keydown', event => {
    if (event.key !== 'Enter' || event.isComposing || button.disabled || !button.isConnected) return;
    event.preventDefault();
    button.click();
  });
}
// ---- In step with the form page (the extension's ring, extension/review.js; lib/review.js) ----
export const reviewStates = new Map();  // session id → {left, total, ready, states: {watch id: ticked}}
const syncedDone = new Set(keptRows.synced || []);    // rows ticked off because the form said so (untick there: back here)
const watchId = text => `w${[...String(text)].reduce((hash, c) => (hash * 31 + c.codePointAt(0)) >>> 0, 7).toString(36)}`;
// The question to find in the form: the bold label Claude gave ("AI Policy for Application"), else its first words.
const agreeLabel = need => splitLabel(need.text).label || firstLine(need.text.replace(/\*\*/g, ''), 80).replace(/[:.]\s*$/, '');
const watching = new Map();      // session id → the JSON last sent, so it's sent when it changes only
// The rows the form page reports on: agreements (ticked?) and questions Claude couldn't answer (answered since?).
export function watchAgreements(item, needs) {
  const items = needs.map(need => ({id: watchId(need.text), label: need.kind === 'ask' ? need.question : agreeLabel(need)}));
  const json = JSON.stringify(items);
  if (watching.get(item.id) === json) return;
  watching.set(item.id, json);
  window.pilot.reviewWatch(item.id, items);
}
// The pill beside the step's title: what the form page says is left, or that it's ready to submit.
export function showFormState(item) {
  const state = reviewStates.get(item.id);
  showFormCard(item, state);
  $('ss-form-state').replaceChildren();  // the "Form completion" card says it (count, bar, pill): once
}
export function applyFormStates(item) {
  const state = reviewStates.get(item.id);
  if (!state) return;
  for (const li of document.querySelectorAll('#ss-needs .ss-need[data-watch]')) {
    const ticked = state.states?.[li.dataset.watch];
    const key = li.dataset.key;
    const outcome = li.classList.contains('is-ask') ? 'Filled in the form' : 'Ticked in the form';
    if (ticked === true && !li.classList.contains('is-done')) { syncedDone.add(key); doneRow(li, key, outcome); }
    if (ticked === false && syncedDone.has(key)) {  // unticked in the form: open again here
      syncedDone.delete(key);
      handled.delete(key);
      keep();
      renderSessionPage();
      return;
    }
  }
  showFormState(item);
}
// Required fields the form page says are still empty and Claude's message didn't list (reworded counts as listed:
// renderer/labels.js): the app finds them itself.
export function emptyFields(item, needs) {
  // What's left as the form's ring counts it (pending: required, or an answer Claude wrote that is empty again; an
  // extension before 0.8.12 sends only the required ones), and never fewer than its count: "16 / 17" beside "All
  // handled" was a contradiction.
  const state = reviewStates.get(item.id);
  if (state?.account) return [];   // a sign-in or sign-up page's empty fields are the account's, not the application's
  const listed = needs.flatMap(need => [agreeLabel(need), need.question, need.text]).filter(Boolean);
  const left = (state?.pending || state?.missing || []).filter(label => label && !listed.some(text => sameQuestion(text, label)));
  const unnamed = (state?.left || 0) - (state?.pending || state?.missing || []).length;
  if (unnamed > 0) left.push(`${unnamed} more field${unnamed === 1 ? '' : 's'}`);
  return left;
}
// Text we drafted from the person's facts and they have not read yet: its own words, in place of a reason it was left (extension/panel-written.js).
const draftNote = (state, label) => { const draft = (state?.drafts || []).find(one => sameQuestion(one.label, label)); return draft ? (draft.outline ? 'Outline for you: add your own details in the form (the lines starting with • Add:).' : 'Drafted for you: read it in the form, edit it or keep it. Review my answer is beside the box.') : ''; };
export function emptyRow(label, item) {
  const proposal = proposalFor(item, label); if (proposal) return markKnockout(proposedRow(item, label, proposal), item, label);   // its answer, back (need-proposal.js)
  const li = el('li', 'ss-need is-empty'), body = el('div', 'ss-need-body'), actions = el('div', 'ss-need-actions');
  li.dataset.empty = label;
  const more = /^\d+ more fields?$/.test(label), name = label.replace(/^\s*\*\s*|\s*\*\s*$/g, '');
  body.append(titleLine(name), el('span', 'ss-need-desc small', more
    ? `Still empty in the form (the ring on the form lists ${label.startsWith('1 ') ? 'it' : 'them'}).`
    : draftNote(reviewStates.get(item.id), label) || reasonFor(reviewStates.get(item.id), label, sameQuestion) || 'This section is still empty in the form.'));   // why the fill left it (reason-words.js)
  actions.append(more ? smallButton('Open the form', 'secondary is-review', event => openForm(item, event.currentTarget))
    : smallButton('Open in form', 'secondary is-review', event => showInForm(item, label, event.currentTarget)));
  li.append(badge(), body, actions);
  return markKnockout(li, item, label);
}
// A problem with the extension: when Chrome runs an older copy than this app's, that's the likely cause; say how to
// fix it. The sentence comes from the app (server.staleExtension), so it is the same one a failed fill records.
export async function explainExtension(row) {
  const seen = await window.pilot.extensionSeen().catch(() => null);
  if (!seen?.note) return;
  row.append(el('div', 'small ss-check-more', `Likely cause: ${seen.note}`));
}
// While Chrome is being brought to the form: the button says so at once, then what's taking time.
export async function opening(button, work) {
  const words = button?.querySelector('span') || button;
  const before = words?.textContent;
  if (button) button.disabled = true;
  if (words) words.textContent = 'Opening…';
  const slow = setTimeout(() => { if (words) words.textContent = 'Looking for the form tab in Chrome…'; }, 2000);
  try { return await work(); } finally {
    clearTimeout(slow);
    if (words) words.textContent = before;
    if (button) button.disabled = false;
  }
}
// Plain "Open in Chrome": one attempt. Chrome comes forward on that job's form tab; when no tab is it, the form opens again.
export async function openForm(item, button) {
  const result = await opening(button, () => window.pilot.showBrowser(item.url, sessionCompany(item), item.id));
  return result?.went === 'none' ? reopenClosedTab(item, button) : result;
}
// What this page holds from the session's form tab: rows you handled, the form's progress, the stuck flag, Claude's question.
const rowsOf = id => [...handled.keys(), ...syncedDone].filter(key => key.startsWith(`${id}|`));
export const staleState = item => !!(rowsOf(item.id).length || reviewStates.get(item.id)?.total || item.stuck || (item.kind !== 'form' && item.question));
// Every button that looks for the form's Chrome tab ends here when the tab is gone (Open in Chrome, Open filled form, Reopen
// form, Review in form, Open in form, Open the form): the form opens again in a new tab with the fill mark, and what the page
// held from the closed tab is cleared. No question (owner, 8 Oct 2026): the card already says it fills again from your kit.
export async function reopenClosedTab(item, button) {
  const result = await window.pilot.sessionReopen(item.id, staleState(item));   // not 'Looking for the form tab…' under the question
  if (result?.cancelled) return result;   // Not now in the first-Apply dialog
  if (result?.ok === false) { toastMessage('Could not open the form', result.error || 'Try again.', sessionPlace(item), 'bad'); return result; }
  if (result?.reset) {
    for (const key of rowsOf(item.id)) { handled.delete(key); syncedDone.delete(key); }
    keep();
    reviewStates.delete(item.id);
    clearAnswers(item.id);
  }
  if (result?.focused) toastMessage('Form tab found', 'The form is still open in Chrome (its address changed): showing it.', NO_PLACE.outside, 'info');
  else toastMessage('Form reopened', 'Opened the form in a new Chrome tab; the extension fills it from your kit.', NO_PLACE.outside, 'info');
  await refreshSessions();
  renderSessionPage();
  return result;
}
// Chrome comes forward on the form tab and the page scrolls to the field. When no page picked the request up, say why.
export async function showInForm(item, label, button) {
  const result = await opening(button, () => window.pilot.reviewFocus(item.id, label, item.url, sessionCompany(item)));
  if (result?.taken) {
    if (result.found === false) toastMessage('Not a field on this form', `"${label}" is not a label on the open form.`, sessionPlace(item), 'warn');
    return;
  }
  if (result?.outdated) toastMessage('Reload the Chrome extension once', `Chrome still runs Jobadabra ${result.extension}; this app has ${result.latest}. ` +
    'In Chrome open chrome://extensions and click ↻ on Jobadabra. Your open forms keep their answers; later updates load by themselves.', {card: 'extension'}, 'warn');
  else if (result?.went === 'none') await reopenClosedTab(item, button);
  else if (result?.went !== 'tab') toastMessage('Opened the job in Chrome', `Find "${label}" in its form.`, NO_PLACE.outside, 'info');
  else toastMessage('Scroll to it yourself this time', `The form tab is open, but the extension could not attach to it. Look for "${label}" in the form.`, NO_PLACE.outside, 'warn');
}
export function needRow(need, item) {
  const key = `${item.id}|${need.text}`, li = el('li', `ss-need is-${need.kind}`);
  li.dataset.key = key;
  const body = el('div', 'ss-need-body');
  const {title, desc} = rowWords(need);
  body.append(titleLine(title));
  if (desc) body.append(el('span', 'ss-need-desc small', desc));
  const actions = el('div', 'ss-need-actions');
  // What an answer is about: the field's label, else the item itself. "this" alone told Claude nothing (8 Oct 2026: "Change this in the form: Yes").
  const name = need.label ? unbold(need.label) : `"${title}"`;
  const reply = need.kind !== 'agree' && replyOf(title);
  if (reply && resumeOffered()) {   // "Reply ok, and I'll click Create an account" (a reply to Claude: only with Claude help on, claude-help.js): one button that sends it, not a field to review
    actions.append(smallButton(`Reply "${reply}"`, 'secondary is-answer', () => { queue(item, key, reply, {last: true}); doneRow(li, key, `To send: ${reply}`); }, offline(item)));
    li.append(badge(), body, actions);
    if (handled.has(key)) doneRow(li, key, handled.get(key));
    return li;
  }
  if (need.kind === 'agree') {
    // Chrome comes forward on the form and the page scrolls to this field (extension/review.js picks it up).
    actions.append(smallButton('Done', 'secondary is-answer', () => doneRow(li, key, 'Ticked in the form')), reviewButton(item, agreeLabel(need)));
    li.dataset.watch = watchId(need.text);
  } else {
    // A judgement call: the proposal agrees in one click, Change… picks a saved answer or (Claude help on) takes your words (need-choice.js).
    loadAnswers();
    const choices = answerOptions(need, knownAnswers, {claude: resumeOffered()});   // "Change with Claude…" only with Claude help on
    const field = need.label ? unbold(need.label) : agreeLabel(need);
    const answer = async value => {   // your own answer (a saved one, or typed): into the form's field
      const sent = await sendAnswer(item, key, field, value, `${name}: ${value}`);
      if (sent.ok) doneRow(li, key, sent.outcome); else toastMessage('Could not fill it in', sent.error);
    };
    const pick = chosen => {
      if (chosen.kind === 'saved') { answer(chosen.value); return; }
      // A recommendation that isn't "keep it as it is" is an instruction for Claude (with Claude help on), not just an acknowledgement.
      const change = !!need.recommended && !KEEP.test(need.recommended) && resumeOffered();
      if (change) queue(item, key, `${name}: ${chosen.value}`);
      doneRow(li, key, change ? `To send: ${chosen.value}` : KEEP.test(chosen.value) ? 'Checked' : `Agreed: ${chosen.value}`);
    };
    const change = () => {
      const before = [...actions.childNodes];
      const back = () => { li.classList.remove('is-asking'); actions.replaceChildren(...before); };
      const parts = choiceChips(choices, pick);
      let input = null;
      {   // say what it should be instead, in your own words
        input = el('input', 'ss-ask-input');
        input.placeholder = `Something else for ${name}…`;
        const send = () => { if (input.value.trim()) answer(input.value.trim()); };
        const sendButton = smallButton('Send', 'secondary is-answer', send, offline(item));
        submitOnEnter(input, sendButton);
        input.addEventListener('keydown', event => { if (event.key === 'Escape') back(); });
        parts.push(input, sendButton);
      }
      li.classList.add('is-asking');   // the picker takes its own line under the text, not a corner of the row
      actions.replaceChildren(...parts, smallButton('Cancel', 'secondary', back));
      (input || parts[0])?.focus();
    };
    const button = (text, run, role) => smallButton(text, `secondary is-${role}`, run, offline(item));   // is-answer / is-change: each role its own border
    actions.append(...choiceButtons(choices, {button, pick, change, field: need.label ? field : ''}));   // nothing to pick (Claude help off, nothing saved): Review in form alone
    // On the account step there is no application form yet: Review in form would open the page again in a new tab, without what Claude typed (12 Oct 2026).
    if (item.stage !== 'account') actions.append(reviewButton(item, agreeLabel(need)));
  }
  li.append(badge(), body, actions);
  if (handled.has(key)) doneRow(li, key, handled.get(key));
  return li;
}
// A fact Claude couldn't find: its suggested answer (editable). Fill it in types it into the form AND keeps it for future forms, as
// "Use" does (owner, 27 Oct 2026: "maybe we should not ask the user... take the decision for him"; the Remember tick is gone);
// afterwards the row says so, with Forget = only this application (the job drawer's Undo, question-lists.js onlyThisJob).
const savedAnswers = remembered(new Map(), keptRows.saved);  // question → the answer saved (the page redraws often)
const forgotten = new Set(keptRows.forgot || []);           // questions you chose to keep for this application only
function savedLine(question) {
  const line = el('div', 'small ss-saved');
  if (forgotten.has(question)) { line.textContent = 'Only for this application'; return line; }
  if (!savedAnswers.has(question)) return null;
  const forget = smallButton('Forget', 'secondary', async () => {
    forget.disabled = true;
    const result = await window.pilot.jobQuestionOnly(question);
    if (!result?.ok) { forget.disabled = false; forget.title = result?.error || 'Couldn\'t forget it'; return; }
    savedAnswers.delete(question); forgotten.add(question); keep();
    line.replaceWith(savedLine(question));
  });
  forget.title = 'Keep this answer for this application only: later forms will ask again';
  line.append('Saved for future forms ', forget);
  return line;
}
export function askRow(need, item) {
  const li = el('li', 'ss-need is-ask');
  const body = el('div', 'ss-need-body');
  body.append(titleLine(need.question));
  if (need.why) body.append(el('span', 'ss-need-desc small', need.why));
  const input = el('input', 'ss-ask-input');
  input.type = 'text';
  input.placeholder = 'Your answer';
  loadAnswers();
  const saved = savedAnswers.get(need.question) ?? savedFor(need.question);
  input.value = saved || need.suggested;
  // The one click that unblocks it: Claude types the answer into the form.
  const key = `${item.id}|${need.text}`;
  li.dataset.key = key;
  li.dataset.watch = watchId(need.text);  // the form page says when it has an answer
  const actions = el('span', 'ss-need-actions');
  const done = value => {
    li.classList.add('is-done');
    const number = li.querySelector('.ss-need-num');
    if (number) number.textContent = '✓';
    actions.replaceChildren(el('span', 'small ss-need-outcome', `✓ ${value}`));
  };
  const fill = smallButton('Fill it in', 'secondary is-answer', async () => {
    const value = input.value.trim();
    if (!value) { input.placeholder = 'Write an answer first'; input.focus(); return; }
    fill.disabled = true;
    const sent = await sendAnswer(item, key, need.question, value, `"${need.question}": ${value}`);
    if (!sent.ok) { fill.disabled = false; toastMessage('Could not fill it in', sent.error); return; }
    handled.set(key, sent.outcome);
    keep();
    done(sent.outcome);
    updateNeedsCount();
    if (value === saved && !forgotten.has(need.question)) { savedAnswers.set(need.question, value); keep(); body.append(savedLine(need.question)); return; }
    const result = await window.pilot.rememberAnswer(need.question, value);
    if (!result?.ok) { body.append(el('div', 'small ss-saved is-error', result?.error || `Couldn't keep it in ${storeName()}`)); return; }
    savedAnswers.set(need.question, value); forgotten.delete(need.question); keep();
    body.append(savedLine(need.question));
  }, offline(item));
  submitOnEnter(input, fill);
  actions.append(fill);
  if (item.stage !== 'account') actions.append(reviewButton(item, need.question));
  const line = el('div', 'ss-ask-line');   // the buttons sit on the input's line (owner, 27 Oct 2026)
  line.append(input, actions);
  body.append(line);
  li.append(badge(), body);
  if (handled.has(key)) { done(handled.get(key)); const note = savedLine(need.question); if (note) body.append(note); }
  return markKnockout(li, item, need.question);
}

// Run at start-up, in the order the window has always done it (app.js calls each page's init in turn).
export async function init() {
  // The cards' header bars fold and unfold them: Form completion's field list, the needs' history.
  const toggleHistory = () => {
    if ($('ss-needs-history').hidden) return;
    $('ss-needs-card').classList.toggle('show-history');
    updateNeedsCount();
  };
  $('ss-needs-history').addEventListener('click', toggleHistory);
  $('ss-needs-card').querySelector('.ss-fact-head').addEventListener('click', event => { if (!event.target.closest('a, button, input, select')) toggleHistory(); });
  for (const bar of ['.ss-form-head', '.ss-form-progress'])
    $('ss-form-card').querySelector(bar).addEventListener('click', () => { const more = $('ss-form-more'); if (!more.hidden) more.open = !more.open; });
  // A window that just loaded (⌘R, a restart) asks for every form's last state: the app passes them on only when they
  // change, so without this the ticks from the form stayed away until something changed there.
  window.pilot.reviewStates().then(states => {
    for (const state of states || []) if (!reviewStates.has(state.id)) reviewStates.set(state.id, state);
    renderDock();
    if (!document.querySelector('.view[data-view="sessions"]').hidden) renderSessionPage();
  }).catch(() => {});
  window.pilot.onReview(state => {
    const before = reviewStates.get(state.id);
    const changed = JSON.stringify(before?.missing || []) !== JSON.stringify(state.missing || []) || before?.url !== state.url   // the header shows the tab's address
      || JSON.stringify(before?.proposals || []) !== JSON.stringify(state.proposals || []);   // answers proposed after the rows were drawn (the AI step is slower than the fill)
    reviewStates.set(state.id, state);
    const item = sessionList.find(entry => entry.id === state.id);
    // Ready to submit (or not any more): every pill that shows it, in the dock and the sessions list.
    if (item && !!before?.ready !== !!state.ready) {
      renderDock();
      if (!document.querySelector('.view[data-view="sessions"]').hidden) { renderSessionPage(); return; }
    }
    if (changed && item && shared.openSessionId === state.id) renderSessionPage();
    if (item && shared.openSessionId === state.id && !document.querySelector('.view[data-view="sessions"]').hidden) {
      applyFormStates(item);
      showFormState(item);  // filled fields arrive while the session is still running
      renderSteps(item);    // and its "What happened" steps follow them (session-steps.js)
    }
  });
  document.querySelector('.sd-head').addEventListener('click', event => {
    if (event.target.closest('#sd-all')) return;
    if (event.target.closest('.sd-link')) { openSession(shared.openSessionId || sessionList[0]?.id); return; }
    shared.dockOpen = !shared.dockOpen;
    renderDock();
  });
  $('sd-all').addEventListener('click', event => { event.preventDefault(); openSession(shared.openSessionId || sessionList[0]?.id); });
  $('ss-new').addEventListener('click', () => openView('jobs'));
  $('ss-empty-jobs').addEventListener('click', () => openView('jobs'));  // the empty state's one action
}
