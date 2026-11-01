// The fill ladder's one attempt log per control (spec docs/superpowers/specs/2026-10-12-fill-ladder.md, amendment 1; the owner's case, 12 Oct 2026: the 6th try in a row on one
// dropdown). Every try on a control asks here first and is written here after: an operator's own retry (the fastpath typing a wiped box again, a menu's click or typed search,
// real typing, a phone typed again in another writing) as much as a repair. A try is a verb (with a variant number, never a value) on the control's state (its one-reader state,
// how many options it lists, shown or not): one that failed on that state is never made again, and a control gets CAP tries in all. A control that used them and still does not
// hold its answer is given up: marked on itself (data-jobadabra-gaveup) and listed once for the worker's log, so the ladder climbs and the person is told once, never a loop.
// The log lives on the control (data-jobadabra-tried), so every script world and every pass of the fill reads the same one. Page world, loaded first (page-files.js PAGE_FILES,
// the apply run's init scripts). Guard: app-core/test/attempts.test.js, the widget zoo's menu-never-takes page.
(() => {
  if (window.__jobadabraAttempts) return;
  const CAP = 3;
  const own = el => !!el && typeof el.setAttribute === 'function';
  // The control's state, never its value: the one reader's state (page/read-back.js), how many options it lists, shown or not.
  const stateOf = el => [window.__jobadabraReadBack?.stateOf(el) || '', el.options?.length ?? '', el.getClientRects?.().length ? 1 : 0].join(':');
  const holds = el => !!window.__jobadabraReadBack?.holds(el);
  const readable = el => ['INPUT', 'SELECT', 'TEXTAREA'].includes(el.tagName);   // the one reader reads it (a toggle group it cannot)
  const read = el => { try { return JSON.parse(el.getAttribute('data-jobadabra-tried') || '[]'); } catch { return []; } };
  const kindOf = el => (el.type === 'file' ? 'file' : el.getAttribute?.('role') === 'combobox' ? 'combobox' : el.tagName === 'SELECT' ? 'select' : el.type || el.tagName?.toLowerCase() || '');
  const fresh = [];   // controls given up since the worker last asked: [{field, kind, tries}]
  const giveUp = (el, why) => {
    if (el.hasAttribute('data-jobadabra-gaveup') || (readable(el) && holds(el))) return;
    el.setAttribute('data-jobadabra-gaveup', why);
    fresh.push({field: el.id || el.name || '', kind: kindOf(el), tries: read(el).length});
  };
  // May this try be made? false when the control used its tries (then it is given up) or this very try already failed on this state. No control to log on: the caller's own limit.
  const mayTry = (el, verb) => {
    if (!own(el)) return true;
    const tried = read(el), key = `${verb}@${stateOf(el)}`;
    if (tried.length >= CAP) { if (!(readable(el) ? holds(el) : tried[tried.length - 1]?.ok)) giveUp(el, 'tries'); return false; }   // used its tries: given up unless it holds its answer now (a group the reader cannot read: unless its last try worked)
    return !tried.some(entry => entry.k === key && !entry.ok);
  };
  // After the try: written with whether it worked (the operator says so for a control the one reader cannot read, a toggle group; else: it holds its answer now); the last
  // allowed try that did not work gives the control up.
  const note = (el, verb, before, worked) => {
    if (!own(el)) return;
    const tried = read(el), ok = typeof worked === 'boolean' ? worked : holds(el);
    tried.push({k: `${verb}@${before ?? stateOf(el)}`, ok});
    if (ok && typeof CustomEvent === 'function' && typeof document.dispatchEvent === 'function') document.dispatchEvent(new CustomEvent('jobadabra:progress', {detail: 'value_stayed'}));   // the run's progress (hook.js relays it to ladder/progress.js): one event per try that worked
    el.setAttribute('data-jobadabra-tried', JSON.stringify(tried.slice(-8)));
    if (!ok && tried.length >= CAP) giveUp(el, 'tries');
  };
  // One call for an operator: ask, run the try, write it down. try() -> its own result (anything); -> the result, or false when the try was not allowed.
  // worked(result): whether the try worked, for a control the one reader cannot read (else the reader decides).
  const attempt = async (el, verb, run, worked) => {
    if (!mayTry(el, verb)) return false;
    const before = own(el) ? stateOf(el) : '';
    const result = await run();
    note(el, verb, before, worked ? !!worked(result) : undefined);
    return result;
  };
  // How many tries each control took on this page, and how many were given up: counts only, no label (the fill-end log line that measures the cap).
  const summary = () => {
    const byTries = {}, worked = {};
    let gaveUp = 0;
    for (const el of document.querySelectorAll('[data-jobadabra-tried]')) {
      const tried = read(el), n = tried.length;
      byTries[n] = (byTries[n] || 0) + 1;
      if (tried.some(entry => entry.ok)) worked[n] = (worked[n] || 0) + 1;
      if (el.hasAttribute('data-jobadabra-gaveup')) gaveUp += 1;
    }
    return {byTries, worked, gaveUp};
  };
  window.__jobadabraAttempts = {CAP, mayTry, note, attempt, stateOf, summary,
    count: el => (own(el) ? read(el).length : 0), gaveUp: el => (own(el) ? el.getAttribute('data-jobadabra-gaveup') || '' : ''), drain: () => fresh.splice(0)};
})();
