// Which tab may the extension touch, and with which page? Chrome reuses a tab id after its tab closes, and the
// extension keeps per-tab state (`from:<id>`, `job:<id>`) in session storage, so an id that comes back showing
// something else must never inherit that work: on 1 Oct 2026 a fill's "Claude is answering 1 more question…" box
// was painted onto a Google search page, and the submitted-check would read the text of any other host.
//
// Kept free of chrome.* so the decisions can be tested (like report-alarm.js): the callers pass URLs.
// Invariants (flow core: read before editing; changing one is the owner's call, said in the commit; each names the test that guards it):
//  1. A later page is a form, an account page, or neither; the same page ignores the fill mark and a trailing slash (desktop/test/extension-tab-pages.test.js).
//  2. A fill may keep drawing while the form moves inside its own site, never onto another site (desktop/test/extension-tab-pages.test.js).
//  3. pageRole is the structure rule: it answers only when no AI kind exists (desktop/test/page-kind.test.js).

import {buttonPhrase} from './alias-schema.js';

// The fill mark, which may carry the session the app opened the tab for: #jobpilotto-fill=<id> (spec 2026-10-12-tab-owned.md). Always the last part of the address.
const MARK_RE = /#jobpilotto-fill(?:=([A-Za-z0-9_-]{1,64}))?$/;
export const parseMark = url => (MARK_RE.exec(String(url || '')) || [])[1] || '';
export const stripMark = url => String(url || '').replace(MARK_RE, '');
export const pageKey = url => String(url || '').split('#')[0].replace(/\/+$/, '');

// The panel and the fill run only on a tab the desktop app opened (#jobpilotto-fill) or has already armed.
// A page the user is just browsing, Calendly included, is not one of those.
export const tabArmed = ({url, armed} = {}) => !!armed || String(url || '').includes('#jobpilotto-fill');

// What the toolbar popup offers on a tab, one kind each (8 Oct 2026: a tab the app opened to apply showed the "read this job list" buttons):
//   fill:   the app opened it to apply (Apply); the panel on the page does the work, nothing to read
//   board:  the app opened it for "Read this board" and waits for the person's Read (popup-controls.js)
//   read:   the app opened it to read its jobs (Read sites, #jp-read) or one posting (#jp-posting); it reads by itself, no buttons
//   browse: any other web page; "Read the jobs on this page" is offered
//   none:   not a web page (chrome://, a file)
const OPENED_TO_READ = /#jp-read(-filter)?(-[a-z0-9]{4,16})?$|#jp-posting-[a-z0-9]{4,16}$/;
// A board the person asked the app to open ("Read this board", #jp-board-<ticket>): theirs to read, so the popup offers the two reads there and nowhere else.
const OPENED_TO_HOLD = /#jp-board-[a-z0-9]{4,16}$/;   // with or without its ticket (READ_MARK below needs one)
export const popupMode = ({url, armed} = {}) => {
  const href = String(url || '');
  if (!/^https?:/.test(href)) return 'none';
  if (tabArmed({url: href, armed}) && !neverForm(href)) return 'fill';
  if (OPENED_TO_HOLD.test(href)) return 'board';
  return OPENED_TO_READ.test(href) ? 'read' : 'browse';
};

// Pages that are never a job form, wherever the tab came from: the user's own Notion (the kit and the tracker live there) and
// search results (Claude researching a company in the armed tab, 2 Oct 2026: a Google results page got "answering 1 question").
// An armed tab pointed at one of them is let go: no panel, no fill, until the app arms it again. Only results pages: a real form
// on a Google host (docs.google.com/forms, careers.google.com) is still a form.
export const neverForm = url => {
  try {
    const {hostname: host, pathname: path} = new URL(String(url));
    if (/(^|\.)(notion\.so|notion\.site|notion\.com)$/i.test(host)) return true;
    if (/^(www\.)?google\.[a-z.]+$/i.test(host)) return /^\/(search|webhp|imghp)?\/?$/.test(path) || path.startsWith('/search');
    return /^(www\.)?(bing\.com|duckduckgo\.com|search\.brave\.com|ecosia\.org|search\.yahoo\.com)$/i.test(host);
  } catch {
    return false;
  }
};

