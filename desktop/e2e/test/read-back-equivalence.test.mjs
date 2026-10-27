// One truth per control (extension/page/read-back.js; spec docs/superpowers/specs/2026-10-12-fill-ladder.md, amendment 4): the readers it replaced (the panel's, the judges' sketch,
// the fill's end read, the audit: copied below as they were on main at bf7980e) and the new one read the same controls, on every recorded page, every zoo page and one page per
// incident the old copies grew from, each as it loads and after a scripted fill of every control. Any disagreement must be one of the named, owner-reviewed changes (CHANGES);
// a new one fails with the page, the control and the readers. EQUIV_TABLE=1 prints the table. Headless Chromium; skipped without it.
/* global document, window, DataTransfer, File, Event -- READ and FILL run in the page (page.evaluate) */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {test} from 'node:test';
import {fileURLToPath} from 'node:url';

let chromium = null;
try { ({chromium} = await import('playwright-core')); if (!fs.existsSync(chromium.executablePath())) chromium = null; } catch { /* no playwright */ }
const E2E = path.join(path.dirname(fileURLToPath(import.meta.url)), '..'), ROOT = path.join(E2E, '..', '..');
const read = file => fs.readFileSync(path.join(ROOT, file), 'utf8');

// The old readers, verbatim in their rules (review.js comboFilled / showsFileName / fields(), account-fill.js accountSketch given + state, page/fill-labels.js comboValue +
// page/fill-read.js describeForm(true), page/browser-form-fastpath.js audit), per control: true = "filled".
const OLD = `(() => {
  const visible = el => !!(el.getClientRects().length && getComputedStyle(el).visibility !== 'hidden');
  const menu = el => (o => !!o && !o.disabled && !o.hidden && !!o.text.trim() && !(o.index === 0 && /^(|0|-1)$/.test(o.value)))(el.options[el.selectedIndex]);
  const comboFilled = el => { for (let box = el.parentElement, i = 0; box && i < 4 && box.querySelectorAll('input:not([type=hidden]), select, textarea').length <= 1; box = box.parentElement, i++)
    if (box.querySelector('[class*=single-value], [class*=multi-value]') || [...box.querySelectorAll('input[type=hidden][id]')].some(h => h.value && document.querySelector('label[for="' + CSS.escape(h.id) + '"]'))) return true; return false; };
  const comboValue = el => (el.closest('[class*=select__container]') || el.closest('[class*=container]'))?.querySelector('[class*=single-value], [class*=multi-value]') ||
    (() => { for (let b = el.parentElement, i = 0; b && i < 4 && b.querySelectorAll('input:not([type=hidden]), select, textarea').length <= 1; b = b.parentElement, i++) { const h = [...b.querySelectorAll('input[type=hidden][id]')].find(x => x.value && document.querySelector('label[for="' + CSS.escape(x.id) + '"]')); if (h) return h; } return null; })();
  const FILE_NAME = /\\S+\\.(pdf|docx?|rtf|txt|odt)\\b/i;
  const showsFileName = input => { let box = input; for (let i = 0; i < 10 && box.parentElement; i++) { const up = box.parentElement;
    if ([...up.querySelectorAll('input, textarea, select')].some(other => other !== input && other.type !== 'file' && other.type !== 'hidden' && visible(other))) break; box = up; if (FILE_NAME.test(box.textContent || '')) return true; } return false; };
  const dial = el => !!String(el.value || '').trim() && !/^\\+\\d{1,4}$/.test(String(el.value).trim());
  const given = el => el.tagName === 'SELECT' ? menu(el) : el.getAttribute('role') === 'combobox' ? comboFilled(el) : dial(el);
  window.__old = {
    panel: el => { const filled = el.type === 'file' ? !!el.files?.length : el.getAttribute('role') === 'combobox' ? comboFilled(el) : ['checkbox', 'radio'].includes(el.type) ? el.checked : el.tagName === 'SELECT' ? menu(el) : window.__jobPilottoBoxGiven(el.value);
      const changed = !!window.__jobPilottoTypedChanged?.(el); return (filled && !changed) || (el.type === 'file' && !el.files?.length && showsFileName(el)); },
    sketch: el => el.type === 'checkbox' || el.type === 'radio' ? el.checked : el.type === 'file' ? !!(el.files?.length || el.dataset.jobPilottoFile) : given(el),
    fill: el => el.type === 'file' ? null : el.type === 'checkbox' || el.type === 'radio' ? el.checked : el.getAttribute('role') === 'combobox' ? !!comboValue(el) : el.tagName === 'SELECT' ? menu(el) : window.__jobPilottoBoxGiven(el.value),
    audit: el => el.type === 'file' ? !!el.files?.length : el.getAttribute('role') === 'combobox' ? comboFilled(el) : ['checkbox', 'radio'].includes(el.type) ? !!el.checked : el.tagName === 'SELECT' ? menu(el) : dial(el),
  };
})();`;

