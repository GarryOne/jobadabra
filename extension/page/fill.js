// Runs in the application page (main world) after browser-submit-guard.js and browser-form-fastpath.js.
// Describes the form (labels, types, options; never your values), fills answers of every field type,
// attaches the CV, and shows what is left in a panel on the page. It never clicks Submit; consent
// controls require the saved authorization and an explicit validated AI agreement reading.
// Its helpers come first, each a concern of its own (FILL_FILES in extension/page-files.js): fill-labels.js (names, LEGAL), fill-read.js (the
// reader), fill-menus.js (dropdowns), fill-checks.js (checkboxes, consents), fill-marks.js (the AI glow), shared through window.__jobPilottoFillKit.
(() => {
  if (window.__jobPilottoFillLoaded) return;
  window.__jobPilottoFillLoaded = true;
  const {LEGAL, clean, norm, once, sleep, visible, labelOf, questionOf, radioOps, tickConsents, fillConsentChoices, markAttention,
    prepareAnswers, describePlan, planContact, planPlain, markContact, rearmLostText, fillAnswerChoices, armDemographics, armPhoneCountry, armProfileMenus,
    buildTrace, markReviewAnswers} = window.__jobPilottoFillKit;

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

  // Run generic control operators sequentially and record their fingerprints.
  const fillControls = async (answers, todo) => {
    let filled = 0;
    // Controls the form reader above does not set (pressable Yes/No groups, custom dropdowns, date pickers): the generic
    // operators (page/controls.js) get the same answers, act only on a control an answer was matched to, and verify each.
    const operated = await window.__jobPilottoControls.fill(answers, {skip: question => LEGAL.test(question)}).catch(() => []);
    for (const result of operated) {
      if (result.unmatched) continue;   // a control no answer fit: only counted for learning (page/controls.js), no row to the person
      if (result.ok) filled += 1; else todo.push(`Pick "${result.value}" for: ${result.question}${result.why ? ` (${result.why})` : ''}`);
    }
    // Which kind of control and fingerprint worked or not: no question, no answer.
    window.__jobPilottoOperatedQuestions = operated.filter(result => !result.unmatched).map(result => result.question);
    window.__jobPilottoOperated = operated.map(({kind, fp, recipe, ok, why}) => ({kind, fp, recipe: recipe || 0, ok, why: why || ''}));
    return filled;
  };

  // Keep attachment evidence and upload fingerprints for this and later passes.
  const recordUploads = (uploads, resume) => {
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
    return {given, resumeAttached, letterFileAttached};
  };

  // Collapse native radio options into their described question row.
  const auditRadio = (row, rowOf, seenGroups) => {
    // The audit lists each radio option on its own: one row per group instead, named and required as the form described it.
    const el = document.getElementById(row.field) || document.querySelector(`input[type=radio][name="${CSS.escape(row.field)}"]`);
    if (!el?.name) return [row];
    const key = `radio:${el.name}`;
    if (seenGroups.has(key)) return [];
    seenGroups.add(key);
    const radios = Array.from(document.querySelectorAll(`input[type=radio][name="${CSS.escape(el.name)}"]`));
    return [{...row, field: key, label: rowOf[key]?.label || questionOf(el) || row.label, filled: radios.some(r => r.checked),
      required: row.required || !!rowOf[key]?.required}];
  };

  // Collapse checkbox options while keeping a single checkbox question label.
  const auditCheckbox = (row, groupOf, seenGroups) => {
    const q = row.type === 'checkbox' && groupOf.get(row.field);
    if (!q) return [row];
    const boxes = Array.from(document.querySelectorAll('input[type=checkbox]')).filter(b => questionOf(b) === q);
    if (boxes.length < 2) return [{...row, label: q}];
    if (seenGroups.has(q)) return [];
    seenGroups.add(q);
    return [{...row, field: `group:${q}`, label: q, filled: boxes.some(b => b.checked), required: boxes.some(b => b.required) || row.required}];
  };

  // Audit visible fields and preserve the reader category decisions.
  const auditFields = (form, rowOf) => {
    // One row per checkbox group (not per option); legal boxes named by their question, not their id.
    const groupOf = new Map();
    for (const b of document.querySelectorAll('input[type=checkbox]')) {
      const q = questionOf(b);
      if (q) groupOf.set(b.id || b.name, q);
    }
    const seenGroups = new Set();
    const after = window.__jobPilottoAuditVisibleFields().flatMap(row => row.type === 'radio'
      ? auditRadio(row, rowOf, seenGroups) : auditCheckbox(row, groupOf, seenGroups));
    // Required questions the page shows that nothing above read (page/coverage.js): a layout the reader doesn't know. Each is
    // listed for you, counted as required, and traced as a reading failure, so it is reported (with its HTML) and learned.
    after.push(...radioOps.ariaRows(form));   // not in the audit (no <input>): listed, and counted when picked
    // Legal is decided once, by the form reader (and the AI's reading of it): the audit has its own word floor, and a row it missed must not fall to
    // "no answer" (11 Oct 2026, Datadog: an attestation the reader marked legal, so never asked, was traced as "no answer in the kit").
    for (const row of after) if (rowOf[row.field]?.legal) row.legal = true;
    for (const row of after) for (const kind of ['written', 'demographic', 'unanswered']) if (rowOf[row.field]?.[kind]) row[kind] = true;
    return after;
  };

  // Append required unread questions and mark their page areas.
  const addUnreadQuestions = (after, form, uploads, given) => {
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
  };

  // List required answers and attachment tasks, excluding armed and legal questions.
  const addOpenTasks = (after, resumeAttached, answers, rowOf, resume, todo) => {
    const open = after.filter(row => row.required && !row.filled);
    if (open.some(row => row.field === 'resume') && !resumeAttached) todo.unshift('Upload your CV');
    const armedFields = new Set(answers.filter(a => rowOf[a.field]?.type === 'combobox').map(a => a.field));
    for (const row of open.filter(r => r.field !== 'resume' && !r.legal && !armedFields.has(r.field))) {
      const title = once(rowOf[row.field]?.label || clean(row.label).replace(row.field, '')) || row.field;
      // A file is attached, never answered; a required letter slot with no letter says where to write one (no base-letter fallback without its switch).
      todo.push(row.type !== 'file' ? `Answer: ${title}` : row.field === 'cover_letter' && !resume?.coverLetterFile
        ? 'Attach a cover letter: write this job\'s letter in its preparation kit, then press Fill again' : `Attach: ${title}`);
    }
    return armedFields;
  };

  // Tick authorized agreement checkboxes and update the audited legal rows.
  const acceptCheckboxConsents = (after) => {
    const consented = tickConsents();
    for (const row of after) if (row.legal && consented.length) row.filled = row.filled || !!document.getElementById(row.field)?.checked;
    return consented;
  };

  // Return legal choices and the labels of agreements ticked with authorization.
  const legalTasks = (after, consented) => {
    const readable = text => clean(String(text || '').replace(/\S*(_|\[\])\S*/g, ' ')) || text;
    const legal = [...after.filter(row => row.legal && !row.filled).map(row => `Your choice (legal): ${readable(row.label)}`),
      ...consented.map(text => `Ticked for you: ${text}`)];
    return legal;
  };

  // Mark letter upload slots and delivery failures without changing their contents.
  const markLetterSlots = (resume) => {
    for (const slot of (window.__jobPilottoUpload.slots?.() || [])) if (window.__jobPilottoUpload.meaningOf(slot, window.__jobPilottoAliases || []) === 'cover_letter') for (const el of new Set([slot.el, slot.input].filter(Boolean))) { el.setAttribute('data-jobpilotto-letter', '1'); el.toggleAttribute('data-jobpilotto-letter-error', !!(resume?.coverLetterFile && !slot.filled)); }
  };

  // Prepend missing or failed letter messages in their original priority order.
  const letterProblems = (resume, coverLetter, uploads, coverLetterStatus, manualLetter, letterGiven, todo) => {
    if ((manualLetter || letterBoxes().length || uploads.some(item => item.meaning === 'cover_letter')) && coverLetterStatus && !coverLetterStatus.ready && !letterGiven) todo.unshift(`Important: cover letter — ${coverLetterStatus.reason} ${coverLetterStatus.action} in Jobadabra → Profile → Cover letter, then Fill again.`);
    const letterUploadFailed = resume?.coverLetterFile && uploads.some(item => item.meaning === 'cover_letter' && !item.ok);
    if (letterUploadFailed) todo.unshift('Important: cover letter upload did not keep the file. Attach the letter manually from Jobadabra, then check the form again.');
    if (coverLetter && (manualLetter && !letterGiven || letterBoxes().some(el => !String(el.value || '').trim()))) todo.unshift('Important: cover letter was available but the text box did not keep it. Paste it from Jobadabra → Profile → Cover letter, then check the form again.');
  };

  // Mark letter surfaces and report optional letter readiness after consents.
  const checkCoverLetter = (resume, coverLetter, uploads, letterFileAttached, todo) => {
    // Why (2026-10-27, owner): an optional letter is still important setup; employer requiredness must never hide the missing letter.
    const coverLetterStatus = resume?.coverLetterStatus || null;
    const letterGiven = letterFileAttached || letterBoxes().some(el => String(el.value || '').trim());
    const manualLetter = manualLetterButton();
    manualLetter?.setAttribute('data-jobpilotto-letter-manual', '1');
    manualLetter?.toggleAttribute('data-jobpilotto-letter-error', !!coverLetter && !letterGiven);
    for (const box of letterBoxes()) box.setAttribute('data-jobpilotto-letter', '1');
    markLetterSlots(resume);
    letterProblems(resume, coverLetter, uploads, coverLetterStatus, manualLetter, letterGiven, todo);
    return coverLetterStatus;
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
    const answers = prepareAnswers(all);
    const {form, rowOf, reach, proposedOf} = await describePlan(all, answers);
    const {contact, contactFields, fromCvFields} = planContact(answers, form, profile);
    const todo = [], review = [], armed = []; document.querySelectorAll('.job-pilotto-badge').forEach(badge => badge.remove());
    const consentChoices = await gate() ? fillConsentChoices(all, form, acceptConsents) : {filled: [], armed: []};
    armed.push(...consentChoices.armed.map(field => rowOf[field]?.label || field));
    let filled = consentChoices.filled.length;
    const plain = planPlain(answers, rowOf, contactFields);
    const typed = window.__jobPilottoFillKnownFields([...contact, ...plain]);
    filled += (typed.filled || []).length;
    markContact(contact, typed, rowOf, review);
    filled = await rearmLostText(contact, plain, typed, rowOf, armed, filled);
    filled += fillAnswerChoices(answers, rowOf, armed, todo, review);
    const answered = new Set(answers.map(a => a.field));
    armDemographics(form, answers, answered, armed);
    armPhoneCountry(form, profile, answers, answered, armed);
    armProfileMenus(form, profile, answers, answered, armed);
    if (armed.length) todo.unshift(`Click the ${armed.length} highlighted dropdown(s); each picks its answer when opened`);
    if (window.__jobPilottoControls && await gate()) filled += await fillControls(answers, todo);
    // The files (page/upload.js): each upload slot is operated by what it asks for; a miss is reported by fingerprint like any control's.
    const uploads = !(await gate()) ? [] : await window.__jobPilottoUpload.fill({resume: resume?.data ? resume : null, coverLetter: resume?.coverLetterFile || null}).catch(() => []);
    const {given, resumeAttached, letterFileAttached} = recordUploads(uploads, resume);
    if (letterFileAttached) filled += 1;
    await gate();   // after the upload's own waits: a layer the page opened meanwhile
    if (coverLetter && !held && await fillCoverLetter(coverLetter)) filled += 1;
    await sleep(300);
    const after = auditFields(form, rowOf);
    addUnreadQuestions(after, form, uploads, given);
    const armedFields = addOpenTasks(after, resumeAttached, answers, rowOf, resume, todo);
    let consented = [];
    if (acceptConsents) {
      consented = acceptCheckboxConsents(after);
      filled += consented.length;
    }
    const legal = legalTasks(after, consented);
    const coverLetterStatus = checkCoverLetter(resume, coverLetter, uploads, letterFileAttached, todo);
    const unfilledRequired = after.filter(row => row.required && !row.filled && !(row.field === 'resume' && resumeAttached)).length;
    const trace = buildTrace(after, all, answers, {rowOf, fromCvFields, contactFields, proposedOf, armedFields}, resumeAttached, resume);
    window.__jobPilottoValueClass?.mark([...contact, ...answers]);   // each answered control's kind of value, never the value: the fill check and the repair see it (page/value-class.js)
    const summary = {coverLetterStatus, reach, filled, unfilledRequired, starred: window.__jobPilottoRequired.starred(document), contact: contact.length, resumeAttached, trace, operated: window.__jobPilottoOperated || [], unknownUploads: window.__jobPilottoUnknownUploads || [], todo: [...new Set([...todo, ...review, ...legal])].slice(0, 25)};
    markReviewAnswers(answers, rowOf, contactFields, summary);
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
