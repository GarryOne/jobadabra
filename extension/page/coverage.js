// Coverage: the questions a form SHOWS as required that the form reader did not read. The reader (page/fill.js, the panel in
// review.js) knows only the shapes it was taught; the page's own required marks ("*", a "required" class, a "*" drawn by CSS)
// say what it needs whatever its shape. A marked question no read field claims is a reading miss: it is listed for the person
// and reported, so a new layout teaches the product on its first visit instead of passing silently (Colonist on Ashby, 5 Oct
// 2026: two required radio groups were neither filled nor listed). Read only: it never changes the page. Loaded by the panel,
// the fill and the form lab (jobadabra-lab lab/form-lab.mjs), and by the tests (module.exports).
(() => {
  const clean = text => window.__jobadabraRequired.clean(text);
  const norm = text => clean(text).toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
  // Where a question's title can be. Options' own labels are not marked required, so they never count.
  const TITLE = 'label, legend, [class*=question-title], [class*=questionTitle], [class*=field-label], [class*=fieldLabel], [class*=label], [class*=title], h3, h4, h5';
  const CONTROL = 'input:not([type=hidden]):not([type=submit]):not([type=button]), textarea, select, [role=radio], [role=checkbox], [role=combobox], [role=switch], [role=slider], [role=listbox], [role=textbox], [contenteditable=true], button[aria-pressed]';

  // The page says this title's question is required: a trailing "*", a "required" class, a "*" drawn before/after it, or a
  // marker element inside it.
  function marked(title, view) {
    if (window.__jobadabraRequired.has(title)) return true;
    if (/(^|[\s_-])required([\s_-]|$)/i.test(String(title.className?.baseVal ?? title.className ?? ''))) return true;
    if ([...title.querySelectorAll('[class*=required], [aria-label*=required i], abbr[title*=required i]')].some(mark => !window.__jobadabraRequired.hiddenIn(mark, title))) return true;   // a marker the page hides is not shown
    try {
      for (const pseudo of ['::after', '::before']) if (String(view.getComputedStyle(title, pseudo).content || '').includes('*')) return true;
    } catch { /* no styles (a test DOM) */ }
    return false;
  }
  // The question's area: its fieldset, else the nearest ancestor (5 levels up) that holds a control; null for a heading with
  // no control near it (a section title). An area that holds another required title is shared, so the title's own row is used.
  function areaOf(title) {
    const set = title.closest('fieldset');
    if (set && set.querySelector(CONTROL)) return set;
    for (let up = title.parentElement, i = 0; up && i < 5; up = up.parentElement, i++) {
      if (up.querySelector(CONTROL)) return up;
    }
    return null;
  }
  const kindsIn = area => [...new Set([...area.querySelectorAll(CONTROL)].map(el => el.getAttribute('role') || (el.tagName === 'INPUT' ? el.type || 'text' : el.tagName.toLowerCase())))].slice(0, 4);

  // An upload field that shows its file: the page drew a chip (a file name and a remove button) where its buttons were and dropped its own input, so the title has no control near it and its
  // area would climb to the whole form. The field is the widest box around the title (up to 5 levels) that holds no control; one that shows a file name is the upload step's slot
  // (page/upload.js reads it, by the file it shows), never a question the reader missed. A title with a control in its own field never gets here.
  function showsFile(title) {
    let box = title.parentElement, field = null;
    for (let up = 0; box && up < 5 && !box.querySelector(CONTROL); box = box.parentElement, up++) field = box;
    return !!field && !!window.__jobadabraReadBack?.namesIn?.(field.innerText ?? field.textContent ?? '').length;
  }
  // read: the labels the reader has for this form (field labels, group questions). shown(el): is it visible. Returns
  // [{question, kinds, area, title, shared}] for each required-marked question with a control near it that no read label names.
  const unread = (doc, read, shown) => audit(doc, read, shown).filter(item => !item.read);
  // Every required-marked question with a control near it, each with read: true/false. The share read is the reader's coverage
  // (the form lab reports it per board, day by day: the number that shows whether reading gets better).
  function audit(doc, read, shown = () => true) {
    const view = doc.defaultView || globalThis;
    const labels = (read || []).map(norm).filter(Boolean);
    const claimed = q => labels.some(l => l === q || (q.length >= 8 && l.length >= 8 && (l.includes(q) || q.includes(l))));
    const out = [], areas = new Set(), seen = new Set(), titles = [];
    for (const title of doc.querySelectorAll(TITLE)) {
      if (title.closest('#jobadabra-review-host, .jobadabra-badge, [id^=jobadabra]')) continue;
      // A label wrapping its own control ("I agree *") is that control's label, read with it.
      if (title.querySelector(CONTROL) || !shown(title) || !marked(title, view)) continue;
      const question = clean(title.textContent);
      const q = norm(question);
      if (q.length < 3 || question.length > 200 || seen.has(q)) continue;
      titles.push(title);
      if (showsFile(title)) continue;
      const area = areaOf(title);
      const live = area ? [...area.querySelectorAll(CONTROL)].filter(shown) : [];
      // An upload alone (the CV, a cover letter file) is the CV step's, listed by the panel on its own.
      if (!live.length || areas.has(area) || live.every(el => el.type === 'file')) continue;
      seen.add(q);
      areas.add(area);
      out.push({question: question.slice(0, 120), kinds: kindsIn(area), area, title, read: claimed(q)});
      if (out.length >= 40) break;
    }
    // An area that holds another required question's title is shared (a recorder's title with no control of its own climbs to the form): its controls answer THEIR questions, so
    // whether this one is answered is unknown, never "yes" (13 Oct 2026: a required recorder was traced filled because the form's first name box held a value).
    for (const item of out) item.shared = titles.some(other => other !== item.title && item.area.contains(other));
    return out;
  }
  // Is the question in this area answered now: a ticked choice, a typed value, a pressed button, a picked option.
  function answered(area) {
    for (const el of area.querySelectorAll(CONTROL)) {
      if (el.matches('input[type=radio], input[type=checkbox]')) { if (el.checked) return true; continue; }
      if (el.matches('input, textarea')) { if (window.__jobadabraBoxGiven ? window.__jobadabraBoxGiven(el.value) : String(el.value || '').trim()) return true; continue; }
      if (el.matches('select')) { if (window.__jobadabraChosen ? window.__jobadabraChosen(el) : el.selectedIndex > 0) return true; continue; }   // a real choice (browser-form-fastpath.js)
      if (el.getAttribute('aria-pressed') === 'true' || el.getAttribute('aria-checked') === 'true') return true;
    }
    return !!area.querySelector('[class*=single-value], [class*=multi-value], [aria-selected=true]');
  }

  const api = {unread, audit, answered, marked, norm};
  if (typeof module !== 'undefined' && module.exports) module.exports = api; else window.__jobadabraCoverage = api;
})();
