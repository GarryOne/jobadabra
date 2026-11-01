// A fake form page that runs a WHOLE extension fill in node: the real page scripts (FILL_FILES and the helpers they need) in a vm, with every
// page helper the fill calls stubbed, so a test gives rows and answers and reads the summary and trace. Used by desktop/test/fill-categories.test.js.
// 11 Oct 2026: a test needed four stubs, found one error at a time (upload, audit, profile entries, required-mark), before a fill could run.
// rows: [{field, label, type, required, filled, legal, options}] as page/fill-read.js describes them. The post-fill audit returns the same rows,
// still as they were (a fake page has no controls that change), with `legal` read as the real audit reads it (page/browser-form-fastpath.js):
// the word floor, or the AI's mark on the element (page/categories.js).
import fs from 'node:fs';
import vm from 'node:vm';
import {FILL_FILES} from '../../extension/page-files.js';

const PAGE_SCRIPTS = ['page/required-mark.js', 'page/categories.js', 'page/radios.js', ...FILL_FILES];

// checkboxes: true lets the page's own consent pass (tickConsents) find the boxes.
// audit: rows the post-fill audit returns instead (the real one reads the page on its own, with its own legal floor: page/browser-form-fastpath.js).
export function fakeFillPage(rows, {audit = null, checkboxes = false} = {}) {
  const elements = Object.fromEntries(rows.map(row => [row.field, {id: row.field, type: row.type, checked: false, dataset: {}, clicks: 0,
    getClientRects() { return [1]; }, click() { this.clicks++; this.checked = !this.checked; }, getAttribute: name => (checkboxes && name === 'aria-label' ? row.label : null), setAttribute() {}, removeAttribute() {}, addEventListener() {}, removeEventListener() {}, classList: {add() {}, remove() {}}, parentElement: null, tagName: row.type === 'textarea' ? 'TEXTAREA' : 'INPUT', closest: () => null, labels: [], value: row.value || ''}]));
  const window = {__jobadabraGuardActive: true};
  const document = {head: {append() {}}, createElement: () => ({}), getElementById: id => elements[id] || null, querySelector: () => null, querySelectorAll: selector => (checkboxes && /type=checkbox/.test(selector) ? Object.values(elements).filter(el => el.type === 'checkbox') : []), body: {innerText: ''},
    documentElement: {className: ''}};
  const context = vm.createContext({window, document, getComputedStyle: () => ({}), setTimeout, clearTimeout, CSS: {escape: s => s}, console,
    Event: class {}, HTMLInputElement: class {}, HTMLTextAreaElement: class {}});
  for (const file of PAGE_SCRIPTS) vm.runInContext(fs.readFileSync(new URL(`../../extension/${file}`, import.meta.url), 'utf8'), context);
  const armed = [];   // the menus the fill armed for a real click (page/fill-menus.js armCombo): [field, value]
  Object.assign(window, {
    __jobadabraDescribeForm: async () => rows.map(row => ({...row})),
    __jobadabraCheckboxQuestions: () => [],
    __jobadabraFillKnownFields: () => ({filled: []}),
    __jobadabraProfileEntries: () => [],
    __jobadabraArmCombo: (field, value) => armed.push([field, value]),
    __jobadabraUpload: {fill: async () => []},
    __jobadabraAuditVisibleFields: () => (audit || rows).map(row => ({...row, legal: !!row.legal || elements[row.field]?.dataset.jobadabraCategory === 'legal'})),
  });
  // The fill as flow.js starts it: answers [{field, value, category?, use?}] -> its summary {trace, todo, ...}. A thrown error is the test's failure.
  const fill = (answers, {profile = {}, resume = null, letter = '', consents = false} = {}) => window.__jobadabraExtensionFill(answers, profile, resume, letter, consents);
  return {window, elements, armed, fill};
}
