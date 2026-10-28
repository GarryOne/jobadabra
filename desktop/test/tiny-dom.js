// A tiny DOM for render tests of renderer pages in Node (no browser): elements, text, attributes, classes, events and simple selectors
// (tag, .class, #id, [attr], [attr="v"], tag.class, descendant with a space). Enough for pages/application-answers.js and pages/job-preferences.js;
// install() sets document, window, Node and Option on globalThis.
class Element {
  constructor(tag) {
    this.tagName = String(tag).toUpperCase(); this.children = []; this.parentNode = null; this.listeners = {}; this.attributes = {};
    this.dataset = {}; this.className = ''; this.hidden = false; this.value = ''; this.disabled = false;
    this.style = {setProperty(name, value) { this[name] = String(value); }};   // custom properties (--p) land as keys
    const self = this;
    this.classList = {add: (...names) => { self.className = [...new Set([...self.className.split(' ').filter(Boolean), ...names])].join(' '); },
      remove: (...names) => { self.className = self.className.split(' ').filter(n => !names.includes(n)).join(' '); },
      toggle: (name, on) => { const has = self.className.split(' ').includes(name); if (on ?? !has) self.classList.add(name); else self.classList.remove(name); },
      contains: name => self.className.split(' ').includes(name)};
  }
  get id() { return this.attributes.id || ''; }
  set id(value) { this.attributes.id = String(value); }
  append(...items) { for (const item of items) { if (item == null) continue; const node = typeof item === 'string' ? new Text(item) : item; node.parentNode = this; this.children.push(node); } }
  prepend(...items) { const old = this.children; this.children = []; this.append(...items); this.children.push(...old); }
  replaceChildren(...items) { this.children = []; this.append(...items); }
  insertBefore(node, ref) { const at = this.children.indexOf(ref); node.parentNode = this; this.children.splice(at < 0 ? this.children.length : at, 0, node); }
  after(...nodes) { const parent = this.parentNode; let at = parent.children.indexOf(this); for (const node of nodes) { node.parentNode = parent; parent.children.splice(++at, 0, node); } }
  replaceWith(node) { const parent = this.parentNode; if (!parent) return; node.parentNode = parent; parent.children[parent.children.indexOf(this)] = node; this.parentNode = null; }
  remove() { if (this.parentNode) this.parentNode.children = this.parentNode.children.filter(c => c !== this); this.removed = true; }
  setAttribute(key, value) { this.attributes[key] = String(value); }
  removeAttribute(key) { delete this.attributes[key]; }
  getAttribute(key) { return this.attributes[key] ?? null; }
  addEventListener(type, fn) { (this.listeners[type] ||= []).push(fn); }
  dispatch(type, event = {}) { for (const fn of this.listeners[type] || []) fn({preventDefault() {}, stopPropagation() {}, target: this, ...event}); }
  click() { this.dispatch('click'); }
  focus() {} select() {} scrollIntoView() {} setSelectionRange() {}
  getBoundingClientRect() { return {top: 0, left: 0, right: 0, bottom: 0, width: 0, height: 0}; }
  get offsetHeight() { return 0; }
  get offsetWidth() { return 0; }
  get isConnected() { for (let node = this; node; node = node.parentNode) if (node.removed) return false; return true; }   // a node never attached still counts as on the page
  contains(node) { return node === this || this.all().includes(node); }
  closest(selector) { for (let node = this; node && node.matches; node = node.parentNode) if (node.matches(selector)) return node; return null; }
  get options() { return this.children.filter(c => c.tagName === 'OPTION'); }
  set textContent(text) { this.children = [new Text(String(text))]; }
  get textContent() { return this.children.map(c => c.textContent).join(''); }
  get innerText() { return this.textContent; }
  all() { return this.children.flatMap(c => (c instanceof Element ? [c, ...c.all()] : [])); }
  matches(selector) {
    return selector.split(',').some(one => {
      const part = one.trim();
      const tag = part.match(/^[a-z]+/i)?.[0], classes = [...part.matchAll(/\.([\w-]+)/g)].map(m => m[1]), id = part.match(/#([\w-]+)/)?.[1];
      const attrs = [...part.matchAll(/\[([\w-]+)(?:="?([^"\]]*)"?)?\]/g)];
      if (tag && this.tagName !== tag.toUpperCase()) return false;
      if (id && this.id !== id) return false;
      if (classes.some(name => !this.classList.contains(name))) return false;
      return attrs.every(([, key, value]) => {
        const actual = key.startsWith('data-') ? this.dataset[key.slice(5).replace(/-(\w)/g, (_, c) => c.toUpperCase())] : key === 'type' ? this.type : this.getAttribute(key);
        return value === undefined ? actual != null : String(actual) === value;
      });
    });
  }
  querySelectorAll(selector) {
    const parts = selector.trim().split(/\s+/);
    let found = this.all().filter(node => node.matches(parts[parts.length - 1]));
    if (parts.length > 1) found = found.filter(node => { let up = node.parentNode; while (up && up !== this) { if (up.matches(parts[parts.length - 2])) return true; up = up.parentNode; } return false; });
    return found;
  }
  querySelector(selector) { return this.querySelectorAll(selector)[0] || null; }
}
class Text { constructor(text) { this.text = text; } get textContent() { return this.text; } }

export function install() {
  const body = new Element('body');
  globalThis.Node = Element;
  globalThis.Option = class extends Element { constructor(text = '', value = text) { super('option'); this.append(String(text)); this.value = String(value); } };
  globalThis.document = {body, createElement: tag => new Element(tag), createElementNS: (_, tag) => new Element(tag), createTextNode: text => new Text(String(text)), listeners: {},
    addEventListener(type, fn) { (this.listeners[type] ||= []).push(fn); },
    dispatchEvent(event) { for (const fn of this.listeners[event.type] || []) fn(event); return true; },
    getElementById: id => body.all().find(node => node.id === id) || null, querySelector: s => body.querySelector(s), querySelectorAll: s => body.querySelectorAll(s)};
  globalThis.window = {pilot: {}, addEventListener() {}, matchMedia: () => ({matches: false, addEventListener() {}})};
  globalThis.localStorage = {getItem: () => null, setItem() {}};
  return body;
}
