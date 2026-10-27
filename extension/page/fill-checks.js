// The form filler's checkboxes (split from page/fill.js, 9 Oct 2026): one box set to yes/no, the option of a checkbox group that is one
// question, and the consents ticked only when you allowed it (never otherwise: the LEGAL floor). Needs page/fill-labels.js first.
// Guarded by desktop/test/fill-categories.test.js.
(() => {
  if (window.__jobPilottoFillChecksLoaded) return;
  window.__jobPilottoFillChecksLoaded = true;
  const {LEGAL, clean, norm, visible, labelOf, questionOf} = window.__jobPilottoFillKit;

  // A group of checkboxes that is one question ("How did you hear about us?": LinkedIn / Careers website / …): tick the option whose label best matches the answer (exact, then contained either way, then shared words).
  const pickCheckboxOption = (question, answer) => {
    const boxes = Array.from(document.querySelectorAll('input[type=checkbox]')).filter(b => questionOf(b) === question);
    if (!boxes.length || LEGAL.test(question)) return null;
    const want = norm(answer), words = want.split(/\W+/).filter(w => w.length > 3);
    const score = b => { const l = norm(labelOf(b)); return l === want ? 3 : (l.includes(want) || want.includes(l)) ? 2 : words.some(w => l.includes(w)) ? 1 : 0; };
    const best = boxes.reduce((a, b) => (score(b) > score(a) ? b : a), boxes[0]);
    if (!score(best)) return false;
    if (!best.checked) (globalThis.__jobPilottoPress?.(best) || best.click());
    return best.checked;
  };

  // The fixed answer of a two-state control is "checked" or "unchecked" (worker/src/extension.js); yes/true and no/false are the same two, spelled the other way.
  // Anything else (empty, another language) is neither: it is never read as "no".
  const wantsChecked = answer => /^(checked|yes|true)$/i.test(answer);
  const wantsUnchecked = answer => /^(unchecked|no|false)$/i.test(answer);
  const boxOf = field => document.getElementById(field) || document.querySelector(`input[type=checkbox][name="${CSS.escape(field)}"]`);
  const setCheckbox = (field, answer) => {
    const box = boxOf(field);
    if (!box || LEGAL.test(`${questionOf(box)} ${labelOf(box)}`)) return false;
    const want = wantsChecked(answer);
    if (box.checked !== want) (globalThis.__jobPilottoPress?.(box) || box.click());
    return box.checked === want;
  };

  // Tick every visible terms/privacy/consent box and hand Submit to the user (the extension never submits).
  const ATTESTS = /\b(certif\w*|affirm\w*|attest\w*|declare|under penalty|perjury)\b/i;   // words-ok: a safety floor that only removes a box from ticking, never decides one
  const tickConsents = () => {
    window.__jobPilottoHandOver?.();
    const ticked = [];
    for (const box of document.querySelectorAll('input[type=checkbox]')) {
      const text = `${questionOf(box)} ${labelOf(box)}`;
      // Sites often hide the real checkbox behind a drawn one: then its label is what's on screen.
      const label = box.labels?.[0] || box.closest('label');
      // The AI's reading of the box decides (any language, page/categories.js marks it): "legal" is a consent or data notice; any other kind (a knockout, a
      // demographic question) is the person's choice. An unread or rejected control stays for the person. A statement of fact about the
      // person (certify, affirm, attest) is never ticked either way: a floor that only removes.
      const consent = box.dataset?.jobpilottoCategory === 'legal' && box.dataset?.jobpilottoConsentReading === 'agreement';
      if (box.checked || !consent || ATTESTS.test(text) || !(visible(box) || (label && visible(label)))) continue;
      (globalThis.__jobPilottoPress?.((visible(box) ? box : label)) || (visible(box) ? box : label).click());
      if (!box.checked && label && visible(box)) (globalThis.__jobPilottoPress?.(label) || label.click());
      if (box.checked) ticked.push(clean(String(questionOf(box) || labelOf(box)).replace(/\S*(_|\[\])\S*/g, ' ')).slice(0, 90));
    }
    return ticked;
  };
  // Consent choices use the same saved authorization as tickConsents. Meaning comes only from the validated AI kind, never option count or words.
  const fillConsentChoices = (all, form, enabled) => {
    const result = {filled: [], armed: []};
    for (const control of document.querySelectorAll('[data-jobpilotto-consent]')) if (!enabled) control.__jobPilottoDisarm?.();
    if (!enabled) return result;
    for (const item of all || []) {
      const row = form.find(row => row.field === item.field);
      if (!row || row.filled || item.category !== 'legal' || item.use !== 'kind' || item.consent !== true || !item.value || ATTESTS.test(row.label || '') || row.multiple) continue;
      const el = document.getElementById(item.field) || document.querySelector(`[name="${CSS.escape(item.field)}"]`);
      if (!el || !visible(el) || el.disabled || el.getAttribute('aria-disabled') === 'true') continue;
      if (row.type === 'combobox' || row.custom) {
        if (window.__jobPilottoFillKit.armCombo(item.field, 'Accept this privacy notice or application terms', {consent: true})) result.armed.push(row.field);
      } else if (row.type === 'select' && el.tagName === 'SELECT') {
        const choices = Array.from(el.options).filter(option => option.text.trim() === item.value && option.value !== '' && !option.disabled && !option.hidden);
        if (choices.length !== 1) continue;
        window.__jobPilottoHandOver?.();
        Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value').set.call(el, choices[0].value);
        el.dispatchEvent(new Event('input', {bubbles: true})); el.dispatchEvent(new Event('change', {bubbles: true}));
        el.setAttribute('data-jobpilotto-picked', item.value.toLowerCase().replace(/[^\p{L}\p{N}]/gu, ''));
        if (window.__jobPilottoReadBack?.holds(el)) result.filled.push(row.field);
      }
    }
    return result;
  };
  Object.assign(window.__jobPilottoFillKit, {pickCheckboxOption, setCheckbox, wantsChecked, wantsUnchecked, boxOf, tickConsents, fillConsentChoices});
})();
