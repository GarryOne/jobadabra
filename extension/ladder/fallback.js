// The one question at each dead end, in SHADOW (spec docs/superpowers/specs/2026-10-12-one-next-move.md, phase 2 box 4; owner, 13 Oct 2026: its spend OK, about $0.01 per pool
// pass). The door (dead-end.js deadEnd) hands each stop here once, after today's report: the numbered digest (rung 3) is asked what the next move is, the move it names is run
// through the live press path's floors WITHOUT pressing (apply-press.js wouldPress), and both are logged beside the stop with the door's id, so agree / better / worse is
// computed from the row's real ending (cc, 13 Oct 2026). Nothing acts: no press, no kept answer, no climb signal (askKind's shadow option). Fixed values only, never page text.
// Not asked again where the stop came from the digest itself (its next rung, the picture, is off), nor when the tab left the stop's page. Whether the move WOULD act is the one rule of
// ladder/next-move.js (box 5): a sure press past the floors is asked a second time, and acts only when both name the same control. Guard: app-core/test/fallback.test.js.
import {effectOf, mayAct, needsSecondAsk} from './next-move.js';

let ask = async () => null, floor = async () => ({press: false, why: null}), log = () => {}, digestAsked = () => false, acts = async () => false, act = async () => null, look = async () => 'none';
// parts: {ask(tab, {digest, shadow}) (fill-flow.js askKind), floor(tabId, named) (apply-press.js wouldPress), asked(tabId, page) (climb.js digestAsked: a climb asked the digest
// on that page already), log (the decide log)}; tests also pass {tab(tabId)}.
let tabOf = tabId => globalThis.chrome?.tabs?.get(tabId).catch(() => null) ?? Promise.resolve(null);
export function useFallback(parts = {}) {
  if (parts.ask) ask = parts.ask;
  if (parts.floor) floor = parts.floor;
  if (parts.log) log = parts.log;
  if (parts.asked) digestAsked = parts.asked;
  if (parts.tab) tabOf = parts.tab;
  if (parts.acts) acts = parts.acts;   // acts(): the harness's test switch (the CI pool); act(tab, move): press the move through the live press path, -> what the page showed after (next-move.js effectOf's facts)
  if (parts.act) act = parts.act;
  if (parts.look) look = parts.look;   // look(tab, why): the closer look WITH the picture, told what was tried (fill-flow.js); only where the test switch is on
}

const WORD = /^[a-z_-]{1,24}$/;   // our own fixed words (a stop reason, an outcome, a verb): never page text
const word = value => (typeof value === 'string' && WORD.test(value) ? value : '');
const pageOf = url => String(url || '').split('#')[0];
// The live press path's refusal, as one fixed word (press-why.js flags): absent, behind a step (hidden), disabled, a Submit by another name, or another floor.
export const floorWord = why => (!why || !why.found ? 'absent' : !why.visible ? 'hidden' : !why.enabled ? 'disabled' : why.submits ? 'submits' : 'refused');

const asked = new Set();   // `${tabId} ${page}`: one question per page and tab
export const forgetFallback = tabId => { for (const key of [...asked]) if (key.startsWith(`${tabId} `)) asked.delete(key); };
globalThis.chrome?.tabs?.onRemoved?.addListener(forgetFallback);

// stop: {door (the door's id), tabId, page, why, rung (the rung that decided the stop, when known)}. -> the logged fields, or null when nothing was asked.
export async function askAtDeadEnd({door, tabId, page, why, rung} = {}) {
  const key = `${tabId} ${pageOf(page)}`;
  if (tabId == null || asked.has(key)) return null;
  asked.add(key);
  const base = {shadow: true, door, why: word(why)};
  if (rung === 3 || digestAsked(tabId, page)) {   // the digest answered on this page already: the next rung is the picture, on in the CI pool only (owner, 14 Oct 2026: the question was asked at 2 of 20 stops)
    const picture = await acts().catch(() => false);
    log('fill', 'dead end fallback (shadow): asked already', {...base, climb: picture ? 'picture' : 'picture_off'});
    if (picture) await lookWithPicture({door, tabId, page, why: base.why});
    return null;
  }
  const tab = await tabOf(tabId);
  if (!tab || pageOf(tab.url) !== pageOf(page)) { log('fill', 'dead end fallback (shadow): the page moved on', base); return null; }
  const first = await moveOf(tab), second = needsSecondAsk(first) ? await moveOf(tab) : null;
  const decided = mayAct(first, second);
  const {named, ...logged} = first;   // the control's own words stay out of the log: fixed values only
  const fields = {...base, ...logged, usd: first.usd + (second?.usd || 0), ...(second ? {agree: decided.why !== 'disagree'} : {}), wouldAct: decided.act, actWhy: decided.why};
  log('fill', 'dead end fallback (shadow)', fields);
  // Box 8: in the CI pool only (the harness's test switch), a move the one rule lets act is pressed through the live press path and its effect is checked right after; once per page, never repeated.
  if (decided.act && await acts().catch(() => false)) {
    const from = Date.now(), observed = await act(tab, {...first, named}).catch(() => null);
    const effect = effectOf(first, observed || {});
    log('fill', 'dead end fallback (acted)', {shadow: false, door, why: base.why, number: first.number, pressKind: first.pressKind, effect, ms: Date.now() - from});
    return {...fields, acted: effect};
  }
  return fields;
}

// One ask of the digest, its move and the floors the live path would apply: only a control the digest judged an Apply (applyButton, set by the app with press_kind), then the
// named-button finder's own floors. -> fixed values only.
async function moveOf(tab) {
  const answer = await ask(tab, {digest: true, shadow: true}).catch(() => null);
  const said = answer?.digestSaid || {};
  const press = ['press', 'open'].includes(said.verb);
  const check = !press ? {floor: 'none'} : !answer?.applyButton ? {floor: 'refused', floorWhy: 'not_apply'}
    : await floor(tab.id, answer.applyButton).then(found => (found?.press ? {floor: 'ok'} : {floor: 'refused', floorWhy: floorWord(found?.why)})).catch(() => ({floor: 'refused', floorWhy: 'unreadable'}));
  return {named: answer?.applyButton || '', signal: word(answer?.signal) || 'none', outcome: word(said.outcome), verb: word(said.verb), number: Number.isInteger(said.numbers?.[0]) ? said.numbers[0] : -1,
    pressKind: word(said.pressKind), confidence: Number.isFinite(answer?.confidence) ? answer.confidence : -1, usd: Number.isFinite(answer?.usd) ? answer.usd : 0, ...check};
}

// The look with the picture, once per page (the `asked` set above): told in fixed words that the digest was asked and found no way on. Its own line (closer look) carries the cost; this one the door and
// what the look said. Never when the tab left the stop's page.
async function lookWithPicture({door, tabId, page, why}) {
  const tab = await tabOf(tabId);
  if (!tab || pageOf(tab.url) !== pageOf(page)) return;
  const from = Date.now(), said = await look(tab, why).catch(() => 'none');
  log('fill', 'dead end fallback (picture)', {shadow: false, door, why, look: word(said) || 'none', ms: Date.now() - from});
}
