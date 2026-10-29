// Plans matched answers and fills plain fields, choices and armed menus in their original page order.
// Invariants: answer order is preserved; only existing field operators write, and consent authorization stays with fillPage.
(() => {
  if (window.__jobPilottoFillPlanLoaded) return;
  window.__jobPilottoFillPlanLoaded = true;
  const {LEGAL, norm, asksQuestion, PROFILE_LABELS, DIAL, dialOf, phoneParts, armCombo, radioOps, setCheckbox, pickCheckboxOption} = window.__jobPilottoFillKit;

  // Strip reminder lines before choosing answers that may be typed.
  const prepareAnswers = (all) => {
    // Why (#2198, owner): a reminder line in a value is never typed (page/fill-marks.js splitReminders): the rest is typed, the reminders go with the answer; nothing left = the AI's reading only.
    for (const a of all || []) if (typeof a.value === 'string' && /•\s*Add:/.test(a.value)) {
      const {text, remind} = window.__jobPilottoFillKit.splitReminders(a.value);
      Object.assign(a, {value: text, remind: [...(a.remind || []), ...remind]}, text ? (a.draft ? {draft: 'outline'} : {}) : {use: 'kind', draft: undefined});
    }
    const answers = (all || []).filter(a => a.use !== 'propose' && a.use !== 'kind');
    return answers;
  };

  // Match kit checkbox answers by their whole question.
  const matchCheckboxGroups = (answers, form, rowOf) => {
    // Kit answers name fields as the job board does (question_123[]); a checkbox group is matched by its question.
    for (const item of answers) {
      if (rowOf[item.field] || !item.question) continue;
      const group = form.find(row => row.type === 'checkbox-group' && norm(row.question) === norm(item.question));
      if (group) item.field = group.field;
    }
  };

  // Match regenerated field ids only to one unclaimed question.
  const matchQuestions = (all, form, rowOf) => {
    // The ids the AI was asked about are gone when the page re-created its controls in between (SAP UI5 gives every re-created control a new generated id): the answer
    // goes to the one row with the same question. Counts only, for the log: how many answers there were, how many found a row, how many by their question, how many none.
    const reach = {asked: 0, matched: 0, byQuestion: 0, lost: 0};
    for (const item of (all || []).filter(a => a.use !== 'kind')) {
      reach.asked++;
      if (rowOf[item.field]) { reach.matched++; continue; }
      const rows = item.question ? form.filter(row => row.type !== 'checkbox-group' && norm(row.label || '') === norm(item.question)) : [];
      if (rows.length === 1 && !(all || []).some(other => other !== item && other.field === rows[0].field)) { item.field = rows[0].field; reach.byQuestion++; } else reach.lost++;
    }
    return reach;
  };

  // Describe the form and categories before matching answers and proposals.
  const describePlan = async (all, answers) => {
    let proposedOf = {};   // built below, once the answers' fields are matched to the rows
    const form = await window.__jobPilottoDescribeForm();
    for (const group of window.__jobPilottoCheckboxQuestions()) {
      form.push({field: `group:${group.question}`, question: group.question, label: group.question, type: 'checkbox-group', options: group.options,
        filled: false, legal: LEGAL.test(group.question)});
    }
    const rowOf = Object.fromEntries(form.map(row => [row.field, row]));
    window.__jobPilottoMarkCategories?.([...answers, ...(all || []).filter(a => a.use === 'kind')], rowOf);   // the AI's reading, any language: legal never filled (page/categories.js)
    matchCheckboxGroups(answers, form, rowOf);
    const reach = matchQuestions(all, form, rowOf);
    proposedOf = Object.fromEntries((all || []).filter(a => a.use === 'propose').map(a => [a.field, a]));
    return {form, rowOf, reach, proposedOf};
  };

  // Prefer the AI contact reading while preserving edits made by the person.
  const planContact = (answers, form, profile) => {
    // Why (#2200, owner): the AI's reading of what a contact box means wins over the quick step's label pattern (owner, 27 Oct 2026; form 103 "Preferred First & Last Name" typed "Tester"):
    // where its answer disagrees, the AI's is typed, now (the pattern's entry is dropped) or over the box the quick step typed earlier (data-jobpilotto-contact), never over the person's edit.
    const alnum = text => String(text ?? '').toLowerCase().replace(/[^\p{L}\p{N}]/gu, '');
    const byAI = Object.fromEntries(answers.filter(a => a.use === 'fill' && typeof a.value === 'string' && a.value.trim() && !/^(your details|standard answer)/.test(a.source || '')).map(a => [a.field, a.value]));
    const sameReading = (a, b) => a === b || (/^\d{8,}$/.test(a) && /^\d{8,}$/.test(b) && a.slice(-8) === b.slice(-8));   // strict: "Tester" is not "Ada Tester" (a containment test would say it is)
    const disagrees = (field, value) => byAI[field] !== undefined && !sameReading(alnum(value), alnum(byAI[field]));
    const contact = window.__jobPilottoProfileEntries(form, profile || {}).filter(entry => !disagrees(entry.field, entry.value));
    for (const row of form) {
      const el = row.filled && document.getElementById(row.field), typed = el?.getAttribute?.('data-jobpilotto-typed');
      if (typed && el.hasAttribute('data-jobpilotto-contact') && disagrees(row.field, typed)) row.filled = false;
    }
    const contactFields = new Set(contact.map(entry => entry.field)), fromCvFields = new Set(contact.filter(entry => entry.fromCv).map(entry => entry.field));
    return {contact, contactFields, fromCvFields};
  };

  // Choose plain fields, leaving legal and custom controls to their own operators.
  const planPlain = (answers, rowOf, contactFields) => {
    const plain = [];
    for (const item of answers) {
      const row = rowOf[item.field];
      if (!row || row.filled || row.legal || contactFields.has(item.field)) continue;
      if (['combobox', 'radio', 'checkbox'].includes(row.type) || row.custom) continue;   // a custom dropdown is operated by page/controls.js below
      plain.push({field: item.field, value: item.value});
    }
    return plain;
  };

  // Mark contact writes and ask for review when replacing a page guess.
  const markContact = (contact, typed, rowOf, review) => {
    for (const entry of contact) if ((typed.filled || []).includes(entry.field)) (document.getElementById(entry.field) || document.querySelector(`[name="${CSS.escape(entry.field)}"]`))?.setAttribute('data-jobpilotto-contact', '');   // typed by the quick step: the AI's reading may replace it
    // A place the page had guessed, now the saved one: the person checks it (page/fill-read.js pageGuess). The page's old text never leaves the page.
    for (const entry of contact) if (entry.pageGuess && (typed.filled || []).includes(entry.field)) review.push(`Check: ${rowOf[entry.field]?.label || entry.field} (it held the page's own text before the fill; your saved one is in now)`);
  };

  // Rearm text lost on blur as suggestions and adjust the count in sequence.
  const rearmLostText = async (contact, plain, typed, rowOf, armed, filled) => {
    // A box that empties itself when focus leaves took text it was not offered (a job board's own place widget takes only one of its suggestions): armed as a type-to-search box, typed for real
    // and chosen by meaning when its click comes (page/suggest-box.js, page/fill-menus.js suggestPick).
    for (const entry of await (window.__jobPilottoSuggest?.lostOnBlur([...contact, ...plain], typed.filled || []) ?? [])) {
      if (armCombo(entry.field, entry.value, {suggest: true})) { armed.push(rowOf[entry.field]?.label || entry.field); filled = Math.max(0, filled - 1); }
    }
    return filled;
  };

  // Set a radio or checkbox answer with the existing field-kind operator.
  const pickAnswerChoice = (row, item) => {
    if (row.type === 'radio') return item.field.startsWith('aria:') ? radioOps.pickAriaRadio(item.field.slice(5), item.value) : radioOps.pickRadio(item.field.slice(6), item.value);
    if (row.type === 'checkbox') return setCheckbox(item.field, item.value);
    if (row.type === 'checkbox-group') return pickCheckboxOption(row.question, item.value);
    return null;
  };

  // Record a choice miss or a low-confidence review without changing its fill count.
  const recordChoiceResult = (ok, row, item, todo, review) => {
    if (ok === false) todo.push(`Pick "${item.value}" for: ${row.label}`);
    if (ok !== false && item.confidence && item.confidence !== 'high') {
      review.push(`Check: ${row.label}${item.note ? ` (${item.note})` : ''}`);
    }
  };

  // Fill answer choices in answer order, recording misses and review hints.
  const fillAnswerChoices = (answers, rowOf, armed, todo, review) => {
    let filled = 0;
    for (const item of answers) {
      const row = rowOf[item.field];
      if (!row || row.filled || row.legal) continue;
      let ok = null;
      if (row.type === 'combobox') { if (armCombo(item.field, item.value)) armed.push(row.label); continue; }
      else ok = pickAnswerChoice(row, item);
      if (ok === true) filled += 1;
      recordChoiceResult(ok, row, item, todo, review);
    }
    return filled;
  };

  // Arm unanswered voluntary demographic menus with their decline choices.
  const armDemographics = (form, answers, answered, armed) => {
    // Voluntary demographic questions with no answer: pick the menu's decline option, whatever it's called.
    const DEMOGRAPHIC = /gender|race|ethnic|veteran|disabilit|sexual orientation|transgender|pronoun/i;
    const DECLINE = "I don't wish to answer || I do not wish to answer || Decline to self-identify || Decline to self identify || " +
      "Prefer not to say || Decline to answer || I do not want to answer || Choose not to disclose || I choose not to disclose || Not specified";
    for (const row of form) {
      if (row.type !== 'combobox' || row.filled || row.legal || answered.has(row.field) || !(row.demographic || DEMOGRAPHIC.test(row.label || ''))) continue;
      // A decline is for the sensitive categories: a REQUIRED menu the AI called demographic without one of them (a salutation: Mr./Ms./Diverse) has no decline choice, so it is
      // the person's own choice, never armed with the decline words (SuccessFactors Title, 15 Oct 2026: the hint read "Click to choose: No Selection", the menu's placeholder).
      if (row.required && !DEMOGRAPHIC.test(row.label || '')) continue;
      if (armCombo(row.field, DECLINE)) { armed.push(row.label); answers.push({field: row.field, value: 'Decline to self-identify', source: 'standard answer (demographics)'}); answered.add(row.field); }
    }
  };

  // Arm the unanswered country menu from the saved phone prefix.
  const armPhoneCountry = (form, profile, answers, answered, armed) => {
    const dial = dialOf(profile?.phone);
    const phoneRow = form.find(row => row.type === 'tel' || (/phone|mobile/i.test(row.label || '') && !asksQuestion(row.label) && phoneParts(form).get(row.field) === 'number'));
    if (dial && phoneRow) {
      const country = form.find(row => row.type === 'combobox' && /^\s*country\b/i.test(row.label || '') && !answered.has(row.field));
      if (country && armCombo(country.field, DIAL[dial])) {
        armed.push(country.label); answers.push({field: country.field, value: DIAL[dial], source: 'your details (phone prefix)'});
        answered.add(country.field);
        window.__jobPilottoPhone = {field: phoneRow.field, national: String(profile.phone).replace(/\s/g, '').slice(dial.length)};
      }
    }
  };

  // Arm unanswered profile menus without putting a phone number in a phone-part menu.
  const armProfileMenus = (form, profile, answers, answered, armed) => {
    for (const row of form) {
      if (row.type !== 'combobox' || row.filled || row.legal || answered.has(row.field) || asksQuestion(row.label)) continue;
      const [key] = PROFILE_LABELS.find(([name, pattern]) => profile?.[name] && pattern.test(row.label || row.field)) || [];
      if (key === 'phone') continue;   // a menu of a phone's other part (device type, calling code: the country path above arms it): never the whole number
      if (key && armCombo(row.field, String(profile[key]))) { armed.push(row.label); answers.push({field: row.field, value: profile[key], source: 'your details'}); }
    }
  };

  Object.assign(window.__jobPilottoFillKit, {prepareAnswers, describePlan, planContact, planPlain, markContact, rearmLostText, fillAnswerChoices, armDemographics, armPhoneCountry, armProfileMenus});
})();
