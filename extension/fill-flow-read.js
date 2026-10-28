// The fill flow's ordered page preparation, retry reads and page-kind decisions; state stays with fill-flow.js.
// Invariants (flow core: read before editing; changing one is the owner's call, said in the commit; each names the test that guards it):
//  1. Apply is pressed once per tab and page; only a reload or the person's "Apply on this page" clears that, never a press itself (dede94a, 6065c87; desktop/e2e/test/real-extension.test.mjs).
//  2. A popup is closed before the page is read, and a link that leaves the page is never pressed (fdd9638; worker/test/visit-consent.test.js, worker/test/popup-page.test.js).
//  3. A fill that put nothing in climbs the closer-look ladder, then reports 'incomplete', kept until something is filled (c1a2fcc; desktop/test/session-flow.test.js).
//  4. After a fill the AI is asked what the page needs next; a middle step's Next is pressed under the Submit floors, Submit never (worker/test/form-ready.test.js).
import {backgroundPage} from './background-apply.js';
import {apiFor, askEarly, settings} from './flow.js';
import {decide} from './log.js';
import {expandSections} from './sections.js';
import {closeConsentEverywhere} from './consent.js';
import {accountOutcome, accountStep} from './account-step.js';
import {noteRole} from './account.js';
import {pageStill} from './page-still.js';
import {STILL_MS, readWhileDrawing} from './ladder/still-drawing.js';
import {bindSession, identityOf} from './tab-identity.js';
import {pageRole} from './tab-pages.js';
import {pageShape} from './page-reads.js';
import {markPage} from './page-mark.js';
import {brokenOf} from './ladder/site-broken.js';
import {climbOnUnsure, controlsOf, noteSignal, takePressed} from './ladder/climb.js';

// Close a cookie popup and expand sections before the first page read.
export async function preparePage(step) {
  const {tab, live} = step, {sayStep} = step.flow;
  // A popup over the page (a cookie banner: Deloitte, 9 Oct 2026; any other, in any flow) is closed the way a person would, before the page is read (consent.js).
  const banner = await closeConsentEverywhere(tab.id, {cookiesOnly: true}).catch(() => '');
  if (banner) { decide('fill', 'closed a popup', {label: banner.slice(0, 40), tab: tab.id}); sayStep(tab.id, `Closed a popup ("${banner.slice(0, 30)}")`); await pageStill(tab.id, {maxMs: 800}); }
  await expandSections(live);   // a form drawn with collapsed sections (SuccessFactors) is read open, or it looks empty and is judged "no form" (sections.js)
}

// Retry refused reads and stop on an unreadable or broken page.
export async function readPage(step) {
  const {tab, jobUrl, key} = step, {started, emptyShape, brokenPage} = step.flow;
  // The page can refuse a read right after its load (still swapping documents, the worker just woke): look again before giving up,
  // or the tab is left with no fill and no state at all, for Claude and the app to wait on.
  let counts = await pageShape(tab.id);
  for (let again = 0; !counts && again < 8; again++) {   // every 0.5 s, up to the same 4 s
    await new Promise(resolve => setTimeout(resolve, 500));
    counts = await pageShape(tab.id);
  }
  // No control at all while the page is still growing (a form rendered by script after its load, "Chargement en cours…"): read it again
  // before anyone judges it, or a loading form is called a posting and its Submit pressed as Apply (9 Oct 2026, SuccessFactors). A static page: one still half second.
  for (let wait = 0; counts && emptyShape(counts) && wait < 4; wait++) {
    await pageStill(tab.id, {maxMs: 1000});
    const next = await pageShape(tab.id);
    if (!next) break;
    const growing = next.nodes !== counts.nodes;
    counts = next;
    if (!growing) break;
  }
  if (!counts) {
    started.delete(key);
    decide('fill', 'the page could not be read', {host: (() => { try { return new URL(tab.url).hostname; } catch { return ''; } })()});
    await brokenPage(tab, jobUrl, key, null);   // loaded again, then reported plainly: never a silent stop (ladder/site-broken.js)
    return false;
  }
  // The server answered with an error (a posting gone, the site down) and the page shows no form: loaded again, then reported plainly; never judged as a page.
  if (brokenOf(counts)) { await brokenPage(tab, jobUrl, key, counts); return false; }
  step.counts = counts;
  return true;
}

