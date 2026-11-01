// A real DOM (jsdom) with the extension's page scripts loaded, for replay and snapshot tests: what Chrome gives the
// extension that jsdom lacks (layout, CSS.escape, trusted clicks) is filled in just enough for fill.js.
import fs from 'node:fs';
import { PAGE_FILES } from '../../../extension/page-files.js';

const read = (path) => fs.readFileSync(new URL(`../../../${path}`, import.meta.url), 'utf8');
export const PAGE_SCRIPTS = PAGE_FILES.map(file => `extension/${file}`);   // as the extension injects them

// jsdom is a dev dependency: CI installs it (npm ci). A worktree whose linked node_modules predates it skips the
// DOM tests locally with a note instead of failing every other suite; `npm install` in worker/ brings it.
export async function loadJsdom() {
  try { return (await import('jsdom')).JSDOM; } catch (error) {
    if (process.env.CI) throw error;
    return null;
  }
}

// patch: {path: source => source}, a planted bug for the learning-loop test (app-core/test/fill-learning.test.js).
export function openPage(JSDOM, html, { url = 'https://job-boards.greenhouse.io/replay/jobs/1', patch = {} } = {}) {
  const dom = new JSDOM(`<!doctype html><html><head></head><body>${html}</body></html>`, { url, runScripts: 'outside-only', pretendToBeVisual: true });
  const { window } = dom;
  const hidden = (el) => !!el.closest('[hidden], [style*="display: none"], [style*="display:none"]');
  window.Element.prototype.getClientRects = function () { return hidden(this) ? [] : [{ width: 100, height: 20 }]; };
  window.Element.prototype.getBoundingClientRect = function () { return { left: 0, top: 0, width: 100, height: 20, right: 100, bottom: 20 }; };
  Object.defineProperty(window.HTMLElement.prototype, 'offsetParent', { get() { return hidden(this) ? null : window.document.body; } });
  window.Element.prototype.scrollIntoView = () => {};
  // jsdom has no ::before/::after styles (Chrome does: coverage.js reads a "*" drawn there): an empty one, not a console error.
  const styleOf = window.getComputedStyle.bind(window);
  window.getComputedStyle = (el, pseudo) => (pseudo ? { content: 'none', getPropertyValue: () => '' } : styleOf(el));
  window.CSS = { escape: (s) => String(s).replace(/["\\\]\[]/g, '\\$&') };
  // Chrome only opens a menu for a real (trusted) click; the test's "user click" is marked and reads as trusted.
  const listeners = new WeakMap();
  const add = window.EventTarget.prototype.addEventListener, remove = window.EventTarget.prototype.removeEventListener;
  window.EventTarget.prototype.addEventListener = function (type, listener, options) {
    if (typeof listener !== 'function') return add.call(this, type, listener, options);
    const wrapped = function (event) {
      if (!event.__jpTrusted) return listener.call(this, event);
      return listener.call(this, new Proxy(event, { get: (target, key) => (key === 'isTrusted' ? true
        : typeof target[key] === 'function' ? target[key].bind(target) : target[key]) }));
    };
    listeners.set(listener, wrapped);
    return add.call(this, type, wrapped, options);
  };
  window.EventTarget.prototype.removeEventListener = function (type, listener, options) {
    return remove.call(this, type, listeners.get(listener) || listener, options);
  };
  window.__jobadabraNoGuard = true;
  for (const path of PAGE_SCRIPTS) window.eval(patch[path] ? patch[path](read(path)) : read(path));
  return window;
}

// The user's click on an armed dropdown: a trusted mousedown on its control.
export function userClick(window, control) {
  const event = new window.MouseEvent('mousedown', { bubbles: true, cancelable: true });
  event.__jpTrusted = true;
  control.dispatchEvent(event);
}
