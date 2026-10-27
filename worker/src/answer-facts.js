// Answers from saved facts: the closed list of facts a form answer may rest on, the prompt rule that sets (not proposes) an answer that follows
// from one, and what the code does with a guess (typed and marked, unless it is a contact detail or a link). Used by worker/src/extension.js answerForm.
// Guarded by worker/test/answer-facts.test.js; measured on real captures by desktop/e2e/answer-reask.mjs (12 Oct 2026: 70% of the required
// fields the pool left were answers, many with the fact saved, e.g. the languages spoken, the work permit for a role in its own region).
import { sameCountry } from './country-names.js';

// What the applicant saved that an answer can follow from. A fixed list: the AI names one, the code checks it; "none" = nothing saved settles it.
export const FACT_KEYS = ['work_permit', 'sponsorship', 'home_location', 'relocation', 'work_mode', 'languages', 'salary', 'notice_period',
  'start_date', 'years_experience', 'employment_history', 'education', 'links', 'referral_source', 'employee_of_this_company',
  'relatives_at_this_company', 'contact', 'drafted_kit', 'other_saved', 'none'];

// Why (#2203): `a free-text box whose question names neither a currency nor a period is asked in the stated target's own` — fair round form 106 ("salary expectations? A range is fine.") stayed empty 3 of 3.
export const FACT_RULE = `use: "fill" when <profile>, <standard_answers>, the CV facts, the search preferences or the drafted kit state the answer, or when it follows from what they state with no judgment of yours: it is typed into the form. Following from a stated fact means, for example: a work authorisation or sponsorship question about a place the stated permit or citizenship covers (an EU or EFTA citizen may work in the EU and Switzerland without sponsorship); which languages the applicant speaks, or their level in one, when the stated languages say it; an on-site, hybrid or remote question the stated work mode covers; a relocation or residence question about a place the stated home base or relocation names; a salary expectation asked in the currency and period of a stated target (a number box that names no currency asks in the currency of the job's country; a free-text box whose question names neither a currency nor a period is asked in the stated target's own: its value is the target as stated, with its currency code, period and gross or net in words, e.g. "CHF 140,000–160,000 a year, gross", and it is listed in pay_asks with the target's own currency and period as the ones asked, use "fill"); every question about pay, salary or compensation, in any currency and even when you must pick a figure inside a stated range (its middle), is answered with fact "salary" and listed in pay_asks, never as a guess with fact "none", also when no conversion is needed: the field, the stated target's amount as a number with its ISO currency and period, the currency and period the form asks (the same ones when they match), and basis_clear (true only when the form's period and gross or net are the same as the stated target's; false when unclear); a salary asked in another currency or period than the stated target is answered the same way, with the stated target as its value: the code converts it, never you, and a salary answer that is not listed is only proposed; years of experience the profile or CV states; whether the applicant has hands-on experience with a skill, tool, language or technology a yes/no question names, or which tools they use most when asked to name them, when the CV or Profile lists it (answer yes, or name the listed ones; a skill the CV does not list is not a no: it is a proposal); whether someone at the company referred or recommended them, or whether they know anyone there, when the saved facts state how they heard of the job or that they know no one there. A question about the job's own country or place ("the country this role is located in") is settled only when the job's text or the form names that place; when neither does, it is a proposal. Choose the form's own option that means that answer, in whatever language the form is. A place typed into a free-text box is written in the applicant's own saved words, never translated. Legal, demographic and own-words (written) questions follow their own rules below, not this one.
fact: the saved fact the answer rests on, one of the listed keys ("other_saved" for a stated fact no key names); "none" when nothing saved settles it.
When nothing saved settles it (a place the permit does not name, a date, or whether they worked for this company, know someone there or how they heard of the job, when nothing saved says so), still give your most plausible answer for this applicant and this job, with use: "propose" and fact "none": the applicant sees it as a suggestion and confirms it; it is never typed for them.`;