// Ask the page kind beside the account outcome, retaining every late-read guard.
export async function askPage(step) {
  const {tab, jobUrl, live, gen} = step;
  const {counts} = step, {askKind, late, emptyShape, sayStep} = step.flow;
  // A sign-up form was open in this tab (we filled it) and the page changed: what became of it is the account AI's word (account-step.js accountOutcome).
  // The two AI looks do not depend on each other (the outcome of a sign-up, the kind of this page): asked together, the wait is the longer one, not the sum (9 Oct 2026, Migros: 13 s then 9 s, one after the other).
  // A page that already shows a form (2+ fields, no password): its questions go to the AI now, beside the page-kind ask; the fill takes the answer only if
  // this page is filled as a form (flow.js askEarly, early-answers.js). A count of controls only starts a question early: it never decides what the page is.
  if (counts.fields + counts.textareas >= 2 && !counts.passwords) askEarly(live, await settings(), jobUrl).catch(() => {});
  const lookedAt = Date.now();
  sayStep(tab.id, 'Reading this page…'); markPage(tab.id, 'reading');   // the panel and the desktop say so at once (page-mark.js)
  const kindAsk = askKind(tab), outcomeLook = accountOutcome(tab).catch(() => {});
  const firstAsked = (await kindAsk) || await climbOnUnsure(tab, askKind);   // unsure: the numbered digest (rung 3), not the structure rule
  if (late(tab, gen, 'page kind')) return false;
  // The AI says the page is still being drawn (a placeholder, a cover over an empty shell): read it again once it is still, never plan a fill from it (ladder/still-drawing.js).
  const asked = await readWhileDrawing(firstAsked, {again: () => askKind(tab, {fresh: true}), still: () => pageStill(tab.id, STILL_MS), unanswered: async () => { const now = await pageShape(tab.id); return !!now && emptyShape(now); }, log: decide, host: (() => { try { return new URL(tab.url).hostname; } catch { return ''; } })()});
  if (late(tab, gen, 'page kind, read again')) return false;
  if (await backgroundPage(tab.id, asked?.role || pageRole(counts, tab.url), asked?.botCheck === true)) return false;
  // The application form: fill it now; what became of the sign-up before it is the account AI's word a moment later, for the card only (owner, 9 Oct 2026: the fill
  // waited 40 s on it on Migros while the page was already the form). Any other page (an account page, a posting, nothing known) waits for it, as the sign-in →
  // sign-up switch and the account step go by it. Guard: worker/test/account-step.test.js.
  if (asked?.role !== 'form') await outcomeLook;
  if (late(tab, gen, 'account outcome')) return false;
  const outcomeMs = Date.now() - lookedAt;   // what the fill waited before it could go on
  Object.assign(step, {asked, lookedAt, outcomeMs});
  return true;
}

