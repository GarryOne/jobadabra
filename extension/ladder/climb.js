// What the extension does with a rung's signal (spec: docs/superpowers/specs/2026-10-10-ai-ladder.md; the rule itself is extension/ladder/core.js). The app's page-kind answer says which rung
// answered and with what signal; an unsure page, or a page with nothing to press and no form, climbs to the numbered digest (rung 3: extension/ladder/rung3-candidates.js, desktop/lib/ladder/rung3-digest.js), once.
// The digest only INFORMS or names a button the page lists (the Apply floors still apply in the app); what the page says to do is reported to the app as the application's need (`told`).
// Invariants (flow core: read before editing; changing one is the owner's call, said in the commit; each names the test that guards it):
//  1. An unsure answer climbs to the digest; a confident one, or no signal, never asks again (app-core/test/ladder-climb.test.js).
//  2. A page without a form asks the digest at most once per tab and page, and never when the digest already answered (app-core/test/ladder-climb.test.js).
//  3. Only a tell_person answer is reported as told, with the page's own sentence; an email has its own report (app-core/test/ladder-climb.test.js).
//  4. The picture rung (4) is not offered to the router yet: it is wired for account pages only (lib/ladder/rung4-picture.js).
//  5. A frame that becomes a form-frame candidate after the judgment makes the page be judged again, once; a candidate the judgment already carried never does (app-core/test/ladder-climb.test.js).
import {nextRung} from './core.js';

const signals = new Map();   // tab id -> the last {rung, signal} the app answered with
const ended = new Set();     // tab ids whose digest answered nothing usable: the ladder ended at the person
const looked = new Set();    // `${tab id} ${page}`: pages whose stall already asked the digest
const OFF = [4];
const opened = new Set();    // `${tab id} ${page}`: pages whose form frame was already opened (once per tab and page)
const frames = new Map();    // tab id -> the page's form-frame candidates WITH their addresses (the addresses never leave the extension)
const pressedProofs = new Map();   // tab id -> the confirmation of an Apply press that moved the tab, for its next page (notePressed)

const sketched = new Map();  // tab id -> the controls the page-kind question carried (the page shape key needs them)
export const noteSignal = (tabId, answer, controls = []) => { sketched.set(tabId, controls); if (answer?.signal) signals.set(tabId, {rung: answer.rung, signal: answer.signal}); else signals.delete(tabId); };
export const controlsOf = tabId => sketched.get(tabId) || [];
export const blindOn = tabId => signals.get(tabId)?.signal === 'blind';   // the digest said the way on is not in its list (core.js 'blind')
export const blindOr = (tabId, signal) => (blindOn(tabId) ? 'blind' : signal);   // the stop's evidence signal: blind when the digest said so
export const forgetClimb = tabId => { for (const key of [...digested]) if (key.startsWith(`${tabId} `)) digested.delete(key); pressedProofs.delete(tabId); signals.delete(tabId); sketched.delete(tabId); ended.delete(tabId); frames.delete(tabId); for (const key of [...opened]) if (key.startsWith(`${tabId} `)) opened.delete(key); for (const key of [...looked]) if (key.startsWith(`${tabId} `)) looked.delete(key); };

// The numbered candidates of the page (extension/ladder/rung3-candidates.js). The page files live in the page's own (MAIN) world; the finder is injected when this page has not loaded it yet.
const look = tabId => chrome.scripting.executeScript({target: {tabId}, world: 'MAIN', func: () => window.__jobPilottoCandidates?.candidatesOf?.()}).then(rows => rows?.[0]?.result).catch(() => undefined);
export async function candidatesOf(tabId) {
  let found = await look(tabId);
  if (!found) { await chrome.scripting.executeScript({target: {tabId}, world: 'MAIN', files: ['ladder/rung3-candidates.js']}).catch(() => {}); found = await look(tabId); }
  return Array.isArray(found) ? found : [];
}

// The pages where a climb asked the digest (`${tab id} ${page}`): the dead-end question in shadow (ladder/fallback.js) never asks it again there.
const digested = new Set();
const digestKey = (tabId, url) => `${tabId} ${String(url || '').split('#')[0]}`;
export const digestAsked = (tabId, page) => digested.has(digestKey(tabId, page));
const askDigest = (tab, ask) => { digested.add(digestKey(tab.id, tab.url)); return ask(tab, {digest: true}); };

// `ask(tab, {digest: true})` is fill-flow's askKind. -> the digest's answer, shaped like a page kind, or null.
export async function climbOnUnsure(tab, ask) {
  const seen = signals.get(tab.id);
  if (!seen) return null;
  const up = nextRung({...seen, off: OFF});
  if (!(up.climbed && up.rung === 3)) return null;
  const answer = await askDigest(tab, ask);
  if (!answer) ended.add(tab.id);
  return answer;
}
export async function climbOnStall(tab, ask, key, kind) {
  if (kind?.by === 'digest' || looked.has(key)) return null;
  looked.add(key);
  const answer = await askDigest(tab, ask);
  if (!answer) ended.add(tab.id);
  return answer;
}

