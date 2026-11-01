/* global document */
// Capturing a page for the recorded pages (layer 2, spec docs/superpowers/specs/2026-10-10-applying-reliability-layers.md): its STRUCTURE only. In the page
// (snapshotInPage): scripts and event handlers dropped, frames kept as elements, the applied CSS kept (11 Oct 2026), every typed value, check and choice removed, URL queries and fragments cut, the extension's
// own elements left out. Here (scrub): any email but example.*, any phone number and the person's own values (personalValues: from the app's profile.md /
// answers.md) replaced by the fake applicant's. The result goes into a PUBLIC repo; desktop/test/recorded-privacy.test.js checks it again.
// Used by: twin-drive.mjs `capture`, lib/capture-journey.mjs (every page of a live run). Guard: e2e/test/capture-page.test.mjs, capture-journey.test.mjs.
import fs from 'node:fs';
import path from 'node:path';
import {appProfileTexts, personalValues} from '../../lib/owner-values.js';
import {EMAIL, FAKE_EMAIL, FAKE_PHONE, PHONE, fakeContacts} from '../../lib/live-capture.js';   // one fake contact for the page and the live sketch

export {EMAIL, PHONE};
export const FAKE = {email: FAKE_EMAIL, name: 'Candidate', phone: FAKE_PHONE};

export {appProfileTexts, personalValues};   // the person's own values live in desktop/lib/owner-values.js (shared with the product's report)

const escape = text => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const valuesOut = (text, values) => {
  let out = text;
  for (const [value, kind] of values) {
    // A name word in any case but all capitals: "ADA" is the Americans with Disabilities Act, not the fake applicant Ada (11 Oct 2026, coreweave's form).
    if (kind === 'name') out = out.replace(new RegExp(`\\b${escape(value)}\\b`, 'gi'), found => (found.length > 1 && found === found.toUpperCase() ? found : FAKE.name));
    if (kind === 'email') out = out.replace(new RegExp(escape(value), 'gi'), FAKE.email);
  }
  return out;
};
export const scrub = (html, values = new Map()) => valuesOut(fakeContacts(html), values);

// The scrub for a captured PAGE (and its sheets): a web address in an attribute (href, src, action, srcset, poster) or a CSS url() is kept whole from the PHONE scrub: a long digit run in a file name
// (main-12345678901.css) is not a phone number, and replacing it with "(phone)" left an address no replay could serve (HelloFresh, 12 Oct 2026). Everything else stays scrubbed: text, tel:/sms:/mailto:
// links, any non-example email and the person's own values, which are cut from the addresses too. fakeContacts and the memo key's normalisation are unchanged (a key must not move).
const ADDRESS_ATTR = /(\s(?:href|src|action|srcset|poster|data-src|data-href)=")([^"]*)(")/gi, CSS_URL = /url\((["']?)([^)"']*)\1\)/gi, PRIVATE_SCHEME = /^\s*(?:tel|sms|mailto):/i;
export function scrubPage(html, values = new Map()) {
  const held = [], hold = value => `\u0000A${held.push(value) - 1}\u0000`;
  const guarded = String(html).replace(ADDRESS_ATTR, (all, open, value, close) => (PRIVATE_SCHEME.test(value) ? all : `${open}${hold(value)}${close}`))
    .replace(CSS_URL, (all, quote, value) => (PRIVATE_SCHEME.test(value) ? all : `url(${quote}${hold(value)}${quote})`));
  const clean = text => valuesOut(text.replace(EMAIL, email => (/@example\.(com|org|net)$/i.test(email) ? email : FAKE.email)), values);
  return scrub(guarded, values).replace(/\u0000A(\d+)\u0000/g, (all, at) => clean(held[Number(at)]));
}

