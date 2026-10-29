// Prepares one tab's page and answers for the fill, keeping each run's state in its supplied context.
// Invariants: see extension/fill-flow.js.
import {apiFor, cachedAI, NO_APP, NOT_CONNECTED} from './flow.js';
import {kitStance} from './tab-pages.js';
import {takeEarly} from './early-answers.js';
import {decide} from './log.js';
import {expandSections} from './sections.js';
import {PAGE_FILES} from './page-files.js';
import {HELD, clearBeforeFill, layerOnTop} from './dialog-after-fill.js';
import {closePopupOrLayer} from './consent.js';   // a cycle again (consent.js uses api and settings from here at run time)
import {pageStarted, isStopped} from './stop-state.js';
import {verdictFields} from './eligibility-verdict.js';

// -> a held result, or undefined after opening sections and injecting the page files.
export async function prepareFillPage({tab, config}) {
  // Nothing is typed under a dialog: what covers the form's controls is closed first (the AI's non-agreeing button, kept), or the fill is held and the person told (dialog-after-fill.js).
  const gate = await clearBeforeFill(tab.id, {close: closePopupOrLayer, look: layerOnTop});
  if (gate.closed.length) decide('fill', 'closed a dialog before the fill', {label: gate.closed[0].slice(0, 40), tab: tab.id});
  if (gate.held) return {held: true, layer: gate.layer, note: HELD, usd: 0};
  await expandSections(tab);   // collapsed sections open first, so their fields are read (a no-op when consider already did: sections.js marks what it opened)
  // No Submit guard for the extension: it never submits, and the user presses Submit themselves.
  await chrome.scripting.executeScript({target: {tabId: tab.id}, world: 'MAIN', func: () => { window.__jobPilottoNoGuard = true; }});
  await chrome.scripting.executeScript({target: {tabId: tab.id}, world: 'MAIN', files: PAGE_FILES});
  await chrome.scripting.executeScript({target: {tabId: tab.id, allFrames: true}, files: ['guard-bridge.js']}).catch(() => {});   // the gate's isolated-world half (guard-bridge.js); without it the fill never waits
  await loadRecipes(tab, config);
  await loadAliases(tab, config);
  await pickUpload(tab, config);
}

// Loads the optional control recipes before reading the form.
async function loadRecipes(tab, config) {
  // Recipes for the kinds of control on this form, asked of the app by fingerprint (it asks the site, and remembers). A recipe
  // only configures a generic operator; no recipe, or no answer, and the operators work with their own defaults.
  try {
    const prints = await chrome.scripting.executeScript({target: {tabId: tab.id}, world: 'MAIN', func: () => window.__jobPilottoControls?.fingerprints?.() || []})
      .then(rows => rows?.[0]?.result || []);
    if (prints.length) {
      const found = await apiFor(tab.id, config, '/extension/recipes', {method: 'POST', body: JSON.stringify({fingerprints: prints})});
      await chrome.scripting.executeScript({target: {tabId: tab.id}, world: 'MAIN', args: [found?.recipes || {}], func: recipes => { window.__jobPilottoRecipes = recipes; }});
    }
  } catch { /* recipes are a bonus: the operators work without them */ }
}

// Loads the optional label meanings before reading the form.
async function loadAliases(tab, config) {
  // Label meanings from the service (extension/alias-schema.js), asked of the app which asks the site and remembers: the filler uses them
  // only for a question no built-in pattern placed. No answer, and the built-in patterns work as before.
  try {
    const packs = await apiFor(tab.id, config, '/extension/aliases', {method: 'POST', body: '{}'});
    await chrome.scripting.executeScript({target: {tabId: tab.id}, world: 'MAIN', args: [Array.isArray(packs?.aliases) ? packs.aliases.slice(0, 2000) : []], func: aliases => { window.__jobPilottoAliases = aliases; }});
  } catch { /* aliases are a bonus */ }
}