// Every control's readings: [{id, kind, old: {panel, sketch, fill, audit}, now: {state}}]
const READ = () => [...document.querySelectorAll('input, select, textarea')].filter(el => !['hidden', 'submit', 'button', 'image', 'reset'].includes(el.type) && !el.disabled
  && (el.type === 'file' || el.getClientRects().length)).map((el, i) => ({id: el.id || el.name || `#${i}`, kind: el.type === 'file' ? 'file' : el.getAttribute('role') === 'combobox' ? 'combobox' : el.tagName === 'SELECT' ? 'select' : el.type,
  old: Object.fromEntries(Object.entries(window.__old).map(([name, reader]) => [name, reader(el)])), state: window.__jobPilottoReadBack.stateOf(el),
  files: !!el.files?.length}));

// A person's fill, by script: a value in every box (the fill's typed mark beside it), the last real option of a menu, every box ticked, one radio per group, the CV in every file input.
const FILL = async () => {
  const alnum = text => String(text).toLowerCase().replace(/[^\p{L}\p{N}]/gu, '');
  const value = el => ({email: 'ada@example.test', tel: '+41 79 123 45 67', date: '2026-11-02', number: '5', url: 'https://example.test/ada'})[el.type] || (el.inputMode === 'numeric' ? '120000' : 'Example 123');   // a box that asks for digits gets digits, as the fill's answer would
  const seen = new Set();
  for (const el of document.querySelectorAll('input, select, textarea')) {
    if (['hidden', 'submit', 'button', 'image', 'reset'].includes(el.type) || el.disabled || el.readOnly || el.getAttribute('role') === 'combobox') continue;
    if (el.type === 'file') { const transfer = new DataTransfer(); transfer.items.add(new File(['%PDF'], 'cv.pdf', {type: 'application/pdf'})); el.files = transfer.files;
      el.dataset.jobPilottoFile = 'cv.pdf'; (el.closest('.field, [class*=field], [class*=upload], [class*=drop]') || el.parentElement).dataset.jobpilottoFile = 'cv.pdf'; }
    else if (el.tagName === 'SELECT') { const options = [...el.options].filter(o => !o.disabled && o.text.trim()); if (options.length) el.value = options.at(-1).value; }
    else if (el.type === 'checkbox') el.checked = true;
    else if (el.type === 'radio') { if (seen.has(el.name)) continue; seen.add(el.name); el.checked = true; }
    else { Object.getOwnPropertyDescriptor(Object.getPrototypeOf(el), 'value')?.set?.call(el, value(el)); el.setAttribute('data-jobpilotto-typed', alnum(value(el))); }   // the fill's mark is what IT typed
    el.setAttribute('data-jobpilotto-filled', '');
    for (const type of ['input', 'change']) el.dispatchEvent(new Event(type, {bubbles: true}));
  }
  await new Promise(resolve => setTimeout(resolve, 300));   // the page's own handlers have their say (an uploader that clears its input, a mask)
};

