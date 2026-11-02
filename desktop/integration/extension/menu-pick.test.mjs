/* global window, document */
// A menu answer is only "picked" when the page shows it (owner, 9 Oct 2026, Migros on SuccessFactors: the picker clicked the option by script, the widget ignored it,
// and "a menu picked for you, matched" was logged over an empty field). The SHAPES: a menu that takes only a real click on its option (picked through the trusted
// fallback that flow.js clickCombos makes with Chrome's debugger: here Playwright's mouse, also trusted), a plain menu (picked by script), a menu that never selects
// (not called picked: still armed, left to you). What was seen (opened, found, selectedAfter, trusted) is recorded for the fill card. A real Chrome.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {test} from 'node:test';
import {chromium} from '../../e2e/lib/visit-page.mjs';

// The page scripts are the extension's own list (extension/page-files.js), never a copy: a copy went stale when required-mark.js was added (10 Oct 2026, 19 tests red on main).
import {PAGE_FILES} from '../../../extension/page-files.js';
// A combobox input that opens a list on mousedown; `accept` decides which option clicks select: 'trusted' (SuccessFactors-like), 'any', or 'none'.
const MENU = accept => `<body><form><div class="field"><label for="pays">* Pays de résidence</label>
  <input id="pays" role="combobox" aria-expanded="false" readonly value="Aucune sélection" style="width:240px">
  <ul id="list" role="listbox" hidden style="list-style:none;padding:0;margin:0;width:240px">${['Aucune sélection', 'Suisse', 'Allemagne', 'France'].map(o => `<li role="option" style="padding:6px">${o}</li>`).join('')}</ul></div></form>
  <script>
    const input = document.getElementById('pays'), list = document.getElementById('list');
    input.addEventListener('mousedown', () => { list.hidden = false; input.setAttribute('aria-expanded', 'true'); });
    for (const li of list.children) li.addEventListener('click', event => {
      if ('${accept}' === 'none' || ('${accept}' === 'trusted' && !event.isTrusted)) return;
      input.value = li.textContent; li.setAttribute('aria-selected', 'true'); list.hidden = true; input.setAttribute('aria-expanded', 'false');
    });
  </script></body>`;

// The fill arms the menu with the answer; then what flow.js clickCombos does, with trusted mouse clicks: click the armed menu, and click the option's spot if the page leaves one.
async function pick(accept) {
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage();
    await page.setContent(MENU(accept));
    for (const file of PAGE_FILES) await page.addScriptTag({content: fs.readFileSync(new URL(`../../../extension/${file}`, import.meta.url), 'utf8')});
    await page.evaluate(() => window.__jobadabraExtensionFill([{field: 'pays', value: 'Suisse'}], {}, null, '', false));
    const armedBefore = await page.evaluate(() => window.__jobadabraArmedCount());
    const spot = await page.evaluate(() => window.__jobadabraNextCombo(0));
    await page.mouse.click(spot.x, spot.y);
    let clickedSpot = false;
    for (let waited = 0; waited < 6000; waited += 100) {
      await page.waitForTimeout(100);
      if (await page.evaluate(() => window.__jobadabraArmedCount()) < armedBefore) break;
      const at = clickedSpot ? null : await page.evaluate(() => window.__jobadabraPickSpot || null);
      if (at) { clickedSpot = true; await page.mouse.click(at.x, at.y); }
    }
    await page.waitForTimeout(300);
    return await page.evaluate(() => ({value: document.getElementById('pays').value, armed: window.__jobadabraArmedCount(), last: window.__jobadabraLastPick, badge: document.querySelector('.jobadabra-badge')?.textContent || ''}));
  } finally { await browser.close(); }
}

test('a menu that takes only a real click on its option is picked through the trusted fallback, and says so', async () => {
  const out = await pick('trusted');
  assert.equal(out.value, 'Suisse');
  assert.equal(out.armed, 0, 'still armed: the selection was not seen');
  assert.deepEqual({opened: out.last.opened, found: out.last.found, selectedAfter: out.last.selectedAfter, trusted: out.last.trusted}, {opened: true, found: true, selectedAfter: true, trusted: true});
});

test('a plain menu is picked by script, no trusted click needed', async () => {
  const out = await pick('any');
  assert.equal(out.value, 'Suisse');
  assert.equal(out.armed, 0);
  assert.equal(out.last.trusted, false);
  assert.equal(out.last.selectedAfter, true);
});

test('a menu that never selects is NOT called picked: still armed, left to you, and the miss is observed as not selected', async () => {
  const out = await pick('none');
  assert.notEqual(out.value, 'Suisse');
  assert.equal(out.armed, 1, 'a menu that did not select was reported picked (the 9 Oct "matched" over an empty field)');
  assert.match(out.badge, /pick it yourself/);
  assert.deepEqual({found: out.last.found, selectedAfter: out.last.selectedAfter}, {found: true, selectedAfter: false});
});

