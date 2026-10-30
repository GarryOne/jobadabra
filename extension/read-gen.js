// Which read of a tab an async answer belongs to (one per consider() of fill-flow.js): "is this result still about the tab's current read?" asked in ONE place. A read begins when a page of the
// tab is considered; a newer read of the same tab makes every answer still on its way to the older one late (pool run 38325158956, HelloFresh: the digest asked for the first, empty read landed
// after the second read had judged the form, and a "no form" dead end was reported mid-fill). The fill's own end-state write keeps its token in the page (fill-flow.js writeState: it guards what
// the PAGE shows, this guards what the FLOW decides). Guard: worker/test/read-generation.test.js.
import {isStopped} from './stop-state.js';
const gens = new Map();   // tabId -> the latest read's number

export const beginRead = tabId => { const gen = (gens.get(tabId) || 0) + 1; gens.set(tabId, gen); return gen; };
export const isCurrent = (tabId, gen) => !isStopped() && gens.get(tabId) === gen;   // Stop makes every read late: no answer on its way is applied (stop.js)
// The two decisions of a read that can strand a page (17 Oct 2026, SuccessFactors journey: 260 s of nothing after a sign-in), pure so a test can script the sequence (worker/test/read-generation.test.js).
// openRead: a read that finds the tab already moved on (`moved`) gives its page key back and begins nothing, so the live read of the page the tab is on stays current -> the generation, or 0.
// dropIfLate: a read whose answer is late gives its page key back, so when the tab returns to that page it is read again -> true when dropped.
export function openRead(tabId, key, started, moved) {
  if (moved) { started.delete(key); return 0; }
  return beginRead(tabId);
}
export function dropIfLate(tabId, gen, key, started) {
  if (isCurrent(tabId, gen)) return false;
  started.delete(key);
  return true;
}
export const forgetReads = tabId => { gens.delete(tabId); };
globalThis.chrome?.tabs?.onRemoved?.addListener(forgetReads);

// The one guard for every async AI answer applied to a page (owner, 13 Oct 2026, the Richemont stop: a digest asked for an unsure first read landed 1 s after a confident read of the same page and
// replaced it; the generation above does not see it, both belong to one read). An answer is applied only if no newer judgment of the same page landed after its ask started: a page-kind answer is
// then replaced by that judgment, any other answer is dropped (the caller treats it as no answer, as when the app is closed). A page the tab left since the ask is dropped too. Every ask with a tab
// goes through api() in flow.js, which calls guarded() for the routes named here; a route used with a tab but named in neither list fails worker/test/ask-guard.test.js.
const FAMILIES = {'/extension/page-kind': 'page', '/extension/escalate': 'page', '/extension/account-judge': 'account', '/extension/answer': 'answer'};
export const GUARDED_ROUTES = Object.keys(FAMILIES);
// Routes asked with a tab that are NOT an AI answer applied to a page (a record, a secret, a ticket, a popup choice, a count): nothing to go stale.
export const EXEMPT_ROUTES = ['/extension/event', '/extension/site-password', '/extension/account-code', '/extension/dismiss-popup', '/extension/pick-choice', '/extension/aliases', '/extension/recipes', '/extension/pick-upload', '/extension/run', '/extension/kit', '/extension/me',
  '/extension/confirmation'];   // confirmation: the verdict on a submit the person made, about that event and not the page's state now (a redirect after it must not drop it)
const CONFIDENT = 0.8;
const judged = new Map();   // `${tab} ${family}${phase}` -> {key, at, by, answer}: the latest judgment landed
let asks = 0;
const keyOf = url => String(url || '').split('#')[0];
const bodyOf = init => { try { return JSON.parse(init?.body || '{}'); } catch { return {}; } };
const judgment = (route, answer) => !!answer && !answer.error && (route === '/extension/page-kind' ? !!answer.kind && Number(answer.confidence) >= CONFIDENT : route === '/extension/account-judge');

// -> the ask's record, or null when this route is not guarded, no tab, or the page's address is not known.
export function startAsk(tabId, path, init, url, now = Date.now()) {
  const family = FAMILIES[path];
  const body = bodyOf(init), key = keyOf(body.url || url);
  if (!family || tabId == null || !key) return null;
  return {tabId, route: path, key, slot: `${tabId} ${family}${family === 'account' ? body.phase || '' : ''}`, at: now, id: ++asks};
}
// -> {answer, dropped: '' | 'newer' | 'moved'}: what the caller applies. now: the landing time; url: the tab's address now.
export function landAsk(ask, answer, url, now = Date.now()) {
  if (!ask) return {answer, dropped: ''};
  if (keyOf(url) && keyOf(url) !== ask.key) return {answer: null, dropped: 'moved'};
  const newer = judged.get(ask.slot);
  if (newer && newer.key === ask.key && newer.at > ask.at && newer.by !== ask.id) return {answer: ask.route === '/extension/page-kind' ? newer.answer : null, dropped: 'newer'};
  if (judgment(ask.route, answer)) judged.set(ask.slot, {key: ask.key, at: now, by: ask.id, answer});
  return {answer, dropped: ''};
}
export const forgetJudgments = tabId => { for (const slot of [...judged.keys()]) if (slot.startsWith(`${tabId} `)) judged.delete(slot); };
globalThis.chrome?.tabs?.onRemoved?.addListener(forgetJudgments);
const tabUrl = async tabId => (await globalThis.chrome?.tabs?.get(tabId).catch(() => null))?.url || '';

/** Guard the answer on its original page; an optional trace brackets the browser reads without awaiting its logging. */
export async function guarded(tabId, path, init, call, log = () => {}, trace = (_name, run) => run()) {
  const ask = startAsk(tabId, path, init, FAMILIES[path] ? await trace('tabs.get before', () => tabUrl(tabId)) : '');
  const answer = await call();
  if (!ask) return answer;
  const landed = landAsk(ask, answer, await trace('tabs.get after', () => tabUrl(tabId)));
  if (landed.dropped) log(`late answer dropped: ${landed.dropped === 'newer' ? 'a newer judgment of this page landed' : 'the tab left this page'}`, {route: path});
  return landed.answer;
}
