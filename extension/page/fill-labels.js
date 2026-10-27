// The form filler's reading helpers (split from page/fill.js, 9 Oct 2026): a field's name, the question a radio group or checkbox belongs to,
// whether it is required, a combobox's control and value, the legal-words floor (LEGAL) and the native/ARIA radio operators (page/radios.js).
// Injected first of the fill files (FILL_FILES in extension/page-files.js); shared through window.__jobPilottoFillKit, read by fill-read.js,
// fill-menus.js, fill-checks.js, fill-marks.js and fill.js. Guarded by worker/test/fill-learning.test.js (plants), extension-files.test.js.
(() => {
  if (window.__jobPilottoFillLabelsLoaded) return;
  window.__jobPilottoFillLabelsLoaded = true;

  const LEGAL = /\b(i agree|i accept|terms|privacy|consent\w*|acknowledg\w*|certif\w*|affirm\w*|i confirm i have read|i have read and understood)\b/i;
  const R = window.__jobPilottoRequired;
  const clean = text => R.clean(text, {leading: false});   // a group's name keeps its leading "*": the radios read it with `has`
  const norm = text => (window.__jobPilottoFold || (x => x.toLowerCase()))(clean(text));   // accents and case ignored (page/fold-text.js)
  // Audit labels can repeat themselves (label text + aria-label): "First Name First Name" -> "First Name".
  const once = text => clean(text).replace(/^(.+?)\s+\1$/i, '$1');
  const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
  const visible = el => !!(el.getClientRects().length && getComputedStyle(el).visibility !== 'hidden');
  // A label that is a sentence asking something (ends in a question mark after four words or more, or runs past eight words) is a question for the AI, never a contact detail's
  // box: a built-in pattern read inside it put a phone number into "Have you automated mobile (iOS/Android) ... workflows?" (13 Oct 2026). By shape, no words.
  const asksQuestion = text => { const words = String(text || '').replace(/[\s*]+$/, '').split(/\s+/).filter(Boolean); return words.length >= 4 && /[?？]$/.test(words.at(-1)) || words.length > 8; };

  // A field's own title when nothing ties it to the field (Ashby's location: <label for="…"> naming no element): the one label
  // tied to no control in the field's entry, within three levels; never two (that is a group's title, not this field's).
  const looseLabel = el => {
    for (let up = el.parentElement, i = 0; up && i < 3; up = up.parentElement, i++) {
      const loose = Array.from(up.querySelectorAll('label')).filter(l => !l.control && !l.querySelector('input, select, textarea'));
      if (loose.length === 1) return R.read(loose[0]);
      if (loose.length > 1) return '';
    }
    return '';
  };
  // A field's question when it sits in a sibling block, not a <label> (Lever: <div class="application-label"> beside the textarea, 11 Oct 2026):
  // within three levels, the one label/title-like block that holds no control, is not the field's own ancestor and comes before it; never two,
  // and only for a field alone in its entry (a text box beside pressable choices is that group's "other", not the title's answer).
  const TITLE_BLOCK = '[class*=label], [class*=Label], [class*=title], [class*=Title], [class*=question-text], legend';
  const blockTitle = el => {
    const ACTIVE = 'input:not([type=hidden]), select, textarea, button, [tabindex], [role=radio], [role=checkbox], [role=button], [role=combobox]';
    for (let up = el.parentElement, i = 0; up && i < 3; up = up.parentElement, i++) {
      if (Array.from(up.querySelectorAll(ACTIVE)).some(other => other !== el && !el.contains(other))) return '';
      const found = Array.from(up.querySelectorAll(TITLE_BLOCK)).filter(b => !b.contains(el) && !b.querySelector('input, select, textarea, button') &&
        clean(b.textContent) && b.textContent.length <= 200 && (b.compareDocumentPosition(el) & Node.DOCUMENT_POSITION_FOLLOWING));
      const innermost = found.filter(b => !found.some(o => o !== b && b.contains(o)));
      if (innermost.length === 1) return R.read(innermost[0]);
      if (innermost.length > 1) return '';
    }
    return '';
  };
  const labelOf = el => {
    const own = Array.from(el.labels || [], l => R.read(l)).join(' ') || el.getAttribute('aria-label');
    const byId = el.getAttribute('aria-labelledby');
    const labelled = byId && byId.split(/\s+/).map(id => R.read(document.getElementById(id)) || '').join(' ');
    return clean(own || labelled || looseLabel(el) || el.getAttribute('placeholder') || (el.type !== 'hidden' && blockTitle(el)) || (el.type !== 'hidden' && window.__jobPilottoLabelBefore?.(el)) || el.name || el.id);
  };
  // The question a radio group or checkbox belongs to: its fieldset legend or group label.
  // A fieldset's title: its <legend>, or (Ashby) a <label> whose `for` points at no control. Required when the title says so:
  // a trailing "*", a "required" class, or a "*" drawn by CSS (Ashby marks its radio groups only that way, no attribute).
  const fieldsetTitle = set => set && (set.querySelector('legend') ||
    Array.from(set.querySelectorAll('label')).find(l => !l.control && !l.querySelector('input, select, textarea')));
  const titleRequired = title => !!title && (window.__jobPilottoRequired.has(title) || /required/i.test(String(title.className || '')) ||
    String(getComputedStyle(title, '::after').content || '').includes('*'));
  const questionOf = el => clean(R.read(fieldsetTitle(el.closest('fieldset'))) ||
    (['radio', 'checkbox'].includes(el.type) ? R.read(window.__jobPilottoRequired.rowTitle(el)) : '') ||
    (group => group && (window.__jobPilottoOwnName(group)?.text || R.read(group.querySelector('label, legend, span'))))(el.closest('[role=radiogroup], [role=group]')) || '');   // the group's own accessible name (aria-labelledby, aria-label: page/label-before.js), else its first title inside
  const isCombo = el => el.getAttribute('role') === 'combobox';
  const comboControl = el => el.closest('[class*=control]') || el;
  const comboValue = el => window.__jobPilottoReadBack.comboValue(el);   // react-select's chip or a labelled hidden input: the one reading of a control (page/read-back.js, injected first)
  const radioOps = window.__jobPilottoRadios({clean, norm, labelOf, questionOf, LEGAL, visible});   // page/radios.js, injected first
  window.__jobPilottoFillKit = {LEGAL, asksQuestion, clean, norm, once, sleep, visible, looseLabel, labelOf, fieldsetTitle, titleRequired, questionOf,
    isCombo, comboControl, comboValue, radioOps};
})();
