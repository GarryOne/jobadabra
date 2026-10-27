// "Needs your attention", a field the form still has empty, with its proposed answer back (owner, 8 Oct 2026: "we had this, it got
// overwritten": the 30 Sep rows proposed Claude's answer, but only from Claude's message, so once Apply went through the extension the
// rows were bare). The answer comes from what the fill proposed for that field (extension/page/propose.js, reported with what is left),
// else, for a contact detail you have not given, from your CV (lib/contact-from-cv.js). "Use" fills it in the form through the
// extension and keeps it for future forms (a contact detail in Your details, any other answer in your Answers). Guarded by
// test/need-proposal.test.js.
import {el} from '../components.js';
import {renderSessionPage} from './session-log.js';
import {badge, reviewStates, showInForm, smallButton, submitOnEnter, titleLine} from './session-needs.js';
import {keyAsker, onChoices, pickProposal, rowPicks} from '../proposal-pick.js';
import {storeName} from '../store-words.js';

// What the row needs besides the form's report, asked once per window and kept: your details, the CV's proposals, and which detail a
// label asks for (Claude reads the labels the extension doesn't know: lib/contact-keys.js).
let contact = null, fromCv = null;
const keys = keyAsker(labels => window.pilot.contactKeysFor(labels), () => renderSessionPage());   // proposal-pick.js: once per label, never twice in flight
function load() {
  if (contact) return;
  contact = {}; fromCv = [];
  window.pilot.contact().then(found => { contact = found || {}; renderSessionPage(); }).catch(() => {});
  window.pilot.contactProposals({}).then(result => { fromCv = result?.proposals || []; if (fromCv.length) renderSessionPage(); }).catch(() => {});
}

// → {value, key, from} or null (proposal-pick.js decides).
export function proposalFor(item, label) {
  load();
  const proposals = reviewStates.get(item.id)?.proposals || [];
  const reported = proposals.find(proposal => proposal.label === label);
  if (!reported?.value && !reported?.key) keys.request(label);
  const proposal = pickProposal({proposals, label, key: keys.key(label), contact, cv: fromCv});
  if (!proposal?.options?.length || !proposal.value) return proposal;
  const ask = `${proposal.value}|${proposal.options.join('|')}`;
  if (!choices.has(ask) && !proposal.options.some(option => option.toLowerCase() === proposal.value.toLowerCase())) {
    choices.set(ask, undefined);   // asked once per window; the answer redraws the row
    window.pilot.formChoiceFor({label, value: proposal.value, options: proposal.options})
      .then(found => { choices.set(ask, found?.choice || ''); renderSessionPage(); }).catch(() => choices.set(ask, ''));
  }
  return onChoices(proposal, choices.get(ask));
}
const choices = new Map();   // `${answer}|${choices}` -> the form's choice that means the same ('' none, undefined asking)

// What "Use" did, per session and field, so a redraw (the page redraws often) keeps saying it. A field the form did not take after a few
// seconds (a menu that needs your click) gets its answer copied and an Open in form.
const used = new Map();   // `${id}|${label}` -> {at, kept}
// Counted once per session and field (lib/proposal-use.js): shown when first drawn, then used or edited on Use. Fixed words only.
const counted = new Set();
const noteUse = (id, source, act) => { if (source) window.pilot.sessionProposalUse?.(id, source, act)?.catch?.(() => {}); };
const TAKES_MS = 5000;
const picks = rowPicks();   // a redraw builds a new box: what the person chose lives here, not in the box

export function proposedRow(item, label, proposal, now = Date.now()) {
  const li = el('li', 'ss-need is-ask'), body = el('div', 'ss-need-body'), actions = el('span', 'ss-need-actions'), line = el('div', 'ss-ask-line');   // askRow's layout
  li.dataset.empty = label;
  const key = `${item.id}|${label}`, tried = used.get(key);
  if (!counted.has(key)) { counted.add(key); noteUse(item.id, proposal.source, 'shown'); }
  // A menu: the form's own choices, the one that means the same picked (proposal-pick.js onChoices); otherwise a text box.
  const input = proposal.options?.length ? el('select', 'ss-ask-input') : el('input', 'ss-ask-input');
  if (proposal.options?.length) input.append(el('option', '', proposal.waiting ? 'Finding the matching choice…' : ''), ...proposal.options.map(option => el('option', '', option)));
  else { input.type = 'text'; input.placeholder = 'Your answer'; }
  input.value = picks.start(key, tried?.value || proposal.value);
  input.addEventListener('input', () => picks.note(key, input.value));   // a text box and a menu both fire input
  const note = el('span', 'ss-need-desc small', proposal.from);
  line.append(input, actions);
  body.append(titleLine(label.replace(/^\s*\*\s*|\s*\*\s*$/g, '')), note, line);
  li.append(badge(), body);
  if (tried && now - tried.at >= TAKES_MS) {   // still empty in the form after Use
    note.textContent = 'The form didn\'t take it: the answer is copied, paste or pick it there';
    actions.append(smallButton('Open in form', 'secondary is-review', event => showInForm(item, label, event.currentTarget)));
    return li;
  }
  if (tried) {
    input.disabled = true;
    note.textContent = tried.kept ? 'Filled in the form · remembered for future forms' : `Filled in the form (not remembered: ${storeName()} didn't answer)`;
    li.classList.add('is-done');
    return li;
  }
  const use = smallButton('Use', 'secondary is-answer', async () => {
    const value = input.value.trim();
    if (!value) { note.textContent = 'Write an answer first'; input.focus(); return; }
    use.disabled = input.disabled = true;
    const filled = await window.pilot.sessionFillField(item.id, label, value).catch(error => ({ok: false, error: error.message}));
    if (!filled?.ok) { use.disabled = input.disabled = false; note.textContent = filled?.error || 'Couldn\'t reach the form'; return; }
    noteUse(item.id, proposal.source, proposal.value && value === String(proposal.value).trim() ? 'used' : 'edited');
    // Kept for every later form: a contact detail in Your details, any other answer in your Answers (Notion).
    // Your saved detail, unchanged (or only put in this form's words, "Monsieur" as "Sir"): nothing to write.
    const already = proposal.key && [value, proposal.original].includes(String(contact?.[proposal.key] || '')) && (value === proposal.value);   // your saved detail, unchanged: nothing to write
    const kept = already ? {ok: true} : await (proposal.key ? window.pilot.saveContactField(proposal.key, value) : window.pilot.rememberAnswer(label, value)).catch(() => ({ok: false}));
    if (proposal.key && kept?.ok) contact = {...contact, [proposal.key]: value};
    used.set(key, {at: Date.now(), value, kept: !!kept?.ok});
    picks.forget(key);
    setTimeout(() => { if ((reviewStates.get(item.id)?.pending || []).includes(label)) { navigator.clipboard?.writeText(value).catch(() => {}); renderSessionPage(); } }, TAKES_MS);
    renderSessionPage();
  });
  submitOnEnter(input, use);
  actions.append(use);
  return li;
}
export const _used = used, _counted = counted;   // tests
