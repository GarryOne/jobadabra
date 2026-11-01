// Does a click submit the form? One rule for the panel's "submit pressed" (review.js): a control that says so itself (type=submit or image, written on it),
// or one the Submit floor's words name. A <button> with no type attribute reports .type === "submit" in every browser, so the property says nothing: an answer
// button (a Yes/No choice, "Next") has it. A typeless button that really submits fires the form's own submit event, which review.js hears separately.
// A press the extension makes itself (a popup closer, a route press, a menu open) is marked by `press(el)` and is never the person's submit: `person(event)` says so for a click,
// and for the form's submit event the button that caused it (event.submitter) was one of those own presses, still in the same task. Structure and one floor of words, no site. Injected before review.js (background.js). Guarded by app-core/test/submit-press.test.js.
(() => {
  if (window.__jobPilottoSubmitPress) return;
  const SUBMIT_WORDS = /\b(submit|send application)\b/i;
  const written = el => String(el.getAttribute?.('type') || '').trim().toLowerCase();
  const says = el => (el.tagName === 'BUTTON' && written(el) === 'submit') || (el.tagName === 'INPUT' && ['submit', 'image'].includes(written(el)));
  const own = new Set();   // the controls the EXTENSION clicked in this task (press, below): the submit event their default action fires comes right after, before the timeout
  const controlOf = target => target?.closest?.('button, input, a, [role=button]') || target;
  const release = (...els) => setTimeout(() => els.forEach(el => own.delete(el)), 0);
  // hold: how long the mark waits for the click to arrive (a debugger click crosses processes; a script's click is synchronous). A click that arrives consumes it, a tick later (the submit comes after the click).
  const mark = (el, hold = 0) => { if (!el) return; const control = controlOf(el); own.add(el); own.add(control); setTimeout(() => { own.delete(el); own.delete(control); }, hold); };
  // A trusted (debugger) click at a point: the element drawn there is checked by the same floor, and never a control that submits. false = do NOT click (the three callers: flow.js, fill-verify.js, ladder/fill-climb.js).
  const pressable = el => /^(button|a)$/i.test(el.tagName) || el.getAttribute?.('role') === 'button' || (el.tagName === 'INPUT' && ['button', 'submit', 'image', 'reset'].includes(written(el)));
  const markAt = (x, y) => {
    const el = document.elementFromPoint(x, y); if (!el) return false;
    const control = controlOf(el);
    if (refused(control) || (pressable(control) && (says(control) || SUBMIT_WORDS.test(textOf(control))))) { window.__jobPilottoRefused = textOf(control).slice(0, 60) || 'x'; return false; }
    mark(el, 1500); return true;
  };
  // The extension's own presses all go through here (a popup closer, a route press, a menu open: `globalThis.__jobPilottoPress?.(el) || el.click()` at every site, guarded by app-core/test/submit-press.test.js).
  // The site's scripts click too (a styled "Send" that clicks a hidden submit button): their click stays the person's.
  // The press floor (safety, 15 Oct 2026: a "Decline" of a Data Privacy Consent Statement opened "Delete All Data"): whatever named the control, the extension never presses one that deletes or removes an
  // account or data, withdraws an application or signs out, nor one that DECLINES inside a dialog that is no cookie or tracking notice. A refused press answers true (the callers' `|| el.click()` stays unused)
  // and is left in window.__jobPilottoRefused. Words are an extra floor ANDed with the AI's answer (desktop/lib/popup-pick.js `effect`), never the judge. Guard: app-core/test/press-floor.test.js.
  const NEVER = /\b(delete|remove|erase|deactivate|withdraw|cancel|close)\b.{0,24}\b(account|data|profile|application)\b|\b(sign|log) ?out\b|\bdelete all\b|löschen|konto entfernen|supprimer|se déconnecter|eliminar cuenta|elimina (account|dati)|abmelden/i;   // words-ok: a safety floor ANDed with the AI answer, never the judge
  const DECLINE = /^\W*(decline|reject|refuse|deny|disagree|i (do not|don't) (agree|accept|consent)|ablehnen|nicht zustimmen|refuser|rifiuta|rechazar)\b/i;   // words-ok: a safety floor ANDed with the AI answer, never the judge
  const ABOUT_COOKIES = /cookie|tracking|traceurs/i;   // words-ok: a safety floor ANDed with the AI answer, never the judge
  const STATEMENT = /(privacy|consent|data protection) statement|datenschutzerkl|déclaration de confidentialité/i;   // words-ok: a safety floor; the dialog's own title: a statement of the form, no cookie notice
  const textOf = el => String(el.innerText || el.textContent || el.value || el.getAttribute?.('aria-label') || el.getAttribute?.('title') || '').replace(/\s+/g, ' ').trim();
  const layerOf = el => { for (let node = el; node && node !== document.body && node !== document.documentElement; node = node.parentElement) { if (node.matches?.('[role=dialog], [role=alertdialog], [aria-modal=true], dialog')) return node; if (getComputedStyle(node).position === 'fixed') return node; } return null; };
  const refused = el => { const words = textOf(el); if (NEVER.test(words)) return true; if (!DECLINE.test(words)) return false; const layer = layerOf(el); const about = layer && textOf(layer); return !!layer && (!ABOUT_COOKIES.test(about) || STATEMENT.test(about.slice(0, 200))); };
  const press = el => { window.__jobPilottoRefused = ''; if (refused(el)) { window.__jobPilottoRefused = textOf(el).slice(0, 60) || 'x'; return true; } mark(el); el.click(); return true; };
  const person = event => event.type === 'submit' ? !(event.submitter ? own.has(event.submitter) : [...own].some(control => control.form && control.form === event.target)) : (own.has(controlOf(event.target)) ? (release(event.target, controlOf(event.target)), false) : true);
  window.__jobPilottoSubmitPress = {refused, says, person, mark, markAt, press, counts: (el, words) => says(el) || SUBMIT_WORDS.test(words)};
  window.__jobPilottoPress = press;
})();
