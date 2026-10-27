// "Your details" for the extension (GET /extension/me): the contact, CV and cover letter it fills a form with, read from Notion with the last
// good read kept on this Mac. Re-exported by server.js. Guarded by desktop/test/kept.test.js, cv.test.js and local-server.test.js.
import * as cv from './cv.js';
import * as letters from './cover-letter.js';
import * as jobLetter from './job-letter.js';
import fs from 'node:fs';
import * as knowledge from './knowledge.js';
import * as viewCache from './view-cache.js';
import * as contactDetails from './contact.js';
import {cvFallbackFor} from './contact-from-cv.js';
import {hashOf} from './cv-check.js';
import {log} from './log.js';
import {choicesFor} from './menu-choices.js';
import {isTwin} from './twin.js';
import {byStore} from './store/words.js';
export const withholdFiles = (storage, env = process.env) => isTwin(env) && fs.existsSync(storage.path('twin-no-files'));

// The user's details live in the app (Settings → Your details, filled from the CV by the strategy draft);
// the extension asks for them each time it fills a form (GET /extension/me with its token), so it keeps no copy.
// With the job page's URL (?url=), a CV tailored to that job is sent instead of the base one (same file name).
// Your details from Notion; when Notion can't be read, the last ones it gave (a cache, rebuilt at the next good
// read) and the reason, never a silent empty answer: that left a form without your name, reported as "no answer".
let lastContact = null;
async function readContact(storage) {
  try {
    const contact = await contactDetails.read(storage);
    if (Object.keys(contact).length) { lastContact = contact; viewCache.remember(storage, 'contact', {contact}); }
    return {contact, contactSource: 'notion', contactError: Object.keys(contact).length ? null : 'the 📇 Contact details section of your Profile is empty'};
  } catch (error) {
    const kept = lastContact || viewCache.recall(storage, 'contact')?.result?.contact || null;
    return {contact: kept || {}, contactSource: kept ? byStore(storage, 'last read (Notion failed)', 'last read') : 'none', contactError: byStore(storage, `Notion: ${error.message}`, error.message)};
  }
}
// Answered at once from the last good read kept on this Mac (view-cache), refreshed from Notion in the background once
// it's older than FRESH_MS; only the very first read waits for Notion. One refresh at a time per kind.
const FRESH_MS = 10 * 60 * 1000;
const refreshing = new Map();
export async function kept(storage, name, load, {now = Date.now()} = {}) {
  const saved = viewCache.recall(storage, name);
  const refresh = () => {
    if (!refreshing.has(name)) refreshing.set(name, Promise.resolve().then(load).finally(() => refreshing.delete(name)));
    return refreshing.get(name);
  };
  if (!saved) return refresh();
  if (now - Date.parse(saved.at) > FRESH_MS) refresh().catch(() => {});
  return {...saved.result, fromCache: saved.at};
}
// The label says where the copy came from, never when: it reaches the extension's debug details and from there a model ask (the filler review), where a clock time could never match a kept answer.
export const keptSource = () => 'kept copy on this Mac';   // the copy came from the store's last good read (view-cache): its place is not a store's name here
export const contactOf = storage => kept(storage, 'contact', () => readContact(storage)).then(result =>
  result.fromCache ? {contact: result.contact || {}, contactSource: keptSource(result.fromCache), contactError: null} : result);
// After an edit in Settings → Your details: the kept copy is the new one at once.
export function contactSaved(storage, contact) { lastContact = contact; viewCache.remember(storage, 'contact', {contact}); }

// The CV a form gets: the job's tailored one, else the general one (twin, 9 Oct 2026: a tailored PDF missing on disk left the form with NO CV,
// silently: an empty catch). Each miss is logged with why (never the file's content). Guard: test/server-contact-cv.test.js.
export function pickCv({tailored, general, url = '', read = file => fs.readFileSync(file), say = log}) {
  const host = (() => { try { return new URL(url).hostname; } catch { return ''; } })();
  for (const [kind, choice] of [['tailored', tailored], ['general', general]]) {
    if (!choice) continue;
    try { return {name: choice.name, type: 'application/pdf', data: read(choice.path).toString('base64'), tailored: kind === 'tailored'}; }
    catch (error) { say('extension', `CV: the ${kind} CV could not be read${kind === 'tailored' ? ', using the general one' : ''}`, {host, error: String(error?.code || error?.message || error).slice(0, 60)}); }
  }
  return null;
}

