// Completes one tab's fill passes, verifies the settled controls and records the original run report.
// Invariants: see extension/fill-flow.js.
import {apiFor, answersOrDropped, clickCombos, debuggerTurn} from './flow.js';
import {MENU_REASONS, OLD_MENU_REASON, applyCombos} from './menu-reason.js';
import {HELD, layerOnTop} from './dialog-after-fill.js';
import {decide} from './log.js';
import {plainWhy} from './ai-reply.js';
import {verdictFields} from './eligibility-verdict.js';
import {typeNotTakenOnTab} from './fill-verify.js';
import {climbFill} from './ladder/fill-climb.js';
import {readBackCounts, settleTrace} from './trace-settle.js';
import {controlDoor} from './ladder/control-door.js';
import {fillCard, markCardId} from './fill-card.js';
import {markCauses} from './ladder/control-marks.js';
import {addressNow, stillOnPage} from './one-fill.js';
import {armRecordUpdate, runUpdateBody} from './ladder/record-update.js';

// Why a field was left that is the extension's fault, not missing data (desktop/lib/reports.js reports these).
const WRITTEN = 'written';   // page/fill.js's reason for an open question the AI read as the person's own words (category written)
const KIND_REASON = /^(legal|demographic|the AI gave no answer)/;   // words-ok: our own trace reasons (page/fill.js): a kind the AI returned with no value, kept from the later pass like written
const PROPOSED = 'proposed for you to confirm';   // page/fill.js's reason for a question the AI proposed an answer for (worker/test/fill-trace-proposed.test.js keeps them equal)
const MECHANICAL = [...MENU_REASONS.map(item => item.text), OLD_MENU_REASON,
  'answer given, but the field did not take it', 'question text not found on the page',
  'question on the page not read'];

// Records the first pass and returns the reason updater used by both menu passes.
export function noteFirstFill({tab, summary, pendingAI, later, me, step}) {
  step('filled the page');
  if (pendingAI) decide('fill', 'first fields filled', {fields: summary?.filled || 0, waiting: later.length}).catch(() => {});   // before Claude's answers
  // Your details couldn't be read (Notion failed and there was no earlier copy): say so on the fields it left,
  // not "no answer", and in the panel, so Fill again is the obvious next step.
  if (me?.contactError && !Object.keys(me.contact || {}).length && summary) {
    const why = `your details couldn't be read (${me.contactError}): Fill again in a minute`;
    for (const row of summary.trace || []) if (row.reason === 'no answer in the kit, Profile or your details' && /name|e-?mail|phone|country|city|location/i.test(row.label)) row.reason = why;
    summary.todo = [`Your name and email weren't filled: ${why}`, ...(summary.todo || [])];
  }
  // An armed menu no trusted click reached keeps its page reason until here: say so, with why (menu-reason.js "dropdown not clicked").
  const notClicked = why => { for (const row of summary.trace || []) if (row.reason === OLD_MENU_REASON) row.reason = `dropdown not clicked: ${why}`; };
  return notClicked;
}

// Chooses the first pass's armed menus, preserving the page's reasons when no click reaches them.
export async function chooseFillMenus({tab, config, summary, debug, onStep, step, inPage, notClicked}) {
  const armedLeft = () => inPage(tab.id, () => window.__jobPilottoArmedCount?.() || 0);
  const clickDropdowns = config.clickDropdowns !== false;  // on unless turned off in Settings
  if (!clickDropdowns) notClicked('"Fill drop-down menus too" is off');
  if (!clickDropdowns && await armedLeft()) {
    // Say why they're left, and how to have them chosen automatically.
    summary.todo = [...(summary.todo || []), 'Tip: turn on "Fill drop-down menus too" in the extension Settings to have these chosen for you'];
  }
  if (clickDropdowns) {
    onStep('Choosing the drop-down answers…');
    try {
      const combos = await clickCombos(tab.id);
      debug.dropdowns = combos;
      step('clicked dropdowns');
      const picked = combos.filter(c => c.picked).length;
      applyCombos(summary.trace, combos);   // what the pick observed (menu-reason.js)
      notClicked('the pick never reached it');
      if (picked) {
        summary.filled = (summary.filled || 0) + picked;
        summary.todo = (summary.todo || []).filter(item => !/highlighted dropdown/.test(item));
        const left = await inPage(tab.id, () => window.__jobPilottoArmedCount());
        if (left) summary.todo.unshift(`Click the ${left} highlighted dropdown(s); each picks its answer when opened`);
      }
    } catch (error) {
      debug.errors.push(`dropdowns: ${error.message}`);
      notClicked('the click failed');
      summary.todo = [`Drop-downs not chosen automatically (${plainWhy(error)}): click each highlighted one`, ...(summary.todo || [])];
    }
  }
}

