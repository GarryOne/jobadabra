/* global document */
// The privacy tripwire (owner, 11 Oct 2026; rule: tests never touch the owner's real data). The plan's claude -p carries the signed-in Claude account, and a held fill
// on a real site typed the owner's first name (guessed from the account e-mail) into the fake applicant's form. After every held fill of a live run (lib/apply-live.mjs
// runLive), every value the page's fields hold (all frames, open shadow roots; never a password field) is compared with the owner's own values: his app's profile and
// answers and contact details (capture-page.mjs appProfileTexts, personalValues), his place (12 Oct 2026: a plan-path model with no profile typed the account
// holder's country and city; "Location:", "City:", "Country:", "Street:" lines) and his Claude account (e-mail, the name words in it, its full and display name).
// What it could not find on this computer is said at the start of each run (coverageLine), never a silent "clean". A match fails the run, deletes what the
// run saved and clears those fields on the page (nothing is ever submitted). Values stay on this Mac: compared, never printed or stored; only kinds and field labels.
// Guard: e2e/test/app/privacy-tripwire.test.mjs.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {CONTACT} from './apply-fixtures.mjs';
import {appProfileTexts, personalValues} from './capture-page.mjs';
import {placesOf as placesIn} from '../../lib/owner-values.js';
import {matchesOwner, plain} from '../../../worker/src/owner-guard.js';
import {passwordLeak} from './test-accounts.mjs';

// The signed-in Claude account on this Mac (~/.claude.json oauthAccount): read here only, never printed. -> {email, names}
export function claudeAccount(file = path.join(os.homedir(), '.claude.json')) {
  try {
    const account = JSON.parse(fs.readFileSync(file, 'utf8')).oauthAccount || {};
    return {email: String(account.emailAddress || ''), names: [account.fullName, account.displayName].filter(Boolean).map(String)};
  } catch { return {email: '', names: []}; }
}

const wordsOf = text => String(text).toLowerCase().split(/[^\p{L}]+/u).filter(word => word.length >= 3);
const FAKE_PLACES = new Set([CONTACT.location, CONTACT.street, 'Zurich, Switzerland'].flatMap(place => placesIn([`location: ${place}`])));   // the fake applicant's own places are not the person's
export const placesOf = texts => placesIn(texts, FAKE_PLACES);

// -> Map(value -> kind): kind is email, phone (digits), name (a word) or account (the account e-mail). texts: the owner's app files; account: claudeAccount().
export function ownerValues({texts = appProfileTexts(), accountEmail, accountNames} = {}) {
  const account = accountEmail === undefined ? claudeAccount() : {email: accountEmail, names: accountNames || []};
  const values = personalValues(texts);
  for (const place of placesOf(texts)) if (!values.has(place)) values.set(place, 'location');
  for (const word of [...wordsOf(account.email.split('@')[0]), ...(account.names || []).flatMap(wordsOf)]) if (!values.has(word)) values.set(word, 'name');
  if (account.email && values.get(account.email.toLowerCase()) !== 'email') values.set(account.email.toLowerCase(), 'account');   // the same address as a profile e-mail stays 'email': one value, one kind, and the coverage line then says the e-mail is checked (15 Oct 2026: it said "NOT FOUND: email" while the address WAS checked, as 'account')
  return values;
}

export {matchesOwner};   // the matcher is shared with the answer step (worker/src/owner-guard.js): the same list is checked before a keystroke and after

