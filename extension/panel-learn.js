// What the panel learns from the person and reports to the app, never typing or clicking in the form: controls the form model did not read (kind and shape
// only), what you answered yourself and what the fill missed (labels and kinds, never a value), and the Submit press. Injected before review.js (panel-files.js);
// review.js calls window.__jobPilottoPanelLearn.start(...) once the panel mounts. Guarded by worker/test/submit-press, panel-widgets, extension-files.
(() => {
  window.__jobPilottoPanelLearn = {start({send, alive, form, mine}) {
  const {fields, question, visible, clean} = form;
  // ---- controls the form model did not read (learning input; see page/skeleton.js) ----
  // A widget that is not a native input and is part of no field the panel counted: its fingerprint, structure (no text) and
  // question go to the app, once per page, so the same widget elsewhere can be learned. Nothing about the fill changes.
  const missSent = new Set();
  let missChecked = 0;
  function reportMisses(list) {
    const kit = window.__jobPilottoSkeleton;
    if (!kit || Date.now() - missChecked < 8000 || missSent.size >= 10) return;
    missChecked = Date.now();
    const items = [];
    for (const {el, kind} of kit.widgets(document, visible)) {
      if (list.some(field => !field.custom && (field.el === el || field.el?.contains?.(el) || el.contains(field.el)))) continue;
      const shape = kit.skeleton(el), fingerprint = kit.fingerprint(shape);
      if (missSent.has(fingerprint)) continue;
      missSent.add(fingerprint);
      items.push({fingerprint, kind, skeleton: shape, question: question(el).slice(0, 120)});
      if (missSent.size >= 10) break;
    }
    if (items.length) send({type: 'misses', items}).catch(() => {});
  }

  // Was this form actually submitted? A submission is an event, and the page's own panel is the only thing that can
  // see it (the worker cannot read a page's events). The press is recorded, never sent by us: this listens, it does
  // not click. It is what lets the app mark a job Applied on evidence instead of on wording that looks like a
  // confirmation (1 Oct 2026: an unsubmitted job was marked Applied because a page said "thank you for applying").
  // A submit control, not an "Apply" link that only opens the form. The press is recorded. Marking waits
  // for the tab to land on another page, which the app then reads.
  // Taken at the press, before the site navigates or replaces the form, so the later read can see what changed.
  const snapshot = () => {
    const clip = value => String(value || '').replace(/\s+/g, ' ').trim();
    const headings = [...document.querySelectorAll('h1, h2')].map(el => clip(el.innerText)).filter(Boolean).slice(0, 6);
    const inputs = [...document.querySelectorAll('input, textarea, select')].filter(el => el.type !== 'hidden' && el.getClientRects().length).length;
    return {title: clip(document.title).slice(0, 180), headings, text: clip(document.body?.innerText).slice(0, 800), inputs};
  };
  // What you answered yourself, kept for next time. Only fields YOU changed count: a person's typing and picking are trusted
  // events, the extension's own writes are not. Read at the Submit press (before the page moves on) and sent to the app,
  // which saves them (desktop/lib/learned.js). Never a password, card, code or a long free text.
  const typed = new Set();
  for (const kind of ['input', 'change']) {
    document.addEventListener(kind, event => { if (event.isTrusted && event.target?.matches?.('input, textarea, select')) typed.add(event.target); }, true);
  }
  const SECRET = /password|passwort|mot de passe|card\s*number|cvv|cvc|iban|\bssn\b|social security|captcha|one-?time|verification code|security code/i;
  const learned = () => {
    const out = new Map();
    for (const el of typed) {
      const type = String(el.type || '').toLowerCase();
      if (!el.isConnected || el.disabled || ['password', 'file', 'checkbox', 'hidden', 'submit', 'button'].includes(type)) continue;
      let value, kind = 'text';
      if (type === 'radio') {
        if (!el.checked) continue;
        value = clean(el.labels?.[0]?.textContent || el.value);
        kind = 'option';
      } else if (el.tagName === 'SELECT') {
        const chosen = el.selectedOptions?.[0];
        if (!chosen || !chosen.value) continue;
        value = clean(chosen.textContent);
        kind = 'option';
      } else value = clean(el.value);
      const label = question(el).slice(0, 120);
      if (!label || !value || value.length > 300 || SECRET.test(label)) continue;
      out.set(label.toLowerCase(), {label, value, kind});
    }
    return [...out.values()].slice(0, 40).map(item => ({...item, remember: remembered(item.label)}));
  };
  // Remember (PR C, owner 28 Oct 2026): per typed answer, on by default; the app says off for a question that belongs to one employer (its AI verdict, never a word
  // match here: lib/learned.js rememberDefaults). The person's own switch wins; a default not answered yet stays on.
  const chosen = new Map(), defaults = new Map(), asked = new Set();
  const remembered = label => (chosen.has(label.toLowerCase()) ? chosen.get(label.toLowerCase()) : defaults.get(label.toLowerCase()) !== false);
  const showMine = () => {
    const box = mine?.box, list = mine?.list;
    if (!box || !list) return;
    const items = learned().filter(item => item.kind === 'text' || item.kind === 'option');
    const fresh = items.map(item => item.label).filter(label => !asked.has(label.toLowerCase()));
    if (fresh.length) {
      fresh.forEach(label => asked.add(label.toLowerCase()));
      send({type: 'rememberDefaults', url: location.href, labels: fresh}).then(reply => {
        for (const [label, on] of Object.entries(reply?.remember || {})) defaults.set(label.toLowerCase(), on !== false);
        showMine();
      }).catch(() => {});
    }
    box.hidden = !items.length;
    list.replaceChildren(...items.map(item => {
      const row = Object.assign(document.createElement('div'), {className: 'item'}), what = document.createElement('div'), name = document.createElement('b'), value = document.createElement('span');
      what.className = 'what'; name.textContent = item.label; value.textContent = item.value; what.append(name, value);
      const label = document.createElement('label'), input = Object.assign(document.createElement('input'), {type: 'checkbox', checked: item.remember});
      input.addEventListener('change', () => { chosen.set(item.label.toLowerCase(), input.checked); });
      label.append(input, 'Remember');
      row.append(what, label);
      return row;
    }));
  };
  // A sign-in or sign-up page (a password box): said with every message, so the worker never takes it for the application.
  const accountNow = () => !!document.querySelector('input[type=password]');
  const noteLearned = () => { const items = learned(); if (items.length) send({type: 'learned', url: location.href, items, account: accountNow()}).catch(() => {}); };
  // What the fill missed, seen at Submit: the questions you answered yourself that the fill left (by_you) or never read
  // (by_you_unread), and those the page then flags as wrong or missing. Labels (the form's wording) and kinds only, never a
  // value. Counted per board by the product; a question the fill never read is a reading failure to learn from.
  const touched = new Set();
  document.addEventListener('click', event => { if (event.isTrusted && event.target instanceof Element) touched.add(event.target); }, true);
  const kindOf = el => el.getAttribute?.('role') || (el.tagName === 'INPUT' ? el.type : el.tagName?.toLowerCase()) || '';
  const byYou = list => {
    const mine = [...typed, ...touched].filter(el => el.isConnected);
    const out = [];
    for (const entry of list) {
      if (entry.byUs || entry.ai || !entry.filled || !entry.label) continue;
      if (String(entry.el?.type || '').toLowerCase() === 'password') continue;   // an account field (Keychain), never a question the fill missed
      const area = entry.unread || entry.custom ? entry.el : entry.el.closest?.('fieldset') || entry.el;
      const name = entry.el.name;
      if (!mine.some(el => el === entry.el || area.contains(el) || (name && el.name === name))) continue;
      out.push({label: entry.label.slice(0, 120), kind: entry.unread ? 'unread' : kindOf(entry.el), unread: !!entry.unread});
    }
    return out.slice(0, 30);
  };
  const flagged = () => {
    const list = fields();
    const bad = list.filter(entry => entry.required && !entry.filled).map(entry => entry.label);
    for (const el of document.querySelectorAll('[aria-invalid=true]')) {
      if (!visible(el)) continue;
      const label = question(el);
      if (label && !bad.includes(label)) bad.push(label);
    }
    return bad.filter(Boolean).slice(0, 20).map(label => label.slice(0, 120));
  };
  let submitNoted = 0;
  const noteMissed = () => {
    if (Date.now() - submitNoted < 3000) return;   // a form's submit event and its button's click are one press
    submitNoted = Date.now();
    const answered = byYou(fields());
    // The fill's record (fill-card.js), so the digest knows this form was submitted and what you answered yourself.
    const fillId = document.documentElement.dataset.jobpilottoFillId || '';
    if (answered.length || fillId) send({type: 'formLearning', url: location.href, byYou: answered, fillId, submitted: true, account: accountNow()}).catch(() => {});
    // Still here a moment later: the page refused the submit; what it flags is what was missed or wrong.
    setTimeout(() => {
      if (!alive()) return;
      const invalid = flagged();
      if (invalid.length) send({type: 'formLearning', url: location.href, invalid, fillId: document.documentElement.dataset.jobpilottoFillId || '', account: accountNow()}).catch(() => {});
    }, 2500);
  };
  const noteSubmit = () => { noteLearned(); noteMissed(); send({type: 'submitted', url: location.href, snapshot: snapshot(), account: accountNow()}).catch(() => {}); };
  document.addEventListener('submit', event => { if (window.__jobPilottoSubmitPress?.person(event) !== false) noteSubmit(); }, true);   // a form the extension's own press submitted is not the person's submit
  document.addEventListener('click', event => {
    const button = event.target?.closest?.('button, input[type=submit], [role=button]');
    if (window.__jobPilottoSubmitPress?.person(event) === false || !button) return;   // a script's click is the extension's own press, never the person's
    const words = `${button.textContent || ''} ${button.getAttribute?.('aria-label') || ''} ${button.name || ''} ${button.value || ''}`;
    if (window.__jobPilottoSubmitPress?.counts(button, words)) noteSubmit();   // page/submit-press.js: written type=submit, or the Submit floor; never the typeless default
  }, true);
  return {reportMisses, showMine};
  }};
})();