// Awaits the later answer and applies it; errors leave the first pass in place.
export async function fillLaterAnswers(run) {
  const {tab, config, later, useAI, withKit, pendingAI, force, summary, onStep, step, debug, askAnswers, cacheKey, useRemembered} = run;
  let {ai, aiError} = run;
  // With a kit: the questions it doesn't cover, answered by Claude now that the rest is already on the page.
  if (!(later.length && useAI)) return;
  onStep(withKit ? `AI is answering ${later.length} more question${later.length === 1 ? '' : 's'}…`
    : `AI is answering ${later.length} question${later.length === 1 ? '' : 's'} and checking you're eligible (usually 10–30 s)…`);
  try {
  ai = answersOrDropped(pendingAI ? await pendingAI : await askAnswers(tab, config, later));
  step('AI answered (after the fill)');
  if (!withKit) {
    await chrome.storage.session.set({[cacheKey(tab)]: {url: tab.url.split('#')[0], ai, test: !!config.testMode, asked: later.map(f => f.field)}});
    // Settings → "Check eligibility before filling" off (for testing): fill regardless. Not eligible: what is filled stays (owner, 11 Oct 2026), the rest waits;
    // the first pass's rows go with the stop, so its fields are logged as on every other end (the smoke counted them as none, 11 Oct 2026).
    if (!ai.eligible && !force && config.checkEligibility !== false) return {...summary, ineligible: true, partly: true, note: ai.eligibility_note || '', usd: ai.usd, ...verdictFields({ai})};
  }
  const extra = useRemembered(ai.answers.filter(a => later.some(f => f.field === a.field)).map(a => ({...a, question: a.question || later.find(f => f.field === a.field)?.label, source: 'Claude (on the page)'})));
  if (extra.length) return await fillExtraAnswers(run, ai, extra);
  } catch (error) {
    if (error.dropped) debug.errors.push(`Claude (after the fill): ${error.message}`);   // not an AI failure: nothing to tell the person
    else { aiError = plainWhy(error); debug.errors.push(`Claude (after the fill): ${error.message}`); }
  } finally { Object.assign(run, {ai, aiError}); }
}

// -> a held result, or updates the summary with only the later AI answers and menus.
async function fillExtraAnswers(run, ai, extra) {
  const {tab, config, withKit, coverLetter, me, inPage, debug, summary, notClicked, step} = run;
  // Only Claude's answers this time: no contact details or CV again (they're in already).
  const more = await inPage(tab.id, (list, letter, consents) => window.__jobPilottoExtensionFill(list, {}, null, letter, consents),
    [extra, withKit ? '' : coverLetter || ai?.cover_letter || '', (me?.acceptConsents ?? config.acceptConsents) !== false]);
  if (more?.held) return {held: true, layer: await layerOnTop(tab.id), note: HELD, usd: 0};   // the same, in the later pass
  const reach = more?.reach; if (reach) decide('fill', 'answers reached rows', reach).catch(() => {});   // counts only: asked, matched an id, matched by question, none (a page that re-created its controls)
  let clickError = '';
  const combos = config.clickDropdowns !== false ? await clickCombos(tab.id).catch(error => { clickError = plainWhy(error); return []; }) : [];
  debug.laterDropdowns = combos;
  summary.filled = (summary.filled || 0) + (more?.filled || 0) + combos.filter(c => c.picked).length;
  summary.unfilledRequired = more?.unfilledRequired ?? summary.unfilledRequired;
  // Claude's rows from this pass win: its answers, and the questions it proposed an answer for (no source: shown, never typed; Coop, 9 Oct 2026:
  // dropped here, the first pass's "no answer" stayed, and the site counted a proposal as declined).
  summary.trace = [...(summary.trace || []), ...(more?.trace || []).filter(row => row.source === 'Claude (on the page)' || row.reason === PROPOSED || String(row.reason || '').startsWith(WRITTEN) || KIND_REASON.test(String(row.reason || '')))];
  applyCombos(summary.trace, combos);   // the later pass's menus too: the observed reason, not the page's old label
  notClicked(config.clickDropdowns === false ? '"Fill drop-down menus too" is off' : clickError ? `the click failed (${clickError})` : 'the pick never reached it');
  step('filled the AI\'s answers');
}

