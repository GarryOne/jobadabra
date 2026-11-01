// One fold for every matcher that compares an answer with an option or a label (extension/page/fold-text.js): "Zurich" finds "Zürich", case and spacing never matter.
// The test loops over the matchers, so a new one that skips the shared fold (or a fold that stops folding) fails here. Why: a required Location typeahead stayed empty
// because the free option match was accent-blind while page/value-class.js already folded accents (14 Oct 2026, pool row, offline replay).
import test from 'node:test';
import assert from 'node:assert/strict';
import { loadJsdom, openPage, userClick } from './helpers/page.js';

const JSDOM = await loadJsdom();
const skip = JSDOM ? false : 'jsdom is not installed here (run npm install in worker/)';
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const OPTION = 'Zürich, Switzerland';
const ANSWERS = ['Zurich, Switzerland', '  ZURICH,   switzerland '];   // the accent, then case and spacing

const MENU = `<form><input id="location" role="combobox" aria-expanded="false" autocomplete="off"><ul id="list" role="listbox">
  <li role="option">Zurich, Netherlands</li><li role="option">${OPTION}</li></ul></form>`;

// Each matcher: how it is driven on its own page, and what it returns when it found the option (the option's text, or null).
const MATCHERS = {
  'armed menu (page/fill-menus.js matchOption)': async (window, answer) => {
    const picked = [];
    window.document.addEventListener('click', (event) => { const option = event.target.closest?.('[role=option]'); if (option) picked.push(option.textContent.trim()); }, true);
    await window.__jobadabraExtensionFill([{ field: 'location', value: answer, question: 'Location', source: 'kit' }], {}, null, '', false);
    const armed = window.document.querySelector('[data-jobadabra-armed]');
    if (armed) userClick(window, armed);
    for (let waited = 0; waited < 3000 && !picked.length; waited += 50) await wait(50);
    return picked[0] ?? null;
  },
  'group of buttons (page/controls.js setToggleGroup)': async (window, answer) => {
    const box = window.document.getElementById('group');
    const pressed = [];
    for (const button of box.querySelectorAll('button')) button.addEventListener('click', () => pressed.push(button.textContent.trim()));
    await window.__jobadabraControls.setToggleGroup(box, answer, { option: 'button' });
    return pressed[0] ?? null;
  },
  'custom select (page/controls.js setCustomSelect)': async (window, answer) => {
    const picked = [];
    window.document.addEventListener('click', (event) => { const option = event.target.closest?.('[role=option]'); if (option) picked.push(option.textContent.trim()); }, true);
    await window.__jobadabraControls.setCustomSelect(window.document.getElementById('trigger'), answer, window.document, {});
    return picked[0] ?? null;
  },
  'click an option (page/browser-form-fastpath.js)': async (window, answer) => {
    const picked = [];
    window.document.addEventListener('click', (event) => { const option = event.target.closest?.('[class*=option]'); if (option) picked.push(option.textContent.trim()); }, true);
    window.__jobadabraClickOption(answer);
    return picked[0] ?? null;
  },
  'option that fits an answer (page/value-class.js fits)': async (window, answer) => {
    return ['Zurich, Netherlands', OPTION].find((text) => window.__jobadabraValueClass.fits(answer, text)) ?? null;
  },
};
const PAGES = {
  'armed menu (page/fill-menus.js matchOption)': MENU,
  'group of buttons (page/controls.js setToggleGroup)': `<div id="group"><button type="button">Zurich, Netherlands</button><button type="button">${OPTION}</button></div>`,
  'custom select (page/controls.js setCustomSelect)': `<button id="trigger" type="button">Choose</button><ul><li role="option">Zurich, Netherlands</li><li role="option">${OPTION}</li></ul>`,
  'click an option (page/browser-form-fastpath.js)': `<div class="menu"><div class="option">Zurich, Netherlands</div><div class="option">${OPTION}</div></div>`,
  'option that fits an answer (page/value-class.js fits)': '<form></form>',
};

for (const [name, drive] of Object.entries(MATCHERS)) {
  for (const answer of ANSWERS) {
    test(`${name}: "${answer}" finds "${OPTION}"`, { skip }, async () => {
      const window = openPage(JSDOM, PAGES[name]);
      const found = await drive(window, answer);
      window.close();
      assert.equal(found, OPTION);
    });
  }
}

test('the matchers named here are all the page scripts that compare an answer with an option or label text', { skip }, async () => {
  const fs = await import('node:fs');
  const files = fs.readdirSync(new URL('../../extension/page/', import.meta.url)).filter((name) => name.endsWith('.js'));
  // A page script that defines its own accent-blind text key for options must be listed here as a reviewed exception (the page's own text on both sides).
  const OWN_KEY = /(?:const|let) (?:norm|fold) *= *(?:\(?\w*\)?|text|t) *=> *[^;]*toLowerCase\(\)/;
  const reviewed = new Set(['fold-text.js', 'menu-pick.js', 'review.js', 'coverage.js', 'propose.js', 'upload.js']);   // menu-pick: the box's value against the option's own text, both from the page
  const offenders = files.filter((name) => !reviewed.has(name) && OWN_KEY.test(fs.readFileSync(new URL(`../../extension/page/${name}`, import.meta.url), 'utf8')) && !/__jobadabraFold/.test(fs.readFileSync(new URL(`../../extension/page/${name}`, import.meta.url), 'utf8')));
  assert.deepEqual(offenders, [], 'a page script defines its own accent-blind norm/fold: use window.__jobadabraFold (page/fold-text.js)');
});