// A detail left empty that the CV states plainly goes to the form, named in contact._fromCv (an array: never typed, never a value the page compares) so the
// page marks it "from your CV: check it" (page/fill.js). Not saved: the Profile stays as the person left it (contact-from-cv.js cvFallback). Guard: test/contact-cv-fallback.test.js.
export function withCvFallback(storage, details, cvFile = hashOf(storage)) {
  const {details: fromCv, keys} = cvFallbackFor(storage, cvFile, details.contact || {});
  if (!keys.length) return details;
  if (fromCv.first_name && fromCv.last_name && !details.contact?.full_name) fromCv.full_name = `${fromCv.first_name} ${fromCv.last_name}`;   // a "Name" box takes both (contact.js read does the same for a saved one)
  log('extension', `details from your CV for an empty one: ${keys.join(', ')}`, {fields: keys});   // which fields, never their values
  return {...details, contact: {...details.contact, ...fromCv, _fromCv: Object.keys(fromCv)}};
}

export async function me(storage, url = '') {
  const settings = storage.settings();
  const tailored = url ? cv.forUrl(storage, url) : null;
  // A tailored CV goes up under its own name (CV_<Name>_<Company>.pdf), so the form shows which one it got.
  const resume = pickCv({tailored: tailored ? {path: cv.pdfPath(storage, tailored.job.code), name: cv.finalName(storage, tailored)} : null,
    general: {path: storage.path('cv.pdf'), name: settings.cvName || 'CV.pdf'}, url});
  // The cover letter as a file, for forms that ask to upload one: this job's own (made with its tailored CV), else the approved base letter only while its
  // switch is on (owner, 18 Oct 2026: approving it and using it everywhere are two choices); never a draft, never one with a gap left to fill ("[Company]").
  let coverLetterFile = null;
  try {
    const base = letters.status(storage);
    if (tailored && jobLetter.hasPdf(storage, tailored.job.code) && !letters.hasGap(jobLetter.load(storage, tailored.job.code)?.text)) coverLetterFile = {name: jobLetter.finalName(storage, tailored), type: 'application/pdf',
      data: fs.readFileSync(jobLetter.pdfPath(storage, tailored.job.code)).toString('base64'), tailored: true};
    else if (letters.fallbackOn(settings) && base.pdf && !letters.hasGap(base.text)) coverLetterFile = {name: 'Cover letter.pdf', type: 'application/pdf', data: fs.readFileSync(letters.pdfPath(storage)).toString('base64')};
  } catch {}
  // Learned notes that answer a field directly (kind answer/option), for the extension to use at fill time.
  const notes = await kept(storage, 'knowledge', async () => {
    const list = (await knowledge.notes(storage)).map(({block, ...note}) => note);
    viewCache.remember(storage, 'knowledge', {notes: list});
    return {notes: list};
  }).catch(() => ({notes: []}));
  const direct = (notes.notes || []).filter(n => n.value && ['answer', 'option'].includes(n.kind));
  const details = withCvFallback(storage, await contactOf(storage));
  // Logged only when Notion was actually read or failed: an answer from the kept copy is the normal case (no noise).
  if (!details.contactSource?.startsWith('kept')) log('extension', `details for ${(() => { try { return new URL(url).hostname; } catch { return 'a form'; } })()}: ${Object.keys(details.contact).length} contact fields from ${details.contactSource}`,
    {fields: Object.keys(details.contact), cv: resume?.name || null, tailored: !!resume?.tailored, coverLetter: !!coverLetterFile, tailoredLetter: !!coverLetterFile?.tailored, ...(details.contactError ? {error: details.contactError} : {})});
  // Twin only: while the file "twin-no-files" is in its folder, no CV and no cover letter go to the form (owner, 9 Oct 2026: test fills on
  // employers outside the owner's list, where a slot that uploads on choice would send the CV to their server). Never checked by a real install.
  if (withholdFiles(storage)) {
    log('extension', 'files withheld for this form: a twin test run (twin-no-files)', {cv: !!resume, coverLetter: !!coverLetterFile});
    return {...details, resume: null, coverLetterFile: null, knowledge: direct, menuChoices: choicesFor(storage), acceptConsents: storage.settings().acceptConsents !== false};
  }
  return {...details, resume, coverLetterFile, knowledge: direct, menuChoices: choicesFor(storage), acceptConsents: storage.settings().acceptConsents !== false};   // lib/menu-choices.js: all of them; the extension keeps the form tab's site (the url here is the posting's)
}