// A guess is typed (owner, 14 Oct 2026, after the bake-off: "Ok, let's change this policy. I allow it"; until then a guess was only proposed,
// 12 Oct 2026). The AI still marks it (use "propose" or fact "none"); the code types it and keeps guess: true so the app can say so.
// Still only proposed (a salary the code could not convert safely, pay-convert.js, among them): a contact detail or a link (the identity and link floors below decide those), a preference (whether the applicant
// is kept informed) and a knockout guess (owner, 9 Oct 2026; f519229: an unplaced sponsorship question typed "No sponsorship needed" on a
// UK role): a knockout that follows from a saved fact is typed by the rule above, a guessed one is the employer's reason to reject; and a guess
// the AI rates low (its scale: "low when the applicant should check it"; owner, 14 Oct 2026: "still proposing where we have a lower confidence"). Legal, demographic and own-words (written) questions keep their own rules: never touched here (12 Oct 2026: a floor here
// turned Lever's typed decline-to-answer into a proposal, which the demographic floor then dropped).
const KEPT_PROPOSED = ['legal', 'demographic', 'written', 'contact', 'preference', 'knockout'];
export function typeGuess(answer) {
  const guess = answer.use === 'propose' || answer.fact === 'none';
  if (!guess || answer.value === '' || ['legal', 'demographic', 'written'].includes(answer.category)) return answer;
  const kept = KEPT_PROPOSED.includes(answer.category) || ['contact', 'home_location', 'links', 'salary'].includes(answer.fact) || answer.confidence === 'low'
    || /^(https?:\/\/|www\.)\S+$/i.test(String(answer.value || '').trim());
  return kept ? {...answer, use: 'propose'} : {...answer, use: 'fill', guess: true};
}
// A box is ticked only from a saved fact (16 Oct 2026): a lone checkbox is a statement the applicant agrees with, and a consent the AI read as an ordinary question (category "normal",
// fact "none") would otherwise be typed as a guess. Structure only: the field's type and the answer's own fact, no wording. A guess on a box stays a proposal the person confirms.
export const floorBoxGuess = (answer, type) => (type === 'checkbox' && answer.use === 'fill' && answer.fact === 'none' && answer.value !== '' && !['legal', 'demographic', 'written'].includes(answer.category)
  ? { ...answer, use: 'propose', guess: undefined } : answer);
// The identity floor (12 Oct 2026: with no profile sent, a plan-path model typed the signed-in account holder's country, city and surname into a test form).
// A contact answer (name, e-mail, phone, address) or one resting on the home location is typed only when its value is in what the ask was given (the
// profile, standard answers, CV facts, search settings, drafted kit): accents and case aside, every word of it, or the phone's last nine digits. Otherwise it
// came from somewhere else (an account, a guess): proposed, never typed. A value that follows from a given one in other words (a country for a given city)
// is proposed too: the applicant confirms it once. Guarded by worker/test/identity-floor.test.js.
const plain = (text) => String(text || '').normalize('NFD').replace(/\p{M}/gu, '').toLowerCase();
const wordsOf = (text) => plain(text).split(/[^\p{L}\p{N}@.+_-]+/u).map((word) => word.replace(/^[.+_-]+|[.+_-]+$/g, '')).filter(Boolean);
// options: the field's listed choices. A country chosen from them passes when it names the saved country in another language ("Suisse" for a saved
// "Switzerland", country-names.js): the form offers no wording of the applicant's own (owner, 17 Oct 2026, a choice a base fact answers is filled).
export function floorUngrounded(answer, given, { test = false, options = [] } = {}) {
  if (test || answer.use !== 'fill' || answer.value === '' || !(answer.category === 'contact' || ['contact', 'home_location'].includes(answer.fact))) return answer;
  const value = plain(answer.value), digits = value.replace(/\D/g, '');
  const phones = (plain(given).match(/\+?\d[\d\s()./-]{6,}\d/g) || []).map((phone) => phone.replace(/\D/g, '').slice(-9));
  const asPhone = digits.length >= 9 && digits.length >= value.replace(/[\s()+./-]/g, '').length;
  const words = new Set(wordsOf(given));
  const grounded = asPhone ? phones.includes(digits.slice(-9)) : wordsOf(value).every((word) => words.has(word));
  const chosen = !asPhone && Array.isArray(options) && options.includes(answer.value) && sameCountry(answer.value, given);
  return grounded || chosen ? answer : { ...answer, use: 'propose' };
}