// -> {why: 'told', needs: <the page's own sentence>} when the digest said to tell the person what the page says (an email has its own report: non-form.js).
export function toldReport(kind) {
  const digest = kind?.digest;
  return digest?.verb === 'tell_person' && digest.outcome !== 'email' && digest.chosen?.[0]?.text ? {why: 'told', needs: digest.chosen[0].text} : null;
}

// What the app is told when a digest-named press led to a form (the one verified signal that can be seen: the page moved on as the digest said): fixed values and the page's address
// without its query, never a sentence or an address from the page (desktop/lib/ladder/learning.js keeps nothing else). null for anything but a digest press.
export function verifiedBody(kind, url, controls = []) {
  const digest = kind?.digest;
  if (kind?.by !== 'digest' || kind.rung !== 3 || digest?.verb !== 'press' || !digest.outcome) return null;
  return {verified: true, url: String(url || '').split('#')[0].split('?')[0], controls, rung: 3, outcome: digest.outcome, kind: 'posting', signal: 'confident'};
}

// What the app is told when the page confirmed a decision of the fast tier (spec docs/superpowers/specs/2026-10-12-one-next-move.md, phase 1): `pressed`, the Apply press led to a form on
// this page; `filled`, a page judged a form took values from the fill. The app only COUNTS it (desktop/lib/ladder/learning.js confirm): nothing it answers changes. A learned answer confirmed
// is a hit; the structure rule's decision is rung 0. Fixed values and the address without its query only. null for a digest answer (verifiedBody's) or a kind the step did not confirm.
// An Apply press that moved the tab to another page (the form opens on its own page: the common case) is confirmed by THAT page taking the fill: kept per tab until the tab's next page
// is judged, which takes it once (fill-flow.js consider). null clears it.
export const notePressed = (tabId, body) => (body ? pressedProofs.set(tabId, body) : pressedProofs.delete(tabId));
export const takePressed = tabId => { const body = pressedProofs.get(tabId) || null; pressedProofs.delete(tabId); return body; };
const CONFIRMS = {pressed: ['posting'], filled: ['form', 'account-form']}, RUNG_OF = {remembered: 1, ai: 2};   // an answer that came without its rung: the rung of who answered
export function confirmedBody(kind, url, controls = [], step = '') {
  const address = String(url || '').split('#')[0].split('?')[0], kinds = CONFIRMS[step];
  if (!kinds) return null;
  if (kind?.by === 'learned') return kinds.includes(kind.kind) ? {confirmed: true, url: address, controls} : null;
  const rung = kind ? (Number.isInteger(kind.rung) ? kind.rung : RUNG_OF[kind.by]) : 0, name = kind ? kind.kind : kinds[0];
  if (!Number.isInteger(rung) || rung < 0 || rung > 2 || kind?.by === 'digest' || !kinds.includes(name)) return null;
  return {verified: true, url: address, controls, rung, outcome: 'form', kind: name, signal: 'confident'};
}

// -> {why: 'other', needs: ''} when the ladder ended at the person with nothing to say: the digest was asked and gave no usable answer, or said `other` with no sentence and no button. The app shows
// a "needs your attention" card and counts the page shape (never text); null when the digest was never asked or gave an answer (a sentence to tell, a button to press).
export function otherReport(kind, tabId) {
  const digest = kind?.digest, usable = !!kind?.applyButton || !!digest?.chosen?.length;
  if (kind?.by === 'digest' && !usable) return {why: 'other', needs: ''};
  return ended.has(tabId) && !usable ? {why: 'other', needs: ''} : null;
}

// The frames that may hold the application form (extension/ladder/rung3-frames.js, in the page's world). The list with addresses stays here; the app is sent host, path and size only.
export const noteFrames = (tabId, list) => frames.set(tabId, Array.isArray(list) ? list : []);
export const frameSketch = list => (Array.isArray(list) ? list : []).map(({host, path, width, height}) => ({host, path, width, height}));
export const frameSrcOf = (tabId, index) => { const src = Number.isInteger(index) ? frames.get(tabId)?.[index]?.src : ''; return typeof src === 'string' && src.startsWith('https://') ? src : ''; };
export const claimFrame = key => (opened.has(key) ? false : (opened.add(key), true));
const lookFrames = tabId => chrome.scripting.executeScript({target: {tabId}, world: 'MAIN', func: () => window.__jobPilottoFrames?.frameCandidates?.()}).then(rows => rows?.[0]?.result).catch(() => undefined);
// A frame that is a candidate NOW but was not in the list the judgment carried (Datadog, 11 Oct 2026: the hosted board's iframe is born 150 px high, below the finder's
// size floor, and is 2432 px high 0.6 s later; its host was already counted, so the watch of a page judged without a form never looked again). By address, never by size.
export const frameGrew = (tabId, now) => { const had = new Set((frames.get(tabId) || []).map(item => item.src)); return (Array.isArray(now) ? now : []).some(item => !had.has(item.src)); };
export const frameBecameCandidate = async tabId => frameGrew(tabId, await framesOf(tabId));
export async function framesOf(tabId) {
  let found = await lookFrames(tabId);
  if (!found) { await chrome.scripting.executeScript({target: {tabId}, world: 'MAIN', files: ['ladder/rung3-frames.js']}).catch(() => {}); found = await lookFrames(tabId); }
  return Array.isArray(found) ? found : [];
}