// The changes the owner reviewed (cc, 12 Oct 2026): each a rule over one disagreement. -> its name, or '' (a new disagreement: the test fails).
const committed = state => state === 'committed', held = state => state === 'committed' || state === 'mismatch';
export const CHANGES = {
  'a: the extension\'s own mark alone is not a file': d => d.kind === 'file' && d.reader === 'sketch' && d.old === true && d.state === 'unknown',
  'b: a box the page changed after it was typed is not filled': d => d.state === 'mismatch' && d.old === true && ['fill', 'audit'].includes(d.reader),
  'c: the file the extension attached, or a name that appeared after first sight, is the file for every reader (the panel\'s chip rule, read as a person sees the words)': d => d.kind === 'file' && committed(d.state) && d.old === false && !d.files,
  'f: a format hint, an example name or a file shown before anyone looked is never a CV (the old panel read "(.pdf" and "resume.pdf" in a hint as one; cc\'s review of #507)': d => d.kind === 'file' && d.reader === 'panel' && d.old === true && ['empty', 'unknown'].includes(d.state) && !d.files,
  'd: a picklist chip counts only from the field\'s own area: the fill\'s end read took one from any "container", even one holding another field': d => d.kind === 'combobox' && d.reader === 'fill' && d.old === true && d.state === 'empty',
  'g: a chip beside a picker\'s plain search box is the picker\'s value for every reader (10b16d5, 16 Oct 2026: Workday\'s calling-code picker; recorded/picker-chip-beside-search-1, phone-split-picker-1)': d => /^recorded\/(picker-chip-beside-search-1|phone-split-picker-1)\//.test(d.page) && committed(d.state) && d.old === false,
  'e: a picklist chip in a container that holds only this field counts for the panel, the judges and the audit too (the fill\'s end read already took it)': d => d.kind === 'combobox' && committed(d.state) && d.old === false && d.reader !== 'fill',
};
const nowFor = (reader, state) => reader === 'sketch' ? held(state) : committed(state);

function disagreements(page, pass, rows) {
  const out = [];
  for (const row of rows) for (const [reader, old] of Object.entries(row.old)) {
    if (old === null || old === nowFor(reader, row.state)) continue;
    const d = {page, pass, id: row.id, kind: row.kind, reader, old, state: row.state, files: row.files};
    out.push({...d, change: Object.keys(CHANGES).find(name => CHANGES[name](d)) || ''});
  }
  return out;
}

// One page per incident the old copies grew from (named in their comments).
const INCIDENTS = {
  'successfactors-labelled-hidden-picklist': '<label for="t">Title*</label><div><input id="t" role="combobox" value="Mon"><input type="hidden" id="tv" value="MR"><label for="tv">Title</label></div>',
  'chosen-country-react-select': '<label>Country*</label><div class="select__container"><div class="select__control"><div class="select__value-container"><div class="select__single-value">Switzerland</div><input id="c" role="combobox"></div></div></div>',
  'calling-code-alone': '<label for="p">Phone*</label><input id="p" type="tel" value="+972">',
  'menu-first-option-real': '<label for="a">Titre*</label><select id="a"><option value="1">Monsieur</option><option value="2">Madame</option></select>',
  'blank-region-zero': '<label for="r">Région</label><select id="r"><option value="0"></option><option value="5">Genève</option></select>',
  'ashby-file-chip': '<div class="_fieldEntry"><label for="cv">CV*</label><div role="presentation" class="_container"><input id="cv" type="file" required tabindex="-1" style="position:absolute;width:1px;height:1px;clip:rect(0,0,0,0)"><div class="_name">cv.pdf</div><button type="button">Replace</button></div></div>',
  'format-hint-empty-slot': '<div class="field"><label for="cv">Resume*</label><div class="zone"><input id="cv" type="file" required><small>Drop your CV here or browse (.pdf, .docx, max 5 MB)</small></div></div>',
  'example-name-hint-empty-slot': '<div class="field"><label for="cv">CV*</label><div class="zone"><input id="cv" type="file" required><small>Accepted: resume.pdf</small></div></div>',
  'file-shown-before-first-read': '<div class="field"><label for="cv">CV*</label><div class="zone"><input id="cv" type="file" required><div class="file-chip">my_cv.pdf</div></div></div>',
  'phone-mask-reformats': '<label for="m">Phone</label><input id="m" type="tel"><script>document.getElementById("m").addEventListener("input", e => { const d = e.target.value.replace(/\\D/g, ""); if (d.startsWith("41")) e.target.value = "0" + d.slice(2).replace(/(\\d{2})(\\d{3})(\\d{2})(\\d{2})/, "$1 $2 $3 $4"); });</script>',
  'date-re-rendered': '<label for="d">Start date</label><input id="d" type="text"><script>document.getElementById("d").addEventListener("change", e => { const [y, m, d] = e.target.value.split("-"); if (d) e.target.value = d + "." + m + "." + y; });</script>',
  'box-replaced-by-page': '<label for="x">Notice period</label><input id="x"><script>document.getElementById("x").addEventListener("change", e => { e.target.value = "Please choose"; });</script>',
  'picklist-chip-in-container-beyond-its-area': '<div class="field-container"><label>Country</label><div class="select__control"><div class="select__single-value">Switzerland</div><div><div><div><div><input id="pc" role="combobox"></div></div></div></div></div><input id="note" placeholder="Note"></div>',
  'picklist-chip-in-its-own-container': '<div class="field-container"><label>Country</label><div class="control"><div class="single-value">Switzerland</div><div><div><div><div><input id="pk" role="combobox"></div></div></div></div></div></div>',
  'name-capitalised': '<label for="n">Name</label><input id="n"><script>document.getElementById("n").addEventListener("input", e => { e.target.value = e.target.value.toUpperCase(); });</script>',
};