// The link floor (13 Oct 2026, a careers form: a LinkedIn address typed into "Useful links (e.g. GitHub)"): a link the AI types must be backed by a saved link of the
// kind the field asks for. The saved link's own line (its label and address) has to share a word of four letters or more with the field's label, by shape: no site names,
// no list. Otherwise it is only proposed, and the applicant confirms it once (a wrong typed answer is worse than an empty one). Not a link, or already proposed: untouched.
const GENERIC = new Set(['link', 'links', 'url', 'urls', 'profile', 'page', 'your', 'useful', 'other', 'additional', 'https', 'http', 'www', 'com']);
const linkWords = (text) => wordsOf(text).filter((word) => word.length >= 4 && !GENERIC.has(word));
// Also backed (owner, 27 Oct 2026, Greenhouse "Website" with only GitHub saved: "'Website / Portfolio' gets the GitHub link, 'Personal website' stays empty"): the AI's own reading,
// link_box "work_page" (the box asks for a page showing the applicant's work and this saved link is one), for a link that is saved; "own_site" and the rest keep the word rule.
export const LINK_RULE = `link_box: for a link you type, what the box asks for. "work_page" only when the box asks for a page that shows the applicant's work (a portfolio, code, projects; e.g. "Website / Portfolio", "Links to your work") AND the saved link you give is such a page (a code host or portfolio, never a profile on a social or job network); "own_site" when it asks for the applicant's own personal website; "other" for any other link; "none" when the answer is no link. Give a link only from what is saved.`;
export function floorLinkKind(answer, label, given, { test = false } = {}) {
  const value = String(answer.value || '').trim();
  if (test || answer.use !== 'fill' || !/^(https?:\/\/|www\.)\S+$/i.test(value)) return answer;
  const key = plain(value).replace(/^https?:\/\//, '').replace(/^www\./, '').replace(/\/+$/, '');
  const lines = plain(given).split('\n').filter((line) => line.includes(key));
  if (answer.link_box === 'work_page' && lines.length) return answer;   // Why (#2201, owner): the AI judges the box (link_box), never a label word list; it read a work-page box and this saved link is one
  const wanted = new Set(linkWords(label));
  const backed = lines.some((line) => linkWords(line).some((word) => wanted.has(word)));
  return backed ? answer : { ...answer, use: 'propose' };
}

// The figure floor (17 Oct 2026, fill-quality measure: "How many years of experience do you have with AWS?" typed "4 years", the profile says 8 and no line says 4): a number the AI
// types into a text box must appear in what it was given (profile, answers, CV facts, search, kit) or in the question itself; otherwise it is only proposed and the applicant confirms it
// once (a wrong typed answer is worse than an empty one). By shape, no words: digit runs only. Left alone: contact and place answers (their own floor), a salary (the code converts it),
// a written answer (an outline or draft, marked), and any box that is not free text (a number, date or menu is checked by its own control).
const digitRuns = (text) => String(text || '').match(/\d+/g) || [];
export function floorInventedFigure(answer, label, given, type, { test = false } = {}) {
  if (test || answer.use !== 'fill' || answer.value === '' || answer.converted || answer.fact === 'salary') return answer;
  if (['written', 'legal', 'demographic', 'contact'].includes(answer.category) || ['contact', 'home_location', 'salary'].includes(answer.fact)) return answer;
  if (!['text', 'textarea'].includes(String(type || ''))) return answer;
  const known = new Set([...digitRuns(given), ...digitRuns(label)]);
  return digitRuns(answer.value).every((run) => known.has(run)) ? answer : { ...answer, use: 'propose' };
}
