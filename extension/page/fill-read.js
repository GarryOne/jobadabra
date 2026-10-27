// The form filler's reader (split from page/fill.js, 9 Oct 2026): every question on the visible page with its choices (__jobPilottoDescribeForm),
// the page's text, checkbox groups that are one question, and your contact details placed by label (built-in patterns, then the service's
// meanings). No applicant values are read. Needs page/fill-labels.js first. Guarded by worker/test/fill-learning.test.js, aliases.test.js.
(() => {
  if (window.__jobPilottoFillReadLoaded) return;
  window.__jobPilottoFillReadLoaded = true;
  const {LEGAL, asksQuestion, clean, labelOf, questionOf, fieldsetTitle, titleRequired, visible, isCombo, radioOps} = window.__jobPilottoFillKit;

  const PROFILE_LABELS = [
    ['first_name', /first\s*name|given\s*name|vorname|prénom/i],
    ['last_name', /last\s*name|family\s*name|surname|nachname|nom de famille/i],
    ['full_name', /^\s*(full\s*)?name\s*\*?\s*$|full\s*name/i],
    ['email', /e-?mail/i],
    ['phone', /phone|mobile|telefon|téléphone/i],
    ['linkedin', /linked\s*in/i],
    ['github', /github/i],
    ['website', /website|portfolio|personal\s*(site|page)/i],
    ['location', /^\s*(current\s*)?(location|city)\b/i],
    ['street', /^\s*(street(\s*address)?|strasse|stra\u00dfe|rue|address(\s*line\s*1)?)\s*\*?\s*$/i],
    ['postal_code', /\b(npa|postal\s*code|post\s*code|zip(\s*code)?|plz|code postal)\b/i],
    ['place_of_origin', /place\s*of\s*origin|heimatort|lieu d.origine/i],
    ['birth_date', /date\s*of\s*birth|birth\s*date|birthday|geburtsdatum|date de naissance/i],
  ];
  const TEXT_TYPES = ['text', 'email', 'tel', 'url', 'number', 'textarea'];

  // A phone split into boxes (16 Oct 2026, Workday "My Information": the whole "+41795550123" went into the calling-code picker, the number box and the extension box).
  // Which part each phone-labelled box takes is decided by STRUCTURE, no label words: a box inside a picker (its own field wrapper holds a listbox, a popup or a combobox) is the
  // calling code; the group then reads code | number | extension, so the first plain box after it is the number and any further one the extension. A phone with no picker
  // keeps the whole number in every box it had (two numbers, home and mobile, are not parts). A box the pack names "phone_extension" is a pack meaning's job (data).
  const fieldBox = el => {   // the widest ancestor that holds this control and no other
    let box = el;
    while (box.parentElement && box.parentElement !== document.body && box.parentElement.querySelectorAll('input, select, textarea').length <= 1) box = box.parentElement;
    return box;
  };
  const isPicker = el => !!(el.getAttribute('aria-haspopup') || el.getAttribute('role') === 'combobox' || el.closest('[role=combobox], [aria-haspopup]') ||
    fieldBox(el).querySelector('[role=listbox], [role=combobox], [aria-haspopup]'));
  // -> Map field -> 'code' | 'number' | 'extension' for the phone-labelled boxes of the rows.
  const phoneParts = rows => {
    const boxes = rows.filter(row => TEXT_TYPES.includes(row.type) && PROFILE_LABELS[4][1].test(row.label || '') && !asksQuestion(row.label))
      .map(row => ({row, el: document.getElementById?.(row.field) || document.querySelector?.(`[name="${CSS.escape(row.field)}"]`)})).filter(item => item.el);
    const parts = new Map();
    const split = boxes.length > 1 && boxes.some(item => isPicker(item.el));   // one box with its country list in its own wrapper (intl-tel-input) is the whole phone, not a code box
    let numbers = 0;
    for (const {row, el} of boxes) parts.set(row.field, !split ? 'number' : isPicker(el) ? 'code' : ++numbers === 1 ? 'number' : 'extension');
    return parts;
  };
  // -> the text this box takes of the saved phone, '' for a box that takes none.
  const phoneFor = (part, phone) => {
    const compact = String(phone).replace(/[\s().-]/g, '');
    const dial = window.__jobPilottoFillKit.dialOf?.(compact) || '';
    if (part === 'extension') return '';
    if (part === 'code') return dial;
    return part === 'split-number' ? compact.slice(dial.length).replace(/^0+/, '') : String(phone);
  };

  // Meanings from the service ("Heimatort" -> place_of_origin; extension/alias-schema.js, whose aliasKey this copies as a plain script, a test
  // keeps them agreeing). Asked only when no built-in pattern above matched, so the service can add meanings but never override these.
  const aliasFor = label => {
    const text = clean(label).toLowerCase().replace(/\*+/g, '').replace(/\((optional|required|erforderlich|obligatoire)\)/g, '').replace(/^\s*\d+[.)]\s+/, '').replace(/[\s:;,.?!-]+$/g, '').trim();
    if (text.length < 3 || text.length > 100 || /@|https?:|www\./.test(text)) return null;
    for (const item of window.__jobPilottoAliases || []) {
      if (item && item.key && !/^(resume|cover_letter)$/.test(item.key) && item.phrase && (text === item.phrase || ` ${text} `.includes(` ${item.phrase} `))) return item;
    }
    return null;
  };
  // A place box that holds text the fill never typed, and that disagrees with the saved place: the page's own guess, not an answer (benchmark form 106,
  // 27 Oct 2026: Workable fills "Address" from the visitor's IP, "Des Moines, United States of America", and the saved street never went in). Only the
  // person's places: a page can guess where a visitor is, but a name, e-mail or phone it holds came from the person's own account there and is kept.
  // A box the fill typed on this page before (the person may have changed it since) is never a guess. Agreeing text (another spelling, the city part) is kept.
  const PLACE_KEYS = ['location', 'street', 'postal_code'];
  const fold = text => (window.__jobPilottoFold?.(text) ?? String(text ?? '').toLowerCase()).replace(/[^\p{L}\p{N}]/gu, '');   // letters and digits, accents dropped (Zürich = Zurich; page/fold-text.js)
  const pageGuess = (row, profile) => {
    const key = (PROFILE_LABELS.find(([name, pattern]) => profile[name] && pattern.test(row.label || row.field)) || [])[0];
    if (!PLACE_KEYS.includes(key) || asksQuestion(row.label)) return false;
    const el = document.getElementById?.(row.field) || document.querySelector?.(`[name="${CSS.escape(row.field)}"]`);
    if (!el || el.tagName === 'SELECT' || window.__jobPilottoTypedHere?.(el)) return false;
    const forms = typeof profile.location_forms === 'string' ? profile.location_forms.split(',') : profile.location_forms || [];
    const saved = [profile[key], ...(key === 'location' ? [String(profile.location).split(',')[0], ...forms] : [])].filter(Boolean);
    return !saved.some(value => window.__jobPilottoTypedSame(fold(value), fold(el.value)));
  };
  // Contact details by field label, for the fields every board names differently.
  window.__jobPilottoProfileEntries = (rows, profile, taken = []) => {
    const used = new Set(taken);
    const entries = [];
    window.__jobPilottoAliasUsed = {};   // field -> the phrase that placed it (reported as counts, never the answer)
    const parts = phoneParts(rows), split = [...parts.values()].includes('code');
    for (const row of rows) {
      if (row.legal || used.has(row.field) || !TEXT_TYPES.includes(row.type)) continue;
      const guess = row.filled && pageGuess(row, profile);
      if (row.filled && !guess) continue;
      if (asksQuestion(row.label)) continue;   // a sentence is a question for the AI, whatever detail it names
      if (/middle|maiden|nick/i.test(row.label || '')) continue;  // "Preferred first name" = your first name
      const match = PROFILE_LABELS.find(([key, pattern]) => profile[key] && pattern.test(row.label || row.field));
      const alias = match ? null : aliasFor(row.label);
      const key = match ? match[0] : alias && profile[alias.key] ? alias.key : '';
      if (!key) continue;
      if (key === 'full_name' && rows.some(r => /first\s*name/i.test(r.label))) continue;
      const part = key === 'phone' ? parts.get(row.field) || 'number' : '';
      const value = key === 'phone' ? phoneFor(part === 'number' && split ? 'split-number' : part, profile.phone) : String(profile[key]);
      if (!value) { used.add(row.field); continue; }   // the extension box: nothing to type, and no other detail takes it
      entries.push({field: row.field, value, ...(guess ? {pageGuess: true} : {}), ...((profile._fromCv || []).includes(key) ? {fromCv: true} : {})});   // a detail you left empty, from your CV (desktop/lib/server-contact.js withCvFallback): shown "check it"
      if (alias) window.__jobPilottoAliasUsed[row.field] = alias.phrase;
      used.add(row.field);
    }
    return entries;
  };

  // Every question on the visible page, with the choices it offers. No applicant values.
  // settled: read at the end of a fill (flow.js), when a real choice on the first option is an answer ("Monsieur"); before it, a page's preselected first
  // option is still asked (the AI answers it: "Célibataire" may be wrong for you).
  window.__jobPilottoDescribeForm = async (settled = false) => {
    const fields = [];
    const controls = Array.from(document.querySelectorAll('input, textarea, select')).filter(el => visible(el) &&
      !el.disabled && !window.__jobPilottoReadBack.hiddenAway(el) &&
      !['hidden', 'submit', 'button', 'reset', 'search', 'file', 'image'].includes(el.type));
    const groups = new Set();
    let unnamed = 0;
    for (const el of controls) {
      // A field with neither id nor name (Ashby's location box) gets one, so it can be answered and filled like any other.
      if (!el.id && !el.name && el.type !== 'radio' && el.type !== 'checkbox') el.id = `jp-field-${++unnamed}`;
      if (el.type === 'radio') {
        if (!el.name || groups.has(el.name)) continue;
        groups.add(el.name);
        const radios = controls.filter(r => r.type === 'radio' && r.name === el.name);
        const question = questionOf(el) || labelOf(el);
        fields.push({field: `radio:${el.name}`, label: question, type: 'radio',
          required: radios.some(r => r.required || r.getAttribute('aria-required') === 'true') || titleRequired(fieldsetTitle(el.closest('fieldset')) || window.__jobPilottoRequired.rowTitle(el))
            || (group => !!group && (group.getAttribute('aria-required') === 'true' || window.__jobPilottoRequired.has(window.__jobPilottoOwnName(group)?.el)))(el.closest('[role=radiogroup], [role=group]')),   // the group's own title carries the star (page/label-before.js)
          options: radios.map(labelOf), filled: radios.some(r => r.checked), legal: LEGAL.test(question)});
      } else if (el.type === 'checkbox') {
        const label = labelOf(el);
        const question = questionOf(el);
        fields.push({field: el.id || el.name, label: question && question !== label ? `${question}: ${label}` : label,
          type: 'checkbox', required: el.required || window.__jobPilottoRequired.marked(el), filled: window.__jobPilottoReadBack.holds(el), legal: LEGAL.test(`${question} ${label}`)});
      } else if (isCombo(el)) {
        fields.push({field: el.id || el.name, label: labelOf(el), type: 'combobox',
          required: window.__jobPilottoRequired.marked(el), filled: window.__jobPilottoReadBack.holds(el),
          legal: LEGAL.test(labelOf(el)), ...(el.closest('[class*="is-multi"], [aria-multiselectable="true"]') ? {multiple: true} : {})});   // a menu that takes several choices (react-select's is-multi, aria-multiselectable): the AI is told, and every choice is picked (page/fill-menus.js armCombo)
      } else {
        const type = el.tagName === 'SELECT' ? 'select' : el.tagName === 'TEXTAREA' ? 'textarea' : el.type || 'text';
        fields.push({field: el.id || el.name, label: labelOf(el), type, required: window.__jobPilottoRequired.marked(el),
          ...(type === 'select' ? {options: Array.from(el.options).map(o => clean(o.text)).filter(Boolean)} : {}),
          filled: window.__jobPilottoReadBack.holds(el) && (type !== 'select' || settled || !window.__jobPilottoAtPageDefault?.(el)), legal: LEGAL.test(labelOf(el))});   // the one reading (page/read-back.js): a box the page changed after we typed it is not filled
      }
    }
    fields.push(...radioOps.ariaFields());   // ARIA radio groups (page/radios.js)
    // Custom dropdowns that are no input (<div role=combobox>, <button aria-haspopup=listbox>): a question with choices like a native select. Their list sits in the page,
    // named by aria-controls or beside the trigger; the operator (page/controls.js) picks by the question or the id. Before, only the coverage audit saw them
    // ("question on the page not read"), so nothing was ever asked (jobs.ch "Disponibilité", "Permis de travail", 20 Oct 2026).
    for (const el of window.__jobPilottoReadBack.customSelects(visible)) {
      if (!el.id && !el.name) el.id = `jp-field-${++unnamed}`;
      const options = window.__jobPilottoReadBack.choicesOf(el);
      fields.push({field: el.id || el.name, label: labelOf(el), type: 'select', custom: true, required: el.getAttribute('aria-required') === 'true' || window.__jobPilottoRequired.marked(el),
        ...(options.length ? {options} : {}), filled: window.__jobPilottoReadBack.holds(el), legal: LEGAL.test(labelOf(el))});
    }
    return fields.filter(f => f.field);
  };

  window.__jobPilottoPageText = () => clean(document.body?.innerText || '').slice(0, 12000);

  window.__jobPilottoCheckboxQuestions = () => {
    const groups = {};
    for (const b of document.querySelectorAll('input[type=checkbox]')) {
      const q = questionOf(b);
      if (q && visible(b)) (groups[q] ||= []).push(labelOf(b));
    }
    return Object.entries(groups).filter(([, options]) => options.length > 1).map(([question, options]) => ({question, options}));
  };
  Object.assign(window.__jobPilottoFillKit, {PROFILE_LABELS, TEXT_TYPES, aliasFor, phoneParts});
})();
