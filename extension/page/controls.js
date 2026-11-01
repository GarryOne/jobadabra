// Generic operators: one small, verified way to read and set each kind of control, found by what it does and not by which
// site draws it (docs: Notion "Self-improving form filling", step 2). Each operator finds its target, sets it the way a person
// would (a click, typing), re-reads it, and says whether it worked. They only touch the control an answer was matched to,
// never a Submit button and never a consent box. Loaded in the page before fill.js; also loaded by the tests (module.exports).
(() => {
  const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
  const clean = text => String(text || '').replace(/\s+/g, ' ').replace(/\s*\*+\s*$/, '').trim();
  const norm = text => (window.__jobadabraFold ? window.__jobadabraFold(clean(text)) : clean(text).toLowerCase()).replace(/[^\p{L}\p{N}]+/gu, ' ').trim();   // accents ignored (page/fold-text.js)

  // ---- answers -> what a control can take ----
  const YES = new Set(['yes', 'y', 'true', 'ja', 'oui', 'si', 'sim', 'da']);
  const NO = new Set(['no', 'n', 'false', 'nein', 'non', 'nao', 'nu']);
  // 'yes' | 'no' | '' for an answer written many ways ("Yes, I am", "No.").
  function yesNo(value) {
    const first = norm(value).split(' ')[0];
    return YES.has(first) ? 'yes' : NO.has(first) ? 'no' : '';
  }
  const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];
  // A date written as yyyy-mm-dd, dd.mm.yyyy, dd/mm/yyyy or "1 Nov 2026" -> {y, m, d}, else null. A slash date is day first:
  // the people and forms this serves write dd/mm; a month above 12 settles it the other way.
  function parseDate(text) {
    const t = String(text || '').trim();
    let m = /^(\d{4})-(\d{1,2})-(\d{1,2})/.exec(t);
    if (m) return valid({y: +m[1], m: +m[2], d: +m[3]});
    m = /^(\d{1,2})[./](\d{1,2})[./](\d{4})$/.exec(t);
    if (m) return +m[2] > 12 && +m[1] <= 12 ? valid({y: +m[3], m: +m[1], d: +m[2]}) : valid({y: +m[3], m: +m[2], d: +m[1]});
    m = /^(\d{1,2})\s+([A-Za-z]{3})[a-z]*\.?,?\s+(\d{4})$/.exec(t);
    if (m && MONTHS.includes(m[2].toLowerCase())) return valid({y: +m[3], m: MONTHS.indexOf(m[2].toLowerCase()) + 1, d: +m[1]});
    return null;
  }
  function valid(date) {
    return date.m >= 1 && date.m <= 12 && date.d >= 1 && date.d <= 31 && date.y >= 1900 && date.y <= 2100 ? date : null;
  }
  const two = n => String(n).padStart(2, '0');
  // How this field wants the date: from its type, or its placeholder (dd.mm.yyyy, mm/dd/yyyy, yyyy-mm-dd); else month first
  // (the US-style pickers that say only "Pick date...").
  function formatDate(date, input, params = {}) {
    if (input.type === 'date') return `${date.y}-${two(date.m)}-${two(date.d)}`;
    const hint = String(input.placeholder || '').toLowerCase();
    const sep = params.sep || (/[dmy]{2,4}([^a-z\s])[dmy]{2,4}/.exec(hint) || [])[1] || '/';   // the separator between format letters, not a trailing "..."
    const order = params.order || (hint.indexOf('yyyy') === 0 ? 'ymd'
      : hint.indexOf('dd') >= 0 && hint.indexOf('mm') >= 0 ? (hint.indexOf('dd') < hint.indexOf('mm') ? 'dmy' : 'mdy') : 'mdy');
    const parts = {d: two(date.d), m: two(date.m), y: String(date.y)};
    return order.split('').map(letter => parts[letter]).join(sep);
  }

  // ---- finding the question a control answers ----
  // Its own accessible name, else the nearest title before it that no other control owns (page/label-before.js: one rule for every group and unlabelled control).
  function titleOf(el) {
    return clean((window.__jobadabraGroupTitle ? window.__jobadabraGroupTitle(el)?.text : '') || '');
  }
  // The ids a page may give the control: its own and its hidden input's, and the field entry's path (Ashby).
  function idsOf(el) {
    const ids = new Set();
    for (const node of [el, ...el.querySelectorAll?.('input, select, textarea') || []]) {
      for (const name of ['id', 'name']) { const value = node.getAttribute?.(name); if (value) ids.add(value); }
    }
    const entry = el.closest?.('[data-field-path]');
    if (entry) ids.add(entry.getAttribute('data-field-path'));
    return ids;
  }
  // The answer for a control: by field id when the page exposes one, else by the question text (equal, or one inside the other).
  function matchAnswer(answers, {ids, question}) {
    const q = norm(question);
    return answers.find(answer => answer.field && ids.has(answer.field))
      || answers.find(answer => answer.question && q && (norm(answer.question) === q
        || (q.length > 12 && (norm(answer.question).includes(q) || q.includes(norm(answer.question))))));
  }

  // ---- operators: each returns {ok, why} after re-reading the control ----
  // `params` are a recipe's few options (extension/recipe-schema.js): which elements are the options, which attribute says
  // "selected", which date shape. Nothing else of a recipe reaches here. An operator never presses anything that looks like a
  // submit control, whatever a recipe says.
  const OPTION = 'button[aria-pressed], [role=radio], button[aria-checked]';
  const SUBMITTY = /submit|send application|apply now|absenden|bewerbung senden|envoyer ma candidature/i;
  // By the words on it and an explicit type="submit"; a button with no type attribute reports "submit" in a browser, so the
  // property is not what is looked at.
  const refuses = el => ['submit', 'image'].includes(String(el.getAttribute?.('type') || '').toLowerCase())
    || SUBMITTY.test(`${el.textContent || ''} ${el.getAttribute?.('aria-label') || ''}`);
  const REFUSED = {ok: false, why: 'refused: looks like a submit control'};
  // A group of pressable buttons (Yes/No, Male/Female): press the one whose text is the answer.
  async function setToggleGroup(box, value, params = {}) {
    const buttons = [...box.querySelectorAll(params.option || OPTION)];
    const wanted = yesNo(value) || norm(value);
    // By its accessible name: an ARIA radio's words often live in another element (aria-labelledby), its own text is empty (page/radios.js).
    const named = button => button.getAttribute('aria-label') || (button.getAttribute('aria-labelledby') || '').split(/\s+/)
      .map(id => (id && document.getElementById(id)?.textContent) || '').join(' ') || button.textContent;
    const target = buttons.find(button => (yesNo(named(button)) || norm(named(button))) === wanted);
    if (!target) return {ok: false, why: `no "${clean(value)}" option`};
    if (refuses(target)) return REFUSED;
    const on = button => (params.onAttr ? button.getAttribute(params.onAttr) === (params.onValue ?? 'true')
      : button.getAttribute('aria-pressed') === 'true' || button.getAttribute('aria-checked') === 'true');
    if (!on(target)) (globalThis.__jobadabraPress?.(target) || target.click());
    await wait(120);
    return on(target) ? {ok: true} : {ok: false, why: 'the option did not stay selected'};
  }
  // A text/date input: set like typing, then confirm the page kept it.
  async function setDate(input, value, params = {}) {
    const date = parseDate(value);
    if (!date) return {ok: false, why: `"${clean(value)}" is not a date`};
    const text = formatDate(date, input, params);
    const setter = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(input), 'value')?.set;
    input.focus?.();
    if (setter) setter.call(input, text); else input.value = text;
    for (const type of ['input', 'change', 'blur']) input.dispatchEvent(new Event(type, {bubbles: true}));
    await wait(200);
    return input.value === text ? {ok: true, text} : {ok: false, why: 'the field did not keep the date'};
  }
  // A custom dropdown (a button or role=combobox that opens a list): open it, pick the option by its text, confirm the value shown.
  async function setCustomSelect(trigger, value, doc = document, params = {}) {
    const wanted = norm(value);
    const opener = (params.trigger && trigger.querySelector?.(params.trigger)) || trigger;
    if (refuses(opener)) return REFUSED;
    (globalThis.__jobadabraPress?.(opener) || opener.click());
    let options = [];
    for (let i = 0; i < 8 && !options.length; i++) {
      await wait(100);
      // The innermost match with a text: an option drawn as <div role=option><span>text</span></div> is the div (the span is no match), a plain <li> its own leaf.
      const found = [...doc.querySelectorAll(params.option || '[role=option], [role=listbox] li, [class*=option]')].filter(option => option.getClientRects().length && clean(option.textContent));
      options = found.filter(option => !found.some(other => other !== option && option.contains(other)));
    }
    const pick = options.find(option => norm(option.textContent) === wanted) || options.find(option => norm(option.textContent).startsWith(wanted));
    if (pick && refuses(pick)) return REFUSED;
    if (!pick) { (globalThis.__jobadabraPress?.(opener) || opener.click()); return {ok: false, why: options.length ? `no option "${clean(value)}"` : 'the list did not open'}; }
    (globalThis.__jobadabraPress?.(pick) || pick.click());
    await wait(150);
    return norm(trigger.textContent || trigger.value).includes(norm(pick.textContent)) ? {ok: true} : {ok: false, why: 'the choice did not show'};
  }

  // The operator a recipe may configure for each kind of control found here.
  const OPERATOR_OF = {'toggle-group': 'toggle', 'custom-select': 'select', date: 'date'};
  function fingerprintOf(el, kit) { try { return kit ? kit.fingerprint(kit.skeleton(el)) : ''; } catch { return ''; } }
  const looksLikeDate = input => input.type === 'date' || /date/i.test(`${input.placeholder || ''} ${input.className || ''}`);

  // The fingerprints of the controls here that the operators handle: what the app is asked recipes for.
  function fingerprints({doc = document, kit = window.__jobadabraSkeleton} = {}) {
    const visible = el => !!el.getClientRects().length;
    const found = new Set();
    for (const {el, kind} of kit ? kit.widgets(doc, visible) : []) if (OPERATOR_OF[kind]) found.add(fingerprintOf(el, kit));
    for (const input of doc.querySelectorAll('input')) if (looksLikeDate(input) && visible(input)) found.add(fingerprintOf(input, kit));
    for (const fp of window.__jobadabraUpload?.fingerprints?.(doc) || []) found.add(fp);   // upload slots (page/upload.js)
    found.delete('');
    return [...found].slice(0, 30);
  }

  // Offer every control the normal fill left to the operators, with the same answers. Returns what happened per control.
  // `skip(question)` says a question is off limits (consent, terms): such controls are never touched. `recipes` (by
  // fingerprint, from the app) configure an operator for the controls they fit; the result says which version was used.
  async function fill(answers, {skip = () => false, doc = document, kit = window.__jobadabraSkeleton, recipes = window.__jobadabraRecipes || {}} = {}) {
    const results = [];
    const open = (answers || []).filter(answer => answer && answer.value !== undefined && answer.value !== '');
    const visible = el => !!(el.getClientRects().length && (typeof getComputedStyle !== 'function' || getComputedStyle(el).visibility !== 'hidden'));
    const used = new Set();
    // A control still empty that no answer was matched to is a miss the learning loop must see (fixed reason word, no text): `left` is true only where the caller has
    // checked the control is empty (a custom select has no such check, so it is reported only when an answer was tried).
    const unmatched = (el, kind, why) => results.push({question: '', kind, fp: fingerprintOf(el, kit), recipe: 0, value: '', ok: false, why, unmatched: true});
    const attempt = async (el, kind, run, left = false) => {
      const question = titleOf(el);
      if (!question) { if (left) unmatched(el, kind, 'no_question'); return; }
      if (skip(question)) return;
      const answer = matchAnswer(open.filter(a => !used.has(a)), {ids: idsOf(el), question});
      if (!answer) { if (left) unmatched(el, kind, 'no_answer'); return; }
      used.add(answer);
      const fp = fingerprintOf(el, kit);
      const recipe = recipes[fp] && recipes[fp].operator === OPERATOR_OF[kind] ? recipes[fp] : null;
      // An operator's try counts in the control's one attempt log (page/attempts.js): refused once it used its tries or this try failed on this state.
      const log = window.__jobadabraAttempts, verb = `operate:${kind}`;
      if (log && !log.mayTry(el, verb)) { results.push({question, kind, fp, recipe: recipe ? recipe.version : 0, value: answer.value, ok: false, why: 'its tries are used'}); return; }
      const before = log?.stateOf(el);
      const result = await run(answer.value, recipe?.params || {}).catch(error => ({ok: false, why: error.message}));
      log?.note(el, verb, before, !!result?.ok);
      results.push({question, kind, fp, recipe: recipe ? recipe.version : 0, value: answer.value, ...result});
    };
    for (const {el, kind} of kit ? kit.widgets(doc, visible) : []) {
      if (kind === 'toggle-group' && !el.querySelector('[aria-pressed="true"], [aria-checked="true"]')) await attempt(el, kind, (value, params) => setToggleGroup(el, value, params), true);
      if (kind === 'custom-select') await attempt(el, kind, (value, params) => setCustomSelect(el, value, doc, params));
    }
    for (const input of doc.querySelectorAll('input')) {
      if (!looksLikeDate(input) || input.value || !visible(input)) continue;
      await attempt(input, 'date', (value, params) => setDate(input, value, params), true);
    }
    return results;
  }

  const api = {yesNo, parseDate, formatDate, matchAnswer, titleOf, idsOf, setToggleGroup, setDate, setCustomSelect, fill, fingerprints, norm};
  if (typeof module !== 'undefined' && module.exports) module.exports = api; else window.__jobadabraControls = api;
})();
