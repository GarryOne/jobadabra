// A box's own label when the page's <label for="…"> names no element (12 Oct 2026, a French form: "Prénom" / "Nom" labels whose `for` ids no box has, boxes named
// by the page's own field names, one of them pointing the wrong way). Structure only: the label that sits right before the box in the same flow (no other text or
// control between them, up through up to three wrappers), tied to no control. One rule for the fill (page/fill-labels.js) and the panel (review.js), loaded in both worlds.
// The title of a group or of a control with no label is the same rule's sibling (12 Oct 2026, widget zoo segmented-toggle-1: a role=group named by aria-labelledby was called
// "First name", the FIRST label of its form, by a walk up its ancestors; the question was never asked and two fields shared one label): its own accessible name
// (aria-labelledby, aria-label) wins, else the NEAREST title before it that no other control owns (a <label for> of another box is that box's). One rule for every
// reader that names a group: page/radios.js, page/controls.js, page/fill-labels.js, review.js. Guarded by app-core/test/label-before.test.js and the widget zoo.
(() => {
  if (window.__jobadabraLabelBefore) return;
  const CONTROL = 'input:not([type=hidden]), select, textarea, button';
  const text = el => String(el.textContent || '').replace(/\s+/g, ' ').trim();
  const labelBefore = el => {
    for (let node = el, hops = 0; node && hops < 4; node = node.parentElement, hops++) {
      for (let prev = node.previousSibling; prev; prev = prev.previousSibling) {
        if (prev.nodeType === 3) { if (prev.textContent.trim()) return ''; continue; }   // words between the label and the box: not its label
        if (prev.nodeType !== 1) continue;
        const isLabel = prev.tagName === 'LABEL';
        if (!isLabel && !text(prev) && !prev.querySelector(CONTROL)) continue;   // <br>, an empty <div></div>, a hidden input: no one's label
        if (!isLabel || prev.control || prev.querySelector(CONTROL) || !text(prev)) return '';
        return text(prev);
      }
      if (node.parentElement && node.parentElement.querySelectorAll(CONTROL).length > 1) return '';   // a wrapper holding other boxes: the label before it is theirs too
    }
    return '';
  };
  const TITLE = 'label, legend, [class*=title], [class*=heading]';
  // A title element tied to another control: a <label> whose control (for, or a box inside it) is not this element and not inside it.
  const othersLabel = (label, el) => label.tagName === 'LABEL' && !!label.control && label.control !== el && !el.contains(label.control);
  // Another control a title could belong to instead: a box, a menu, a group of choices or of pressable buttons (not hidden, not part of el).
  const OTHER = 'input:not([type=hidden]), select, textarea, [role=group], [role=radiogroup], button[aria-pressed]';
  const before = (a, b) => !!(b.compareDocumentPosition(a) & Node.DOCUMENT_POSITION_PRECEDING);   // a comes before b in the page
  // Some other control sits between the title and el (cc's review of #515, 12 Oct 2026: "Do you need a visa?" took "Are you fluent in English?", the previous question's title,
  // and a toggle took "Notice period", a text box's): that control owns the title.
  const ownedBetween = (found, el, scope) => [...scope.querySelectorAll(OTHER)].some(other => other !== el && !el.contains(other) && !other.contains(el) && !found.contains(other)
    && before(found, other) && before(other, el));
  // The text right before el in its own row: the nearest earlier sibling (up through up to three wrappers) with words and no control in it.
  const textBefore = el => {
    for (let node = el, hops = 0; node && hops < 4; node = node.parentElement, hops++) {
      for (let prev = node.previousElementSibling; prev; prev = prev.previousElementSibling) {
        if (prev.querySelector(OTHER) || prev.matches(OTHER)) break;   // another control's part of the row: not el's
        if (text(prev)) return prev;
      }
      if (node.parentElement && [...node.parentElement.querySelectorAll(OTHER)].some(other => other !== el && !el.contains(other) && !other.contains(el))) return null;
    }
    return null;
  };
  // The nearest title before el, a few boxes up: never inside el, never after it, never another control's label, never one with another control between it and el; when none
  // qualifies, the text right before el in its own row. -> the element, or null. selector: what counts as a title.
  window.__jobadabraTitleAbove = (el, selector = TITLE, levels = 5) => {
    for (let up = el.parentElement, i = 0; up && i < levels; up = up.parentElement, i++) {
      const found = [...up.querySelectorAll(selector)].filter(item => !el.contains(item) && !item.contains(el) && text(item) && !othersLabel(item, el) && before(item, el));
      const nearest = found[found.length - 1];
      if (nearest) return ownedBetween(nearest, el, up) ? textBefore(el) : nearest;
    }
    return textBefore(el);
  };
  // A group's own accessible name: the words of the elements its aria-labelledby names, else its aria-label. -> {text, el} or null.
  // Its words read as the panel reads a label: a required star and its spoken twin ("Required", "Pflichtfeld") left out (page/required-mark.js clean); the element keeps the mark.
  const words = node => (window.__jobadabraRequired?.clean ? text({textContent: window.__jobadabraRequired.clean(node)}) : text(node));
  window.__jobadabraOwnName = group => {
    const named = String(group.getAttribute?.('aria-labelledby') || '').split(/\s+/).map(id => id && document.getElementById(id)).filter(Boolean);
    const said = named.map(words).join(' ').trim();
    if (said) return {text: said, el: named[0]};
    const label = String(group.getAttribute?.('aria-label') || '').replace(/\s+/g, ' ').trim();
    return label ? {text: window.__jobadabraRequired?.clean ? window.__jobadabraRequired.clean(label) : label, el: group} : null;
  };
  // A group's title: its own accessible name, else the nearest title before it. -> {text, el} or null (el: where a required mark would sit).
  window.__jobadabraGroupTitle = (group, selector = TITLE) => {
    const own = window.__jobadabraOwnName(group);
    if (own) return own;
    const found = window.__jobadabraTitleAbove(group, selector);
    return found ? {text: text(found), el: found} : null;
  };
  // A bare heading right above a control with no label of its own names it (17 Oct 2026, Breezy HR: <div><h3>Desired Salary</h3><select name=salaryCurrency><input name=cSalary></div>,
  // <li><div><h3>Provide your city and state of residence</h3><input name=section_..._question_5>: the boxes were asked as their field names). Structure only: the nearest
  // earlier h1-h6/role=heading holding no control, in the closest wrapper (up to two up) with at most three visible boxes, none of which has a label of its own (a section
  // title over labelled fields is never a box's name). -> the heading's words, or ''.
  const HEADING = 'h1, h2, h3, h4, h5, h6, [role=heading]';
  const ownLabel = c => !!(c.labels && c.labels.length) || !!c.getAttribute('aria-label') || !!c.getAttribute('aria-labelledby');
  const headingFor = el => {
    for (let up = el.parentElement, i = 0; up && i < 2; up = up.parentElement, i++) {
      const boxes = [...up.querySelectorAll(CONTROL)].filter(c => c.type !== 'hidden' && !c.closest('[hidden], [aria-hidden=true]'));
      if (boxes.length > 3 || boxes.some(ownLabel)) return '';
      const found = [...up.querySelectorAll(HEADING)].filter(h => !h.contains(el) && !h.querySelector(CONTROL) && text(h) && text(h).length <= 200 && before(h, el));
      if (found.length) return text(found[found.length - 1]);
    }
    return '';
  };
  window.__jobadabraLabelBefore = el => labelBefore(el) || headingFor(el);   // the label right before the box, else the heading above its block
})();
