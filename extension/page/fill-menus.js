// The form filler's dropdowns (split from page/fill.js, 9 Oct 2026): a menu is armed with its answer and picked when your (or the extension's
// trusted) click opens it (page/menu-pick.js checks the pick took); where the next armed menu and the phone box are, for flow.js clickCombos;
// the phone's country from its prefix. Needs page/fill-labels.js first. Guarded by desktop/e2e/test/menu-pick.test.mjs, fill-categories.test.js.
(() => {
  if (window.__jobPilottoFillMenusLoaded) return;
  window.__jobPilottoFillMenusLoaded = true;
  const {clean, norm, sleep, labelOf, comboControl, comboValue} = window.__jobPilottoFillKit;

  // Phone widgets with a separate country menu: the country comes from the number's prefix (every code: page/dial-codes.js).
  const DIAL = {...(window.__jobPilottoDial || {}), '+1': 'United States', '+30': 'Greece', '+31': 'Netherlands', '+32': 'Belgium', '+33': 'France', '+34': 'Spain',
    '+36': 'Hungary', '+39': 'Italy', '+40': 'Romania', '+41': 'Switzerland', '+43': 'Austria', '+44': 'United Kingdom',
    '+45': 'Denmark', '+46': 'Sweden', '+47': 'Norway', '+48': 'Poland', '+49': 'Germany', '+351': 'Portugal', '+353': 'Ireland',
    '+358': 'Finland', '+373': 'Moldova', '+380': 'Ukraine', '+420': 'Czech Republic', '+421': 'Slovakia', '+972': 'Israel',
    '+971': 'United Arab Emirates', '+91': 'India', '+86': 'China', '+81': 'Japan', '+61': 'Australia', '+55': 'Brazil'};
  const dialOf = phone => Object.keys(DIAL).sort((a, b) => b.length - a.length).find(code => String(phone || '').replace(/\s/g, '').startsWith(code));

  // Searchable dropdowns (react-select on Greenhouse) only open for real user input: scripted clicks and keys are ignored (checked on a live form, 27 Sep 2026). So the extension never opens them; it marks each one, and when you click it, picks the answer in the menu your click opened.
  const OPTION = '[class*="option"], [role="option"], [role="listbox"] > *, [class*="dropdown-item"]';   // the choices of a list that names no option (a listbox's own children)
  // The innermost option elements of an open menu (not the phone field's hidden country list).
  // A suggest-only box (suggestPick below) has no markup of its own to find its options by: what appeared beside it once it was typed in is its list (page/suggest-box.js).
  let suggestCtx = null;
  const optionNodes = () => (suggestCtx ? window.__jobPilottoSuggest.appeared(suggestCtx.el, suggestCtx.before) : Array.from(document.querySelectorAll(OPTION))
    .filter(o => o.offsetParent !== null && !o.querySelector(OPTION) && !/iti__/.test(o.className)));
  // A menu that draws its choices page by page (SuccessFactors: 100 of 200 countries) loads the next page when its list is scrolled: scroll the open list's own scroller to its end.
  const loadMoreOptions = () => {
    const last = optionNodes().pop();
    for (let node = last?.parentElement; node && node !== document.body; node = node.parentElement) {
      if (node.scrollHeight > node.clientHeight + 4 && /auto|scroll/.test(getComputedStyle(node).overflowY)) { node.scrollTop = node.scrollHeight; return; }
    }
  };
  const matchOption = answer => {
    if (String(answer).includes(' || ')) {
      for (const alternative of String(answer).split(' || ')) { const hit = matchOption(alternative); if (hit) return hit; }
      return null;
    }
    const want = norm(answer);
    const options = optionNodes();
    // "Geneva, Switzerland": an option naming every part (Geneva … Switzerland), when only one does.
    const parts = want.split(/\s*,\s*/).filter(Boolean);
    if (parts.length > 1) {
      const all = options.filter(o => parts.every(part => norm(o.textContent).includes(part)));
      if (all.length >= 1) return all[0];
    }
    const exact = options.filter(o => norm(o.textContent) === want);
    if (exact.length === 1) return exact[0];
    const starts = options.filter(o => norm(o.textContent).startsWith(want));
    if (starts.length === 1) return starts[0];
    const contains = options.filter(o => norm(o.textContent).includes(want));
    return contains.length === 1 ? contains[0] : null;
  };

  // The page asks the extension for what only it can do (real typing, the AI's pick): combo-click.js answers through __jobPilottoNeedDone.
  const need = async request => {
    window.__jobPilottoNeedDone = undefined; window.__jobPilottoNeed = request;
    for (let waited = 0; waited < 12000 && window.__jobPilottoNeedDone === undefined; waited += 100) await sleep(100);
    window.__jobPilottoNeed = null;
    return window.__jobPilottoNeedDone ?? null;
  };
  // A box that searches as you type: the answer typed for real (its first part, then all of it, then a short start when those find nothing), the options awaited,
  // the one that means the answer chosen: the same text, else the AI's pick from the options' own list (a fixed answer: one of them or none).
  const typeToSearch = async (el, answer) => {
    const full = String(answer).split(' || ')[0].trim(), first = full.split(',')[0].trim();
    const tries = [...new Set([first, full, first.length > 4 ? first.slice(0, 3) : ''].filter(Boolean))];
    let shown = [];
    for (const text of tries) {
      if (suggestCtx) { try { el.focus({preventScroll: true}); } catch { /* a box that cannot take focus is typed at where it is */ } }   // a blur (another tab, the app window) took the focus: the keys go to the focused box
      if (!(await need({kind: 'type', text, keys: !!suggestCtx}))) return {option: null, shown};
      for (let waited = 0; waited < 3000; waited += 250) {
        await sleep(250); loadMoreOptions();
        if (matchOption(answer)) return {option: matchOption(answer), shown};
        if (waited >= 1500 && optionNodes().length) break;
      }
      shown = optionNodes().map(o => clean(o.textContent)).filter(Boolean).slice(0, 60);
      if (!shown.length) continue;
      const choice = await need({kind: 'choose', label: labelOf(el) || '', asked: full, choices: shown});
      const hit = choice && optionNodes().find(o => clean(o.textContent) === choice);
      if (hit) return {option: hit, shown};
    }
    return {option: null, shown};
  };

  // A search box whose menu showed choices, none of them the answer (a long list's first page: Greenhouse's School opens on its first 100 schools; owner, 27 Oct 2026: "search,
  // then Other"): each search the AI named is typed for real, in order (the answer's own name, then the list's catch-all), a search that found nothing is passed over, and the
  // AI picks by meaning among what one found, told what was already typed. -> {option, shown}
  const realOptions = () => optionNodes().filter(o => !o.matches('[class*="notice"], [class*="Notice"]'));   // a menu's "No options" / "Loading..." line is no choice
  const searchFor = async (el, answer, searches) => {
    const asked = String(answer).split(' || ')[0], tried = [];
    for (const text of searches.slice(0, 3)) {
      if (!(await need({kind: 'type', text}))) break;
      tried.push(text);
      let found = [];
      for (let waited = 0; waited < 3000; waited += 250) {
        await sleep(250);
        if (matchOption(answer)) return {option: matchOption(answer), shown: found};
        found = realOptions().map(o => clean(o.textContent)).filter(Boolean).slice(0, 60);
        if (waited >= 1000 && found.length) break;
      }
      if (!found.length) continue;
      const reply = await need({kind: 'choose', label: labelOf(el) || '', asked, choices: found, searchable: true, tried});
      const choice = typeof reply === 'string' ? reply : reply?.choice || '';
      const hit = choice && realOptions().find(o => clean(o.textContent) === choice);
      if (hit) return {option: hit, shown: found};
    }
    return {option: null, shown: []};
  };

  // A box that only takes a suggestion the page offers (page/suggest-box.js: it emptied itself when focus left): the answer typed for real, the options that appeared beside it awaited, the one that
  // means the applicant's own place chosen (the AI's pick: one of them or none; a place the page offers first, nearby or not, is never taken for the applicant's), then checked once focus has left again:
  // a box the page empties reads as empty, never as filled. Nothing chosen: the box is left empty for the person (page/propose.js menuMissed). -> {selectedAfter, trusted}
  const suggestPick = async (el, answer, control, badge, done) => {
    const suggest = window.__jobPilottoSuggest, asked = String(answer).split(' || ')[0];
    suggestCtx = {el, before: suggest.snapshot()};
    let found = {option: null, shown: []}, took = {selectedAfter: false, trusted: false}, text = '';
    try {
      found = await typeToSearch(el, answer);
      if (found.option) {
        text = clean(found.option.textContent);
        took = await window.__jobPilottoMenuPick({el, option: found.option, control, readValue: box => suggest.holds(box, found.option)});
        if (took.selectedAfter) {
          window.__jobPilottoNoteTyped?.(el, text);   // the box holds the chosen place now: the typed-check must not call that a box that did not take its answer and type the first text over it
          try { el.focus({preventScroll: true}); el.blur(); } catch { /* a box that cannot take focus keeps what it has */ }
          await sleep(250);
          if (norm(el.value) !== norm(text)) took = {...took, selectedAfter: false};
        }
      }
    } finally { suggestCtx = null; }
    // Nothing was suggested at all: not a suggest-only box (a plain box that keeps its own state and empties when left, text-state-from-keys-2). Disarmed and left exactly as it is: the retype step
    // (page/fill-verify.js, typed for real) still owns it, and the box is not emptied.
    if (!found.option && !found.shown.length) { window.__jobPilottoLastPick = {asked, got: '', opened: false, found: false, refused: true, choices: [], peek: `nothing appeared beside the box: ${String(el.value || '').length} typed, focused ${document.activeElement === el}, ${suggest.snapshot().size} visible text nodes`}; done(); return took; }
    window.__jobPilottoLeaveAlone?.(el);   // decided: the retype watch must not type plain text into it (page/browser-form-fastpath.js)
    window.__jobPilottoForgetNotTaken?.(el.id || el.name);   // decided: never typed over again as a box that did not take its answer (page/fill-verify.js)
    window.__jobPilottoLastPick = {asked, got: text, same: found.option ? !!window.__jobPilottoValueClass?.fits?.(asked, text) : null, opened: found.shown.length > 0 || !!found.option, found: !!found.option, choices: found.option ? [] : found.shown.slice(0, 8).map(item => clean(item).slice(0, 40)), peek: '', ...took};
    if (took.selectedAfter) { el.setAttribute('data-jobpilotto-picked', text.toLowerCase().replace(/[^\p{L}\p{N}]/gu, '').slice(0, 160)); done(); return took; }
    badge.textContent = `✈️ Suggested: ${asked} (pick it yourself)`; window.__jobPilottoMenuMissed?.(el, found.shown);
    return took;
  };

  // Mark a dropdown with its answer; your click opens the menu, and the answer is picked in it.
  // The rest of a multiple-choice menu's answer: queued when a pick took, armed again by the next __jobPilottoNextCombo, so flow.js sees the first pick as done (the armed count fell)
  // before the same menu is clicked for the next choice.
  const moreChoices = [];
  let armedSeq = 0;
  const armCombo =(field, fullAnswer, opts = {}) => {
    // A menu that takes several choices gets them joined by " && " (the AI's answer for a `multiple` field): the first is picked now, the rest arm the same menu again after it.
    const [answer, ...rest] = String(fullAnswer).split(' && ').map(part => part.trim()).filter(Boolean);
    const el = document.getElementById(field) || document.querySelector(`[name="${CSS.escape(field)}"]`);
    if (!el || answer === undefined) return false;
    const control = comboControl(el); control.__jobPilottoDisarm?.();   // armed again (Use in the app, a re-arm): the earlier answer's click handler goes
    control.style.outline = '3px solid #b87400';
    control.style.outlineOffset = '2px';
    const badge = document.createElement('div');
    badge.className = 'job-pilotto-badge';
    badge.textContent = `✈️ Click to choose: ${String(answer).split(' || ')[0]}`;
    badge.style.cssText = 'margin-top:4px;font:600 12px system-ui,sans-serif;color:#8a5700';
    control.parentElement.insertBefore(badge, control.nextSibling);
    control.dataset.jobpilottoArmed = labelOf(el) || field;
    control.dataset.jobpilottoArmedId = String(++armedSeq);   // which menu flow.js has passed over, whatever menus are disarmed meanwhile (__jobPilottoNextCombo)
    const done = () => { control.style.outline = ''; badge.remove(); delete control.dataset.jobpilottoArmed; delete control.dataset.jobpilottoArmedId; control.removeEventListener('mousedown', onOpen, true); };
    const onOpen = event => {
      if (!event.isTrusted) return;
      // Each opening is a try in the menu's one attempt log (page/attempts.js): one that failed on this state is not made again, and a menu gets a few in all, then it is
      // given up and left to the person once (12 Oct 2026: the 6th try in a row on one dropdown). Not allowed: disarmed, the suggestion stays for the person.
      const attemptLog = window.__jobPilottoAttempts;
      if (attemptLog && !attemptLog.mayTry(el, 'pick')) { window.__jobPilottoLastPick = {asked: String(answer).split(' || ')[0], got: '', opened: false, found: false, refused: true, choices: []}; done(); return; }   // refused: never read as a pick (combo-click.js)
      const before = attemptLog ? attemptLog.stateOf(el) : '';
      setTimeout(async () => { window.__jobPilottoPicking = true; let took = null; try {   // flow.js/combo-click.js waits for it: no second click while the page is still deciding
        if (opts.suggest) { took = await suggestPick(el, answer, control, badge, done); return; }   // a box that only takes a suggestion the page offers (page/suggest-box.js)
        let option = matchOption(answer);
        if (!option) {
          // The menu as it opened (before typing filters it): for the fill-failure report's snapshot (snapshot.js).
          try { (window.__jobPilottoMenuSnapshots ||= {})[control.dataset.jobpilottoArmed] = window.__jobPilottoSnapshot?.({field: el.id || el.name}); } catch {} var shown = []; for (let w = 0; w < 1500 && !shown.length; w += 150) { await sleep(150); shown = optionNodes().map(o => clean(o.textContent)).filter(Boolean).slice(0, 60); } option = matchOption(answer); var menuAsOpened = shown.slice();   // the menu's own choices once drawn (a slow menu: Coop, 8 Oct 2026)
          // Long menus (countries, cities) show only their first entries: type the answer to filter, which the menu accepts once your click has opened it; search-as-you-type fields (Location) load suggestions from the server: type the first part, wait for them.
          if (!option) Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(el, String(answer).split(' || ')[0].split(',')[0].trim());
          if (!option) el.dispatchEvent(new Event('input', {bubbles: true}));
          for (let waited = 0; waited < 4000 && !option; waited += 250) { loadMoreOptions(); await sleep(250); option = matchOption(answer); }
          // Nothing matched the answer's text, scrolled to ("Yes" asked, "I have the right to work here" offered): the AI picks the choice that means the same from the menu as it opened; the filter text goes first so they are all shown again.
          if (!option && menuAsOpened.length) {
            const searchable = el.tagName === 'INPUT';   // a box the menu searches as you type: what it showed may be only the start of its list (searchFor)
            const reply = await need({kind: 'choose', label: labelOf(el) || '', asked: String(answer).split(' || ')[0], choices: menuAsOpened, ...(searchable ? {searchable, tried: []} : {})});
            const choice = typeof reply === 'string' ? reply : reply?.choice || '';
            if (!choice && reply?.searches?.length) { const found = await searchFor(el, answer, reply.searches); option = found.option; if (found.shown.length) shown = found.shown; }
            if (choice) { Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(el, ''); el.dispatchEvent(new Event('input', {bubbles: true})); for (let waited = 0; waited < 2000 && !option; waited += 250) { await sleep(250); option = optionNodes().find(o => clean(o.textContent) === choice) || null; } }
          }
          // A type-to-search box ignores that scripted typing (its options come from a server after real keystrokes, so it showed none when it opened): the extension types for real. A menu that did show its choices is asked about by meaning above, not typed at again and again.
          if (!option && !menuAsOpened.length && el.tagName === 'INPUT') { const found = await typeToSearch(el, answer); option = found.option; if (found.shown.length) shown = found.shown; }
        }
        // Picked only when the page shows it (page/menu-pick.js); what was seen goes to flow.js clickCombos and the fill card's reason (observed, not assumed: 9 Oct 2026).
        const opened = el.getAttribute('aria-expanded') === 'true' || optionNodes().length > 0;   // before the pick closes it
        took = option ? await (window.__jobPilottoMenuPick?.({el, option, control, readValue: comboValue, multiple: !!el.closest('[class*="is-multi"], [aria-multiselectable="true"]')}) ?? ((globalThis.__jobPilottoPress?.(option) || option.click()), {selectedAfter: true, trusted: false})) : {selectedAfter: false, trusted: false};
        window.__jobPilottoLastPick = {asked: String(answer).split(' || ')[0], got: option ? clean(option.textContent) : '', same: option ? !!window.__jobPilottoValueClass?.fits?.(String(answer).split(' || ')[0], clean(option.textContent)) : null, opened, found: !!option, choices: option ? [] : (shown || []).slice(0, 8).map(text => text.slice(0, 60)),
          peek: option ? '' : Array.from(document.querySelectorAll('[class*="menu-notice"], [class*="menu-list"], [role="listbox"]')).filter(n => !/iti__|country/.test(String(n.className))).map(n => clean(n.textContent).slice(0, 30)).slice(0, 3).join(' | '), ...took};   // choices, peek: the form's own wording of a menu nothing matched (its choices, or its "No options" notice), for the log; never the answer
        if (took.selectedAfter) { el.setAttribute('data-jobpilotto-picked', clean(option.textContent).toLowerCase().replace(/[^\p{L}\p{N}]/gu, '').slice(0, 160)); done(); if (rest.length) moreChoices.push([field, rest.join(' && ')]); return; }   // the fill's own pick, for the one reader's mismatch (page/read-back.js)
        badge.textContent = `✈️ Suggested: ${answer} (pick it yourself)`; if (!option) window.__jobPilottoMenuMissed?.(el, shown);   // page/propose.js: no text left in the box; its choices go to the app
      } finally { window.__jobPilottoPicking = false; attemptLog?.note(el, 'pick', before, !!took?.selectedAfter); } }, 120);
    };
    control.addEventListener('mousedown', onOpen, true); control.__jobPilottoDisarm = done;
    return true;
  };

  // For "Fill drop-down menus too": the next armed dropdown, scrolled into view, as viewport coordinates
  // for a real click (sent by the extension through Chrome's debugger), or null when none is left.
  // skip: the ids of the menus already passed over (flow.js), or how many to pass. By id: a failed menu disarmed by the sweep below shifted every later one, so a count
  // passed over the next menu unclicked (27 Oct 2026, fair round form 102: School missed, then Degree was never clicked). The spot carries the menu's id.
  window.__jobPilottoNextCombo = async (skip = 0) => {
    while (moreChoices.length) { const [field, answer] = moreChoices.shift(); armCombo(field, answer); }
    // A menu whose attempt log refuses another opening (page/attempts.js) is disarmed here, before it is counted and clicked: its suggestion stays for the person.
    for (const armed of document.querySelectorAll('[data-jobpilotto-armed]')) {
      const box = armed.matches('input, select') ? armed : armed.querySelector('input[role=combobox], input, select');
      if (box && window.__jobPilottoAttempts && !window.__jobPilottoAttempts.mayTry(box, 'pick')) armed.__jobPilottoDisarm?.();
    }
    const armed = Array.from(document.querySelectorAll('[data-jobpilotto-armed]'));
    const control = Array.isArray(skip) ? armed.find(one => !skip.includes(one.dataset.jobpilottoArmedId)) : armed[skip];
    if (!control) return null;
    // Instant, not smooth: sites with smooth scrolling (Greenhouse) moved the menu after it was measured.
    control.scrollIntoView({block: 'center', behavior: 'instant'});
    await sleep(120);
    const rect = control.getBoundingClientRect();
    return {x: Math.round(rect.left + Math.min(40, rect.width / 2)), y: Math.round(rect.top + rect.height / 2),
      label: control.dataset.jobpilottoArmed, id: control.dataset.jobpilottoArmedId || ''};
  };
  // After the country menu is picked: where to type the national number (the widget adds the prefix).
  window.__jobPilottoPhoneSpot = async () => {
    const phone = window.__jobPilottoPhone;
    const el = phone && (document.getElementById(phone.field) || document.querySelector(`[name="${CSS.escape(phone.field)}"]`));
    if (!el) return null;
    el.scrollIntoView({block: 'center', behavior: 'instant'});
    await sleep(120);
    const rect = el.getBoundingClientRect();
    return {x: Math.round(rect.left + 30), y: Math.round(rect.top + rect.height / 2), text: phone.national};
  };
  window.__jobPilottoArmedCount = () => document.querySelectorAll('[data-jobpilotto-armed]').length;
  Object.assign(window.__jobPilottoFillKit, {DIAL, dialOf, armCombo});
})();
