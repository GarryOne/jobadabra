// The panel's reading of the form (read only): each question's text, which are required, which are filled, find by label, and the amber flash that points at one.
// Owns fields(), question(), find(), flash() and the knockout / agreement word lists the panel draws with. Injected before review.js (panel-files.js), shared as
// window.__jobPilottoPanelForm (a content script has no imports). Guarded by worker/test/panel-widgets, option-groups, control-marks, aria-hidden-select,
// select-chosen and desktop/test/typed-match, extension-files (the knockout words agree with the app's).
(() => {
  const SKIP = ['hidden', 'submit', 'button', 'reset', 'search', 'image'];
  // Questions a hiring system can be set to reject on by themselves (recruiters on r/recruiting, 2025-26: work authorisation, sponsorship, location or
  // office attendance, a required licence or language). Marked first, because a wrong or rushed answer here decides more than anything else on the form.
  const KNOCKOUT = /authori[sz]ed to work|authori[sz]ation|right to work|legally (eligible|entitled)|sponsor|visa|work permit|citizen|relocat|willing(ness)? to (work|commute|come|travel)|on-?site|in[- ]office|office (days|attendance)|days (a|per) week|reside|currently located|security clearance|licen[sc]e/i;
  const AGREE = /agree|consent|acknowledg|terms|privacy|policy|arbitrat|certif|attest|pledge/i;
  const clean = text => window.__jobPilottoRequired.clean(text);
  const norm = text => clean(text).toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
  const visible = el => !!(el.getClientRects().length && getComputedStyle(el).visibility !== 'hidden');

  // ---- reading the form (read only) ----
  function question(el) {
    const byIds = (el.getAttribute('aria-labelledby') || '').split(/\s+/).map(id => document.getElementById(id)?.textContent).filter(Boolean).join(' ');
    const own = byIds || el.getAttribute('aria-label') || Array.from(el.labels || [], label => window.__jobPilottoRequired.read(label)).join(' ') || (el.type !== 'hidden' && window.__jobPilottoLabelBefore?.(el)) || '';
    const legend = window.__jobPilottoRequired.read(fieldsetTitle(el.closest('fieldset')) || (['radio', 'checkbox'].includes(el.type) ? window.__jobPilottoRequired.rowTitle(el) : null));
    if (['checkbox', 'radio'].includes(el.type) && legend) return clean(legend);
    if (clean(own)) return clean(own);
    if (legend) return clean(legend);
    const above = window.__jobPilottoTitleAbove(el, 'label, legend, [class*=label], [class*=question]', 4);   // the nearest title before it that no other control owns (page/label-before.js)
    if (above) return clean(above.textContent);
    return clean(el.name || el.id);
  }
  // A fieldset's title: its <legend>, or (Ashby) a <label> whose `for` points at no control. Ashby marks a required radio group only
  // by a "*" its CSS draws after that title (no attribute), so the class and the drawn "*" count too.
  const fieldsetTitle = set => set && (set.querySelector('legend') ||
    Array.from(set.querySelectorAll('label')).find(l => !l.control && !l.querySelector('input, select, textarea')));
  const titleRequired = title => !!title && (window.__jobPilottoRequired.has(title) || /required/i.test(String(title.className || '')) ||
    String(getComputedStyle(title, '::after').content || '').includes('*'));
  const required = el => window.__jobPilottoRequired.marked(el) ||
    [...(el.labels || [])].some(label => window.__jobPilottoRequired.has(label)) ||
    (['checkbox', 'radio'].includes(el.type) && titleRequired(fieldsetTitle(el.closest('fieldset')) || window.__jobPilottoRequired.rowTitle(el)));
  // A control's state (a box, a menu, a picklist's chip, a choice, an upload slot that shows its file as a chip) is read by the one reader the fill and the judges use too
  // (page/read-back.js, injected before this file): one truth per control, never a copy that drifts (12 Oct 2026, Ashby: the fill said 8 filled, the panel 5/10 left).
  // A required custom control the readers in fields() do not know (a slider, a switch, a rich-text box): nothing says what it should hold, so it is
  // left for the person until its own state differs from the one first seen. Without it the panel said "Ready to submit" over an unanswered question.
  const firstState = new WeakMap();
  const widgetState = el => [...['aria-valuenow', 'aria-checked', 'aria-pressed', 'aria-selected'].map(name => el.getAttribute(name)), clean(el.textContent),
    el.querySelector('[aria-selected=true], [aria-checked=true]') ? 1 : 0].join('|');
  function fields() {
    const groups = new Map();
    for (const el of document.querySelectorAll('input, textarea, select, [role=combobox]:not(input):not(textarea):not(select)')) {   // a select-only combobox is a <div role=combobox> holding its shown choice (page/read-back.js selectOnly)
      const slot = el.type === 'file' && !visible(el) ? window.__jobPilottoReadBack.shownSlot(el) : null; if (SKIP.includes(el.type) || el.disabled || window.__jobPilottoReadBack.hiddenAway(el) || !(visible(el) || slot)) continue;   // a CV slot whose input the page hides counts by its visible zone (page/read-back.js)
      const group = ['checkbox', 'radio'].includes(el.type) ? window.__jobPilottoOptionGroups?.groupOf(el) : null;   // one question is one row, however its options are named (page/option-groups.js, shared with the replay's truth reader)
      const key = group ? group.key : el;
      const filled = window.__jobPilottoReadBack.holds(el);   // the one reading (page/read-back.js): a box holding only a country code is empty, an upload slot by the file it shows
      const named = group?.box && window.__jobPilottoOwnName?.(group.box);   // a group that names itself (aria-labelledby / aria-label: a UI5 radio group): that is the question, not the first option's own label
      const entry = groups.get(key) || {el: slot || el, label: named ? clean(named.text) : group && !group.box ? clean(window.__jobPilottoTitleAbove(el, 'label, legend, [class*=label], [class*=question]', 4)?.textContent) || question(el) : question(el), required: false, filled: false, ai: false, byUs: false};   // the zone is what a person sees and is shown
      entry.required ||= required(el) || !!(group?.box && (group.box.getAttribute('aria-required') === 'true' || (named?.el && window.__jobPilottoRequired.has(named.el))));   // the group's own mark: aria-required on it, or the star in the title it names itself by
      entry.ai ||= el.hasAttribute('data-jobpilotto-ai'); entry.suggested ||= el.dataset.jobpilottoSuggested || ''; entry.guess ||= !!el.dataset.jobpilottoGuess; entry.wants ||= el.dataset.jobpilottoWants || ''; entry.options ||= el.dataset.jobpilottoOptions || '';   // page/propose.js: proposals, reported with what is left (the app's rows)
      entry.cause ||= el.dataset.jobpilottoCause || ''; entry.gaveUp ||= el.getAttribute('data-jobpilotto-gaveup') || ''; entry.byUs ||= el.hasAttribute('data-jobpilotto-filled') || el.hasAttribute('data-jobpilotto-ai'); entry.category ||= el.dataset.jobpilottoCategory || '';   // the AI's reading, any language (page/categories.js)
      entry.draft ||= el.dataset.jobpilottoDraft || '';   // page/fill-marks.js: text we drafted that the person has not yet read
      entry.changed ||= !!window.__jobPilottoTypedChanged?.(el); entry.filled ||= filled && !entry.changed && !entry.draft;   // a box the page changed after we typed it is not filled (page/typed-check.js)
      groups.set(key, entry);
    }
    // A robot check (reCAPTCHA, hCaptcha, Turnstile) lives in a frame the form's inputs don't include: its answer is the hidden
    // response box those widgets keep in the page. Ticked by you, never by us; until then the form is not ready (8 Oct 2026, Migros).
    for (const box of document.querySelectorAll('textarea[name$="captcha-response"], input[name="cf-turnstile-response"]')) {
      const frame = box.parentElement?.querySelector('iframe') || box.closest('div')?.querySelector('iframe');
      if (!frame || !visible(frame)) continue;
      groups.set(box, {el: frame, label: 'Confirm you are not a robot', required: true, filled: !!String(box.value || '').trim(), ai: false, byUs: false});
    }
    // Yes/No questions drawn as two toggle buttons (Ashby: aria-pressed, with a visually hidden checkbox no one sees): one field, filled when one of the two is pressed, required
    // as its title says; the checkbox inside the pair is that same question, never a second row (13 Oct 2026: each was listed twice; recorded yes-no-pair-counted-once-1).
    const pairs = new Map();
    for (const button of document.querySelectorAll('button[aria-pressed]')) {
      if (!/^(yes|no)$/i.test((button.textContent || '').trim()) || !visible(button)) continue;
      if (!pairs.has(button.parentElement)) pairs.set(button.parentElement, []);
      pairs.get(button.parentElement).push(button);
    }
    for (const [box, buttons] of pairs) {
      const named = buttons.length > 1 && window.__jobPilottoGroupTitle(box);   // two buttons; its own accessible name, else the nearest title before it no other control owns (page/label-before.js)
      if (!named) continue;
      const inner = [...groups].filter(([, entry]) => entry.el !== box && box.contains(entry.el)), title = named.el;
      inner.forEach(([key]) => groups.delete(key));   // what the fill marked on the checkbox (by us, suggested) stays with the question
      groups.set(box, {...inner[0]?.[1], el: box, label: clean(named.text), ai: false,
        required: /required/i.test(title.className) || window.__jobPilottoRequired.has(title),
        filled: buttons.some(button => button.getAttribute('aria-pressed') === 'true')});
    }
    // An ARIA radio group (role=radiogroup > role=radio, a hidden aria-hidden input inside each option): one question, however the options are drawn. The loop above skips the
    // aria-hidden inputs (react-select's helpers), so without this row the fill sees the question and the panel never counts it (Starling, 17 Oct 2026: 4 required Yes/No left,
    // panel "4 left" against 8). Filled when an option reads as on; required as the group or an option says, or its title shows the mark.
    // A group named only by a label link is the same question (the fill's reader marks it, page/radios.js namedGroups; hybrid fill move 1): its options are its children, on by an aria state or the fill's chosen mark.
    for (const box of document.querySelectorAll('[role=radiogroup], [data-jobpilotto-named-group]')) {
      const options = [...(box.matches('[role=radiogroup]') ? box.querySelectorAll('[role=radio]') : box.children)].filter(option => option.tagName !== 'INPUT' && visible(option));
      if (options.length < 2 || !visible(box) || [...groups.values()].some(entry => entry.el === box || box.contains(entry.el))) continue;
      const named = window.__jobPilottoOwnName?.(box) || window.__jobPilottoGroupTitle?.(box);
      if (!named) continue;
      groups.set(box, {el: box, label: clean(named.text), ai: box.hasAttribute('data-jobpilotto-ai'), byUs: box.hasAttribute('data-jobpilotto-filled'), suggested: box.dataset.jobpilottoSuggested || '', guess: !!box.dataset.jobpilottoGuess, options: box.dataset.jobpilottoOptions || '',
        required: box.getAttribute('aria-required') === 'true' || options.some(option => option.getAttribute('aria-required') === 'true') || (!!named.el && window.__jobPilottoRequired.has(named.el)),
        filled: options.some(option => option.getAttribute('aria-checked') === 'true' || option.getAttribute('aria-pressed') === 'true' || option.dataset.jobpilottoChosen === '1' || !!option.querySelector('input[type=radio]:checked'))});
    }
    const known = [...groups.values()];
    for (const {el} of window.__jobPilottoSkeleton?.widgets(document, visible) || []) {
      if (known.some(entry => entry.el === el || entry.el?.contains?.(el) || el.contains(entry.el))) continue;   // a field the readers above already count
      const named = (el.getAttribute('aria-labelledby') || '').split(/\s+/).map(id => document.getElementById(id)?.textContent || '').join(' ');
      if (el.getAttribute('aria-required') !== 'true' && !window.__jobPilottoRequired.has(named)) continue;
      const state = widgetState(el);
      if (!firstState.has(el)) firstState.set(el, state);
      groups.set(el, {el, label: question(el), required: true, filled: state !== firstState.get(el), ai: false, custom: true});   // custom: still a miss for reportMisses
    }
    // Required questions the page shows that none of the readers above read (page/coverage.js): left for you until answered, told apart at Submit.
    const cover = window.__jobPilottoCoverage;
    if (cover) {
      const read = [...groups.values()].map(entry => entry.label);
      for (const item of cover.unread(document, read, visible)) {   // an ARIA radio group is read by the fill (page/radios.js): not unread, and its marks count
        const aria = item.area.matches?.('[role=radiogroup]') ? item.area : item.area.querySelector?.('[role=radiogroup]');
        groups.set(item.area, {el: item.area, label: item.question, required: true, filled: !item.shared && cover.answered(item.area), ai: false, unread: !aria, suggested: aria?.dataset.jobpilottoSuggested || '', guess: !!aria?.dataset.jobpilottoGuess, options: aria?.dataset.jobpilottoOptions || ''});
      }
    }
    return [...groups.values()];
  }
  function find(label, list = fields()) {
    const wanted = norm(label);
    if (!wanted) return null;
    return list.find(f => norm(f.label) === wanted) || list.find(f => norm(f.label).includes(wanted) || (norm(f.label).length > 8 && wanted.includes(norm(f.label))))
      || byWords(wanted, list);
  }
  // Claude shortens questions ("Rationale or evidence for the high school selections" for "Please share your rationale
  // or evidence for the high school performance selections above…"): the field sharing most of its words, if at
  // least 70% of them and 3 or more.
  const WORD = /[\p{L}\p{N}]{3,}/gu;
  const STOP = new Set(['the', 'and', 'for', 'you', 'your', 'are', 'with', 'this', 'that', 'what', 'have', 'did', 'how', 'please', 'which']);
  function byWords(wanted, list) {
    const words = [...new Set(wanted.match(WORD) || [])].filter(word => !STOP.has(word));
    if (words.length < 2) return null;
    let best = null, bestShare = 0, bestCount = 0;
    for (const field of list) {
      const label = norm(field.label);
      const count = words.filter(word => label.includes(word)).length;
      if (count / words.length > bestShare) { best = field; bestShare = count / words.length; bestCount = count; }
    }
    return bestShare >= 0.7 && bestCount >= 3 ? best : null;
  }
  // The page's highlight for fields (one stylesheet, added once, shared by fill.js and review.js): a soft amber ring
  // and glow instead of a hard border or outline. "review": an answer the AI wrote (pulses 3 times, then stays soft);
  // "flash": the field the panel or the app pointed at (pulses, removed after a few seconds).
  const glowStyle = () => {
    if (document.getElementById('jobpilotto-glow-style')) return;
    const style = document.createElement('style');
    style.id = 'jobpilotto-glow-style';
    style.textContent = `
      @keyframes jobpilotto-pulse { 0%, 100% { box-shadow: 0 0 0 2px rgba(245,158,11,.45), 0 0 10px 2px rgba(245,158,11,.18); }
        50% { box-shadow: 0 0 0 3px rgba(245,158,11,.75), 0 0 22px 6px rgba(245,158,11,.35); } }
      .jobpilotto-review { box-shadow: 0 0 0 2px rgba(245,158,11,.45), 0 0 10px 2px rgba(245,158,11,.18) !important;
        animation: jobpilotto-pulse 1.4s ease-in-out 3; transition: box-shadow .3s ease; }
      .jobpilotto-flash { box-shadow: 0 0 0 3px rgba(255,178,36,.8), 0 0 24px 6px rgba(255,178,36,.35) !important;
        animation: jobpilotto-pulse 1s ease-in-out 3; transition: box-shadow .3s ease; }
      @media (prefers-reduced-motion: reduce) { .jobpilotto-review, .jobpilotto-flash { animation: none; } }`;
    document.head.append(style);
  };
  function flash(el) {
    el.scrollIntoView({behavior: 'smooth', block: 'center'});
    const target = el.closest('fieldset') || el;
    glowStyle();
    target.classList.remove('jobpilotto-flash');
    void target.offsetWidth;  // restart the pulse when the same field is shown again
    target.classList.add('jobpilotto-flash');
    setTimeout(() => target.classList.remove('jobpilotto-flash'), 3500);
    // The cursor goes into text fields only: a dropdown would open its menu, a box would look ticked-by-us.
    if (!['checkbox', 'radio', 'file'].includes(el.type) && el.getAttribute('role') !== 'combobox' && el.tagName !== 'SELECT') el.focus({preventScroll: true});
  }
  window.__jobPilottoPanelForm = {KNOCKOUT, AGREE, clean, norm, visible, question, fields, find, flash};
})();