// -> the scrubbed snapshots of controls left for a mechanical reason.
export async function snapshotFill({tab, config, summary, debug, me, inPage}) {
  // Fields left for a mechanical reason (a widget the extension couldn't operate): a scrubbed HTML snapshot of each,
  // for the fill-failure report's replay test (page/snapshot.js). Your details are passed only to hide them.
  return await inPage(tab.id, (targets, secrets) => window.__jobPilottoSnapshots?.(targets, secrets) || {},
    [(summary.trace || []).filter(row => MECHANICAL.some(reason => String(row.reason || '').startsWith(reason))).map(row =>
      ({label: row.label, field: (debug.form || []).find(f => f.label === row.label)?.field || ''})),
    Object.values(me?.contact || config.profile || {}).filter(value => typeof value === 'string')]).catch(() => ({}));
}

// Retypes boxes wiped by the page, then retries real typing through the shared debugger turn.
export async function retryFill({tab, step, inPage}) {
  // A page's own autofill after an upload can empty boxes we typed: they are typed again, once (now, and while the page is watched for 15 s) (page/browser-form-fastpath.js).
  const retyped = await inPage(tab.id, () => window.__jobPilottoRetypeWiped?.(15000) || 0).catch(() => 0);
  if (retyped) step(`typed ${retyped} box${retyped === 1 ? '' : 'es'} again that the page emptied`);
  // Rung 0 of the fill ladder: a text box that did not take its answer is typed again for real, one key at a time, and read back (extension/fill-verify.js); same debugger turn as the menus.
  const real = await debuggerTurn(() => typeNotTakenOnTab(tab.id)).catch(() => ({tried: 0, taken: 0}));
  if (real.tried) { step(`typed ${real.taken} of ${real.tried} box${real.tried === 1 ? '' : 'es'} again for real`); decide('fill', 'typed for real a box that did not take its answer', {tab: tab.id, tried: real.tried, taken: real.taken}).catch(() => {}); }
}

// Settles every trace row from the final form and read-back after the fill ladder.
export async function settleFill({tab, config, summary, me, inPage}) {
  // Every field's outcome as the page holds it once all passes are done (extension/trace-settle.js).
  const finalForm = await inPage(tab.id, () => window.__jobPilottoDescribeForm?.(true)).catch(() => null);   // settled: a real first choice is an answer
  const gaveUp = await inPage(tab.id, () => window.__jobPilottoRetypeGaveUp?.() || []).catch(() => []);
  // Rung 0 of the fill ladder: the one read of every control once the page settled (page/read-back.js), written on each control; the trace takes it, so it says what the panel says.
  const settleStart = Date.now(), readBack = (await inPage(tab.id, () => window.__jobPilottoReadBack?.pass() || []).catch(() => [])) || [];   // null: the page went away (a press during the fill)
  if (readBack.length) decide('fill', 'read back after the page settled', {...readBackCounts(readBack), ms: Date.now() - settleStart}).catch(() => {});   // ms: what the settle wait costs (spec budget: <= +1 s on a clean page)
  await logFillAttempts(tab, inPage);
  const lastRead = (await climbFill(tab, config, {turn: debuggerTurn}).catch(() => null))?.readBack || readBack;   // the fill ladder's repair (test switch only) and the read after a late retype (ladder/fill-climb.js)
  summary.trace = settleTrace(summary.trace || [], Array.isArray(finalForm) ? finalForm : [], gaveUp, Array.isArray(lastRead) ? lastRead : [], (me?.resume || config.resume)?.name || '');
  if (Array.isArray(finalForm)) summary.unfilledRequired = finalForm.filter(row => row.required && !row.filled && !(row.field === 'resume' && summary.resumeAttached)).length;   // after trusted picks: the same settled form as the trace
}

