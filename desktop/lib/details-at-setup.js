// Your details filled from the CV when the setup is accepted (owner, 27 Oct 2026: "When we setup a profile, when we upload a CV, in the wizard, we should
// extract the values from CV and put them in 'your details'"; "we can also deduct some of the things, for example, the location"). One CV read (contact-from-cv.js)
// for the details still empty after the draft's contact; every value the CV states plainly is SAVED. A value the AI inferred or was not sure of stays a proposal
// (Your details shows it in its empty box) until the review queue takes those (hand-off "CV facts to the review queue"). A detail you already have is never replaced.
// Guard: test/details-at-setup.test.js.
import * as contactDetails from './contact.js';
import * as fromCv from './contact-from-cv.js';
import {hashOf} from './cv-check.js';

// The proposals to save over the details: stated plainly by the CV (sure, never inferred, never a Profile-only value), for an empty detail. -> {key: value}
export function toSave(proposals, contact = {}) {
  const empty = new Set(fromCv.emptyFields(contact)), save = {};
  for (const item of proposals || []) {
    if (item?.sure !== true || item.inferred || item.source === 'profile' || !empty.has(item.field) || save[item.field] || !String(item.value || '').trim()) continue;
    save[item.field] = String(item.value).trim();
  }
  return save;
}

// The save window's line for the step's result (desktop/renderer/pages/wizard.js): counts only, never a value.
export const detailsNote = ({saved = [], left = []} = {}) => !saved.length && !left.length ? 'nothing more in your CV'
  : `${saved.length} filled${left.length ? `, ${left.length} to check in Your details` : ''}`;

// -> {saved: [key], left: [key]} (left: proposed but not saved) ; never throws (a failed read leaves Your details as the draft wrote them, and says why in the log).
export async function detailsFromCvAtSetup(storage, {client, log = () => {}, contactSaved = () => {}, profile = ''} = {}) {
  try {
    const contact = await contactDetails.read(storage);
    if (!fromCv.emptyFields(contact).length) return {saved: [], left: []};
    const {proposals, error} = await fromCv.forCv(storage, {contact, client, cvHash: hashOf(storage), profile, again: true, log});
    const save = toSave(proposals, contact), left = (proposals || []).map(item => item.field).filter(key => !save[key]);
    if (!Object.keys(save).length) { log('profile', `details from the CV at setup: none saved${error ? ` (${error})` : ''}`, {left}); return {saved: [], left}; }
    const saved = await contactDetails.save(storage, {...contact, ...save});
    contactSaved(saved);
    log('profile', `details from the CV at setup: ${Object.keys(save).length} saved, ${left.length} left as proposals`, {saved: Object.keys(save), left});   // which fields, never values
    return {saved: Object.keys(save), left};
  } catch (failure) {
    log('profile', `details from the CV at setup: failed: ${String(failure?.message || failure).slice(0, 120)}`, {});
    return {saved: [], left: []};
  }
}