// Loads the optional CV upload choice before reading the form.
async function pickUpload(tab, config) {
  // Two or more upload slots that could take the CV (the page's own "import my details from my CV" feature has a file input of its own): the app's AI names the one that takes the
  // CV as a document, from their titles, kept (upload-pick.js). No answer: the operator behaves as before. page/upload.js reads window.__jobPilottoUploadChoice.
  try {
    const titles = await chrome.scripting.executeScript({target: {tabId: tab.id}, world: 'MAIN', func: () => window.__jobPilottoUpload?.cvCandidates?.() || []}).then(rows => rows?.[0]?.result || []);
    const picked = titles.length > 1 ? (await apiFor(tab.id, config, '/extension/pick-upload', {method: 'POST', body: JSON.stringify({titles})}))?.title : '';
    await chrome.scripting.executeScript({target: {tabId: tab.id}, world: 'MAIN', args: [picked || ''], func: title => { window.__jobPilottoUploadChoice = title ? {resume: title} : null; }});
  } catch { /* the choice is a bonus: the operator works without it */ }
}

// -> the supplied or freshly fetched contact details and CV, with the original connection errors.
export async function resolveFillContact({tab, config, job, early, debug, usesApp}) {
  // Contact details and CV come from the Jobadabra app each time (it's the one place they live).
  return early || await apiFor(tab.id, config, `/extension/me?url=${encodeURIComponent(job)}`).catch(error => {
    // No app or no connection: stop, rather than fill a form without your name and CV.
    if (usesApp(config) && (!error.status || error.status === 401)) throw new Error(error.status ? NOT_CONNECTED : NO_APP);
    debug.errors.push(`details from the app: ${error.message}`);
    return null;
  });
}

// -> an eligibility stop, or updates the run's answers and pending AI without awaiting that answer.
export async function resolveFillAnswers(run) {
  const {tab, config, useAI, kitAnswers, hasKit, withKit, reuse, me, debug, step, readForm, openQuestions, askAnswers} = run;
  let {answers, ai, later, pendingAI, force, kitSkips} = run;
  // The best of both, like an Apply with Claude session: the kit's answers first (drafted when the kit was made),
  // then Claude only for the questions they don't cover, so nothing is left empty that could be answered. A form
  // the kit covers fully costs nothing (no call when nothing is open).
  if (useAI) {
    const form = await readForm(tab);
    step('read the form');
    debug.form = (form || []).map(({field, label, type, required, filled, legal, options}) =>
      ({field, label, type, required, filled, legal, options: (options || []).slice(0, 30)}));
    const {fromKit, open} = await openQuestions(tab, form, kitAnswers, me, config);
    debug.sentToClaude = open.map(f => f.field);
    // With a kit, applying was the user's decision (they prepared it): no eligibility stop, and no waiting: everything
    // known fills at once, and Claude answers what's left afterwards (below), while you already see the form filled.
    kitSkips = kitStance({kitAnswers, hasKit, matched: fromKit.size}).skipEligibility;
    if (kitSkips) force = true;
    if (withKit) later = open;
    const cached = reuse && !withKit ? await cachedAI(tab, open) : null;
    if (withKit) { /* Claude after the fill */ } else if (cached) {
      ai = cached;
      if (!ai.eligible && !force && config.checkEligibility !== false) return {ineligible: true, note: ai.eligibility_note || '', usd: 0, ...verdictFields({ai})};
      const byAI = new Set(ai.answers.map(a => a.field));
      answers = [...ai.answers.map(a => ({...a, source: 'Claude (on the page)'})), ...answers.filter(a => !byAI.has(a.field))];
    } else if (open.length) {
      // The fields your details and CV answer are filled at once; Claude's answers fill a second pass when they come, as after a kit (owner, 11 Oct 2026:
      // "fill them at once and let the AI fill the rest"; a "not eligible" answer then keeps what is filled and says so).
      const askedEarly = takeEarly(tab.id, tab.url, open);   // asked beside the page-kind ask (askEarly), when it was for these same questions
      debug.earlyAnswers = !!askedEarly;
      pendingAI = askedEarly ? askedEarly.then(found => found || askAnswers(tab, config, open)) : askAnswers(tab, config, open);
      pendingAI.catch(() => {});
      later = open;
    }
  }
  Object.assign(run, {answers, ai, later, pendingAI, force, kitSkips});
}

