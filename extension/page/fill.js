// Runs in the application page (main world) after browser-submit-guard.js and browser-form-fastpath.js.
// Describes the form (labels, types, options; never your values), fills answers of every field type,
// attaches the CV, and shows what is left in a panel on the page. It never clicks Submit; consent
// controls require the saved authorization and an explicit validated AI agreement reading.
// Its helpers come first, each a concern of its own (FILL_FILES in extension/page-files.js): fill-labels.js (names, LEGAL), fill-read.js (the
// reader), fill-menus.js (dropdowns), fill-checks.js (checkboxes, consents), fill-marks.js (the AI glow), shared through window.__jobPilottoFillKit.
(() => {
  if (window.__jobPilottoFillLoaded) return;
  window.__jobPilottoFillLoaded = true;
  // A question's wording is kept whole (owner, 17 Oct 2026: labels cut at 120 characters were saved as "…We t: Yes" and never matched the form again); the cap only guards a runaway page.
  const TRACE_LABEL_MAX = 500;

  const {LEGAL, asksQuestion, clean, norm, once, sleep, visible, labelOf, questionOf, radioOps, PROFILE_LABELS, aliasFor, DIAL, dialOf, armCombo, phoneParts,
    pickCheckboxOption, setCheckbox, wantsUnchecked, boxOf, tickConsents, fillConsentChoices, markAttention, markDraft} = window.__jobPilottoFillKit;

  const letterBoxes = () => Array.from(document.querySelectorAll('textarea')).filter(el => visible(el) && window.__jobPilottoUpload.fileKind(`${el.id} ${el.name} ${labelOf(el)}`, window.__jobPilottoAliases || []) === 'cover_letter');

  // The same visible manual-entry shape drives filling and missing-letter observation.
  const manualLetterButton = () => {
    const heading = Array.from(document.querySelectorAll('label, legend, h3, h4, div')).find(el => visible(el) && /^\s*cover\s*letter\s*\*?\s*$/i.test(el.textContent || ''));
    return heading && Array.from(heading.parentElement.querySelectorAll('button, a')).find(el => visible(el) && /enter manually|type it|paste/i.test(el.textContent || ''));
  };

  // Optional cover letter: a textarea labelled Cover letter, or behind an "Enter manually" button.
  const fillCoverLetter = async letter => {
    const find = () => letterBoxes()[0];
    let box = find();
    if (!box) {
      const manual = manualLetterButton();
      if (!manual) return false;
      (globalThis.__jobPilottoPress?.(manual) || manual.click());
      for (let i = 0; i < 10 && !box; i++) { await sleep(150); box = find(); }
    }
    if (!box || String(box.value || '').trim()) return false;
    Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set.call(box, letter);
    box.dispatchEvent(new Event('input', {bubbles: true}));
    box.dispatchEvent(new Event('change', {bubbles: true}));
    return true;
  };

  // answers: [{field, value, question?, confidence?, note?}] merged by the extension (AI + kit).
  const fillPage = async (all, profile, resume, coverLetter = '', acceptConsents = false) => {
    if (!('__jobPilottoGuardActive' in window)) return {error: 'The page helpers did not load; nothing was filled.'};
    if (window.__jobPilottoStopped) return {error: 'Stopped by you.', stopped: true};
    // The AI's likely answers it was not told (use: "propose", worker/src/extension.js): shown to you as proposals, never typed.
    // A kind only (use: "kind", no value): the AI's reading of a legal question, marked below and never filled (worker/src/extension.js answerForm).
    // The popup guard (page/guard-gate.js): between the stages a layer that opened over the form is closed by the extension, or the fill is held and types nothing more.
    let held = false;
    const gate = async () => { if (!held && await (window.__jobPilottoGate?.() ?? true) === false) held = true; return !held; };
    // Why (#2198, owner): a reminder line in a value is never typed (page/fill-marks.js splitReminders): the rest is typed, the reminders go with the answer; nothing left = the AI's reading only.
    for (const a of all || []) if (typeof a.value === 'string' && /•\s*Add:/.test(a.value)) {
      const {text, remind} = window.__jobPilottoFillKit.splitReminders(a.value);
      Object.assign(a, {value: text, remind: [...(a.remind || []), ...remind]}, text ? (a.draft ? {draft: 'outline'} : {}) : {use: 'kind', draft: undefined});
    }
    const answers = (all || []).filter(a => a.use !== 'propose' && a.use !== 'kind');
    let proposedOf = {};   // built below, once the answers' fields are matched to the rows
    const form = await window.__jobPilottoDescribeForm();
    for (const group of window.__jobPilottoCheckboxQuestions()) {
      form.push({field: `group:${group.question}`, question: group.question, label: group.question, type: 'checkbox-group', options: group.options,
        filled: false, legal: LEGAL.test(group.question)});
    }
    const rowOf = Object.fromEntries(form.map(row => [row.field, row]));
    window.__jobPilottoMarkCategories?.([...answers, ...(all || []).filter(a => a.use === 'kind')], rowOf);   // the AI's reading, any language: legal never filled (page/categories.js)
    // Kit answers name fields as the job board does (question_123[]); a checkbox group is matched by its question.
    for (const item of answers) {
      if (rowOf[item.field] || !item.question) continue;
      const group = form.find(row => row.type === 'checkbox-group' && norm(row.question) === norm(item.question));
      if (group) item.field = group.field;
    }
    // The ids the AI was asked about are gone when the page re-created its controls in between (SAP UI5 gives every re-created control a new generated id): the answer
    // goes to the one row with the same question. Counts only, for the log: how many answers there were, how many found a row, how many by their question, how many none.
    const reach = {asked: 0, matched: 0, byQuestion: 0, lost: 0};
    for (const item of (all || []).filter(a => a.use !== 'kind')) {
      reach.asked++;
      if (rowOf[item.field]) { reach.matched++; continue; }
      const rows = item.question ? form.filter(row => row.type !== 'checkbox-group' && norm(row.label || '') === norm(item.question)) : [];
      if (rows.length === 1 && !(all || []).some(other => other !== item && other.field === rows[0].field)) { item.field = rows[0].field; reach.byQuestion++; } else reach.lost++;
    }
    proposedOf = Object.fromEntries((all || []).filter(a => a.use === 'propose').map(a => [a.field, a]));
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
    const todo = [], review = [], armed = []; document.querySelectorAll('.job-pilotto-badge').forEach(badge => badge.remove());
    const consentChoices = await gate() ? fillConsentChoices(all, form, acceptConsents) : {filled: [], armed: []};
    armed.push(...consentChoices.armed.map(field => rowOf[field]?.label || field));
    let filled = consentChoices.filled.length;
    const plain = [];
    for (const item of answers) {
      const row = rowOf[item.field];
      if (!row || row.filled || row.legal || contactFields.has(item.field)) continue;
      if (['combobox', 'radio', 'checkbox'].includes(row.type) || row.custom) continue;   // a custom dropdown is operated by page/controls.js below
      plain.push({field: item.field, value: item.value});
    }
    const typed = window.__jobPilottoFillKnownFields([...contact, ...plain]);
    filled += (typed.filled || []).length;
    for (const entry of contact) if ((typed.filled || []).includes(entry.field)) (document.getElementById(entry.field) || document.querySelector(`[name="${CSS.escape(entry.field)}"]`))?.setAttribute('data-jobpilotto-contact', '');   // typed by the quick step: the AI's reading may replace it
    // A place the page had guessed, now the saved one: the person checks it (page/fill-read.js pageGuess). The page's old text never leaves the page.
    for (const entry of contact) if (entry.pageGuess && (typed.filled || []).includes(entry.field)) review.push(`Check: ${rowOf[entry.field]?.label || entry.field} (it held the page's own text before the fill; your saved one is in now)`);
    // A box that empties itself when focus leaves took text it was not offered (a job board's own place widget takes only one of its suggestions): armed as a type-to-search box, typed for real
    // and chosen by meaning when its click comes (page/suggest-box.js, page/fill-menus.js suggestPick).
    for (const entry of await (window.__jobPilottoSuggest?.lostOnBlur([...contact, ...plain], typed.filled || []) ?? [])) {
      if (armCombo(entry.field, entry.value, {suggest: true})) { armed.push(rowOf[entry.field]?.label || entry.field); filled = Math.max(0, filled - 1); }
    }
    for (const item of answers) {
      const row = rowOf[item.field];
      if (!row || row.filled || row.legal) continue;
      let ok = null;
      if (row.type === 'combobox') { if (armCombo(item.field, item.value)) armed.push(row.label); continue; }
      else if (row.type === 'radio') ok = item.field.startsWith('aria:') ? radioOps.pickAriaRadio(item.field.slice(5), item.value) : radioOps.pickRadio(item.field.slice(6), item.value);
      else if (row.type === 'checkbox') ok = setCheckbox(item.field, item.value);
      else if (row.type === 'checkbox-group') ok = pickCheckboxOption(row.question, item.value);
      if (ok === true) filled += 1;
      if (ok === false) todo.push(`Pick "${item.value}" for: ${row.label}`);
      if (ok !== false && item.confidence && item.confidence !== 'high') {
        review.push(`Check: ${row.label}${item.note ? ` (${item.note})` : ''}`);
      }
    }
    const answered = new Set(answers.map(a => a.field));
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
    for (const row of form) {
      if (row.type !== 'combobox' || row.filled || row.legal || answered.has(row.field) || asksQuestion(row.label)) continue;
      const [key] = PROFILE_LABELS.find(([name, pattern]) => profile?.[name] && pattern.test(row.label || row.field)) || [];
      if (key === 'phone') continue;   // a menu of a phone's other part (device type, calling code: the country path above arms it): never the whole number
      if (key && armCombo(row.field, String(profile[key]))) { armed.push(row.label); answers.push({field: row.field, value: profile[key], source: 'your details'}); }
    }
    if (armed.length) todo.unshift(`Click the ${armed.length} highlighted dropdown(s); each picks its answer when opened`);
    // Controls the form reader above does not set (pressable Yes/No groups, custom dropdowns, date pickers): the generic
    // operators (page/controls.js) get the same answers, act only on a control an answer was matched to, and verify each.
    if (window.__jobPilottoControls && await gate()) {
      const operated = await window.__jobPilottoControls.fill(answers, {skip: question => LEGAL.test(question)}).catch(() => []);
      for (const result of operated) {
        if (result.unmatched) continue;   // a control no answer fit: only counted for learning (page/controls.js), no row to the person
        if (result.ok) filled += 1; else todo.push(`Pick "${result.value}" for: ${result.question}${result.why ? ` (${result.why})` : ''}`);
      }
      // Which kind of control and fingerprint worked or not: no question, no answer.
      window.__jobPilottoOperatedQuestions = operated.filter(result => !result.unmatched).map(result => result.question);
      window.__jobPilottoOperated = operated.map(({kind, fp, recipe, ok, why}) => ({kind, fp, recipe: recipe || 0, ok, why: why || ''}));
    }
    // The files (page/upload.js): each upload slot is operated by what it asks for; a miss is reported by fingerprint like any control's.
    const uploads = !(await gate()) ? [] : await window.__jobPilottoUpload.fill({resume: resume?.data ? resume : null, coverLetter: resume?.coverLetterFile || null}).catch(() => []);
    // What a pass on this page attached, by meaning: its slot's title. A field the page redraws after the file went in has no slot for a while (the live chip came 4.5 s
    // or more after the file), so a later pass then keeps the file as given; a slot that comes back empty is a slot again, and the upload above gives it the file.
    const given = window.__jobPilottoUploadsGiven ||= {};
    for (const item of uploads) if (item.ok && item.meaning && item.label) given[item.meaning] = item.label;
    const resumeAttached = uploads.some(item => item.meaning === 'resume' && item.ok) || (!uploads.some(item => item.meaning === 'resume') && !!given.resume);
    const letterFileAttached = uploads.some(item => item.meaning === 'cover_letter' && item.ok);
    // Which letter this extension put in (kept for later passes; a file the person chose names none): the fill record shows it (owner, 18 Oct 2026).
    if (uploads.some(item => item.meaning === 'cover_letter' && item.ok && !item.why) && resume?.coverLetterFile) window.__jobPilottoLetterGiven = resume.coverLetterFile.tailored ? 'this job\'s letter' : 'your base letter';
    window.__jobPilottoOperated = [...(window.__jobPilottoOperated || []), ...uploads.filter(item => item.ok !== undefined)
      .map(({fp, recipe, ok, why}) => ({kind: 'upload', fp, recipe: recipe || 0, ok, why: why || ''}))];
    // Wordings nobody knew (no text of yours: the slot's own title), for the service to give a meaning once.
    window.__jobPilottoUnknownUploads = uploads.filter(item => item.why === 'wording unknown' && item.label).map(item => item.label);
    if (letterFileAttached) filled += 1;
    await gate();   // after the upload's own waits: a layer the page opened meanwhile
    if (coverLetter && !held && await fillCoverLetter(coverLetter)) filled += 1;
    await sleep(300);
    // One row per checkbox group (not per option); legal boxes named by their question, not their id.
    const groupOf = new Map();
    for (const b of document.querySelectorAll('input[type=checkbox]')) {
      const q = questionOf(b);
      if (q) groupOf.set(b.id || b.name, q);
    }
    const seenGroups = new Set();
    const after = window.__jobPilottoAuditVisibleFields().flatMap(row => {
      // The audit lists each radio option on its own: one row per group instead, named and required as the form described it.
      if (row.type === 'radio') {
        const el = document.getElementById(row.field) || document.querySelector(`input[type=radio][name="${CSS.escape(row.field)}"]`);
        if (!el?.name) return [row];
        const key = `radio:${el.name}`;
        if (seenGroups.has(key)) return [];
        seenGroups.add(key);
        const radios = Array.from(document.querySelectorAll(`input[type=radio][name="${CSS.escape(el.name)}"]`));
        return [{...row, field: key, label: rowOf[key]?.label || questionOf(el) || row.label, filled: radios.some(r => r.checked),
          required: row.required || !!rowOf[key]?.required}];
      }
      const q = row.type === 'checkbox' && groupOf.get(row.field);
      if (!q) return [row];
      const boxes = Array.from(document.querySelectorAll('input[type=checkbox]')).filter(b => questionOf(b) === q);
      if (boxes.length < 2) return [{...row, label: q}];
      if (seenGroups.has(q)) return [];
      seenGroups.add(q);
      return [{...row, field: `group:${q}`, label: q, filled: boxes.some(b => b.checked), required: boxes.some(b => b.required) || row.required}];
    });
    // Required questions the page shows that nothing above read (page/coverage.js): a layout the reader doesn't know. Each is
    // listed for you, counted as required, and traced as a reading failure, so it is reported (with its HTML) and learned.
    after.push(...radioOps.ariaRows(form));   // not in the audit (no <input>): listed, and counted when picked
    // Legal is decided once, by the form reader (and the AI's reading of it): the audit has its own word floor, and a row it missed must not fall to
    // "no answer" (11 Oct 2026, Datadog: an attestation the reader marked legal, so never asked, was traced as "no answer in the kit").
    for (const row of after) if (rowOf[row.field]?.legal) row.legal = true;
    for (const row of after) for (const kind of ['written', 'demographic', 'unanswered']) if (rowOf[row.field]?.[kind]) row[kind] = true;
    const unread = [];
    if (window.__jobPilottoCoverage) {
      // Read = asked about: the described fields and the widgets an operator answered. Not the audit's rows: a field can be on
      // the page (and in the audit) without its question ever having been asked.
      // The upload slots' titles too (page/upload.js): their own rows say filled or left, even while the page redraws a field after the file went in.
      const read = [...form.map(row => row.label), ...(window.__jobPilottoOperatedQuestions || []), ...uploads.map(item => item.label).filter(Boolean), ...Object.values(given)];
      for (const item of window.__jobPilottoCoverage.unread(document, read, visible)) {
        item.area.setAttribute('data-jobpilotto-unread', item.question);
        unread.push(item);
        const same = after.find(row => norm(row.label) === norm(item.question));
        if (same) Object.assign(same, {required: true, unread: true});
        else after.push({field: `unread:${item.question}`, label: item.question, type: item.kinds[0] || '', required: true,
          filled: !item.shared && window.__jobPilottoCoverage.answered(item.area), legal: LEGAL.test(item.question), unread: true});
      }
    }
    const open = after.filter(row => row.required && !row.filled);
    if (open.some(row => row.field === 'resume') && !resumeAttached) todo.unshift('Upload your CV');
    const armedFields = new Set(answers.filter(a => rowOf[a.field]?.type === 'combobox').map(a => a.field));
    for (const row of open.filter(r => r.field !== 'resume' && !r.legal && !armedFields.has(r.field))) {
      const title = once(rowOf[row.field]?.label || clean(row.label).replace(row.field, '')) || row.field;
      // A file is attached, never answered; a required letter slot with no letter says where to write one (no base-letter fallback without its switch).
      todo.push(row.type !== 'file' ? `Answer: ${title}` : row.field === 'cover_letter' && !resume?.coverLetterFile
        ? 'Attach a cover letter: write this job\'s letter in its preparation kit, then press Fill again' : `Attach: ${title}`);
    }
    const readable = text => clean(String(text || '').replace(/\S*(_|\[\])\S*/g, ' ')) || text;
    let consented = [];
    if (acceptConsents) {
      consented = tickConsents();
      filled += consented.length;
      for (const row of after) if (row.legal && consented.length) row.filled = row.filled || !!document.getElementById(row.field)?.checked;
    }
    const legal = [...after.filter(row => row.legal && !row.filled).map(row => `Your choice (legal): ${readable(row.label)}`),
      ...consented.map(text => `Ticked for you: ${text}`)];
    // Why (2026-10-27, owner): an optional letter is still important setup; employer requiredness must never hide the missing letter.
    const coverLetterStatus = resume?.coverLetterStatus || null;
    const letterGiven = letterFileAttached || letterBoxes().some(el => String(el.value || '').trim());
    const manualLetter = manualLetterButton();
    manualLetter?.setAttribute('data-jobpilotto-letter-manual', '1');
    manualLetter?.toggleAttribute('data-jobpilotto-letter-error', !!coverLetter && !letterGiven);
    for (const box of letterBoxes()) box.setAttribute('data-jobpilotto-letter', '1');
    for (const slot of (window.__jobPilottoUpload.slots?.() || [])) if (window.__jobPilottoUpload.meaningOf(slot, window.__jobPilottoAliases || []) === 'cover_letter') for (const el of new Set([slot.el, slot.input].filter(Boolean))) { el.setAttribute('data-jobpilotto-letter', '1'); el.toggleAttribute('data-jobpilotto-letter-error', !!(resume?.coverLetterFile && !slot.filled)); }
    if ((manualLetter || letterBoxes().length || uploads.some(item => item.meaning === 'cover_letter')) && coverLetterStatus && !coverLetterStatus.ready && !letterGiven) todo.unshift(`Important: cover letter — ${coverLetterStatus.reason} ${coverLetterStatus.action} in Jobadabra → Profile → Cover letter, then Fill again.`);
    const letterUploadFailed = resume?.coverLetterFile && uploads.some(item => item.meaning === 'cover_letter' && !item.ok);
    if (letterUploadFailed) todo.unshift('Important: cover letter upload did not keep the file. Attach the letter manually from Jobadabra, then check the form again.');
    if (coverLetter && (manualLetter && !letterGiven || letterBoxes().some(el => !String(el.value || '').trim()))) todo.unshift('Important: cover letter was available but the text box did not keep it. Paste it from Jobadabra → Profile → Cover letter, then check the form again.');
    const unfilledRequired = open.filter(row => !(row.field === 'resume' && resumeAttached) && !row.legal).length;
    // A value we put in that the person then changes by hand is a correction: the label is kept (never the value) so the product learns
    // which questions it fills wrongly. The background drains window.__jobPilottoCorrections (extension/background.js reportTabs).
    window.__jobPilottoCorrections = window.__jobPilottoCorrections || [];
    const watchCorrection = (field, label) => {
      const el = document.getElementById(field) || document.querySelector(`[name="${CSS.escape(field)}"]`);
      if (!el || !/^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName)) return;
      const once = event => {
        if (!event.isTrusted) return;
        el.removeEventListener('input', once); el.removeEventListener('change', once);
        if (window.__jobPilottoCorrections.length < 40) window.__jobPilottoCorrections.push(clean(label).slice(0, 500));
      };
      el.addEventListener('input', once); el.addEventListener('change', once);
    };
    // Every field the fill set carries a mark, so the panel tells at Submit what you answered yourself (extension/review.js).
    const markFilled = field => {
      const name = String(field);
      const els = name.startsWith('radio:') ? document.querySelectorAll(`input[type=radio][name="${CSS.escape(name.slice(6))}"]`)
        : name.startsWith('group:') ? Array.from(document.querySelectorAll('input[type=checkbox]')).filter(b => questionOf(b) === name.slice(6))
        : [document.getElementById(name) || document.querySelector(`[name="${CSS.escape(name)}"]`)];
      for (const el of els) el?.setAttribute('data-jobpilotto-filled', '');
    };
    // Field-by-field log for the run record: where each answer came from and what happened.
    const answerOf = Object.fromEntries([...answers, ...(all || []).filter(a => a.consent === true)].map(a => [a.field, a]));
    const knownKey = row => (PROFILE_LABELS.find(([, pattern]) => pattern.test(clean(row.label || ''))) || [])[0] || aliasFor(row.label || '')?.key || '';
    // Upload widgets' own buttons (Attach, Dropbox, Enter manually…) aren't questions: not in the log.
    const trace = after.filter(row => row.field !== 'resume' && !/^(attach|dropbox|google drive|enter manually)$/i.test(clean(row.label))).map(row => {
      const label = rowOf[row.field]?.label || clean(row.label).replace(row.field, '').trim() || row.field;
      const answer = answerOf[row.field];
      const source = fromCvFields.has(row.field) ? 'your CV' : contactFields.has(row.field) ? 'your details' : answer ? (answer.source || (answer.consent === true ? 'your consent setting' : 'kit')) : '';
      let outcome = row.filled ? 'filled' : 'left';
      let reason = '';
      if (row.type === 'file') { if (!row.filled) reason = 'upload: no file for this question'; }
      else if (row.type === 'password' && !row.filled) { outcome = 'left'; reason = 'password: never typed, yours to set'; }   // a safety rule (CLAUDE.md: never a password field): left for you, never "no answer"   // an upload slot that is not the CV (the CV has its own row below): counted like any required control, left unless it holds a file
      else if (row.legal && !row.filled) { outcome = 'left'; reason = 'legal/consent: always your choice'; }
      else if (row.written && !row.filled && !answer && !proposedOf[row.field]) { outcome = 'left'; reason = 'written: your own words to write'; }   // the AI's reading (category written), any language
      else if (row.demographic && !row.filled && !answer && !proposedOf[row.field]) { outcome = 'left'; reason = 'demographic: your own choice'; }   // a salutation or gender nothing given states: never guessed
      else if (row.unanswered && !row.filled && !answer && !proposedOf[row.field]) { outcome = 'left'; reason = 'the AI gave no answer'; }
      // A menu left on the page's own preselected choice that nobody answered (easytemp: Nationalité "Suisse"): the page will send it, so it reads as
      // filled, but the person must check it (browser-form-fastpath.js __jobPilottoAtPageDefault).
      else if (row.filled && !source && (el => el?.tagName === 'SELECT' && window.__jobPilottoAtPageDefault?.(el))(document.getElementById(row.field) || document.querySelector(`select[name="${CSS.escape(row.field)}"]`))) reason = 'preselected by the page: check it';
      else if (row.unread && !row.filled) reason = 'question on the page not read';
      // A two-state control (checkbox, switch, toggle) answered "no" that holds its state already: the answer is kept, nothing to type (it stays "left" for a required one: the page may still want it ticked).
      else if (!row.filled && row.type === 'checkbox' && answer && wantsUnchecked(answer.value) && boxOf(row.field)?.checked === false) { outcome = 'left'; reason = 'answered no: left unchecked'; }
      else if (!row.filled && proposedOf[row.field]) reason = 'proposed for you to confirm';
      else if (!row.filled && armedFields.has(row.field)) { outcome = 'left'; reason = 'dropdown that opens only on a real click'; }
      // The question read as one of its own choices (or nothing): the page's title wasn't found, so no answer could be right.
      else if (!row.filled && !answer && (!label || (rowOf[row.field]?.options || []).some(o => norm(o) === norm(label)))) reason = 'question text not found on the page';
      // A detail the built-in words or a pack meaning recognise, with nothing saved for it: your data to give once (cause no_data), never a
      // wording to learn (only NO_ANSWER rows are reported as such). 9 Oct 2026: "Lieu d'origine" went to the learner although its meaning was known.
      else if (!row.filled && !answer && !contactFields.has(row.field) && knownKey(row)) reason = `a detail of yours not saved yet (${knownKey(row)})`;
      else if (!row.filled && !answer && !contactFields.has(row.field)) reason = 'no answer in the kit, Profile or your details';
      else if (!row.filled) { reason = 'answer given, but the field did not take it'; window.__jobPilottoNoteNotTaken?.(row.field, answer?.value); }   // typed again for real after the fill (page/fill-verify.js)
      if (outcome === 'filled' && fromCvFields.has(row.field)) reason = 'from your CV: check it';   // not in your saved details: the CV states it (owner, 27 Oct 2026)
      if (outcome === 'filled' && answer?.draft && row.type !== 'file') reason = answer.draft === 'outline' ? 'outline: add your own details' : 'drafted: review it';   // typed, but the person has not read it yet (owner, 16 Oct 2026)
      if (outcome === 'filled' && source && row.type !== 'file') watchCorrection(row.field, label);
      if (outcome === 'filled' && source) markFilled(row.field); else window.__jobPilottoMarkProposal?.({...row, options: rowOf[row.field]?.options || row.options}, answer || proposedOf[row.field], (PROFILE_LABELS.find(([, pattern]) => pattern.test(label)) || [])[0] || aliasFor(label)?.key || '');   // page/propose.js: what the app's row proposes
      // The form's own choices (never a value): the app keeps the question's kind (desktop/lib/question-formats.js). A menu's placeholder (an option with an empty value) is not a choice.
      const menu = (el => (el?.tagName === 'SELECT' ? el : null))(document.getElementById(row.field) || document.querySelector(`select[name="${CSS.escape(row.field)}"]`));
      const choices = (menu ? Array.from(menu.options).filter(o => o.value !== '').map(o => o.text.replace(/\s+/g, ' ').trim()) : rowOf[row.field]?.options || row.options || []).filter(Boolean).slice(0, 60).map(option => String(option).slice(0, 120));
      const shown = row.type === 'file' && row.field === 'cover_letter' && outcome === 'filled' ? window.__jobPilottoLetterGiven || '' : source;   // which letter went in
      return {label: label.slice(0, TRACE_LABEL_MAX), required: !!row.required, type: rowOf[row.field]?.type || (row.type === 'file' ? 'file' : ''), source: shown, outcome, reason,
        ...(choices.length ? {options: choices} : {}), ...(rowOf[row.field]?.multiple ? {multiple: true} : {}),
        alias: (window.__jobPilottoAliasUsed || {})[row.field] || '',
        fact: (answer || proposedOf[row.field])?.fact || '', category: (answer || proposedOf[row.field])?.category || '', known: knownKey(row),   // fixed words for the fill card's meaning (fill-meaning.js)
        low: answer && answer.confidence && answer.confidence !== 'high' ? (answer.note || 'low confidence') : ''};
    });
    trace.push({label: 'CV', required: true, type: 'file', source: 'your CV', outcome: resumeAttached ? 'filled' : 'left',
      reason: resumeAttached ? '' : resume?.data ? 'no place to attach it was found on this page' : 'no CV in the app'});
    window.__jobPilottoValueClass?.mark([...contact, ...answers]);   // each answered control's kind of value, never the value: the fill check and the repair see it (page/value-class.js)
    const summary = {coverLetterStatus, reach, filled, unfilledRequired, starred: window.__jobPilottoRequired.starred(document), contact: contact.length, resumeAttached, trace, operated: window.__jobPilottoOperated || [], unknownUploads: window.__jobPilottoUnknownUploads || [], todo: [...new Set([...todo, ...review, ...legal])].slice(0, 25)};
    for (const item of answers) {
      const row = rowOf[item.field];
      if (!row || contactFields.has(item.field) || row.legal || /your details|standard answer/.test(item.source || '')) continue;
      const long = row.type === 'textarea' || String(item.value || '').length > 80;
      const unsure = item.guess || (item.confidence && item.confidence !== 'high');   // a typed guess at any confidence (worker typeGuess, 14 Oct 2026)
      if (item.draft) summary.todo.push(`${item.draft === 'outline' ? 'Complete' : 'Review'}: ${row.label} (drafted for you)`);
      if (long || unsure || item.draft) markAttention(item.field, row.label || item.question || item.field);
      if (item.draft) markDraft(item.field, item.draft);   // a written answer drafted from the person's facts: reviewed before it counts (page/fill-marks.js)
    }
    const letterBox = letterBoxes()[0];
    if (coverLetter && letterBox?.value) markAttention(letterBox.id || letterBox.name, 'Cover letter');
    summary.held = held;   // a layer the extension could not close: nothing more was typed (flow.js turns it into the held result)
    return summary;
  };
  // The page fill never throws into the extension: a control it did not expect is a page error, said with where it happened (flow.js shows it, never "moved to another tab").
  window.__jobPilottoExtensionFill = async (...args) => {
    try {
      const result = await fillPage(...args);
      // Chrome hands the extension null for a result it cannot copy (a DOM node, a function inside it): the keys that cannot go are dropped and named, the rest is kept.
      try { if (typeof structuredClone === 'function') structuredClone(result); return result; } catch {
        const lost = Object.keys(result || {}).filter(key => { try { structuredClone(result[key]); return false; } catch { return true; } });
        const kept = Object.fromEntries(Object.entries(result || {}).filter(([key]) => !lost.includes(key)));
        return {...kept, pageError: `the result held something that cannot be copied: ${lost.join(', ')}`, unclonable: lost};
      }
    } catch (error) {
      const where = String(error?.stack || '').split('\n').slice(0, 4).map(line => line.trim()).join(' | ');
      return {error: `the fill failed on this page: ${error?.message || error}`, pageError: where, filled: 0, trace: [], todo: []};
    }
  };
})();