// SHAPE (Breitling-like, 12 Oct 2026): a menu that draws only its first page of choices and loads the next when its list is scrolled. The answer is not in the DOM when the menu opens.
const PAGED = `<body><form><div class="field"><label for="pays">* Pays de résidence</label>
  <input id="pays" role="combobox" aria-expanded="false" readonly value="Aucune sélection" style="width:240px">
  <div id="scroller" hidden style="height:90px;overflow:auto;width:240px"><ul id="list" role="listbox" style="list-style:none;padding:0;margin:0"></ul></div></div></form>
  <script>
    const input = document.getElementById('pays'), list = document.getElementById('list'), scroller = document.getElementById('scroller');
    const all = ['Aucune sélection', 'Afghanistan', 'Albanie', 'Algérie', 'Allemagne', 'Andorre', 'Belgique', 'France', 'Italie', 'Suisse', 'Turquie'];
    let shown = 0;
    const more = () => { for (const o of all.slice(shown, shown + 4)) { const li = document.createElement('li'); li.setAttribute('role', 'option'); li.style.padding = '6px'; li.textContent = o;
      li.addEventListener('click', () => { input.value = o; input.dataset.picked = o; scroller.hidden = true; input.setAttribute('aria-expanded', 'false'); }); list.appendChild(li); } shown += 4; };
    more();
    scroller.addEventListener('scroll', () => { if (scroller.scrollTop + scroller.clientHeight >= scroller.scrollHeight - 5 && shown < all.length) more(); });
    input.addEventListener('mousedown', () => { scroller.hidden = false; input.setAttribute('aria-expanded', 'true'); });
  </script></body>`;

test('a menu that loads its choices page by page is scrolled until the answer appears, then picked', async () => {
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage();
    await page.setContent(PAGED);
    for (const file of PAGE_FILES) await page.addScriptTag({content: fs.readFileSync(new URL(`../../../extension/${file}`, import.meta.url), 'utf8')});
    await page.evaluate(() => window.__jobadabraExtensionFill([{field: 'pays', value: 'Suisse'}], {}, null, '', false));
    const spot = await page.evaluate(() => window.__jobadabraNextCombo(0));
    await page.mouse.click(spot.x, spot.y);
    await page.waitForFunction(() => document.getElementById('pays').dataset.picked === 'Suisse', null, {timeout: 8000}).catch(() => {});
    assert.equal(await page.evaluate(() => document.getElementById('pays').dataset.picked), 'Suisse', 'the known answer was only proposed: its option was on a page not loaded yet');
  } finally { await browser.close(); }
});

// SHAPE (Nebius-like, 15 Oct 2026): a menu that takes several choices (react-select is-multi). The answer lists them joined by " && "; each opens the menu again, and a chip from an
// earlier pick must not make the next pick look done (the old check: "some chip exists"). The page is the widget zoo's multi-select-1 page.
test('a menu that takes several choices gets each one picked with its own real click, not only the first', async () => {
  const html = fs.readFileSync(new URL('../../e2e/recorded/multi-select-menu-1/form.html', import.meta.url), 'utf8');
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage();
    await page.setContent(html);
    for (const file of PAGE_FILES) await page.addScriptTag({content: fs.readFileSync(new URL(`../../../extension/${file}`, import.meta.url), 'utf8')});
    await page.evaluate(() => window.__jobadabraExtensionFill([{field: 'lang', value: 'English && Spanish && German'}], {}, null, '', false));
    assert.equal(await page.evaluate(() => window.__jobadabraArmedCount()), 1);
    for (let turn = 0; turn < 6; turn++) {   // what flow.js clickCombosNow does: the next armed menu, a real click, the option's spot when the page leaves one
      const spot = await page.evaluate(() => window.__jobadabraNextCombo(0));
      if (!spot) break;
      const armedBefore = await page.evaluate(() => window.__jobadabraArmedCount());
      await page.mouse.click(spot.x, spot.y);
      let clickedSpot = false;
      for (let waited = 0; waited < 6000; waited += 100) {
        await page.waitForTimeout(100);
        if (await page.evaluate(() => window.__jobadabraArmedCount()) < armedBefore) break;
        const at = clickedSpot ? null : await page.evaluate(() => window.__jobadabraPickSpot || null);
        if (at) { clickedSpot = true; await page.mouse.click(at.x, at.y); }
      }
    }
    assert.deepEqual(await page.evaluate(() => [...document.querySelectorAll('.chips .chip')].map(chip => chip.textContent)), ['English', 'Spanish', 'German']);
    assert.equal(await page.evaluate(() => document.getElementById('langs').value), 'English,Spanish,German');
  } finally { await browser.close(); }
});
