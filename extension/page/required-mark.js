// The required mark, one rule for every reader: a "*" (also ∗ ＊ ✱ ✳) leading a label, or trailing it with an optional ":" or "." after it
// ("Name *", "Anrede*:", "Nom* :"), or glued to the last word before a short tail ("Gehalt* (erforderlich)"). Structure only: no word, no language, no site. The panel (review.js), the fill (page/fill-labels.js),
// the coverage (page/coverage.js), the radio groups (page/radios.js) and the proposer (page/propose.js) all ask it, so they cannot disagree.
// Injected in both worlds (page-files.js, and the panel's list in background.js). Guarded by worker/test/required-mark.test.js.
(() => {
  if (window.__jobPilottoRequired) return;
  const STAR = '[*\\u2217\\uFF0A\\u2731\\u2733]';   // * ∗ ＊ ✱ ✳
  const TRAILING = new RegExp(`\\s*${STAR}+\\s*[:\\uFF1A.]?\\s*$`);
  const LEADING = new RegExp(`^\\s*${STAR}+\\s*`);
  // A star glued to the label's last word, then a short tail of the page's own words in any language ("Gehaltsvorstellung* (erforderlich)", "First name*Required"):
  // a letter right before the star, a tail of at most 3 words (30 characters) with no star of its own. The tail's meaning is not read; a legend has a space before its star.
  const GLUED = new RegExp(`\\p{L}${STAR}+\\s*\\(?\\s*[^\\s*()]+(?:\\s+[^\\s*()]+){0,2}\\s*\\)?\\s*[:\\uFF1A.]?\\s*$`, 'u');
  const glued = t => GLUED.test(t) && t.slice(t.search(new RegExp(`\\p{L}${STAR}`, 'u'))).length <= 32;
  const text = value => String(value || '').replace(/\s+/g, ' ').trim();
  // Does this label text carry the mark?
  const textHas = value => { const t = text(value); return TRAILING.test(t) || LEADING.test(t) || glued(t); };
  // A label or title ELEMENT can draw the mark as an element of its own: a leaf that holds only the star, and (when the star is aria-hidden) a visually hidden element right after
  // it that says the same to a screen reader, in the page's language ("Name<sup aria-hidden>*</sup><span>Required</span>"). Its text then ends in no star.
  const STAR_ONLY = new RegExp(`^\\s*${STAR}+\\s*$`);
  const starLeaves = el => Array.from(el.querySelectorAll?.('*') || []).filter(node => !node.firstElementChild && STAR_ONLY.test(node.textContent));
  // A mark the page keeps hidden until its script says the section is required (class rule, hidden attribute, inline style: any of them leaves it not displayed) is no mark.
  // Only a live element can be asked; a detached copy has no styles, so the words readers (read) keep dropping every star leaf.
  const hiddenIn = (node, root) => {
    for (let el = node; el && el !== root?.parentElement; el = el.parentElement) {
      if (el.hidden) return true;
      const style = el.ownerDocument?.defaultView?.getComputedStyle?.(el);
      if (style && (style.display === 'none' || style.visibility === 'hidden')) return true;
    }
    return false;
  };
  // The words of a label element without its star element and that spoken twin; a string is returned as it is. Text the page never draws is no word of it: an icon's
  // <svg> carries a <desc>/<title> ("SVGs not supported by this browser." beside Workable's "Address", benchmark form 106, 27 Oct 2026: the label no longer read as the address).
  const UNDRAWN = 'svg, style, script, template, noscript';
  const read = value => {
    if (!value?.cloneNode) return text(value);
    const copy = value.cloneNode(true);
    for (const leaf of starLeaves(copy)) {
      if (leaf.getAttribute('aria-hidden') === 'true') leaf.nextElementSibling?.remove();
      leaf.remove();
    }
    for (const undrawn of Array.from(copy.querySelectorAll?.(UNDRAWN) || [])) undrawn.remove();
    return text(copy.textContent);
  };
  // Does this label text (or label element) carry the mark?
  const has = value => value?.querySelectorAll ? starLeaves(value).some(leaf => !hiddenIn(leaf, value)) || textHas(read(value)) : textHas(value);
  // The label's words without the mark and the colon after it.
  // `leading: false` keeps a leading mark (the fill reads a group's name with it, then asks `has`).
  const clean = (value, {leading = true} = {}) => { const t = read(value); return text((glued(text(t)) ? t.replace(new RegExp(`(\\p{L})${STAR}+`, 'u'), '$1 ') : t).replace(leading ? LEADING : /^$/, '').replace(TRAILING, '').replace(/\s*[:\uFF1A]$/, '')); };
  // The title of a radio/checkbox group that has no fieldset: the row it sits in (table row, form row, definition list) names it in a
  // cell or label beside it that holds no control and is not one option's own label. Structure only; the first such cell wins.
  const ROW = 'tr, li, dl, [class*=row], [class*=Row], [class*=field], [class*=Field], [class*=form-group], [class*=question]';
  const rowTitle = el => {
    // The nearest row can be an option's own <li>; walk up to the outer row that holds the question. A row holding another group's controls is a whole form.
    for (let row = el.closest?.(ROW); row; row = row.parentElement?.closest(ROW)) {
      if (row.closest('fieldset')) return null;
      const boxes = Array.from(row.querySelectorAll('input[type=radio], input[type=checkbox]'));
      if (boxes.some(box => box.name !== el.name || !box.name)  && boxes.some(box => box !== el && !(el.name && box.name === el.name))) return null;
      if (isGrid(el, row, boxes)) return null;
      const title = titleIn(el, row, boxes);
      if (title) return title;
    }
    return null;
  };
  // A lone box with its own label (a consent tick) whose row also holds other fields is a grid cell, not a titled row: the captions in that row belong to
  // the other fields, so the box is named by its own label (12 Oct 2026: "Vorname: Ich habe die Datenschutzerklärung gelesen"). A group of options keeps its title.
  const FIELD = 'input:not([type=hidden]):not([type=submit]):not([type=button]):not([type=reset]):not([type=image]):not([type=radio]):not([type=checkbox]), select, textarea';
  const isGrid = (el, row, boxes) => !!(el.labels?.length || el.closest('label')) && boxes.every(box => box === el || !el.name || box.name !== el.name) &&
    Array.from(row.querySelectorAll(FIELD)).some(field => !field.closest('label') || !field.closest('label').contains(el));
  const titleIn = (el, row, boxes) => {
    const optionLabels = new Set(boxes.flatMap(box => [box.closest('label'), ...(box.labels || [])]));
    const cells = Array.from(row.querySelectorAll('th, td, dt, legend, label, [class*=label], [class*=Label], [class*=title]'));
    const free = cell => !optionLabels.has(cell) && !cell.querySelector('input, select, textarea, button') && !cell.contains(el) && LETTER.test(cell.textContent) &&
      !Array.from(cell.querySelectorAll('label')).some(label => optionLabels.has(label));
    // A sign on its own ("*" in a span) is no title; with no label-like cell, the block just before the control's own block in the row is.
    return cells.find(free) || beforeBlock(el, row, free);
  };
  const LETTER = /\p{L}/u;
  const beforeBlock = (el, row, free) => {
    for (let up = el; up && up !== row; up = up.parentElement) {
      for (let prev = up.previousElementSibling; prev; prev = prev.previousElementSibling) if (free(prev) && prev.textContent.length <= 200) return prev;
    }
    return null;
  };
  // An independent count for the learning loop (no personal data, a number only): how many short label-like texts on the page carry a "*"
  // anywhere, except a legend sentence ("Mit * markierte Felder…": the star between two words). It does not use `has`, so when the rule above
  // misses a layout the page still shows starred > required on /admin/intelligence/insights and /admin/form-filling/lab, and a recorded page can be added.
  const LEGEND = new RegExp(`\\S\\s+${STAR}\\s+\\S`);
  const starred = doc => {
    let n = 0;
    for (const el of doc.querySelectorAll('label, legend, th, td, dt, span, div, p, b, strong, em, i, abbr')) {
      if (el.closest('#jobpilotto-review-host, .job-pilotto-badge, [id^=jobpilotto]')) continue;
      const t = text(el.textContent);
      if (t.length > 80 || !new RegExp(STAR).test(t) || !/\p{L}/u.test(t) || LEGEND.test(t)) continue;
      if (Array.from(el.children).some(child => { const c = text(child.textContent); return c.length <= 80 && new RegExp(STAR).test(c) && /\p{L}/u.test(c) && !LEGEND.test(c) && child.matches('label, legend, th, td, dt, span, div, p, b, strong, em, i, abbr'); })) continue;   // the innermost one only
      n++;
      if (n >= 200) break;
    }
    return n;
  };
  // The page marks the box itself: the `required` attribute, aria-required, or a class that names it (a validator's "validate[required,custom[email]]", "is-required").
  // A control whose label (or aria-labelledby element) carries the mark, with no required attribute on the control itself (a page that checks in its script).
  const labelMarked = el => [...(el.labels || []), ...String(el.getAttribute?.('aria-labelledby') || '').split(/\s+/).map(id => el.ownerDocument.getElementById(id))].some(label => !!label && has(label));
  const marked = el => !!el && (labelMarked(el) || el.required || el.getAttribute('aria-required') === 'true' || /(^|[\s_\[,-])required([\s_\],-]|$)/i.test(String(el.className?.baseVal ?? el.className ?? '')));
  window.__jobPilottoRequired = {has, clean, read, rowTitle, starred, marked, hiddenIn};
})();
