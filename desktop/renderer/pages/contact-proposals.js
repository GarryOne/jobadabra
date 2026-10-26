// "Your details from your CV" in the window: the values Claude proposed from the CV (lib/contact-from-cv.js) go into the empty boxes of
// Settings → Profile → Your details, each marked "From your CV", and the page bar's Save all changes is the confirmation. Nothing is saved before it.
// Also the nudge after Apply when the details forms usually ask for are missing. Guarded by test/contact-from-cv.test.js.
import {pill} from '../components.js';
import {message} from './core.js';
import {detailsChanged} from './details-drafts.js';
import {editDetailsCard} from './details-read.js';
import {toastMessage} from './startup.js';

const MARK = 'proposal-pill';
const box = field => document.querySelector(`#setting-contact [data-contact="${field}"]`);
const BADGE = 'cv-proposals-badge';

// The Contact card's title says how many boxes still hold a CV proposal ("4 from CV · check"), never a lone line under the card (mockup 05).
function syncBadge() {
  const title = document.querySelector('#setting-contact .card-words h3');
  const left = document.querySelectorAll('#setting-contact [data-proposed]').length;
  title?.querySelector(`.${BADGE}`)?.remove();
  if (!title || !left) return;
  const badge = pill(`${left} from CV · check`, 'warn');
  badge.classList.add(BADGE);
  badge.title = 'Filled in from your CV: check them, then Save all changes.';
  title.append(badge);
}

// Take the marks off (after Save, or before showing new proposals); an edited box keeps your value, unmarked.
const unmark = input => { delete input.dataset.proposed; input.parentElement.querySelector(`.${MARK}`)?.remove(); };
export function clearProposals() {
  document.querySelectorAll('#setting-contact [data-proposed]').forEach(unmark);
  syncBadge();
}

// A box the form hides on purpose (the Swiss-only Place of origin); a closed Profile tab is not that: its boxes are filled for when it opens.
const hiddenByForm = input => { const hidden = input.parentElement?.closest('[hidden]'); return Boolean(hidden && !hidden.matches('[data-profile-panel]')); };

// Fill each empty box the form shows with its proposal. → how many were shown.
// A box still marked from an earlier call (the tab opened again) keeps its mark: it is still unchecked.
export function showProposals(proposals = []) {
  const fields = new Set(proposals.map(each => each.field));
  document.querySelectorAll('#setting-contact [data-proposed]').forEach(input => { if (!fields.has(input.dataset.contact)) unmark(input); });
  let shown = 0;
  for (const {field, value, sure} of proposals) {
    const input = box(field);
    if (input?.dataset.proposed) { shown++; continue; }
    if (!input || input.value.trim() || hiddenByForm(input)) continue;
    input.value = value;
    input.dataset.proposed = 'cv';
    const mark = pill(sure ? 'From your CV' : 'From your CV · check it', sure ? 'info' : 'warn');
    mark.classList.add(MARK);
    (input.nextElementSibling?.dataset?.contactControl ? input.nextElementSibling : input).after(mark);   // under the typed control when there is one
    input.addEventListener('input', () => { delete input.dataset.proposed; mark.remove(); syncBadge(); }, {once: true});
    editDetailsCard(input.closest('.setting')?.id);   // a proposal is checked in its card's editor, never hidden behind the read view
    shown++;
  }
  if (shown) {
    detailsChanged();   // they are drafts on the Profile page's one save bar until saved
    message('contact-panel-message', '');
    syncBadge();
  }
  return shown;
}

// On opening the panel: what was proposed for this CV (Claude reads a CV once, so this is free after the first time).
// again: "Fill from my CV" (the Profile page's ⋯ menu), which reads the CV anew and says what it found in the Contact card's own line, also when it
// found nothing or failed (#409: a press that said nothing at all).
export async function loadProposals({again = false} = {}) {
  if (again) message('contact-panel-message', 'Reading your CV for missing details… (about 15 s)');
  const result = await window.pilot.contactProposals({again}).catch(error => ({proposals: [], error: error.message}));
  const shown = showProposals(result?.proposals || []);
  if (again && !shown) {
    message('contact-panel-message', result?.error && result.error !== 'notion' ? `Couldn't read your CV: ${result.error === 'no AI' ? 'choose your AI in Settings → Connections first' : result.error}.`
      : 'Your CV has nothing for the empty boxes: type them once here.', result?.error ? 'error' : '');
  }
  return shown;
}

// After Apply: forms usually ask for these; when some are empty, say so once per app run, with what the CV can fill.
const USUAL = {phone: 'phone', street: 'street', postal_code: 'postal code', location: 'town'};
let nudged = false;
export async function nudgeMissingDetails() {
  if (nudged) return;
  const [contact, result] = await Promise.all([window.pilot.contact().catch(() => null), window.pilot.contactProposals({}).catch(() => null)]);
  if (!contact || !Object.keys(contact).length) return;   // not connected, or Notion unreadable: nothing to say
  const missing = Object.keys(USUAL).filter(key => !String(contact[key] || '').trim());
  if (!missing.length) return;
  nudged = true;
  const fromCv = (result?.proposals || []).filter(item => missing.includes(item.field)).length;
  toastMessage({title: 'Forms will ask for details you haven\'t given',
    body: `Missing: ${missing.map(key => USUAL[key]).join(', ')}.${fromCv ? ` ${fromCv} found in your CV: check and save them once.` : ' Add them once in your Profile.'}`,
    target: {view: 'settings', section: 'profile'}, tone: 'warn'});
}
