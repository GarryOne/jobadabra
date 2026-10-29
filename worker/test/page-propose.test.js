// The session page's rows get their proposed answers from the fill (extension/page/propose.js): a field the fill left empty carries
// what it proposed (a value the form did not take) or the contact detail it asks for; "Use" in the app fills one field through the
// extension's own fill. Coop's form (8 Oct 2026) in miniature.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { loadJsdom, openPage, PAGE_SCRIPTS } from './helpers/page.js';
import { PAGE_FILES } from '../../extension/page-files.js';
import { readPanel } from './helpers/panel.js';

const JSDOM = await loadJsdom();
const skip = JSDOM ? false : 'jsdom is not installed here (run npm install in worker/)';
const FORM = `<form>
  <label for="sal">Formule d'appel *</label><select id="sal" required><option value=""></option><option>Madame</option><option>Monsieur</option></select>
  <label for="tel">Numéro de téléphone *</label><input id="tel" type="tel" required>
  <label for="rue">Rue et numéro *</label><input id="rue" type="text" required>
  <label for="a">A</label><input id="a"><label for="b">B</label><input id="b"></form>`;

test('a field left empty is marked with the answer the form did not take, or the detail it asks for; Use fills it', { skip }, async () => {
  const window = openPage(JSDOM, FORM, { url: 'https://career2.successfactors.eu/careers?company=Coop' });
  await window.__jobPilottoExtensionFill([{ field: 'sal', value: 'Sir', source: 'kit' }], {}, null, '', false);
  const $ = (id) => window.document.getElementById(id);
  assert.equal($('sal').value, '');                                   // "Sir" is not an option: the form did not take it
  assert.equal($('sal').dataset.jobpilottoSuggested, 'Sir');
  assert.deepEqual(JSON.parse($('sal').dataset.jobpilottoOptions), ['Madame', 'Monsieur']);   // the form's choices: the app picks one by meaning
  // A menu opened by your click with no matching choice: no word is left in its box, and the choices it showed go to the app.
  const box = window.document.createElement('input');
  window.document.body.append(box);
  box.value = 'Monsieur';
  window.__jobPilottoMenuMissed(box, ['Madam', 'Sir']);
  assert.equal(box.value, '');
  assert.deepEqual(JSON.parse(box.dataset.jobpilottoOptions), ['Madam', 'Sir']);
  assert.equal($('tel').dataset.jobpilottoWants, 'phone');            // a detail you haven't given
  assert.equal($('rue').dataset.jobpilottoWants, undefined);          // a label the extension doesn't know: the app asks Claude
  assert.deepEqual(JSON.parse(JSON.stringify(await window.__jobPilottoFillOne('Rue et numéro', 'Rue du Lac 1'))), { ok: true, armed: false, translated: false });
  assert.equal($('rue').value, 'Rue du Lac 1');
});

test('propose.js is loaded with the page scripts, before fill.js, as the extension injects them', () => {
  const flow = fs.readFileSync(new URL('../../extension/flow.js', import.meta.url), 'utf8');
  // The order, not the exact list: propose.js and menu-pick.js (the armed menus' pick) load before fill.js, which calls them.
  assert.match(flow, /import \{PAGE_FILES\} from '\.\/page-files\.js'/);
  for (const before of ['page/propose.js', 'page/menu-pick.js', 'page/fill-labels.js', 'page/fill-read.js', 'page/fill-menus.js', 'page/fill-checks.js', 'page/fill-marks.js', 'page/fill-plan.js', 'page/fill-report.js']) {
    assert.ok(PAGE_FILES.indexOf(before) > 0 && PAGE_FILES.indexOf(before) < PAGE_FILES.indexOf('page/fill.js'), `${before} is injected before fill.js`);
  }
  assert.deepEqual(PAGE_SCRIPTS, PAGE_FILES.map(file => `extension/${file}`), 'the tests load the page scripts the extension injects');
  const panel = readPanel();
  assert.match(fs.readFileSync(new URL('../../extension/page/review-payload.js', import.meta.url), 'utf8'), /proposals: state\.list\.filter/);   // the report moved out of review.js
  assert.match(panel, /if \(command\.fill\) \{ send\(\{type: 'panelFillOne', \.\.\.command\.fill\}\)/);
  const worker = fs.readFileSync(new URL('../../extension/fill-flow.js', import.meta.url), 'utf8');
  assert.match(worker, /message\?\.type !== 'panelFillOne'/);
  assert.match(worker, /files: PAGE_FILES/);
});
