// Fictional consent controls exercise the real page fill, trusted menu click and required-field read-back without accounts or network.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {test} from 'node:test';
import {chromium} from 'playwright-core';
import {PAGE_FILES} from '../../../extension/page-files.js';

const decision = (field, value = 'checked') => ({field, value, category: 'legal', use: 'kind', consent: true});
const fixture = shape => `<form><div class="field"><label for="notice">Privacy notice for applicants *</label>${shape === 'native'
  ? '<select id="notice" required><option value="">Choose</option><option value="agree">Acconsento</option><option value="refuse">Non acconsento</option></select>'
  : `${shape === 'aria' ? '<div id="notice" role="combobox" style="width:240px;height:24px;border:1px solid" tabindex="0" aria-controls="choices" aria-required="true" aria-expanded="false"></div>' : '<input id="notice" role="combobox" readonly aria-controls="choices" aria-required="true" aria-expanded="false">'}<ul id="choices" role="listbox" hidden><li role="option">Non acconsento</li><li role="option">Acconsento</li></ul>`}
  </div><label for="truth">I certify that these statements are true *</label><select id="truth" required><option value="">Choose</option><option>Yes</option></select>
  <button type="submit">Submit application</button></form><script>
  window.submits=0; document.querySelector('form').onsubmit=e=>{e.preventDefault();window.submits++};
  const box=document.getElementById('notice'), list=document.getElementById('choices');
  if(list){box.addEventListener('mousedown',()=>{list.hidden=false;box.setAttribute('aria-expanded','true')});
    for(const option of list.children) option.onclick=()=>{box.value=option.textContent; if(box.tagName==='DIV') box.textContent=option.textContent; const chip=document.createElement('span'); chip.className='single-value';chip.textContent=option.textContent;box.parentElement.insertBefore(chip,box);list.hidden=true;box.setAttribute('aria-expanded','false')};}
  </script>`;

for (const shape of ['native', 'custom', 'aria']) test(`${shape} consent follows authorization, reads back the value and is idempotent`, async () => {
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage();
    await page.route('**/*', route => route.abort());
    await page.setContent(fixture(shape));
    for (const file of PAGE_FILES) await page.addScriptTag({content: fs.readFileSync(new URL(`../../../extension/${file}`, import.meta.url), 'utf8')});
    const answers = [decision('notice', shape === 'native' ? 'Acconsento' : 'checked'), decision('truth', 'Yes')];
    const fill = enabled => page.evaluate(({answers,enabled})=>window.__jobPilottoExtensionFill(answers,{},null,'',enabled), {answers,enabled});
    const off = await fill(false);
    assert.equal(off.error, undefined);
    assert.equal(off.unfilledRequired, 2, 'an unaccepted required consent stays in the required count');
    assert.equal(await page.evaluate(()=>document.getElementById('notice').value || ''), '');
    assert.equal(await page.evaluate(()=>window.__jobPilottoArmedCount()), 0);
    const on = await fill(true);
    assert.equal(on.error, undefined);
    if (shape !== 'native') {
      const spot = await page.evaluate(()=>window.__jobPilottoNextCombo());
      assert.ok(spot, 'authorized consent must be armed for the existing trusted dropdown path');
      await page.mouse.click(spot.x, spot.y);
      await page.waitForFunction(()=>window.__jobPilottoNeed?.kind === 'choose');
      const request = await page.evaluate(()=>window.__jobPilottoNeed);
      assert.equal(request.consent, true);
      assert.deepEqual(request.choices, ['Non acconsento', 'Acconsento']);
      await page.evaluate(()=>{window.__jobPilottoNeedDone='Acconsento'});
      await page.waitForFunction(()=>window.__jobPilottoArmedCount() === 0);
    }
    assert.equal(await page.evaluate(()=>document.getElementById('notice').value || ''), shape === 'native' ? 'agree' : 'Acconsento');
    assert.equal(await page.inputValue('#truth'), '', 'a factual attestation stays untouched even with an erroneous consent reading');
    const again = await fill(true);
    assert.equal(again.unfilledRequired, 1, 'only the attestation remains required');
    assert.equal(again.trace.find(row=>row.label.startsWith('Privacy notice')).outcome,'filled');
    assert.equal(await page.evaluate(()=>window.__jobPilottoArmedCount()), 0, 'repeat must not arm a committed consent');
    assert.equal(await page.evaluate(()=>window.__jobPilottoAuditVisibleFields().find(row=>row.field==='notice').filled), true);
    assert.equal(await page.evaluate(()=>window.submits), 0);
  } finally { await browser.close(); }
});


test('custom consent with no affirmative AI reading stays empty and required; turning the setting off disarms it', async () => {
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage();
    await page.route('**/*', route => route.abort());
    await page.setContent(fixture('custom'));
    for (const file of PAGE_FILES) await page.addScriptTag({content: fs.readFileSync(new URL(`../../../extension/${file}`, import.meta.url), 'utf8')});
    const answers = [decision('notice')];
    await page.evaluate(answers=>window.__jobPilottoExtensionFill(answers,{},null,'',true), answers);
    const spot = await page.evaluate(()=>window.__jobPilottoNextCombo());
    await page.mouse.click(spot.x, spot.y);
    await page.waitForFunction(()=>window.__jobPilottoNeed?.kind === 'choose');
    await page.evaluate(()=>{window.__jobPilottoNeedDone=''});
    await page.waitForFunction(()=>!window.__jobPilottoPicking);
    assert.equal(await page.evaluate(()=>document.getElementById('notice').value || ''), '');
    assert.equal(await page.evaluate(()=>window.__jobPilottoLastPick.selectedAfter), false);
    const off = await page.evaluate(answers=>window.__jobPilottoExtensionFill(answers,{},null,'',false), answers);
    assert.equal(await page.evaluate(()=>window.__jobPilottoArmedCount()), 0);
    assert.equal(off.trace.find(row=>row.label.startsWith('Privacy notice')).outcome,'left');
    assert.equal(off.unfilledRequired, 2);
  } finally { await browser.close(); }
});
