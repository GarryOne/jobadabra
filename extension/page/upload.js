// The upload operator: puts a file (the CV, a cover letter) into an upload slot, however the page draws it. A slot is found by structure
// (page/skeleton.js uploadSlots: a native file input, visible or hidden behind a styled label, or a pressable that creates the input when
// pressed, as SuccessFactors does). What a slot asks for is a meaning, not a word list here: the service's phrases first, then the floor of
// words everyone knows (extension/alias-schema.js fileKind, copied below as a plain script and kept in step by a test); a wording neither
// knows is left empty and reported so the pack can learn it. The result is verified by re-reading the page, and the slot's fingerprint
// lets the recipe library (extension/recipe-schema.js, operator "upload", param "trigger") say what opens a slot this code cannot.
// It never presses anything that looks like a submit control. Loaded in the page before fill.js (PAGE_FILES in extension/flow.js); guarded by
// desktop/e2e/test/upload-slot.test.mjs (the shapes of slots; JP_LIVE=1 also the real Coop form) and app-core/test/upload.test.js.
(() => {
  const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
  const visible = el => !!(el.getClientRects().length && getComputedStyle(el).visibility !== 'hidden');
  const clean = text => String(text || '').replace(/\s+/g, ' ').trim();
  const FILE_KEYS = ['resume', 'cover_letter'];
  const FILE_FLOOR = {
    resume: /\b(resume|r[ée]sum[ée]|cv|c\.v\.|curriculum|lebenslauf)\b/i,
    cover_letter: /\b(cover\s*letter|motivation\s*letter|anschreiben|bewerbungsschreiben|lettre\s+de\s+motivation|lettera\s+di\s+(presentazione|motivazione)|carta\s+de\s+presentaci[oó]n|carta\s+de\s+apresenta[cç][aã]o)\b/i,
  };
  // The same cleaning as cleanLabel in alias-schema.js, for a phrase the pack holds.
  const cleanLabel = label => String(label ?? '').toLowerCase().replace(/\s+/g, ' ').trim().replace(/\*+/g, '').replace(/\((optional|required|erforderlich|obligatoire)\)/g, '')
    .replace(/^\s*\d+[.)]\s+/, '').replace(/[\s:;,.?!-]+$/g, '').trim();
  function fileKind(label, aliases) {
    const text = cleanLabel(label);
    if (!text) return '';
    for (const item of Array.isArray(aliases) ? aliases : []) {
      if (!item || !FILE_KEYS.includes(item.key) || !item.phrase) continue;
      if (text === item.phrase || ` ${text} `.includes(` ${item.phrase} `)) return item.key;
    }
    const found = FILE_KEYS.filter(key => FILE_FLOOR[key].test(text));
    return found.length === 1 ? found[0] : '';
  }

  const kit = () => window.__jobadabraSkeleton;
  const fingerprintOf = el => { try { return kit() ? kit().fingerprint(kit().skeleton(el)) : ''; } catch { return ''; } };
  const textOf = el => el.innerText ?? el.textContent ?? '';   // innerText is the words a person sees; a DOM without layout has only textContent

  // The slots on the page, each with what it asks for (title), whether the page marks it required, whether it holds a file now.
  function slots(doc = document) {
    if (!kit()?.uploadSlots) return [];
    return kit().uploadSlots(doc, visible).map(slot => {
      const start = slot.input || slot.trigger;
      // Wrappers that hold only the widget and no words of their own are stepped through: the label sits beside the widget further in (a field > group > label + widget).
      const ownWords = el => Array.from(el.childNodes).some(node => node.nodeType === 3 && node.textContent.trim());
      let box = slot.el;
      while (box.children.length === 1 && box.children[0] !== start && box.children[0].contains(start) && !ownWords(box)) box = box.children[0];
      let child = start;
      while (child.parentElement && child.parentElement !== box) child = child.parentElement;
      // The title is the field's text outside the widget itself; a widget alone in its field has only its own words.
      const title = clean(Array.from(box.children).filter(el => el !== child).map(textOf).join(' ')) || clean(textOf(slot.el));
      const hints = slot.input ? `${slot.input.getAttribute('aria-label') || ''} ${slot.input.name || ''} ${slot.input.id || ''}` : '';
      // Holds a file: the one reading (page/read-back.js): the input's file, or a file name the slot shows; this extension's own mark alone is not a file (one truth with the panel).
      const holds = slot.input ? window.__jobadabraReadBack?.fileState(slot.input) === 'committed'
        : [slot.el.dataset.jobadabraFile, ...(window.__jobadabraAttached || [])].some(name => !!name && textOf(slot.el).includes(name));   // a slot that is only a button: it shows a file we attached (by name: the page may have redrawn the field and lost our mark on it)
      return {...slot, title: title.slice(0, 160), hints, fp: fingerprintOf(slot.el), filled: holds,
        required: /\*/.test(title) || !!slot.input?.required || slot.input?.getAttribute('aria-required') === 'true' || slot.trigger?.getAttribute('aria-required') === 'true'};
    });
  }
  // What a slot asks for, from its title (then the input's own aria-label/name): 'resume', 'cover_letter' or ''.
  const meaningOf = (slot, aliases) => fileKind(slot.title, aliases) || fileKind(slot.hints, aliases);
  // The app's AI picked, from the titles of the slots that could take the CV, the one that takes it as a document (window.__jobadabraUploadChoice = {resume: title}, set by flow.js):
  // that slot is the CV slot, and another that only a word called a CV (an "Import data from my CV" feature that reads the file to fill the form) gets no file.
  // A slot's own title can miss its field's label (Louis Vuitton: the label block sits more than 6 levels above the hidden input): the AI sees the wider title, climbed further
  // by the same stops (never past a parent that holds another slot or any other control).
  const OTHERS = 'input:not([type=file]):not([type=hidden]):not([type=submit]):not([type=button]), select, textarea';
  const wideTitle = (slot, all) => {
    let el = slot.el;
    for (let i = 0; i < 10; i++) {
      const parent = el.parentElement;
      if (!parent || parent === document.body || parent.querySelector(OTHERS) || all.some(other => other !== slot && parent.contains(other.el))) break;
      el = parent;
    }
    // What the page itself says labels the slot, by reference (aria-labelledby / aria-describedby of its input or trigger, a <label for>): the label block can sit where no climb reaches.
    const control = slot.input || slot.trigger, named = new Set();
    const ids = [control?.getAttribute('aria-labelledby'), control?.getAttribute('aria-describedby')].join(' ').split(/\s+/).filter(Boolean);
    const refs = [...ids.map(id => document.getElementById(id)), ...(control?.labels ? [...control.labels] : [])].filter(Boolean);
    const said = refs.map(ref => clean(textOf(ref)).slice(0, 80)).filter(text => text && !named.has(text) && named.add(text));
    return clean([...said, textOf(el)].join(' ')).slice(0, 160);
  };
  const choice = () => cleanLabel(window.__jobadabraUploadChoice?.resume || '');
  const named = (slot, aliases, all) => {
    const meaning = meaningOf(slot, aliases), picked = choice();
    return !picked ? meaning : cleanLabel(wideTitle(slot, all)) === picked ? 'resume' : meaning === 'resume' ? '' : meaning;
  };
  // The wider titles of the slots that could take the CV (not a cover-letter slot), when two or more could: what the app is asked to choose among. Fewer: nothing to choose.
  function cvCandidates(doc = document, aliases = window.__jobadabraAliases || []) {
    const all = slots(doc), titles = all.filter(slot => meaningOf(slot, aliases) !== 'cover_letter').map(slot => wideTitle(slot, all)).filter(Boolean);
    return titles.length >= 2 ? [...new Set(titles)] : [];
  }

  // The rows the form audit lists for uploads: the CV slot keeps the field name "resume" (what the panel and the session page know).
  function rows(doc = document, aliases = window.__jobadabraAliases || []) {
    const all = slots(doc);
    return all.map((slot, i) => {
      const meaning = named(slot, aliases, all) || (all.length === 1 ? 'resume' : '');
      return {field: meaning || `upload_${i + 1}`, label: slot.title || 'Upload', type: 'file', required: slot.required, legal: false, filled: slot.filled};
    });
  }

  // A pressable slot whose file input already exists beside it, hidden (Louis Vuitton: a "cargar archivo" button, its input in the same field): that input, with no press (a press
  // opens the system's file dialog over the person's page). The nearest ancestor of the trigger that holds exactly one file input, empty and not another slot's. Else null.
  function nearbyInput(slot, owned = new Set()) {
    if (!slot.trigger) return null;
    for (let el = slot.trigger.parentElement, i = 0; el && el !== document.body && i < 8; el = el.parentElement, i++) {
      const inputs = [...el.querySelectorAll('input[type=file]')];
      if (!inputs.length) continue;
      return inputs.length === 1 && !inputs[0].files?.length && !owned.has(inputs[0]) ? inputs[0] : null;
    }
    return null;
  }

  // A pressable slot whose file input the page made by script, hidden and detached (a drop-zone library appends it to <body>): the one empty file input outside every field of
  // the page's slots and every form, used with no press. Exactly one: with two, nothing says which is this slot's. Else null.
  function detachedInput(slot, all) {
    if (!slot.trigger || all.filter(item => item.trigger && !item.input).length !== 1) return null;
    const free = [...document.querySelectorAll('input[type=file]')].filter(input => !input.files?.length && !input.closest('form, fieldset') && !all.some(item => item.el.contains(input)));
    return free.length === 1 && free[0].parentElement === document.body ? free[0] : null;
  }

  // Press the slot's trigger (or the one a recipe names) and wait for the file input the page creates.
  async function reveal(slot, params = {}, owned = new Set()) {
    let trigger = slot.trigger;
    if (params.trigger) { try { trigger = slot.el.querySelector(params.trigger) || trigger; } catch { /* a recipe's selector is data: ignore a bad one */ } }
    if (!trigger || trigger.type === 'submit') return null;
    const before = new Set(document.querySelectorAll('input[type=file]'));
    (globalThis.__jobadabraPress?.(trigger) || trigger.click());
    for (let tries = 0; tries < 10; tries++) {
      await sleep(150);
      // The input the page creates, or one it already had and SHOWS now, empty and not another slot's (a choice among ways to give the CV: Upload / Paste / Later
      // reveals its own part, and an earlier press may have shown it already).
      const fresh = Array.from(document.querySelectorAll('input[type=file]')).find(el => !before.has(el) || (!owned.has(el) && !el.files?.length && el.getClientRects().length));
      if (fresh) return fresh;
    }
    return null;
  }

  // Put the file into the input, tell the page, and check the page took it: the input still holds it, or the page consumed the input, or the
  // slot visibly changed. A file the person chose stays; one this extension attached earlier is replaced by a different file (a CV tailored later).
  async function attach(slot, input, file, revealed) {
    window.__jobadabraReadBack?.baseline(input);   // what the slot showed before our file (page/read-back.js): a name there now is not ours
    const ours = input.dataset.jobadabraFile;
    if (input.files?.length && !(ours && input.files[0].name === ours && ours !== file.name)) return {ok: true, why: 'already holds a file'};
    const holder = revealed ? input.closest('fieldset, form') || input.parentElement || slot.el : slot.el;   // a revealed input's own area, not the trigger's
    const before = holder.outerHTML.length;
    const bytes = Uint8Array.from(atob(file.data), c => c.charCodeAt(0));
    const transfer = new DataTransfer();
    transfer.items.add(new File([bytes], file.name, {type: file.type || 'application/pdf'}));
    input.files = transfer.files;
    input.dataset.jobadabraFile = file.name;
    slot.el.dataset.jobadabraFile = file.name;
    (window.__jobadabraAttached ||= new Set()).add(file.name);   // by name, for a field the page redraws (the mark above is lost with the element)
    input.dispatchEvent(new Event('input', {bubbles: true}));
    input.dispatchEvent(new Event('change', {bubbles: true}));
    await sleep(revealed ? 800 : 150);
    if (revealed) document.dispatchEvent(new KeyboardEvent('keydown', {key: 'Escape', bubbles: true}));
    const kept = input.isConnected ? input.files?.[0]?.name === file.name : true;
    const changed = holder.outerHTML.length !== before || slot.el.outerHTML.length !== before || !input.isConnected;
    return kept && (changed || !revealed) ? {ok: true} : {ok: false, why: kept ? 'the page did not show the file' : 'the page cleared the file'};
  }

  // The order the slots are given their files: a slot the page marks required before an optional one, else the page's order. Two slots that both read as the CV and no AI pick
  // between them (an optional "Autofill from resume" import box above the form's required CV slot): the required one takes the file, the other is then "already given"
  // (flow-checks' replay checks, 13 Oct 2026: the import box took it and the CV slot stayed empty; recorded cv-to-required-slot-1).
  const fillOrder = all => [...all].sort((a, b) => Number(!!b.required) - Number(!!a.required));
  // files: {resume, coverLetter} (each {data: base64, name, type} or absent). -> one result per slot:
  // {meaning, fp, recipe, ok, why, label} where ok is true/false only when the slot was operated (a failure is a miss to report);
  // a slot with no file for it, or with a wording nobody knows, is {ok: undefined, why} and is never touched.
  async function fill(files, {aliases = window.__jobadabraAliases || [], recipes = window.__jobadabraRecipes || {}, doc = document} = {}) {
    const all = slots(doc);
    const results = [];
    const given = new Set();   // a document given by one slot is not given again by another way of giving it (Upload CV, then Copy and paste CV: the second press hid the first's input)
    for (const slot of fillOrder(all)) {
      // A lone slot with a wording nobody knows takes the CV, as a lone file input always did.
      const meaning = named(slot, aliases, all) || (all.length === 1 ? 'resume' : '');
      const label = cleanLabel(slot.title).slice(0, 60);
      const recipe = recipes[slot.fp]?.operator === 'upload' ? recipes[slot.fp] : null;
      const base = {meaning, fp: slot.fp, recipe: recipe ? recipe.version : 0, label};
      const file = meaning === 'resume' ? files.resume : meaning === 'cover_letter' ? files.coverLetter : null;
      if (!meaning) { results.push({...base, why: 'wording unknown'}); continue; }
      if (!file?.data) { results.push({...base, why: 'no file for it'}); continue; }
      if (given.has(meaning)) { results.push({...base, why: 'already given through another slot'}); continue; }
      // A slot of buttons only that already shows a file (the chip a page draws after an attach): its button is the remove button, never pressed again (a second pass found "no place to attach it").
      if (!slot.input && slot.filled) { given.add(meaning); results.push({...base, ok: true, why: 'already holds a file'}); continue; }
      // A file input on the page already holds a file (the person chose one, or an earlier pass attached it) and belongs to this meaning or to no known one: a trigger is NOT pressed again,
      // since pressing it opens the system's file dialog over the person's page (owner, 9 Oct 2026: "I uploaded the CV, but then it opened again").
      if (!slot.input && all.some(item => item.input?.files?.length && (named(item, aliases, all) || meaning) === meaning)) { given.add(meaning); results.push({...base, ok: true, why: 'already holds a file'}); continue; }
      try {
        const near = slot.input ? null : nearbyInput(slot, new Set(all.filter(item => item.input && (named(item, aliases, all) || meaning) !== meaning).map(item => item.input))) || detachedInput(slot, all);
        const revealed = !slot.input && !near;
        const input = slot.input || near || await reveal(slot, recipe?.params || {}, new Set(all.filter(item => item.input && (named(item, aliases, all) || meaning) !== meaning).map(item => item.input)));   // another slot's input only when its wording is known and differs: an unnamed one beside the triggers is the part the trigger reveals
        if (!input) { results.push({...base, ok: false, why: 'no file input appeared'}); continue; }
        const done = await attach(slot, input, file, revealed);
        if (done.ok) given.add(meaning);
        results.push({...base, ...done});
      } catch (error) { results.push({...base, ok: false, why: String(error.message || error).slice(0, 80)}); }
    }
    return results;
  }

  // The fingerprints of the slots here: what the app is asked recipes for.
  const fingerprints = (doc = document) => [...new Set(slots(doc).map(slot => slot.fp).filter(Boolean))];

  const api = {slots, rows, fill, fillOrder, fingerprints, fileKind, meaningOf, cvCandidates};
  if (typeof module !== 'undefined' && module.exports) module.exports = api; else window.__jobadabraUpload = api;
})();