// Correct a contradicted kind and fill account details only outside confirmation mode.
export async function correctPage(step) {
  const {tab, gen} = step;
  const {counts, asked} = step, {askKind, late, forgetKind} = step.flow;
  // What kind of page this is: the AI's word for this site and page shape (asked once, kept), in any language; the structure rule when
  // there is none (no AI, unsure). Every flow below goes by the role either one gives (docs/flows/applying.md).
  const ruled = pageRole(counts, tab.url);
  let kind = asked;
  let role = kind?.role || ruled, noted = '';   // noted: what the page is called to the app and the learning, when the fill below treats it as something else
  // Self-correction: a "form" with nothing to fill is not one. The kept answer goes; the structure rule decides this visit.
  const controls = (Number(counts.fields) || 0) + (Number(counts.files) || 0) + (Number(counts.textareas) || 0) + (Number(counts.passwords) || 0) + (Number(counts.choices) || 0);
  if (kind && role === 'form' && controls === 0) {
    await forgetKind(tab, kind, 'a form with no fields'); role = ruled;
    if (role === 'no-form') { noteSignal(tab.id, {rung: kind.rung ?? 2, signal: 'contradicted'}, controlsOf(tab.id)); kind = (await climbOnUnsure(tab, askKind)) || kind; if (late(tab, gen, 'contradicted page')) return false; role = kind?.role === 'no-form' ? 'no-form' : role; }   // the page contradicts the kept answer: a signal, so the ladder climbs (ladder/climb.js)
  }
  // Every account page gets the normal fill: its fields are judged by meaning (any language) and your details go in, whatever step the AI named or did not
  // (owner, 12 Oct 2026: "we see an email, the AI judges, we fill"; a remembered answer with no step left the page to Claude and the email box empty).
  // Filling presses nothing: which way to go (register, sign in, leave), the passwords and the account button stay account-step.js's (accountMove, dffa024).
  if (role === 'account') {
    const host0 = (() => { try { return new URL(tab.url).hostname; } catch { return ''; } })();
    const id = await identityOf(tab);
    const peek = await apiFor(tab.id, await settings(), '/extension/site-password', {method: 'POST', body: JSON.stringify({host: host0, peek: true, session: id.session, job: id.job, url: id.url})}).catch(() => null);
    await bindSession(tab.id, peek?.session, id.session);
    if (peek?.mode !== 'confirm') { role = 'form'; noted = 'account'; decide('fill', `account page${kind?.accountStep ? ` (${kind.accountStep})` : ''}: filled with your details`, {host: host0}); }   // 'confirm': waiting for its mail, nothing typed again
  }
  if (late(tab, gen, 'account details')) return false;   // the peek waits on the app: the person may have pressed on meanwhile (beta run 38383983490: a sign-up's read filled the form after it)
  Object.assign(step, {ruled, kind, role, noted});
  return true;
}

// Mark and remember the judged page before any Apply press or fill.
export async function describePage(step) {
  const {tab, kind, ruled, role, noted, lookedAt, outcomeMs} = step;
  decide('fill', `page kind: ${kind?.kind || ruled}`, {by: kind ? kind.by : 'structure rule', confidence: kind?.confidence ?? null, ms: Date.now() - lookedAt, outcomeMs,
    ...(kind && kind.role !== ruled ? {rule: ruled} : {}), host: (() => { try { return new URL(tab.url).hostname; } catch { return ''; } })()});
  await markPage(tab.id, role, false, kind, {working: true});   // a page with no form says so to the panel: never Ready, never counts (page-mark.js); no verdict yet: the read goes on (working-mark.js)
  const carried = takePressed(tab.id);   // the Apply press that brought the tab here: confirmed below only if this page takes the fill (ladder/climb.js)
  await noteRole(tab.id, tab.url, noted || role);   // a sign-up page filled like a form is still an account page: no application learning, no "application form" stage (Migros, 8 Oct 2026)
  // Event-driven: an account page is looked at the moment its kind is known, not at the panel's next tick. One filled with your details is looked at AFTER
  // that fill: its "ready?" judgment must see the email in (jobs.ch, 9 Oct 2026: judged 0.3 s before the fill typed it, "Email address" missing, nothing pressed).
  const accountPage = kind?.role === 'account' || ruled === 'account', accountAfterFill = accountPage && noted === 'account';
  if (accountPage && !accountAfterFill) accountStep(tab, 0).catch(() => {});
  let host = '';
  try { host = new URL(tab.url).hostname; } catch { /* not a url */ }
  Object.assign(step, {carried, accountPage, accountAfterFill, host});
}