// -> the menu-wording adapter shared by both fill passes.
export function rememberedFillChoices({tab, debug, me}) {
  // A menu answer this site showed under another wording is given as the menu's own choice (desktop/lib/menu-choices.js: "+41" -> "Suisse").
  // Every pass's answers: the first ones here, Claude's later ones below.
  const host = new URL(tab.url).hostname;
  const labelKey = text => String(text || '').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
  // -> the same list with this site's remembered menu wording applied.
  const useRemembered = list => {
    for (const answer of list) {
      const field = (debug.form || []).find(f => f.field === answer.field);
      const known = field && (me?.menuChoices || []).find(c => (host === c.host || host.endsWith(`.${c.host}`)) && labelKey(c.label) === labelKey(field.label) && labelKey(c.value) === labelKey(answer.value));
      if (known) Object.assign(answer, {value: known.choice, note: 'the choice this site\'s menu uses for it'});
    }
    return list;
  };
  return useRemembered;
}

// Records the form even when AI is off, before choosing remembered answers.
export async function recordFillForm({tab, debug, inPage}) {
  if (!debug.form) {  // filled from the kit: still record the form as read, for the run log
    const seen = await inPage(tab.id, () => window.__jobPilottoDescribeForm()).catch(() => []);
    debug.form = (seen || []).map(({field, label, type, required, filled, legal, options}) =>
      ({field, label, type, required, filled, legal, options: (options || []).slice(0, 30)}));
  }
}

// -> the first page summary, or a stop result before any menus or verification.
export async function fillKnownFields({tab, config, answers, ai, me, coverLetter, useRemembered, debug, inPage, withLetterFile}) {
  useRemembered(answers);
  debug.answers = answers.map(({field, question, value, source, confidence, note}) => ({field, question, value, source, confidence, note}));
  debug.details = {coverLetterState: me?.coverLetterStatus?.state || 'unknown', coverLetterSource: me?.coverLetterStatus?.source || '', coverLetterFile: !!me?.coverLetterFile, fields: Object.keys(me?.contact || {}), source: me?.contactSource || null, cv: me?.resume?.name || null, tailoredCv: !!me?.resume?.tailored};
  if (me?.contactError) debug.errors.push(`your details: ${me.contactError}`);
  const letter = coverLetter || ai?.cover_letter || me?.coverLetterText || '';
  const summary = await pageStarted(tab.id).then(() => inPage(tab.id, (list, profile, resume, letter, consents) => window.__jobPilottoExtensionFill(list, profile, resume, letter, consents),   // pageStarted: a start just now cleared the page's own Stop first (stop.js startTab)
    [answers, me?.contact || config.profile || {}, withLetterFile(me?.resume || config.resume || null, me?.coverLetterFile, me?.coverLetterStatus), letter, (me?.acceptConsents ?? config.acceptConsents) !== false]));
  // The page fill threw or returned nothing (a control it did not expect, or the page went away): said as it is, never read as a result (page/fill.js reports the error and where).
  if (!summary || summary.error) {
    const why = summary?.error || 'the fill failed on this page: the page returned nothing';
    if (!summary?.stopped && !isStopped()) decide('fill', 'the page fill failed', {error: String(why).slice(0, 200), at: String(summary?.pageError || '').slice(0, 300)}).catch(() => {});
    return {error: why, pageError: summary?.pageError || '', filled: 0, trace: [], todo: [], usd: 0};
  }
  if (summary?.held) return {held: true, layer: await layerOnTop(tab.id), note: HELD, usd: 0};   // a layer opened mid-fill and nothing closed it: nothing more is typed (page/guard-gate.js)
  return {summary};
}
