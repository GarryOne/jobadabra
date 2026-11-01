// The fill ladder's value class (spec docs/superpowers/specs/2026-10-12-fill-ladder.md, amendment 3; the owner's case c, 12 Oct 2026: "+41" pushed into a Country dropdown): the KIND
// of value the fill gave a control, from a fixed list, computed here on the person's computer from the fill's own answer, so the fill check and the repair question
// (desktop/lib/ladder/fill-verify.js, fill-repair.js) can see that a calling code went into a country menu without ever seeing the value. Shapes only, no word list: calling codes
// and country names come from the dial-code table (page/dial-codes.js) named by the browser itself (Intl.DisplayNames, in the page's language and English).
// The fill marks each answered control with its class (data-jobpilotto-class, page/fill.js); the judges' sketch reads that mark (extension/account-fill.js).
// The list is the desktop's VALUE_CLASSES too (desktop/lib/ladder/fill-repair.js; desktop/test/fill-repair.test.js fails when they differ). Guard: app-core/test/value-class.test.js.
(() => {
  if (window.__jobPilottoValueClass) return;
  const CLASSES = ['dial_code', 'country_name', 'email_shaped', 'phone', 'date', 'number', 'url', 'free_text', 'none'];
  const fold = window.__jobPilottoFold;   // page/fold-text.js, loaded first
  let countries = null;
  // Every country name of the dial-code table's regions, in the page's language and in English (built once, on first use).
  const countryNames = () => {
    if (countries) return countries;
    countries = new Set();
    const regions = Object.values(window.__jobPilottoDialRegion || {});
    for (const lang of [...new Set([document.documentElement?.lang?.split('-')[0], 'en'].filter(Boolean))]) {
      let names = null;
      try { names = new Intl.DisplayNames([lang], {type: 'region'}); } catch { continue; }
      for (const region of regions) { const name = fold(names.of(region)); if (name && name !== fold(region)) countries.add(name); }
    }
    return countries;
  };
  const digits = text => (String(text).match(/\d/g) || []).length;
  // A date in the writings forms ask for: 2026-11-02, 02.11.2026, 02/11/2026, 11-02-2026 (day and month in range).
  const DATE = [/^(\d{4})[-./](\d{1,2})[-./](\d{1,2})$/, /^(\d{1,2})[-./](\d{1,2})[-./](\d{4})$/];
  const isDate = text => DATE.some((shape, i) => {
    const found = text.match(shape);
    if (!found) return false;
    const [a, b] = i === 0 ? [Number(found[2]), Number(found[3])] : [Number(found[1]), Number(found[2])];
    return a >= 1 && b >= 1 && Math.min(a, b) <= 12 && Math.max(a, b) <= 31;
  });
  // value (the fill's answer) -> one of CLASSES.
  const of = value => {
    const text = String(value ?? '').trim();
    if (!text) return 'none';
    const code = text.replace(/^00(?=\d)/, '+').replace(/\s/g, '');
    if (/^\+\d{1,4}$/.test(code) && (window.__jobPilottoDialRegion || {})[code]) return 'dial_code';
    if (/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(text)) return 'email_shaped';
    if (/^(https?:\/\/|www\.)\S+$/i.test(text) || /^[\p{L}\p{N}-]+(\.[\p{L}\p{N}-]+)+\/\S*$/u.test(text)) return 'url';
    if (isDate(text)) return 'date';
    if (/^[+(]?[\d\s().\-/]+$/.test(text) && digits(text) >= 6 && digits(text) <= 15 && !/^-?\d+([.,]\d+)?$/.test(text)) return 'phone';
    if (/^-?\d+([.,]\d+)?$/.test(text)) return digits(text) >= 9 && !/[.,]/.test(text) ? 'phone' : 'number';
    if (countryNames().has(fold(text))) return 'country_name';
    return 'free_text';
  };
  const answerOf = new WeakMap();   // control -> the fill's own answer, kept in the page only: the repair asks for the option that fits it, never for the value
  // The fill's answers ([{field, value}]) -> each answered control marked with its class (a radio or checkbox group is a choice, not a typed value: not marked).
  const mark = answers => {
    for (const item of answers || []) {
      const field = String(item?.field || '');
      if (!field || /^(radio|group):/.test(field)) continue;
      const el = document.getElementById(field) || document.querySelector(`[name="${CSS.escape(field)}"]`);
      if (!el || !el.matches('input, select, textarea') || ['checkbox', 'radio', 'file', 'password'].includes(el.type)) continue;
      el.setAttribute('data-jobpilotto-class', of(item.value));
      answerOf.set(el, String(item.value ?? ''));
    }
  };
  const words = text => fold(text).split(/[^\p{L}\p{N}]+/u).filter(Boolean);
  // Does an option's text show the answer in another writing? A calling code: its own digits after a plus ("Switzerland (+41)"), or its country by the dial-code table
  // ("Switzerland"); anything else: all the answer's words are the option's words ("Switzerland" in "Switzerland (CH)"). Never a different answer.
  const fits = (answer, text) => {
    if (!words(answer).length || !words(text).length) return false;
    const has = (want, got) => want.length > 0 && want.every(word => got.includes(word));
    if (of(answer) === 'dial_code') {
      const code = String(answer).trim().replace(/^00(?=\d)/, '+').replace(/\s/g, '');
      return new RegExp(`\\+${code.slice(1)}(?!\\d)`).test(String(text)) || has(words(window.__jobPilottoDial?.[code] || ''), words(text));
    }
    // A bare calling code the option shows (a phone country picker's chip: a flag and "+41") is the country the dial-code table names for it.
    const shown = String(text).trim().replace(/\s/g, '');
    if (/^\+\d{1,4}$/.test(shown)) return has(words(answer), words(window.__jobPilottoDial?.[shown] || ''));
    return has(words(answer), words(text));
  };
  // The option of this menu (a native select) that shows the fill's own answer: number (1-based among its listed options, as the judges' sketch numbers them) names one to check, 0 asks
  // for the one that fits. -> the option, or null when none fits or more than one does (never guessed).
  const optionFor = (el, number = 0) => {
    const answer = answerOf.get(el);
    if (!answer || el?.tagName !== 'SELECT') return null;
    const listed = [...el.options].filter(option => option.text.trim()), pool = number ? [listed[number - 1]].filter(Boolean) : listed;   // numbered as the sketch lists them (extension/account-fill.js)
    const found = pool.filter(option => !option.disabled && fits(answer, option.text));
    return found.length === 1 ? found[0] : null;
  };
  window.__jobPilottoValueClass = {CLASSES, of, mark, fits, optionFor, answer: el => answerOf.get(el) ?? null};   // answer: for the page's own repair (page/repair-act.js), never sent anywhere
})();