// Logs drained control attempts and their counts without applicant values.
async function logFillAttempts(tab, inPage) {
  for (const spent of await inPage(tab.id, () => window.__jobPilottoAttempts?.drain() || []).catch(() => []) || []) { decide('fill', 'a control used its tries: left for the person', {kind: spent.kind, tries: spent.tries}).catch(() => {}); controlDoor({rung: 0, signal: 'stalled', reason: 'tries', tried: spent.tries}, decide); }   // once per control (page/attempts.js)
  const tries = await inPage(tab.id, () => window.__jobPilottoAttempts?.summary() || null).catch(() => null);
  if (tries && Object.keys(tries.byTries).length) decide('fill', 'tries per control', tries).catch(() => {});   // measures the attempt log's cap (spec amendment 1): counts only
}

// Marks and records the settled fill, then arms the same late-retype record update.
export async function reportFill({tab, config, summary, debug, later, ai, aiError, useAI, withKit, startedAt, me, inPage, event, job, snapshots}) {
  // One anonymous record of this fill for the learning digest (fill-card.js: counts and fixed words), and its id on the page so
  // the panel can add, at Submit, what you answered yourself.
  summary.card = fillCard({id: crypto.randomUUID(), trace: summary.trace || [], form: debug.form || [],
    sent: [...(debug.sentToClaude || []), ...later.map(f => f.field)], ai, aiError, useAI, kit: withKit, version: debug.version, startedAt});
  await markCauses(inPage, tab.id, summary.card);   // each left control carries its cause for the panel (ladder/control-marks.js)
  // Only into the page this fill filled: a tab that moved on (the sign-up's form) shows another page, whose own fill writes its own mark (extension/one-fill.js).
  if (stillOnPage(tab.url, await addressNow(tab.id))) await inPage(tab.id, markCardId, [summary.card.id]).catch(() => {});
  event('fill-done', {filled: summary.filled || 0, left: (summary.todo || []).length});
  // One row in 🎏 Job Apply — Agent Runs (Agent = Extension), comparable with the agent runs there.
  const runBody = {url: job, pageUrl: tab.url, started: startedAt.toISOString(),
    ended: new Date().toISOString(), fields: summary.filled || 0, unfilled: summary.unfilledRequired || 0, usd: ai?.usd || 0, billed_to: ai?.billed_to || '',
    kit: withKit, todo: (summary.todo || []).slice(0, 8), trace: summary.trace || [], snapshots: snapshots || {}, debug: {...debug, aiUsd: ai?.usd || 0}};
  const logged = apiFor(tab.id, config, '/extension/run', {method: 'POST', body: JSON.stringify(runBody)})
    .then(done => { if (done?.url) chrome.storage.session.set({[`run:${tab.id}`]: done.url}); return done; }).catch(() => null);
  // The record was sent: a box the page empties after this and the retype types again updates it once (ladder/record-update.js): the log line, and that run's row when the store gave an id.
  let sentTrace = runBody.trace;
  armRecordUpdate(tab.id, {page: tab.url, trace: sentTrace, resumeName: (me?.resume || config.resume)?.name || '', inPage, decide, onUpdate: async next => {
    const id = (await logged)?.id, before = sentTrace; sentTrace = next;
    if (id) apiFor(tab.id, config, '/extension/run', {method: 'POST', body: JSON.stringify(runUpdateBody({...runBody, snapshots: {}}, before, next, String(id)))}).catch(() => {});
  }});
}
