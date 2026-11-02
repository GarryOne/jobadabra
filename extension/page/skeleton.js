// What a control is made of, without what it says: the first step of learning from forms we could not read (docs: Notion
// "Self-improving form filling"). A control's skeleton is its tags, roles and aria flags, with class names reduced to their
// words (build hashes dropped). It never holds text, values, placeholders, ids or addresses, so the same widget on two sites
// has the same fingerprint, and nothing a person typed can leave the page. Also loaded by the tests (module.exports).
(() => {
  // Attributes that say how a control behaves. Not value, placeholder, name, id, href, title or any text.
  const ATTRS = ['role', 'type', 'aria-pressed', 'aria-checked', 'aria-expanded', 'aria-haspopup', 'aria-autocomplete',
    'aria-selected', 'aria-multiselectable', 'aria-orientation', 'contenteditable', 'required', 'multiple', 'inputmode'];
  const STATE = new Set(['aria-pressed', 'aria-checked', 'aria-expanded', 'aria-selected']);
  const MAX_DEPTH = 4, MAX_CHILDREN = 12, MAX_CLASSES = 6;

  // "_yesno_1e3gg_148" -> "yesno"; "css-1x2y3z", "sc-bdVaJa", "a1b2c3d" -> dropped; "ashby-form-input-yesno" stays.
  function classWords(el) {
    const raw = typeof el.className === 'string' ? el.className : String(el.getAttribute?.('class') || '');
    const words = new Set();
    for (const token of raw.split(/\s+/).filter(Boolean)) {
      const module = /^_?([A-Za-z][A-Za-z0-9-]*?)_[a-z0-9]{4,8}(?:_\d+)?$/.exec(token);
      const word = module ? module[1] : token;
      if (/^(css|sc|jsx|emotion|svelte|chakra|mui|Mui)-?[A-Za-z0-9]*$/.test(word) && /\d/.test(word)) continue;
      if (/^[a-z]{0,2}\d[a-z0-9]{3,}$/i.test(word) || word.length < 3 || word.length > 40) continue;
      words.add(word.toLowerCase());
    }
    return [...words].sort().slice(0, MAX_CLASSES);
  }

  function node(el, depth) {
    const attrs = {};
    for (const name of ATTRS) {
      const value = el.getAttribute?.(name);
      if (value === null || value === undefined) continue;
      // What kind of thing it is stays; whether it is pressed, checked, open or selected right now does not.
      attrs[name] = STATE.has(name) || !(name === 'type' || name === 'role' || name.startsWith('aria-')) ? '' : String(value).slice(0, 24);
    }
    const kids = depth >= MAX_DEPTH ? [] : [...(el.children || [])].slice(0, MAX_CHILDREN).map(child => node(child, depth + 1));
    return {t: String(el.tagName || '').toLowerCase(), a: attrs, c: classWords(el), k: kids};
  }
  const skeleton = el => node(el, 0);

  // Canonical text of a skeleton; repeated identical siblings collapse to "*2", so a 2-option and a 3-option group differ
  // only by that count.
  function canonical(n) {
    const own = `${n.t}${Object.entries(n.a).map(([k, v]) => `[${k}${v ? `=${v}` : ''}]`).join('')}${n.c.length ? `.${n.c.join('.')}` : ''}`;
    const parts = [];
    for (const kid of n.k.map(canonical)) {
      const last = parts[parts.length - 1];
      if (last && last.text === kid) last.count++; else parts.push({text: kid, count: 1});
    }
    return parts.length ? `${own}(${parts.map(p => p.count > 1 ? `${p.text}*${p.count}` : p.text).join(',')})` : own;
  }
  // A short, stable name for a structure (cyrb53).
  function hash(text) {
    let h1 = 0xdeadbeef, h2 = 0x41c6ce57;
    for (let i = 0; i < text.length; i++) {
      const code = text.charCodeAt(i);
      h1 = Math.imul(h1 ^ code, 2654435761);
      h2 = Math.imul(h2 ^ code, 1597334677);
    }
    h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
    h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
    return (4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(36);
  }
  const fingerprint = n => hash(canonical(n));

  // Interactive widgets that are not a native input/textarea/select, found by what they do. `shown(el)` says if it is visible.
  const WIDGETS = [
    ['switch', '[role=switch]'],
    ['radiogroup', '[role=radiogroup]'],
    ['listbox', '[role=listbox]'],
    ['slider', '[role=slider]'],
    ['custom-select', 'button[aria-haspopup=listbox], div[role=combobox], button[role=combobox]'],
    ['rich-text', '[contenteditable=true], div[role=textbox]'],
  ];
  // Upload slots, found by structure: a native file input (visible, or hidden behind a styled label), or a pressable control that sits in a part
  // of the page whose class or id names uploading or attaching (the + of SuccessFactors, which creates its file input only when pressed). A slot
  // is its "field": the widest ancestor that holds this one slot and no other form control, so the title above the widget is part of it.
  // -> [{el: the field, input: a native file input or null, trigger: the pressable that opens one or null}]. Structure only: no wording.
  const REVEAL = /attach|upload|dropzone|dropbox/i;
  const OWN = '[id^=jobadabra], #jobadabra-review-host';
  const POPUP = '[role=dialog], [class*=popup], [class*=callout]';
  const FIELDS = 'input:not([type=file]):not([type=hidden]):not([type=submit]):not([type=button]), select, textarea';
  // A popup beside the form (a source picker the + opens) holds no other form control; a dialog that holds the form's own fields IS the form (an application drawn as a sheet).
  const apart = el => !!el.closest(OWN) || (popup => !!popup && !popup.querySelector(FIELDS))(el.closest(POPUP));
  function uploadSlots(root, shown = () => true) {
    const starts = [];
    for (const input of root.querySelectorAll('input[type=file]')) if (!apart(input)) starts.push({input, trigger: null, start: input});
    // Pressables are grouped by the part of the page that names uploading (their parent if its class or id does, else themselves, else the nearest ancestor within three levels that does), so a widget with
    // several pressables (an info icon beside the +) is one slot, not several.
    const named = new Map();
    const names = el => REVEAL.test(`${String(el.className?.baseVal ?? el.className ?? '')} ${el.id || ''}`);
    // The part of the page that names uploading around a pressable: the pressable itself, or the nearest ancestor within three levels that does (a drop zone's
    // button sits two levels under the container that says so), never one that also holds another form control (that is the whole form, not this widget).
    const OTHER = 'input:not([type=file]):not([type=hidden]):not([type=submit]):not([type=button]), select, textarea';
    const namedPart = el => {
      if (el.parentElement && names(el.parentElement)) return el.parentElement;
      if (names(el)) return el;
      for (let up = el.parentElement?.parentElement, i = 0; up && i < 3 && up !== root && up.tagName !== 'BODY' && !up.querySelector(OTHER); up = up.parentElement, i++) if (names(up)) return up;
      return null;
    };
    for (const el of root.querySelectorAll('[role=button], button')) {
      if (el.type === 'submit' || apart(el) || !shown(el)) continue;
      const group = namedPart(el);
      // A group that holds a slot's file input is that widget (its Attach, Dropbox… buttons): the input stands for it, never a second slot (two starts stop each other's climb).
      if (group && !named.has(group) && !starts.some(item => group.contains(item.input))) named.set(group, el);
    }
    for (const [group, trigger] of named) starts.push({input: null, trigger, start: group});
    const slots = [];
    const others = 'input:not([type=file]):not([type=hidden]):not([type=submit]):not([type=button]), select, textarea';
    for (const item of starts) {
      let field = item.start;
      for (let i = 0; i < 6; i++) {
        const parent = field.parentElement;
        // Stop before an ancestor that also holds another slot's control, or any other form control.
        if (!parent || parent.querySelector(others) || starts.some(other => parent.contains(other.start) && !field.contains(other.start))) break;
        field = parent;
      }
      const have = slots.find(slot => slot.el === field);
      if (have) { have.input ||= item.input; have.trigger ||= item.trigger; continue; }
      if (shown(field) || item.trigger) slots.push({el: field, input: item.input, trigger: item.trigger});
    }
    return slots;
  }
  function widgets(root, shown = () => true) {
    const found = [];
    for (const slot of uploadSlots(root, shown)) found.push({el: slot.el, kind: 'upload'});
    for (const [kind, selector] of WIDGETS) {
      for (const el of root.querySelectorAll(selector)) if (shown(el)) found.push({el, kind});
    }
    // A group of two or more pressable buttons under one parent (Yes/No, Male/Female, size pickers).
    const pairs = new Map();
    for (const button of root.querySelectorAll('button[aria-pressed], [role=radio], button[aria-checked]')) {
      if (!shown(button) || !button.parentElement) continue;
      if (!pairs.has(button.parentElement)) pairs.set(button.parentElement, 0);
      pairs.set(button.parentElement, pairs.get(button.parentElement) + 1);
    }
    for (const [el, count] of pairs) if (count >= 2) found.push({el, kind: 'toggle-group'});
    return found;
  }

  const api = {skeleton, canonical, fingerprint, classWords, widgets, uploadSlots};
  if (typeof module !== 'undefined' && module.exports) module.exports = api; else window.__jobadabraSkeleton = api;
})();
