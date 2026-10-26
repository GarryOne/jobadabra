// Free AI's lines for this install (owner, 26 Oct 2026: "show this popup whenever, on every action that requires AI and their cap is reached ... before they reached
// 60 days or 20 applications"): the last answer of GET /api/ai/caps (lib/plan.js caps), asked before each AI start (at most once a minute), after every run, and when
// our AI refused a call (lib/ai/refusals.js). A cap in force refuses new AI starts (lib/app-allowance.js) and, found in the background, opens the top-up dialog
// (renderer/pages/topup-dialog.js). Only while Free AI is the engine: an own key or a CLI has no cap here. Guard: test/ai-caps.test.js.
import * as aiFree from './ai-free.js';

export const FRESH_MS = 60_000, REFUSED_MS = 15_000;

export function createAiCaps({getStorage, getPlan, now = () => Date.now(), onCapped = () => {}, log = () => {}}) {
  let last = null;      // the site's last answer {at, capped, message, resetsAt}
  let asking = null;    // one question at a time
  const on = () => aiFree.isOn(getStorage().settings());
  // The cap in force now -> {capped, message, resetsAt} or null. A line with a reset time holds until then; the others until a fresh answer.
  function known() {
    if (!last?.capped || !on()) return null;
    if (last.resetsAt && Date.parse(last.resetsAt) <= now()) return null;
    return {capped: last.capped, message: last.message, resetsAt: last.resetsAt};
  }
  // Ask the site (at most once a minute unless forced). quiet: a press asks, and its refusal opens the dialog itself; otherwise a newly reached cap is told (onCapped).
  // Offline or slow: the last answer stands. -> known()
  async function check({force = false, quiet = false} = {}) {
    if (!on()) return null;
    if (!force && last && now() - last.at < FRESH_MS) return known();
    asking ||= Promise.resolve(getPlan().caps()).catch(() => null).finally(() => { asking = null; });
    const answer = await asking;
    if (answer) {
      const was = known()?.capped;
      last = {at: now(), capped: answer.capped || null, message: answer.message || '', resetsAt: answer.resetsAt || null};
      const cap = known();
      if (cap?.capped !== was) log(cap ? `Free AI line reached: ${cap.capped}` : 'Free AI open again');
      if (cap && cap.capped !== was && !quiet) onCapped(cap);
    }
    return known();
  }
  // Our AI refused a call (429/503): ask now, at most every 15 s (a minute's rate limit refuses many calls at once).
  let heardAt = 0;
  function heard() {
    if (!on() || now() - heardAt < REFUSED_MS) return;
    heardAt = now();
    check({force: true}).catch(() => {});
  }
  // A promo code or a key changed things: the next check asks the site again.
  const forget = () => { last = null; };
  return {known, check, heard, forget};
}
