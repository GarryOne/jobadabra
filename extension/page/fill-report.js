// Builds value-free field traces and review marks after the page fill has been audited.
// Invariants: reason precedence and mark order are preserved; traces keep field metadata, never applicant values.
(() => {
  if (window.__jobPilottoFillReportLoaded) return;
  window.__jobPilottoFillReportLoaded = true;
  const {clean, norm, PROFILE_LABELS, aliasFor, questionOf, wantsUnchecked, boxOf, markAttention, markDraft} = window.__jobPilottoFillKit;

  // A question's wording is kept whole (owner, 17 Oct 2026: labels cut at 120 characters were saved as "…We t: Yes" and never matched the form again); the cap only guards a runaway page.
  const TRACE_LABEL_MAX = 500;

  // Watch the first trusted edit, keeping only the question label.
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
  const markFilled = (field, grounded) => {
    const name = String(field);
    const els = name.startsWith('radio:') ? document.querySelectorAll(`input[type=radio][name="${CSS.escape(name.slice(6))}"]`)
      : name.startsWith('group:') ? Array.from(document.querySelectorAll('input[type=checkbox]')).filter(b => questionOf(b) === name.slice(6))
      : [document.getElementById(name) || document.querySelector(`[name="${CSS.escape(name)}"]`)];
    for (const el of els) if (el) { el.setAttribute('data-jobpilotto-filled', ''); el.dataset.jobpilottoGrounding = grounded ? 'known' : 'unknown'; }
  };

  // Return the saved-detail key recognized for a row.
  const knownKey = row => (PROFILE_LABELS.find(([, pattern]) => pattern.test(clean(row.label || ''))) || [])[0] || aliasFor(row.label || '')?.key || '';

  // Return provenance without including an applicant value.
  const traceSource = (row, answer, contactFields, fromCvFields) => {
    return fromCvFields.has(row.field) ? 'your CV' : contactFields.has(row.field) ? 'your details' : answer ? (answer.source || (answer.consent === true ? 'your consent setting' : 'kit')) : '';
  };

  // Keep file, password, legal and AI kind reasons ahead of other explanations.
  const traceProtectedReason = (row, answer, proposedOf) => {
    let reason;
    if (row.type === 'file') { reason = ''; if (!row.filled) reason = 'upload: no file for this question'; }
    else if (row.type === 'password' && !row.filled) { reason = 'password: never typed, yours to set'; }   // a safety rule (CLAUDE.md: never a password field): left for you, never "no answer"   // an upload slot that is not the CV (the CV has its own row below): counted like any required control, left unless it holds a file
    else if (row.legal && !row.filled) { reason = 'legal/consent: always your choice'; }
    else if (row.written && !row.filled && !answer && !proposedOf[row.field]) { reason = 'written: your own words to write'; }   // the AI's reading (category written), any language
    else if (row.demographic && !row.filled && !answer && !proposedOf[row.field]) { reason = 'demographic: your own choice'; }   // a salutation or gender nothing given states: never guessed
    else if (row.unanswered && !row.filled && !answer && !proposedOf[row.field]) { reason = 'the AI gave no answer'; }
    return reason;
  };

  // Explain page defaults, unread questions and choices held for a real click.
  const traceChoiceReason = (row, answer, source, proposedOf, armedFields) => {
    let reason;
    // A menu left on the page's own preselected choice that nobody answered (easytemp: Nationalité "Suisse"): the page will send it, so it reads as
    // filled, but the person must check it (browser-form-fastpath.js __jobPilottoAtPageDefault).
    if (row.filled && !source && (el => el?.tagName === 'SELECT' && window.__jobPilottoAtPageDefault?.(el))(document.getElementById(row.field) || document.querySelector(`select[name="${CSS.escape(row.field)}"]`))) reason = 'preselected by the page: check it';
    else if (row.unread && !row.filled) reason = 'question on the page not read';
    // A two-state control (checkbox, switch, toggle) answered "no" that holds its state already: the answer is kept, nothing to type (it stays "left" for a required one: the page may still want it ticked).
    else if (!row.filled && row.type === 'checkbox' && answer && wantsUnchecked(answer.value) && boxOf(row.field)?.checked === false) { reason = 'answered no: left unchecked'; }
    else if (!row.filled && proposedOf[row.field]) reason = 'proposed for you to confirm';
    else if (!row.filled && armedFields.has(row.field)) { reason = 'dropdown that opens only on a real click'; }
    return reason;
  };

  // Explain missing questions or saved facts before reporting a rejected answer.
  const traceMissingReason = (row, answer, label, rowOf, contactFields) => {
    let reason;
    // The question read as one of its own choices (or nothing): the page's title wasn't found, so no answer could be right.
    if (!row.filled && !answer && (!label || (rowOf[row.field]?.options || []).some(o => norm(o) === norm(label)))) reason = 'question text not found on the page';
    // A detail the built-in words or a pack meaning recognise, with nothing saved for it: your data to give once (cause no_data), never a
    // wording to learn (only NO_ANSWER rows are reported as such). 9 Oct 2026: "Lieu d'origine" went to the learner although its meaning was known.
    else if (!row.filled && !answer && !contactFields.has(row.field) && knownKey(row)) reason = `a detail of yours not saved yet (${knownKey(row)})`;
    else if (!row.filled && !answer && !contactFields.has(row.field)) reason = 'no answer in the kit, Profile or your details';
    else if (!row.filled) { reason = 'answer given, but the field did not take it'; window.__jobPilottoNoteNotTaken?.(row.field, answer?.value); }   // typed again for real after the fill (page/fill-verify.js)
    return reason;
  };

  // Choose the first applicable trace reason in the existing safety order.
  const traceReason = (row, answer, label, source, context) => {
    const {proposedOf, armedFields, rowOf, contactFields} = context;
    let reason = traceProtectedReason(row, answer, proposedOf);
    if (reason !== undefined) return reason;
    reason = traceChoiceReason(row, answer, source, proposedOf, armedFields);
    if (reason !== undefined) return reason;
    return traceMissingReason(row, answer, label, rowOf, contactFields) ?? '';
  };

  // Determine grounding from saved details or the answer evidence.
  const traceGrounded = (row, answer, source, contactFields, fromCvFields) => {
    return contactFields.has(row.field) || fromCvFields.has(row.field) || !!answer && !answer.guess && !answer.draft && (!answer.confidence || answer.confidence === 'high') && (!!answer.fact && answer.fact !== 'none' || /your details|standard answer/.test(source));
  };

  // Mark filled provenance or a proposal after registering correction watching.
  const markTraceRow = (row, answer, label, source, outcome, context) => {
    const {contactFields, fromCvFields, rowOf, proposedOf} = context;
    if (outcome === 'filled' && source && row.type !== 'file') watchCorrection(row.field, label);
    const grounded = traceGrounded(row, answer, source, contactFields, fromCvFields);
    if (outcome === 'filled' && source) markFilled(row.field, grounded); else window.__jobPilottoMarkProposal?.({...row, options: rowOf[row.field]?.options || row.options}, answer || proposedOf[row.field], (PROFILE_LABELS.find(([, pattern]) => pattern.test(label)) || [])[0] || aliasFor(label)?.key || '');   // page/propose.js: what the app's row proposes
  };

  // Return the form choices, excluding empty placeholders and applicant values.
  const traceChoices = (row, rowOf) => {
    // The form's own choices (never a value): the app keeps the question's kind (desktop/lib/question-formats.js). A menu's placeholder (an option with an empty value) is not a choice.
    const menu = (el => (el?.tagName === 'SELECT' ? el : null))(document.getElementById(row.field) || document.querySelector(`select[name="${CSS.escape(row.field)}"]`));
    const choices = (menu ? Array.from(menu.options).filter(o => o.value !== '').map(o => o.text.replace(/\s+/g, ' ').trim()) : rowOf[row.field]?.options || row.options || []).filter(Boolean).slice(0, 60).map(option => String(option).slice(0, 120));
    return choices;
  };

  // Return one audited field record after applying reason and mark precedence.
  const traceRow = (row, context) => {
    const {rowOf, answerOf, fromCvFields, contactFields, proposedOf} = context;
    const label = rowOf[row.field]?.label || clean(row.label).replace(row.field, '').trim() || row.field;
    const answer = answerOf[row.field];
    const source = traceSource(row, answer, contactFields, fromCvFields);
    const outcome = row.filled ? 'filled' : 'left';
    let reason = traceReason(row, answer, label, source, context);
    if (outcome === 'filled' && fromCvFields.has(row.field)) reason = 'from your CV: check it';   // not in your saved details: the CV states it (owner, 27 Oct 2026)
    if (outcome === 'filled' && answer?.draft && row.type !== 'file') reason = answer.draft === 'outline' ? 'outline: add your own details' : 'drafted: review it';   // typed, but the person has not read it yet (owner, 16 Oct 2026)
    markTraceRow(row, answer, label, source, outcome, context);
    const choices = traceChoices(row, rowOf);
    const shown = row.type === 'file' && row.field === 'cover_letter' && outcome === 'filled' ? window.__jobPilottoLetterGiven || '' : source;   // which letter went in
    return {label: label.slice(0, TRACE_LABEL_MAX), required: !!row.required, type: rowOf[row.field]?.type || (row.type === 'file' ? 'file' : ''), source: shown, outcome, reason,
      ...(choices.length ? {options: choices} : {}), ...(rowOf[row.field]?.multiple ? {multiple: true} : {}),
      alias: (window.__jobPilottoAliasUsed || {})[row.field] || '',
      fact: (answer || proposedOf[row.field])?.fact || '', category: (answer || proposedOf[row.field])?.category || '', known: knownKey(row),   // fixed words for the fill card's meaning (fill-meaning.js)
      low: answer && answer.confidence && answer.confidence !== 'high' ? (answer.note || 'low confidence') : ''};
  };

  // Build the field trace and append the CV result without applicant values.
  const buildTrace = (after, all, answers, context, resumeAttached, resume) => {
    // A value we put in that the person then changes by hand is a correction: the label is kept (never the value) so the product learns
    // which questions it fills wrongly. The background drains window.__jobPilottoCorrections (extension/background.js reportTabs).
    window.__jobPilottoCorrections = window.__jobPilottoCorrections || [];
    // Field-by-field log for the run record: where each answer came from and what happened.
    const answerOf = Object.fromEntries([...answers, ...(all || []).filter(a => a.consent === true)].map(a => [a.field, a]));
    const traceContext = {...context, answerOf};
    // Upload widgets' own buttons (Attach, Dropbox, Enter manually…) aren't questions: not in the log.
    const trace = after.filter(row => row.field !== 'resume' && !/^(attach|dropbox|google drive|enter manually)$/i.test(clean(row.label))).map(row => traceRow(row, traceContext));
    trace.push({label: 'CV', required: true, type: 'file', source: 'your CV', outcome: resumeAttached ? 'filled' : 'left',
      reason: resumeAttached ? '' : resume?.data ? 'no place to attach it was found on this page' : 'no CV in the app'});
    return trace;
  };

  // Mark a drafted or uncertain answer and append its review action.
  const markReviewAnswer = (item, row, summary) => {
    const long = row.type === 'textarea' || String(item.value || '').length > 80;
    const grounded = document.getElementById(item.field) || document.querySelector(`[name="${CSS.escape(item.field)}"]`);
    if (grounded && (item.guess || item.fact === 'none' || item.confidence && item.confidence !== 'high')) grounded.dataset.jobpilottoGrounding = 'unknown';
    const unsure = item.guess || (item.confidence && item.confidence !== 'high');   // a typed guess at any confidence (worker typeGuess, 14 Oct 2026)
    if (item.draft) summary.todo.push(`${item.draft === 'outline' ? 'Complete' : 'Review'}: ${row.label} (drafted for you)`);
    if (long || unsure || item.draft) markAttention(item.field, row.label || item.question || item.field);
    if (item.draft) markDraft(item.field, item.draft);   // a written answer drafted from the person's facts: reviewed before it counts (page/fill-marks.js)
  };

  // Apply final review marks in answer order after the summary is built.
  const markReviewAnswers = (answers, rowOf, contactFields, summary) => {
    for (const item of answers) {
      const row = rowOf[item.field];
      if (!row || contactFields.has(item.field) || row.legal || /your details|standard answer/.test(item.source || '')) continue;
      markReviewAnswer(item, row, summary);
    }
  };

  Object.assign(window.__jobPilottoFillKit, {buildTrace, markReviewAnswers});
})();
