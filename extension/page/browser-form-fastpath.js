// Deterministic helpers injected into application pages. No network calls, submit actions,
// checkbox clicks, or legal attestations. Return labels/status only, never applicant values.
(() => {
  const forbidden = /submit|apply now|send application|privacy|terms|consent|acknowledg|i agree|i accept/i;
  const label = element => {
    const texts = [element.getAttribute('aria-label'), element.name, element.id,
      ...Array.from(element.labels || [], item => item.textContent)];
    return texts.filter(Boolean).join(' ').trim();
  };
  const visible = element => !!(element.getClientRects().length &&
    getComputedStyle(element).visibility !== 'hidden');
  // A box a date picker keeps read-only (the page opens a calendar on it) takes a date written whole while it is still empty: the value is all the form
  // sends; any other answer, and any read-only box that already holds something, stays untouched.
  const dateInReadOnly = (element, value) => element.readOnly && !element.value && window.__jobPilottoValueClass?.of(value) === 'date';
  const writable = (element, value) => {
    if (!element || !visible(element) || element.disabled || (element.readOnly && !dateInReadOnly(element, value))) return false;
    if (forbidden.test(label(element))) return false;
    if (element.matches('textarea, select')) return true;
    return element.matches('input:not([type]), input[type="text"], input[type="email"], input[type="tel"], input[type="url"], input[type="number"]');
  };
  const byField = field => {
    const elements = Array.from(document.querySelectorAll('input, textarea, select'));
    return elements.find(el => el.id === field || el.name === field);
  };
  // react-select (every Greenhouse dropdown) renders a text input that is only its search box:
  // setting its value selects nothing, and the chosen option lives in the container instead.
  const isCombo = element => element.getAttribute('role') === 'combobox';
  // Step timer for the Agent Runs record: helpers stamp themselves; agents add named steps
  // ("dropdowns", "resume") inside a JS call they already make. Times only, never values.
  window.__jobPilottoSteps = window.__jobPilottoSteps || [];
  window.__jobPilottoStep = name => {
    window.__jobPilottoSteps.push({name: String(name).slice(0, 40), at: new Date().toISOString()});
    return window.__jobPilottoSteps.length;
  };
  // What the fill typed, per box: the value, whether the person has touched the box since, how many times it was typed again. A page can clear a box
  // after the fill, more than once (an upload's own autofill reads the file seconds later and rewrites the boxes; a re-render empties it again):
  // retypeWiped puts back what WE typed, as long as the box's one attempt log allows (page/attempts.js: every retry of every operator counts there, a few in all), so a
  // page that keeps clearing it is not typed into forever.
  const attempts = () => window.__jobPilottoAttempts;
  const WATCH_CAP_MS = 60000;
  const typedHere = new Map();
  // Does the box still hold what we typed? Only letters and digits count, so a mask or a reformat (spaces, dashes, a date's separators, a national form of a
  // phone number) is the same value; a box the page reset to something else ("+972" for "+41 79 555 01 23") is not. One rule with the panel (extension/review.js,
  // its own copy; desktop/test/typed-match.test.js keeps them equal).
  const alnum = text => String(text ?? '').toLowerCase().replace(/[^\p{L}\p{N}]/gu, '');
  const typedSame = (typed, now) => {
    const a = alnum(typed), b = alnum(now);
    if (!a || a === b || b.includes(a) || (b.length >= 6 && a.includes(b))) return true;
    if (a.length >= 8 && b.length >= 8 && /^\d+$/.test(a) && /^\d+$/.test(b) && a.slice(-8) === b.slice(-8)) return true;   // the same number with or without its country code or trunk 0
    return [...a].sort().join('') === [...b].sort().join('');
  };
  window.__jobPilottoTypedSame = typedSame;   // for desktop/test/typed-match.test.js
  window.__jobPilottoLeaveAlone = element => { const record = typedHere.get(element); if (record) record.edited = true; };   // a box the fill decided on (a suggestion chosen, or left empty on purpose) is never typed again as plain text by the retype watch (page/fill-menus.js suggestPick)
  window.__jobPilottoTypedHere = element => typedHere.has(element);   // the fill typed this box on this page before (the person's later edits included): its text is not the page's own guess (page/fill-read.js pageGuess)
  window.__jobPilottoNoteTyped = (element, value) => noteTyped(element, value);   // a box the fill picked a suggestion in now holds that choice, not the text first typed: retired as what we typed (page/fill-menus.js suggestPick)
  const follow = (element, record) => { typedHere.set(element, record); element.addEventListener('input', event => { if (event.isTrusted) { record.edited = true; element.removeAttribute?.('data-jobpilotto-typed'); } }, true); };
  const noteTyped = (element, value) => {
    element.setAttribute?.('data-jobpilotto-typed', alnum(value).slice(0, 160));   // what the panel checks at the end (review.js): the letters and digits we typed
    const known = typedHere.get(element);
    if (known) { Object.assign(known, {value, retypes: 0}); return; }
    follow(element, {value, edited: false, retypes: 0, field: element.id || element.name || '', label: labelNow(element)});
  };
  // What the fill picked in a menu, per menu: the option's letters and digits on the menu (data-jobpilotto-picked, read by page/read-back.js: another option shown = mismatch)
  // and its value, so a menu the page set back is picked again within its attempt log (retypeNow); a person's own change stops that.
  const pickedHere = new Map();
  const notePicked = (element, option) => {
    element.setAttribute?.('data-jobpilotto-picked', alnum(option.text).slice(0, 160));
    if (!pickedHere.has(element)) element.addEventListener?.('change', event => { if (event.isTrusted) { pickedHere.get(element).edited = true; element.removeAttribute?.('data-jobpilotto-picked'); } }, true);
    pickedHere.set(element, {value: option.value, text: option.text, edited: false});
  };
  // A page that draws its form again after an upload (a re-render) replaces the box with a new element of the same id or name: the record moves to it,
  // so what we typed is put back there; the person's edits to the old element still count (the record says so).
  // A toolkit that creates its controls again (SAP UI5 gives each new control a new generated id and no name) leaves no id or name to find the box by: it is found by its question,
  // the one box of the page with that label that holds no record of ours yet (never two: then it is not told apart).
  const labelNow = element => { try { return String(window.__jobPilottoFillKit?.labelOf?.(element) || '').trim(); } catch { return ''; } };
  const byLabel = (record, was) => {
    if (!record.label) return null;
    const found = [...document.querySelectorAll('input:not([type=hidden]), textarea')].filter(box => box.isConnected && box.tagName === was.tagName && box.type === was.type && !typedHere.has(box) && labelNow(box) === record.label);
    return found.length === 1 ? found[0] : null;
  };
  const stillThere = (element, record) => {
    if (element.isConnected) return element;
    const same = (record.field && byField(record.field)) || byLabel(record, element);
    if (!same || !same.isConnected || typedHere.has(same)) return null;
    typedHere.delete(element);
    follow(same, record);
    return same;
  };
  window.__jobPilottoFillKnownFields = entries => {
    // The Chrome extension turns the guard off on purpose (it never clicks Submit itself).
    if (!window.__jobPilottoGuardActive && !window.__jobPilottoNoGuard) return {error: 'submit guard is inactive'};
    window.__jobPilottoStep('fill known fields');
    const filled = [], skipped = [];
    for (const item of entries) {
      const key = String(item.field || '');
      const element = byField(key);
      if (!element || !writable(element, item.value) || typeof item.value !== 'string') {
        skipped.push(key);
        continue;
      }
      if (isCombo(element)) {
        skipped.push(`${key} (combobox: pick its option instead)`);
        continue;
      }
      if (element.tagName === 'SELECT') {
        const option = Array.from(element.options).find(o => o.value === item.value || o.text.trim() === item.value);
        if (!option) { skipped.push(key); continue; }
        element.value = option.value;
        notePicked(element, option);
      } else {
        const prototype = element.tagName === 'TEXTAREA' ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
        Object.getOwnPropertyDescriptor(prototype, 'value').set.call(element, item.value);
      }
      element.dispatchEvent(new Event('input', {bubbles: true}));
      element.dispatchEvent(new Event('change', {bubbles: true}));
      if (element.tagName !== 'SELECT') noteTyped(element, item.value);
      filled.push(key);
    }
    // Then leave each one the way a person does (focus, then blur). Sites hang their look on those events: a floating label that moves up
    // once the field has been left with a value sat on top of the filled text (3 Oct 2026, consultandpepper.com).
    for (const key of filled) {
      const element = byField(String(key));
      if (!element || element.tagName === 'SELECT') continue;
      try { element.focus({preventScroll: true}); element.blur(); } catch { /* not focusable */ }
    }
    return {filled, skipped};
  };
  // After the fill: a box we typed that is empty now, that the person never touched and the page did not fill itself, is typed again (within its attempt log
  // times). A page's autofill can land seconds after the upload, so the check runs now and then every 700 ms for watchMs; each box typed again extends
  // the watch by watchMs (a page that empties again is still watched), never past WATCH_CAP_MS in all.
  // -> how many boxes were typed again by this call (a count only, never a value).
  let watching = 0, watchUntil = 0, watchEnd = 0;
  const retypeNow = () => {
    const back = [];
    let repicked = 0;
    for (const [was, record] of [...typedHere]) {
      const element = record.edited ? was : stillThere(was, record);
      if (!element || record.edited || !/^(\+\d{1,4})?$/.test(String(element.value || '').trim()) || !writable(element) || !attempts().mayTry(element, 'retype')) continue;   // emptied, or back on a bare country code (a phone widget's own "+972"); a value the page wrote itself is never typed over (the panel still reports it: review.js)
      record.retypes++;
      const before = attempts().stateOf(element);
      const prototype = element.tagName === 'TEXTAREA' ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
      Object.getOwnPropertyDescriptor(prototype, 'value').set.call(element, record.value);
      element.dispatchEvent(new Event('input', {bubbles: true}));
      element.dispatchEvent(new Event('change', {bubbles: true}));
      back.push([element, before, record]);
    }
    // A menu the page set back to another option (or its placeholder) after the fill picked: picked again, within its attempt log.
    for (const [element, record] of pickedHere) {
      const shown = element.options?.[element.selectedIndex];
      if (record.edited || !element.isConnected || (shown && alnum(shown.text) === alnum(record.text)) || !attempts().mayTry(element, 'repick')) continue;
      const before = attempts().stateOf(element);
      element.value = record.value;
      element.dispatchEvent(new Event('input', {bubbles: true}));
      element.dispatchEvent(new Event('change', {bubbles: true}));
      attempts().note(element, 'repick', before, alnum(element.options?.[element.selectedIndex]?.text) === alnum(record.text));
      repicked += 1;
    }
    for (const [element] of back) try { element.focus({preventScroll: true}); element.blur(); } catch { /* not focusable */ }
    for (const [element, before, record] of back) attempts().note(element, 'retype', before, typedSame(record.value, element.value));   // written once the page had its say on blur: it holds what we typed, or not
    return back.length + repicked;
  };
  window.__jobPilottoRetypeWiped = (watchMs = 0) => {
    const now = retypeNow();
    if (watchMs > 0) {
      const start = Date.now();
      if (!watching) { watchEnd = start + WATCH_CAP_MS; watchUntil = start + watchMs; }
      if (now) watchUntil = Math.min(watchEnd, Math.max(watchUntil, start + watchMs));
      if (!watching) watching = setInterval(() => {
        if (retypeNow()) watchUntil = Math.min(watchEnd, Math.max(watchUntil, Date.now() + watchMs));
        if (Date.now() > watchUntil) { clearInterval(watching); watching = 0; }
      }, 700);
    }
    return now;
  };
  // The panel (extension/review.js, another script world) asks for a look when a box no longer holds what we typed: typed again now, within the same limit per box.
  document.addEventListener?.('jobpilotto-retype', () => { retypeNow(); });
  // A phone number the site refused: the boxes we typed that look like a phone number and show an error message of the site's own beside them, found by structure
  // (aria-errormessage / aria-describedby, a role=alert/status or aria-live element in the field's own area, or red text there; no words). -> [{field, label, message}], never a value.
  const looksPhone = value => /^\+?[\d\s().-]+$/.test(String(value).trim()) && String(value).replace(/\D/g, '').length >= 7;
  const redText = el => { const m = /rgba?\((\d+),\s*(\d+),\s*(\d+)/.exec(getComputedStyle?.(el).color); return !!m && +m[1] >= 150 && +m[2] <= 100 && +m[3] <= 100; };
  const errorText = element => {
    const ids = `${element.getAttribute('aria-errormessage') || ''} ${element.getAttribute('aria-describedby') || ''}`.split(/\s+/).filter(Boolean);
    for (const id of ids) { const text = (document.getElementById(id)?.textContent || '').trim(); if (text && text.length <= 200) return text; }
    for (let box = element.parentElement, i = 0; box && i < 3 && box.querySelectorAll('input:not([type=hidden]), select, textarea').length <= 1; box = box.parentElement, i++) {
      for (const el of box.querySelectorAll('*')) {
        if (el.children.length || el.closest('label, legend, button, input, select, textarea, [id^=jobpilotto]') || !visible(el)) continue;
        const text = (el.textContent || '').trim();
        if (text && text.length <= 200 && (['alert', 'status'].includes(el.getAttribute('role')) || el.getAttribute('aria-live') === 'assertive' || redText(el))) return text;
      }
    }
    return '';
  };
  window.__jobPilottoRefusedPhones = () => [...typedHere].filter(([element, record]) => !record.edited && element.isConnected && looksPhone(record.value))
    .map(([element, record]) => ({field: record.field, label: label(element).slice(0, 80), message: errorText(element).slice(0, 200), tried: record.writings || []})).filter(item => item.message);
  // The writings of one phone number the extension builds itself (the AI only names one: lib/format-judge.js FORMATS). The country code is read from the number's own
  // prefix (page/dial-codes.js, via the fill kit's DIAL), never guessed. -> the text, or '' when the number has no known code.
  const writeAs = (value, format) => {
    const digits = String(value).replace(/\D/g, '').replace(/^00/, ''), codes = Object.keys(window.__jobPilottoFillKit?.DIAL || {}).map(code => code.slice(1)).sort((a, b) => b.length - a.length);
    const code = codes.find(known => digits.startsWith(known));
    if (!code) return '';
    const national = digits.slice(code.length), groups = String(value).replace(/^\s*\+?\s*/, '').split(/[^\d]+/).filter(Boolean);
    const spaced = groups[0] === code ? groups.slice(1).join(' ') : national;
    return {e164: `+${code}${national}`, e164_digits: `${code}${national}`, international_00: `00${code}${national}`, national: `0${spaced}`, national_plain: `0${national}`}[format] || '';
  };
  window.__jobPilottoWriteAs = writeAs;   // for desktop/test/typed-match.test.js
  window.__jobPilottoRetypeAs = (field, format) => {
    const entry = [...typedHere].find(([element, record]) => !record.edited && element.isConnected && record.field === field);
    if (!entry) return false;
    const [element, record] = entry, text = writeAs(record.original || record.value, format);
    if (!text || !writable(element) || !attempts().mayTry(element, `writing:${format}`)) return false;   // a writing counts in the box's one attempt log (page/attempts.js)
    const before = attempts().stateOf(element);
    const prototype = element.tagName === 'TEXTAREA' ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
    Object.getOwnPropertyDescriptor(prototype, 'value').set.call(element, text);
    element.dispatchEvent(new Event('input', {bubbles: true}));
    element.dispatchEvent(new Event('change', {bubbles: true}));
    const original = record.original || record.value, writings = [...(record.writings || []), format];
    noteTyped(element, text);
    Object.assign(typedHere.get(element), {original, writings});
    try { element.focus({preventScroll: true}); element.blur(); } catch { /* not focusable */ }
    attempts().note(element, `writing:${format}`, before);
    return true;
  };
  // The boxes the page emptied after the last typing-again, with the limit spent: [{field, times}], so the fill's reason can say the page kept clearing it.
  window.__jobPilottoRetypeGaveUp = () => [...typedHere].filter(([element, record]) => !record.edited && !!attempts().gaveUp(element) && element.isConnected && String(element.value || '') === '')
    .map(([, record]) => ({field: record.field, times: record.retypes}));
  // Greenhouse removes the file input once a file is attached and shows its name instead, so the
  // resume counts as attached when its section shows a document filename.
  // The * of an upload slot can sit in a label above the box ("* CV and diplomas"): look a few levels up, never into a box that holds text fields.
  const starred = box => {
    for (let up = box, i = 0; up && i < 3; up = up.parentElement, i++) {
      if (up.querySelector('input:not([type=file]):not([type=hidden]), textarea, select')) return false;
      if (/\*/.test(up.textContent || '')) return true;
    }
    return false;
  };
  const resumeRow = () => {
    const heading = Array.from(document.querySelectorAll('label, legend, h2, h3, h4, span, div'))
      .find(el => !el.children?.length && /^\s*(resume|cv|resume\s*\/\s*cv)\b/i.test(el.textContent || ''))
      // An upload box that names the CV in a few words ("Upload a CV", "Charger un CV"): SuccessFactors draws it as a + button, no input yet.
      || Array.from(document.querySelectorAll('span, div, label')).find(el => !el.children?.length && el.getClientRects().length &&
        (el.textContent || '').trim().length < 40 && /\b(resume|cv|lebenslauf)\b/i.test(el.textContent) && !/cover/i.test(el.textContent));
    if (!heading) return null;
    let box = heading;
    for (let i = 0; i < 4 && box.parentElement; i++) box = box.parentElement;
    const fileInput = box.querySelector('input[type=file]');
    // The words a person sees: a script or hidden text in the box can mention "x.doc" without any file being attached.
    const named = /\S+\.(pdf|docx?|rtf|txt|odt)\b/i.test(box.innerText || '');
    return {field: 'resume', label: 'Resume/CV', type: 'file', required: /\*/.test(heading.textContent || '') || starred(box),
      legal: false, filled: named || !!fileInput?.files?.length};
  };
  // A menu's real choice: window.__jobPilottoChosen, defined with every other control reading in page/read-back.js (one truth per control).
  // A menu still on the page's own initial choice (the option its HTML marks selected, else the first): a page default nobody answered.
  // easytemp (9 Oct 2026) preselects Nationalité "Suisse" and Langue maternelle "Suisse-allemand": read as answered, never asked, wrong for the person.
  window.__jobPilottoAtPageDefault = el => { const first = [...el.options].findIndex(option => option.defaultSelected); return el.selectedIndex === (first >= 0 ? first : 0); };
  window.__jobPilottoAuditVisibleFields = () => {
    window.__jobPilottoStep('audit');
    const rows = Array.from(document.querySelectorAll('input, textarea, select'))
      // aria-hidden inputs are react-select's hidden "required" helpers, not fields.
      .filter(el => visible(el) && !el.disabled && !window.__jobPilottoReadBack.hiddenAway(el)
        && !['hidden', 'submit', 'button', 'reset', 'search'].includes(el.type))
      .map(el => ({field: el.id || el.name || label(el), label: label(el),
        type: isCombo(el) ? 'combobox' : el.type || el.tagName.toLowerCase(),
        required: window.__jobPilottoRequired?.marked ? window.__jobPilottoRequired.marked(el) : !!(el.required || el.getAttribute('aria-required') === 'true'),   // page/required-mark.js: the attribute, aria-required or a class that says required
        legal: forbidden.test(label(el)) || el.dataset?.jobpilottoCategory === 'legal',   // the AI's reading too, any language (page/categories.js)
        filled: window.__jobPilottoReadBack.holds(el)}));   // the one reading of a control's state (page/read-back.js): a box holding only a country code is empty, a picklist by its chip
    // Custom dropdowns that are no input (page/read-back.js customSelects): rows like the form reader's, so a required one left unanswered is a row, not only a coverage miss.
    for (const el of window.__jobPilottoReadBack?.customSelects?.(visible) || []) rows.push({field: el.id || el.name || label(el), label: label(el), type: 'select', required: el.getAttribute('aria-required') === 'true' || !!window.__jobPilottoRequired?.marked?.(el),
      legal: forbidden.test(label(el)) || el.dataset?.jobpilottoCategory === 'legal', filled: window.__jobPilottoReadBack.holds(el)});
    // The upload slots (page/upload.js, found by structure) are the file rows; where that script is not loaded (the Playwright launchers), the CV heading is guessed.
    const slots = window.__jobPilottoUpload?.rows ? window.__jobPilottoUpload.rows() : [];
    if (slots.length) return [...rows.filter(r => r.type !== 'file'), ...slots];
    const resume = resumeRow();
    if (!resume) return rows;
    return [...rows.filter(r => !(r.type === 'file' && /resume|cv/i.test(`${r.field} ${r.label}`))), resume];
  };
  // Read-only: text and viewport centre of every option in the currently open dropdown menu, so a
  // click lands on live coordinates instead of a position eyeballed from an older screenshot.
  window.__jobPilottoOptionPositions = () => Array.from(document.querySelectorAll('[class*="option"]'))
    .filter(el => el.offsetParent !== null && el.children.length === 0)
    .map(el => {
      const box = el.getBoundingClientRect();
      return {text: el.textContent.trim().slice(0, 80), x: Math.round(box.x + box.width / 2),
        y: Math.round(box.y + box.height / 2), onScreen: box.top >= 0 && box.bottom <= innerHeight};
    });
  // Pick the option whose text EXACTLY equals `wanted` in the open dropdown menu (case/space
  // insensitive). Typing + Return picks the first partial match ("Male" -> "Female", "4" -> "0"),
  // so use this instead. Returns the live coordinates too, for a trusted click if a site ignores
  // a JS click; verify with the audit afterwards.
  window.__jobPilottoClickOption = wanted => {
    const norm = t => (window.__jobPilottoFold || (x => String(x ?? '').normalize('NFD').replace(/\p{M}/gu, '').toLowerCase().replace(/\s+/g, ' ').trim()))(t);   // accents and case ignored, as page/fold-text.js (this file also runs alone in the agents' pages)
    const options = Array.from(document.querySelectorAll('[class*="option"]'))
      .filter(el => el.offsetParent !== null && !el.children?.length);
    const exact = options.filter(el => norm(el.textContent) === norm(wanted));
    if (exact.length !== 1) {
      return {ok: false, why: exact.length ? 'ambiguous' : 'no exact match',
        options: options.map(el => el.textContent.trim().slice(0, 60)).slice(0, 40)};
    }
    const box = exact[0].getBoundingClientRect();
    (globalThis.__jobPilottoPress?.(exact[0]) || exact[0].click());
    return {ok: true, x: Math.round(box.x + box.width / 2), y: Math.round(box.y + box.height / 2)};
  };
})();