function corpus() {
  const pages = [];
  for (const dir of ['recorded', 'widget-zoo']) for (const name of fs.readdirSync(path.join(E2E, dir))) {
    const folder = path.join(E2E, dir, name);
    if (!fs.statSync(folder).isDirectory()) continue;
    for (const file of fs.readdirSync(folder).filter(file => file.endsWith('.html'))) pages.push({name: `${dir}/${name}/${file}`, html: fs.readFileSync(path.join(folder, file), 'utf8')});
  }
  for (const [name, html] of Object.entries(INCIDENTS)) pages.push({name: `incident/${name}`, html: `<!doctype html><html><body><form>${html}</form></body></html>`});
  return pages;
}

test('the one reader says what the old readers said, on every page, except the named changes', {skip: !chromium && 'no Chromium installed', timeout: 600000}, async () => {
  const browser = await chromium.launch({headless: true});
  const scripts = [read('extension/page/typed-check.js'), read('extension/page/read-back.js'), OLD];
  const all = [];
  try {
    const context = await browser.newContext({viewport: {width: 1200, height: 900}});
    await context.route('**/*', route => (route.request().isNavigationRequest() ? route.continue() : route.fulfill({status: 404, body: ''})));   // offline: nothing but the page
    for (const item of corpus()) {
      const page = await context.newPage();   // one window per page: a page's own top-level declarations must not meet the next page's (a reused window broke their scripts)
      await page.setContent(item.html, {waitUntil: 'domcontentloaded'}).catch(() => {});
      for (const content of scripts) await page.evaluate(content).catch(() => {});   // run, never added to the page as a tag: a reader that climbs to <html> must not read our own scripts' words
      all.push(...disagreements(item.name, 'as loaded', await page.evaluate(READ).catch(() => [])));
      await page.evaluate(FILL).catch(error => { if (process.env.EQUIV_DEBUG && item.name.includes(process.env.EQUIV_DEBUG)) console.log('FILL failed', error.message); });
      const filled = await page.evaluate(READ).catch(error => { if (process.env.EQUIV_DEBUG && item.name.includes(process.env.EQUIV_DEBUG)) console.log('READ failed', error.message); return []; });
      if (process.env.EQUIV_DEBUG && item.name.includes(process.env.EQUIV_DEBUG)) console.log(item.name, JSON.stringify(filled));
      all.push(...disagreements(item.name, 'filled', filled));
      await page.close();
    }
  } finally { await browser.close(); }
  if (process.env.EQUIV_TABLE) {
    const counts = {};
    for (const d of all) { const key = `${d.change || 'NEW'} | ${d.reader} | old ${d.old} -> ${d.state}`; counts[key] = (counts[key] || 0) + 1; }
    console.log(Object.entries(counts).sort().map(([key, n]) => `${String(n).padStart(4)}  ${key}`).join('\n'));
    for (const d of all.slice(0, 60)) console.log(`${d.change ? d.change.slice(0, 2) : 'NEW'}  ${d.page} ${d.pass} ${d.id} (${d.kind}) ${d.reader}: old ${d.old}, now ${d.state}`);
  }
  const unnamed = all.filter(d => !d.change);
  for (const name of Object.keys(CHANGES)) assert.ok(all.some(d => d.change === name), `no page shows change "${name.slice(0, 60)}": add the incident that proves it`);
  assert.deepEqual(unnamed.map(d => `${d.page} [${d.pass}] ${d.id} (${d.kind}): ${d.reader} said ${d.old ? 'filled' : 'empty'}, the one reader says ${d.state}`), []);
});
