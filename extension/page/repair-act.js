// The fill ladder's repair, the page's side (spec docs/superpowers/specs/2026-10-12-fill-ladder.md, PR C2): the verbs of the repair question (desktop/lib/ladder/fill-repair.js) that run in
// the page, on the control the judges' sketch numbered (extension/account-fill.js writes data-jobadabra-n). A repair changes HOW the fill's own answer goes in, never WHAT: choose_option
// picks the one option that shows the answer in another writing, checked here against the answer (page/value-class.js optionFor; none or two fit: nothing), retype puts the fill's own
// answer back, commit leaves the control as a person does. Floors (AND, never moved): never a legal or knockout question, a password, a button, a native radio or checkbox (a click there can only flip the answer, 15 Oct 2026) or a control the fill gave no answer; every repair is
// a try in the control's one attempt log (page/attempts.js, verb "repair:<verb>"). spot() gives a trusted click's place (the worker clicks: extension/ladder/fill-repair.js).
// Values never leave the page: each verb returns {ok, why} only. Guard: app-core/test/repair-act.test.js.
(() => {
  if (window.__jobadabraRepairAct) return;
  const holds = el => !!window.__jobadabraReadBack?.holds(el);
  const target = n => document.querySelector(`[data-jobadabra-n="${Number(n)}"]`);
  const labelOf = el => (window.__jobadabraFillKit?.labelOf ? window.__jobadabraFillKit.labelOf(el) : '') || el.labels?.[0]?.textContent || el.getAttribute('aria-label') || '';
  // The floors: why a control is never repaired, or '' when it may be.
  const refused = el => !el ? 'no such control'
    : el.type === 'password' ? 'a password'
    : el.matches('button, [type=submit], [type=button], [type=image], [type=reset]') ? 'a button'
    : el.dataset.jobadabraCategory === 'legal' || window.__jobadabraFillKit?.LEGAL?.test(labelOf(el)) ? 'a legal question'
    : el.dataset.jobadabraCategory === 'knockout' ? 'a knockout question'
    : el.matches('input[type=radio], input[type=checkbox]') ? 'a native choice: the fill\'s own click decides it, a repair could only flip the answer'
    : '';
  const fire = (el, ...types) => types.forEach(type => el.dispatchEvent(new Event(type, {bubbles: true})));
  const setValue = (el, value) => {
    const proto = el.tagName === 'SELECT' ? HTMLSelectElement.prototype : el.tagName === 'TEXTAREA' ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
    Object.getOwnPropertyDescriptor(proto, 'value').set.call(el, value);
  };
  // One verb on control n, as a try in its attempt log. -> {ok, why}
  const tried = async (n, verb, act) => {
    const el = target(n), floor = refused(el);
    if (floor) return {ok: false, why: floor};
    const log = window.__jobadabraAttempts;
    if (log && !log.mayTry(el, `repair:${verb}`)) return {ok: false, why: 'its tries are used'};
    const before = log ? log.stateOf(el) : '';
    const why = await act(el);
    const ok = !why && holds(el);
    log?.note(el, `repair:${verb}`, before, ok);
    return {ok, why: why || (ok ? '' : 'the page did not keep it')};
  };
  const VERBS = {
    // The one option of a native menu that shows the fill's answer in another writing (number: the option the model named, checked; 0: found here).
    choose_option: (n, number) => tried(n, `choose_option:${Number(number) || 0}`, el => {   // the option number is the try's variant (amendment 1: a verb with a variant, never a value)
      const option = window.__jobadabraValueClass?.optionFor(el, Number(number) || 0);
      if (!option) return el.tagName === 'SELECT' ? 'no option shows the answer' : 'not a native menu';
      setValue(el, option.value); option.selected = true; fire(el, 'input', 'change');
      el.setAttribute('data-jobadabra-picked', option.text.toLowerCase().replace(/[^\p{L}\p{N}]/gu, '').slice(0, 160));   // the fill's own pick (page/read-back.js mismatch)
      return '';
    }),
    // The fill's own answer put back into a box that lost it.
    retype: n => tried(n, 'retype', el => {
      const answer = window.__jobadabraValueClass?.answer(el);
      if (!answer || el.tagName === 'SELECT' || el.getAttribute('role') === 'combobox') return 'no answer of the fill to type here';
      el.focus(); setValue(el, answer); fire(el, 'input', 'change'); el.blur();
      return '';
    }),
    // Leave the control the way a person does, so the page keeps what is in it.
    commit: n => tried(n, 'commit', el => { el.focus(); fire(el, 'change'); el.blur(); fire(el, 'focusout'); return ''; }),
  };
  // Where to click control n for real (a toggle, a widget that ignores scripted clicks), scrolled into view; null when the floors refuse it.
  const spot = n => {
    const el = target(n);
    if (refused(el)) return null;
    el.scrollIntoView({block: 'center', inline: 'nearest'});
    const box = (el.getClientRects().length ? el : el.closest('label, [role], div') || el).getBoundingClientRect();
    return box.width && box.height ? {x: Math.round(box.left + box.width / 2), y: Math.round(box.top + box.height / 2)} : null;
  };
  // After a trusted click: written in the log, and whether it holds now.
  const clicked = (n, verb, before) => {
    const el = target(n);
    if (!el) return false;
    const ok = holds(el);
    window.__jobadabraAttempts?.note(el, `repair:${verb}`, before, ok);
    return ok;
  };
  const mayClick = (n, verb) => { const el = target(n); return !refused(el) && (window.__jobadabraAttempts ? window.__jobadabraAttempts.mayTry(el, `repair:${verb}`) : true) ? (window.__jobadabraAttempts?.stateOf(el) ?? '') : null; };
  window.__jobadabraRepairAct = {...VERBS, spot, mayClick, clicked, refused: n => refused(target(n))};
})();
