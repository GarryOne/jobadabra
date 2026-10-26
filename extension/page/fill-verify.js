// Rung 0 of the fill ladder, the page's side (spec docs/superpowers/specs/2026-10-12-fill-ladder.md): the text boxes the fill answered that did not take the answer
// (page/fill.js notes them: "answer given, but the field did not take it") are listed with their spot, so the worker types them again for real (extension/fill-verify.js),
// and each is read back after. Only plain text boxes: never a password, a read-only or disabled box, a menu's search box (combo-click.js owns those) or a select.
// Values stay in the page: the worker gets the text to type for the box it clicks, never a list of values to report. Guard: worker/test/fill-verify.test.js.
(() => {
  if (window.__jobPilottoFillVerifyLoaded) return;
  window.__jobPilottoFillVerifyLoaded = true;
  const notTaken = new Map();   // field (id or name) -> the answer the fill gave it
  const before = new Map();     // field -> its state before the real typing (the attempt log's key)
  const TEXT = 'input:not([type]), input[type=text], input[type=email], input[type=tel], input[type=url], input[type=number], input[type=search], textarea';
  const alnum = text => String(text ?? '').toLowerCase().replace(/[^\p{L}\p{N}]/gu, '');
  const holds = (el, value) => { const want = alnum(value), now = alnum(el?.value); return !!want && (now === want || now.includes(want)); };
  const byField = field => Array.from(document.querySelectorAll('input, textarea')).find(el => el.id === field || el.name === field);
  const typable = el => !!el && el.matches(TEXT) && !el.disabled && !el.readOnly && el.getAttribute('role') !== 'combobox'
    && !!el.getClientRects().length && getComputedStyle(el).visibility !== 'hidden';
  // The fill gave this box an answer and the page did not take it: a bare mark (no value) so the judges' sketch says match "no" (extension/account-fill.js matchOf), a box the fill's own
  // marks would otherwise call untouched. Any answered box, whatever its kind; only the plain text ones are typed again below.
  window.__jobPilottoNoteNotTaken = (field, value) => {
    const el = byField(String(field));
    if (el && !el.hasAttribute('data-jobpilotto-typed')) el.setAttribute('data-jobpilotto-nottaken', '');
    if (field && typeof value === 'string' && value.trim()) notTaken.set(String(field), value);
  };
  // A box a suggest-only widget was handled in (page/fill-menus.js suggestPick: a suggestion chosen, or the box left empty on purpose) is no longer one that "did not take its answer": typing the first text
  // over a chosen place, or into a box the page empties again, would undo or repeat what was just decided.
  window.__jobPilottoForgetNotTaken = field => {
    const el = byField(String(field));
    notTaken.delete(String(field));
    el?.removeAttribute('data-jobpilotto-nottaken');
  };
  // Every noted control with the fill's answer, whatever its kind: the presses for real read it (page/press-real.js). -> [[field, answer]]
  window.__jobPilottoNotTakenAll = () => [...notTaken];
  // -> [{field, x, y, text}] for each noted box that is typable and still does not hold its answer (at most 8), scrolled into view first.
  window.__jobPilottoNotTakenSpots = () => {
    const spots = [];
    for (const [field, text] of notTaken) {
      const el = byField(field);
      const log = window.__jobPilottoAttempts;
      if (!typable(el) || holds(el, text) || spots.length >= 8 || (log && !log.mayTry(el, 'type_real'))) continue;   // within the box's one attempt log (page/attempts.js)
      if (log) before.set(field, log.stateOf(el));
      el.scrollIntoView({block: 'center', inline: 'nearest'});
      const box = el.getBoundingClientRect();
      spots.push({field, x: Math.round(box.left + Math.min(box.width / 2, 40)), y: Math.round(box.top + box.height / 2), text: text.slice(0, 200)});
    }
    return spots;
  };
  // After the real typing: leave the box the way a person would (it loses focus), then say whether it holds the answer now; a box that does is marked as the fill's.
  window.__jobPilottoTakenNow = field => {
    const el = byField(field), text = notTaken.get(field);
    if (!el) return false;
    el.blur();
    const taken = holds(el, text);
    window.__jobPilottoAttempts?.note(el, 'type_real', before.get(field), taken);
    if (taken) { el.removeAttribute('data-jobpilotto-nottaken'); el.setAttribute('data-jobpilotto-filled', ''); el.setAttribute('data-jobpilotto-typed', alnum(text).slice(0, 160)); notTaken.delete(field); }
    return taken;
  };
})();