// A page with no form but an "Apply" button (the posting first, the form behind it): which button to press, by rule, never by
// guess. candidates: [{index, text, tag, area, visible, disabled, href, submits}] read in the page. The text must be an apply phrase
// on its own (a button, not a sentence), and never sign-in, "Easy Apply", "Apply with LinkedIn", a mail link or Submit.
// → the candidate, or null. Tested in desktop/test/extension-tab-pages.test.js.
const APPLY_PHRASE = /^(to apply|apply( now| here| online| today)?( for (this|the) (job|role|position|opening))?|apply to this (job|role|position)|i['\u2019]?m interested|start (your |the )?application|jetzt bewerben|online bewerben|bewerben|zur bewerbung|bewerbung starten|postuler( maintenant| en ligne)?|candidater|postuler [a\u00e0] (ce|cette) (poste|offre)|candidati( ora)?|invia candidatura|inscribirme|aplicar( ahora)?)[\s\p{P}\p{S}]*$/iu;   // any trailing marks: "Postuler »" (Coop, 8 Oct 2026), "Apply →", "Apply ❯"
const NOT_APPLY = /sign.?in|log.?in|register|create (an )?account|submit|save|share|alert|easy apply|apply with |already applied|follow|subscribe/i;
// The button the page-kind AI named: the same floor, except a board's own "Easy apply" (owner, 11 Oct 2026: the AI says whether it applies here or through another site's account;
// "apply with …" stays refused). Without the AI's answer the rule above still refuses it.
const NOT_APPLY_NAMED = new RegExp(NOT_APPLY.source.replace('|easy apply', ''), 'i');
const notAPage = href => /^(mailto|tel|javascript):/i.test(String(href || ''));   // a mail, phone or script link is no way into the application
export function pickApplyButton(candidates = [], phrases = []) {
  let best = null, bestScore = -1;
  for (const item of candidates) {
    const text = String(item?.text || '').replace(/\s+/g, ' ').trim();
    // The built-in words, or a phrase the service learned (extension/alias-schema.js, validated against the same not-a-button list).
    const learned = buttonPhrase(text, phrases);
    if (item?.submits) continue;   // never a form's Submit, whatever its words (applyCandidates: by structure)
    if (!item?.visible || item.disabled || !text || text.length > 40 || !(APPLY_PHRASE.test(text) || learned) || (learned ? NOT_APPLY_NAMED : NOT_APPLY).test(text)) continue;
    if (notAPage(item.href)) continue;
    const score = 100 - text.length + (item.tag === 'button' ? 5 : 0) + Math.min(20, Math.log10(Math.max(1, Number(item.area) || 1)) * 4);
    if (score > bestScore) { best = learned && !APPLY_PHRASE.test(text) ? {...item, viaPhrase: learned} : item; bestScore = score; }
  }
  return best;
}

// What may be named: every control the page sketch lists (page-reads.js pageSketchOf reads the page with this same selector) and the named-button finder searches with it, so the AI is never
// told about a control the finder cannot find (10 Oct 2026, Hornbach: "Jetzt bewerben (ohne Anmeldung)" is an <a> with no href and a script click handler; the finder listed only a[href]).
// One string for both: desktop/test/named-controls.test.js. The phrase path (pickApplyButton, no AI answer) keeps its own narrower list (fill-flow.js PAGE_BUTTONS).
export const NAMED_BUTTONS = 'button, input[type=submit], [role=button], a';
// A button the page-kind AI NAMED (the start route's: Workday's "Apply Manually"): found by its own text, never ranked against the built-in apply words,
// which would pick the posting's plain "Apply" behind the dialog (10 Oct 2026: 109 vs 103 on Richemont, Red Hat, Chanel). The AI decides which button;
// structure only finds it (same words, case and spacing aside). Floors as above: never a Submit, a sign-in or "apply with…", a mail link, a hidden or disabled one.
// → the candidate, or null (not on the page: nothing is pressed, never a guess). Tested in desktop/test/extension-tab-pages.test.js.
export function pickNamedButton(candidates = [], named = '') {
  const same = text => String(text || '').replace(/\s+/g, ' ').trim().toLowerCase();
  const wanted = same(named);
  if (!wanted) return null;
  let best = null;
  for (const item of candidates) {
    const text = same(item?.text);
    if (text !== wanted || item.submits || !item.visible || item.disabled || NOT_APPLY_NAMED.test(text)) continue;
    if (notAPage(item.href)) continue;
    if (!best || (Number(item.area) || 0) > (Number(best.area) || 0)) best = item;
  }
  return best;
}

// How a fill treats the job's kit. A kit that exists (hasKit: drafted when the job was prepared, eligibility judged then) means
// applying was the user's decision: fill what is known at once, ask Claude about the form's own questions afterwards, and never
// stop on an eligibility check. A kit with no answer for any of this form's fields is still a kit.
export const kitStance = ({kitAnswers = [], hasKit = false, matched = 0} = {}) =>
  ({withKit: kitAnswers.length > 0 || hasKit, skipEligibility: matched > 0 || hasKit});

// What an armed tab is showing, from counts only. A password field is an account page: Claude signs in or
// creates the account, and the extension never types it. Several fields, a textarea or a file input is the
// application form; so is a sign-in address (url). Anything smaller is a page Claude still has to click through (Apply, Next).
// A sign-in address is an account page too, before its password box shows: jobs.ch's Apply leads to auth.jobs.ch/u/login/identifier,
// which asks for the email first (8 Oct 2026: it was called "no form").
const SIGN_IN_PATH = /\/(login|log-in|signin|sign-in|sign_in|authwall|uas\/login|oauth2?\/authorize|authorize)\b/i;
// A password box alone makes a sign-in or sign-up page ('account'), however many fields beside it (a sign-up asks names, email twice,
// a username). With an application's own sign beside it, a file upload (a CV, even behind an "Upload a CV" button that hides its input)
// or a text box (a cover letter), the page is the application with its account made on the way ('form': owner, 8 Oct 2026, Coop on
// SuccessFactors: CV, email, password, name, date of birth on one page); its password boxes stay account fields (filled from the
// Keychain, never learned, never a fill miss).
export function pageRole({fields = 0, passwords = 0, files = 0, textareas = 0, anyFiles = 0, choices = 0} = {}, url = '') {
  if ((Number(passwords) || 0) > 0) {
    const applying = (Number(files) || 0) > 0 || (Number(anyFiles) || 0) > 0 || (Number(textareas) || 0) > 0;
    return applying ? 'form' : 'account';
  }
  try { if (SIGN_IN_PATH.test(new URL(String(url)).pathname)) return 'account'; } catch { /* not a url */ }
  if ((Number(files) || 0) > 0 || (Number(textareas) || 0) > 0 || (Number(fields) || 0) >= 3) return 'form';
  if ((Number(choices) || 0) > 0) return 'form';   // a step that asks a question with plain buttons while a control waits for its answer (page/choice-step.js): the application goes on here
  return 'no-form';
}

// The page mark for a role the flow decided (page-mark.js says it on the page and to the app): pure, so the tests read it.
export const markOf = (role, pressed = false, step = '', kind = '') => (role === 'no-form' ? (kind && kind !== 'posting' ? 'other' : pressed ? 'opening' : 'posting')   // 'other': the AI saw no job page (an error, an expired link): never "Apply button detected"
  : role === 'account' ? (step === 'sign_up' ? 'sign-up' : 'account')
  : role === 'signing' ? (step === 'sign_up' ? 'signing-up' : 'signing-in')   // its button pressed (account-step.js)
  : ['form', 'reading', 'signing-in', 'signing-up'].includes(role) ? role : '');

// A form the press BROUGHT: the page reads as a form now, and is not just the controls it already had before the press (15 Oct 2026, a posting with a job-search box and a "Create Alert"
// form beside its Apply link: the alert's fields were taken as "a form came" 0.5 s before the page moved on, and the posting was filled and called Ready). A form that is drawn adds
// controls; a new page ends the wait as navigated. `before`: the page's shape before any press (null: nothing known, so the page alone decides, as before).
export function formCame(before, now, url = '') {
  if (pageRole(now, url) !== 'form') return false;
  if (!before || pageRole(before, url) !== 'form') return true;
  return ['fields', 'files', 'textareas', 'choices', 'passwords', 'anyFiles'].some(key => (Number(now?.[key]) || 0) > (Number(before?.[key]) || 0));
}

// Is this a sign-in or sign-up page, for everything that learns from a page or judges a submit? `stored`: the role pageRole gave
// and the page it was decided on ({role, page}); `page`: the page now; `panelSaw`: the page's panel sees a password box, used only
// for a page the rule hasn't decided. An account page never teaches the form-filling data, never adds answers, never counts as "submitted".
export function isAccountPage(stored, page, panelSaw = false, key = url => String(url || '').split('#')[0]) {
  if (stored && key(stored.page) === key(page)) return stored.role === 'account';   // the rule decided this page: it wins (a combined page has a password box too)
  return !!panelSaw;
}

// The URL's origin, or '' when it isn't a URL.
export function originOf(url) {
  try {
    return new URL(String(url)).origin;
  } catch {
    return '';
  }
}

// The same page, ignoring the fill marker (#jobpilotto-fill) and a trailing slash.
export const samePage = (a, b) => !!a && !!b && pageKey(a) === pageKey(b);

// The same site: what a fill may keep painting on while a form moves between its own steps (the ATS redirects
// /apply to /apply/step2), but never another site.
export const sameSite = (a, b) => !!originOf(a) && originOf(a) === originOf(b);

// How long to watch after a submit press. A redirect can be the confirmation, and so can the same page
// once its content changes. After this, an unchanged form is not a submission.
export const SUBMIT_WAIT_MS = 20 * 1000;
// A confirmation page that comes later than that (a slow submit, a CAPTCHA) after a press is still read, up to this long after it.
export const LATE_CONFIRMATION_MS = 3 * 60 * 1000;
// A loading line ("Submitting…") is not the outcome. The page must sit still for this long, or the wait must end.
export const SUBMIT_SETTLE_MS = 2 * 1000;

// A short hash of what the page is showing. The text itself is not kept.
export function pageFingerprint({title, headings, text, inputs} = {}) {
  const body = [title || '', ...(headings || []), String(inputs ?? ''), String(text || '').slice(0, 800)].join('\n');
  let hash = 2166136261;
  for (let i = 0; i < body.length; i++) hash = Math.imul(hash ^ body.charCodeAt(i), 16777619);
  return (hash >>> 0).toString(16);
}

// Whether to ask the AI. A submit press, then either a new address or different content. The path is not evidence,
// and a redirect is not required: a confirmation message on the same page counts once the content has changed.
export function submissionOutcome({at, now = Date.now(), from, to, before, after, stableFor = 0} = {}) {
  let host = '';
  let path = '';
  try {
    const url = new URL(String(to || from || ''));
    host = url.hostname;
    path = url.pathname.replace(/\/+$/, '').slice(-80);
  } catch { /* not a url */ }
  if (!at) return {ask: false, why: 'no submit', host, path};
  if (now - at > SUBMIT_WAIT_MS || now < at) return {ask: false, why: 'submit too old', host, path};
  const redirected = !!(from && to && !samePage(from, to));
  const edited = !!(before && after && before !== after);
  if (!redirected && !edited) return {ask: false, why: now - at >= SUBMIT_WAIT_MS ? 'unchanged' : 'waiting', host, path};
  if (stableFor < SUBMIT_SETTLE_MS && now - at < SUBMIT_WAIT_MS) return {ask: false, why: 'waiting', host, path};
  return {ask: true, why: redirected ? 'redirect' : 'content', host, path};
}

// A Greenhouse /confirmation or Lever /thanks page, as host + job id + path. Null for anything else,
// including a form page and a page whose text merely says "thank you". Query strings are dropped.
export function confirmationOf(url) {
  try {
    const parsed = new URL(String(url));
    const parts = parsed.pathname.replace(/\/+$/, '').split('/').filter(Boolean);
    const path = parts.at(-1) || '';
    if (path !== 'confirmation' && path !== 'thanks') return null;
    return {host: parsed.hostname, id: parts.at(-2) || '', path};
  } catch {
    return null;
  }
}

// Why a confirmation page was not marked, or null when this tab's stored job owns it (the mark path
// logs that itself). The silent return here is what left the 1 Oct 2026 Anthropic confirmation with
// no [extension] line: the tab's saved job was gone, so nothing was written.
export function missedConfirmation({url, job} = {}) {
  const page = confirmationOf(url);
  if (!page) return null;
  if (!job) return {text: 'confirmation page, no job stored on this tab: not marked', fields: page};
  if (!forJob(url, job)) {
    let stored = '';
    try { stored = new URL(String(job)).pathname.replace(/\/+$/, '').split('/').filter(Boolean).at(-1) || ''; } catch { stored = ''; }
    return {text: 'confirmation page is not the job stored on this tab: not marked', fields: {...page, stored}};
  }
  return null;
}

// This job's own page, or the confirmation page a site shows after submitting it (Greenhouse …/<job id>/confirmation,
// Lever …/<job id>/thanks): the two places an email-side "you submitted" signal is expected from.
export function forJob(current, job) {
  if (!current || !job) return false;
  if (samePage(current, job)) return true;
  const id = String(job).replace(/\/+$/, '').split('/').pop();
  if (!id) return false;
  // An embedded Greenhouse form: …/embed/job_app/confirmation?for=<board>&token=<job id>.
  try { if (confirmationOf(current) && [...new URL(String(current)).searchParams.values()].includes(id)) return true; } catch { /* not a url */ }
  try {
    return new RegExp(`${id.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}/(confirmation|thanks)`).test(String(current));
  } catch {
    return false;
  }
}

// The tab ids the app is told are open: the job-board tabs, plus every tab the app armed (a form on any other site, such as
// an agency's own) that still exists. Without the armed ones the app took such a form for closed and hid its card.
export function reportedIds({jobSiteIds = [], armedIds = [], existingIds = []} = {}) {
  const exist = new Set(existingIds);
  return [...new Set([...jobSiteIds, ...armedIds.filter(id => exist.has(id))])];
}

// How a navigation in an armed tab began, from Chrome's webNavigation details. A person typing an address, searching from the
// address bar, using a bookmark or the start page leaves the application ('by-hand'); a link, a form, a reload or a redirect is
// the page moving on by itself ('page'). The mark in the URL follows the page, never a person who walked away.
const BY_HAND = new Set(['typed', 'generated', 'auto_bookmark', 'start_page', 'keyword', 'keyword_generated']);
// from_api is an address handed to the tab from outside the page (another app's link, chrome.tabs.update): by hand too, unless the extension itself moved the tab (`ours`, tabs.js moveTab).
// A page's own link, redirect, form post and reload never carry it. 14 Oct 2026: a GitHub PR page opened in an armed tab got the fill mark and the panel.
export function navigationKind({transitionType = '', transitionQualifiers = []} = {}, ours = false) {
  const qualifiers = transitionQualifiers || [];
  return BY_HAND.has(transitionType) || qualifiers.includes('from_address_bar') || (qualifiers.includes('from_api') && !ours) ? 'by-hand' : 'page';
}
// The address with the fill mark, kept on every page of the application. Pages that use their own #fragment are left alone.
export function withMark(url, mark = 'jobpilotto-fill') {
  try {
    const parsed = new URL(String(url));
    if (!/^https?:$/.test(parsed.protocol) || parsed.hash) return '';
    parsed.hash = mark;
    return parsed.href;
  } catch { return ''; }
}

// A fill that used a shared fix (a recipe from Jobadabra's service) says so in the panel, never silently (owner, 2 Oct 2026: the
// service now changes what the extension does on a page, so the user sees when it did, and how to turn it off).
const KIND_WORDS = {'toggle-group': 'a Yes/No-style choice', 'custom-select': 'a custom dropdown', date: 'a date field'};
export function sharedFixes(operated) {
  const used = (Array.isArray(operated) ? operated : []).filter(item => item && item.recipe > 0 && item.ok);
  return {count: used.length, kinds: [...new Set(used.map(item => KIND_WORDS[item.kind] || 'a control'))]};
}
export const sharedFixNote = ({count, kinds}) => (count
  ? `Used ${count} shared fix${count === 1 ? '' : 'es'} from Jobadabra's service for ${kinds.join(' and ')}. Only the control's shape is shared, never your answers. Turn it off in the app: Settings → Technical reports.`
  : '');


// A page the app opened with the fill mark: does it start its own job, or is it the page this tab already holds a job for loading again
// (the result of a form's own Submit, a reload)? Only a different page starts a job: keeping the job across a reload is what lets the
// confirmation after Submit be marked (3 Oct 2026: a job lost on the result page was never marked Applied).
export const startsOwnJob = (prior, url) => !prior || pageKey(prior) !== pageKey(url);

// Read sites (the app's Actions task): which open tab reads which site, by the ticket in the mark the app opened it with
// (#jp-read-<ticket> or #jp-read-filter-<ticket>). A tab keeps its ticket after a redirect drops the mark (`kept`: tab id -> ticket from
// chrome.storage.session read:<id>). Returns {reading: {ticket: tab id}, mark: {tab id: ticket}} (mark: ones to keep), open tabs only.
export const READ_MARK = /#jp-(?:read(?:-filter)?|posting|board)-([a-z0-9]{4,16})$/;   // a site read, or one job posting read (visit.js POSTING_MARK)
export function readTabs(tabs = [], kept = {}) {
  const reading = {}, mark = {};
  for (const tab of tabs) {
    const fromUrl = READ_MARK.exec(String(tab.url || ''))?.[1];
    const ticket = fromUrl || kept[tab.id];
    if (!ticket) continue;
    reading[ticket] = tab.id;
    if (fromUrl && kept[tab.id] !== fromUrl) mark[tab.id] = fromUrl;
  }
  return {reading, mark};
}