// Runs in each frame: every field the page holds a value in, with its label (a password field is never read).
function fieldsInPage() {
  const all = [], walk = root => { all.push(...root.querySelectorAll('input, textarea, select, [contenteditable=""], [contenteditable=true]')); for (const el of root.querySelectorAll('*')) if (el.shadowRoot) walk(el.shadowRoot); };
  walk(document);
  const labelOf = el => (el.labels?.[0]?.textContent || el.getAttribute('aria-label') || el.getAttribute('placeholder') || el.name || el.id || '').replace(/\s+/g, ' ').trim();
  const isAutocomplete = el => el.getAttribute('role') === 'combobox' || (el.getAttribute('aria-autocomplete') || 'none') !== 'none' || el.hasAttribute('list') || !!el.closest('[role=combobox]');   // a control that offers suggestions
  return all.filter(el => !['hidden', 'password', 'submit', 'button', 'reset', 'image', 'file', 'checkbox', 'radio'].includes(el.type))
    .map(el => ({label: labelOf(el), control: isAutocomplete(el) ? 'autocomplete' : 'input', value: el.tagName === 'SELECT' ? el.selectedOptions?.[0]?.textContent || '' : el.isContentEditable ? el.textContent : el.value}))
    .filter(field => String(field.value || '').trim());
}
// Runs in each frame: empties the fields with these labels (the tripwire's hits), as a person would.
function clearInPage(labels) {
  const wanted = new Set(labels), walk = (root, found) => { found.push(...root.querySelectorAll('input, textarea, [contenteditable=""], [contenteditable=true]')); for (const el of root.querySelectorAll('*')) if (el.shadowRoot) walk(el.shadowRoot, found); return found; };
  const labelOf = el => (el.labels?.[0]?.textContent || el.getAttribute('aria-label') || el.getAttribute('placeholder') || el.name || el.id || '').replace(/\s+/g, ' ').trim().slice(0, 60);
  for (const el of walk(document, [])) if (wanted.has(labelOf(el)) && el.type !== 'password') {
    if (el.isContentEditable) el.textContent = ''; else el.value = '';
    el.dispatchEvent(new Event('input', {bubbles: true})); el.dispatchEvent(new Event('change', {bubbles: true}));
  }
}

// A Playwright page as the tripwire reads it: every frame's fields; clearing by label.
export const pageFields = page => ({
  typed: async () => (await Promise.all(page.frames().map(frame => frame.evaluate(fieldsInPage).catch(() => [])))).flat(),
  clear: async labels => { await Promise.all(page.frames().map(frame => frame.evaluate(clearInPage, labels).catch(() => {}))); },
});

// What the tripwire knows of the owner on this computer, by kind (never a value): what it checks, and what it could not find, so a run never reads "clean"
// for a kind it never looked for. -> {checks: [kind], missing: [kind]}; coverageLine: the one line a live run prints at its start.
const KINDS = ['name', 'email', 'phone', 'location'];
export function coverage(values) {
  const kinds = new Set(values.values());
  return {checks: [...KINDS, 'account'].filter(kind => kinds.has(kind)), missing: KINDS.filter(kind => !kinds.has(kind))};
}
export function coverageLine(values) {
  const {checks, missing} = coverage(values);
  return `privacy tripwire: checks ${checks.join(', ') || 'nothing'}${missing.length ? `; NOT FOUND on this computer: ${missing.join(', ')}` : ''}`;
}

// Where a typed value came from (never the value): 'answer' (one the extension was told to type), 'kit' (the fake applicant's own), 'page suggestion' (a control that
// offers suggestions, here an autocomplete's IP-based pick, holds something nobody typed), else 'unknown'. answers/kit: the strings the run supplied.
export function sourceOf(field, {answers = [], kit = []} = {}) {
  const same = list => list.some(item => plain(item) === plain(field.value));
  return same(answers) ? 'answer' : same(kit) ? 'kit' : field.control === 'autocomplete' ? 'page suggestion' : 'unknown';
}

// source: {typed(), clear?(labels)}; saved: the run's folders to delete on a match. -> {ok, checked, missing, reason?}
// allow: values a listed test account brings (lib/test-accounts.mjs allowedValues: its email), never a trip.
// answers, kit: what the run knows the extension typed, to say where a hit's value came from (the reason names the control and the source, before the files are deleted).
// accounts: the listed test accounts; their passwords are looked for in `saved` too (lib/test-accounts.mjs passwordLeak).
export async function tripwire(source, {values = ownerValues(), saved = [], allow = [], answers = [], kit = [], accounts = {}} = {}) {
  const leak = passwordLeak(saved, accounts);
  if (leak) return {ok: false, checked: 0, missing: coverage(values).missing, reason: leak};
  const typed = (await source.typed()).filter(({value}) => !allow.includes(String(value || '').trim().toLowerCase())), hits = matchesOwner(typed, values), {missing} = coverage(values);
  if (!hits.length) return {ok: true, checked: typed.length, missing};
  for (const dir of saved.filter(Boolean)) fs.rmSync(dir, {recursive: true, force: true});
  await source.clear?.([...new Set(hits.map(hit => hit.label))]);
  return {ok: false, checked: typed.length, missing, reason: `privacy tripwire: ${hits.map(hit => { const field = typed.find(item => String(item.label || '').slice(0, 60) === hit.label) || {}; return `${hit.kind} typed into "${hit.label}" (${field.control || 'input'}, from ${sourceOf(field, {answers, kit})})`; }).join(', ')}; the run's saved files (screenshots included) were deleted and those fields cleared`};
}