// Runs IN the page (passed to page.evaluate): the page's structure as one HTML string. The rules the page APPLIES are kept (speed-5x landing 1, 11 Oct 2026:
// the extension decides on geometry: a dialog shown by a class, a frame born 150 px high): a readable sheet (same origin, or a <style>, or rules a script
// inserted) becomes a <style> of its rules; a cross-origin sheet the page cannot read stays a <link> (its text is in the run's styles.har.json, cssRecorder).
// Frames stay as elements (address without query): each frame's own document is captured as its own page (lib/capture-journey.mjs).
export function snapshotInPage() {
  const root = document.documentElement.cloneNode(true);
  // Each control's state at this moment, never its value (12 Oct 2026: the sketch the extension's asks carry lists "filled"/"empty"/"checked"; a replayed page that lost them made the ask differ): data-jp-state on the copy.
  const FIELDS = 'input, textarea, select', liveFields = [...document.querySelectorAll(FIELDS)], copyFields = [...root.querySelectorAll(FIELDS)];
  liveFields.forEach((field, at) => {
    const copy = copyFields[at], type = String(field.type || '').toLowerCase();
    if (!copy || /^(file|submit|button|image|reset|hidden)$/.test(type)) return;
    copy.setAttribute('data-jp-state', /^(checkbox|radio)$/.test(type) ? (field.checked ? 'checked' : 'unchecked') : field.tagName === 'SELECT' ? (field.selectedIndex > 0 ? 'filled' : 'empty') : String(field.value || '') !== '' ? 'filled' : 'empty');
  });
  const SHEETS = 'link[rel~="stylesheet"], style';
  const live = [...document.querySelectorAll(SHEETS)], copies = [...root.querySelectorAll(SHEETS)];
  live.forEach((node, at) => {
    const copy = copies[at];
    if (!copy) return;
    let rules = null;
    try { rules = node.sheet ? [...node.sheet.cssRules].map(rule => rule.cssText).join('\n') : null; } catch { rules = null; }   // a cross-origin sheet: SecurityError
    if (rules === null) { if (copy.tagName === 'STYLE') copy.textContent = ''; return; }
    const style = document.createElement('style');
    style.setAttribute('data-captured', node.tagName === 'LINK' ? 'sheet' : 'style');
    if (node.media && node.media.length) style.setAttribute('media', node.media.mediaText || '');
    style.textContent = rules;
    copy.replaceWith(style);
  });
  try {
    const adopted = (document.adoptedStyleSheets || []).map(sheet => [...sheet.cssRules].map(rule => rule.cssText).join('\n')).join('\n');
    if (adopted) { const style = document.createElement('style'); style.setAttribute('data-captured', 'adopted'); style.textContent = adopted; (root.querySelector('head') || root).append(style); }
  } catch { /* none readable */ }
  for (const node of root.querySelectorAll('script, noscript, object, embed, template, link[rel=preload], link[rel=prefetch], link[rel=modulepreload], meta[http-equiv]')) node.remove();
  for (const node of root.querySelectorAll('iframe[srcdoc], frame[srcdoc]')) node.removeAttribute('srcdoc');
  for (const node of root.querySelectorAll('[id^="jobpilotto"], [class*="jobpilotto"], [data-jobpilotto-panel]')) node.remove();
  for (const node of root.querySelectorAll('*')) {
    for (const attr of [...node.attributes]) {
      if (/^on/i.test(attr.name) || /^data-jobpilotto/i.test(attr.name)) node.removeAttribute(attr.name);
      else if (attr.name === 'srcset') node.setAttribute(attr.name, attr.value.replace(/[?#][^\s,"]*/g, ''));   // a list: each address loses its own query
      else if (['href', 'src', 'action'].includes(attr.name)) node.setAttribute(attr.name, attr.value.replace(/[?#].*$/s, ''));   // one address: the whole query goes, commas included (css?family=Lato:400,400i left ",400i" behind: an address no replay could serve)
    }
    if (node.tagName === 'INPUT') { if (!['submit', 'button', 'reset', 'image'].includes((node.getAttribute('type') || '').toLowerCase())) node.removeAttribute('value'); node.removeAttribute('checked'); }
    if (node.tagName === 'TEXTAREA') node.textContent = '';
    if (node.tagName === 'OPTION') node.removeAttribute('selected');
  }
  return `<!doctype html>\n${root.outerHTML}`;
}

// Writes <out>/<caseName>/<pageName>.html and adds the page to its case.json (a skeleton the first time: shape, ai and expect are for the person to write).
export function writeCapture({out, caseName, pageName, url, html}) {
  const dir = path.join(out, caseName), file = `${pageName}.html`, casePath = path.join(dir, 'case.json');
  fs.mkdirSync(dir, {recursive: true});
  fs.writeFileSync(path.join(dir, file), html);
  const item = fs.existsSync(casePath) ? JSON.parse(fs.readFileSync(casePath, 'utf8')) : {shape: 'TODO: the shape in words', why: 'TODO: the bug or fix', sample: '', pages: [], ai: {}, expect: {}};
  const address = String(url).replace(/[?#].*$/, '');
  item.pages = [...item.pages.filter(page => page.file !== file), {url: address, file}];
  if (!item.sample) item.sample = new URL(address).host;
  fs.writeFileSync(casePath, `${JSON.stringify(item, null, 1)}\n`);
  return {dir, file};
}

// The run's stylesheets as they came over the network, a text/css HAR (HAR 1.2, the fields a replay's routeFromHAR reads): what a page cannot read of a
// cross-origin sheet. Addresses without query; one entry per address; at most 2 MB a sheet, 20 MB in all. Public static files: no person's data.
export function cssRecorder(context, {maxSheet = 2e6, maxAll = 2e7} = {}) {
  const sheets = new Map(), pending = new Set();
  let size = 0;
  context.on('response', response => {
    if (response.request().resourceType() !== 'stylesheet' || response.status() >= 400) return;
    const url = response.url().replace(/[?#].*$/, '');
    if (sheets.has(url) || !/^https?:/.test(url)) return;
    const read = response.text().then(text => { if (text.length <= maxSheet && size + text.length <= maxAll) { sheets.set(url, text); size += text.length; } }).catch(() => {}).finally(() => pending.delete(read));
    pending.add(read);
  });
  const entry = (url, text) => ({startedDateTime: new Date(0).toISOString(), time: 0, cache: {}, timings: {send: 0, wait: 0, receive: 0},
    request: {method: 'GET', url, httpVersion: 'HTTP/1.1', headers: [], queryString: [], cookies: [], headersSize: -1, bodySize: -1},
    response: {status: 200, statusText: 'OK', httpVersion: 'HTTP/1.1', headers: [{name: 'content-type', value: 'text/css'}], cookies: [], redirectURL: '', headersSize: -1, bodySize: -1,
      content: {size: text.length, mimeType: 'text/css', text}}});
  return {har: async () => { await Promise.all([...pending]); return {log: {version: '1.2', creator: {name: 'job-pilotto capture', version: '1'}, entries: [...sheets].map(([url, text]) => entry(url, text))}}; }};
}
