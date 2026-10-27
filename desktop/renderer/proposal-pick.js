// The proposed answer for a field the form still has empty (no DOM: the session page's row asks this, a test feeds it every source).
// In order: what the fill proposed for that field (a value the form did not take); else, when the field asks for a contact detail
// (the extension knew it, or Claude read the label: lib/contact-keys.js), your saved detail, then the CV's (or the Profile's) proposal; else an empty
// box that keeps what you type for every form. null: nothing to propose (the row stays "Open in form"). `source` is one of
// lib/proposal-use.js SOURCES: what the session page counts when the row is shown and used.
const NAMES = {phone: 'phone', street: 'street', postal_code: 'postal code', location: 'town', birth_date: 'date of birth',
  place_of_origin: 'place of origin', salutation: 'salutation', first_name: 'first name', last_name: 'last name', email: 'email'};
export function pickProposal(ask = {}) {
  const proposal = proposalOf(ask), options = (ask.proposals || []).find(item => item.label === ask.label)?.options || [];
  return proposal && options.length ? {...proposal, options} : proposal;
}
// A menu's row proposes one of the form's own choices (owner, 8 Oct 2026: "Monsieur" was typed into a Madam/Sir menu): the same text is
// taken as it is; `choice` is what lib/option-pick.js found means the same (undefined: not asked yet; '': none does).
export function onChoices(proposal, choice) {
  if (!proposal?.options?.length || !proposal.value) return proposal;
  const same = proposal.options.find(option => option.trim().toLowerCase() === proposal.value.trim().toLowerCase());
  if (same) return {...proposal, value: same};
  if (choice === undefined) return {...proposal, value: '', waiting: true, original: proposal.value};
  return choice ? {...proposal, value: choice, original: proposal.value, from: `${proposal.from} ("${proposal.value}" on this form)`}
    : {...proposal, value: '', original: proposal.value, from: `None of this form's choices means "${proposal.value}": pick one`};
}
function proposalOf({proposals = [], label, key = '', contact = {}, cv = []} = {}) {
  const found = proposals.find(proposal => proposal.label === label);
  if (found?.value) return {value: found.value, key: found.key || key || '', source: found.guess ? 'fill_guess' : 'fill_tried',
    from: found.guess ? 'Your most likely answer, from your profile and this job: check it' : 'Proposed by the fill: the form did not take it'};
  const wants = found?.key || key;
  if (!wants) return null;
  if (String(contact?.[wants] || '').trim()) return {value: contact[wants], key: wants, source: 'details', from: 'From your details'};
  const mine = cv.find(proposal => proposal.field === wants);
  if (mine) return {value: mine.value, key: wants, source: mine.source === 'profile' ? 'profile' : 'cv', from: mine.source === 'profile' ? 'From your profile: check it' : mine.sure ? 'From your CV' : 'From your CV: check it'};
  return {value: '', key: wants, source: 'empty', from: `Your ${NAMES[wants] || 'detail'}: type it once, every form gets it`};
}

// What the person has picked or typed in a row's box, kept outside the box: the session page redraws a row many times (proposals,
// contact, the choice lookup arrive late) and a new box starts from the proposal, so a pick made a moment before Use read "" and
// the row said "Write an answer first" (applyflows run 40526061842, 27 Oct 2026). One owner per row key; changed only by the person
// (`note`) or by Use (`forget`, the form has it now).
export function rowPicks() {
  const picked = new Map();
  return {
    note: (key, value) => { if (value) picked.set(key, value); else picked.delete(key); },   // an emptied box goes back to the proposal
    start: (key, fallback) => picked.has(key) ? picked.get(key) : fallback,
    forget: key => { picked.delete(key); },
  };
}

// Which detail each label asks for, asked of Claude once per label (lib/contact-keys.js), the labels of one redraw in one call.
// A label stays "asked" until its answer comes: a redraw while Claude reads it must not pay for it again (8 Oct 2026, the live-test
// twin: "Localité" was sent twice, 0.1 s apart). ask(labels) -> Promise<{label: key}>; onAnswer() redraws.
export function keyAsker(ask, onAnswer = () => {}, delay = 200) {
  const keyOf = new Map(), queued = new Set(), waiting = new Set();
  let timer = null;
  const request = label => {
    if (keyOf.has(label) || queued.has(label) || waiting.has(label) || /^\d+ more fields?$/.test(label)) return;
    queued.add(label);
    clearTimeout(timer);
    timer = setTimeout(() => {
      const labels = [...queued];
      queued.clear();
      for (const one of labels) waiting.add(one);
      const settle = keys => { for (const one of labels) { keyOf.set(one, keys?.[one] || ''); waiting.delete(one); } onAnswer(); };
      Promise.resolve().then(() => ask(labels)).then(settle, () => settle({}));
    }, delay);
  };
  return {request, key: label => keyOf.get(label) || '', known: label => keyOf.has(label)};
}
