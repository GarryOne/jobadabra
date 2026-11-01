// Text the page never draws is no word of a label (benchmark form 106, 27 Oct 2026, after #2196): each label held an info icon <svg> with a <desc>
// "SVGs not supported by this browser.", read as "AddressSVGs not supported by this browser.", so the box no longer read as the address and the saved one never went in.
// Every label reader goes through the one words reader (extension/page/required-mark.js read); this file loops over each of them, so a new reader that reads raw text fails here.
import test from 'node:test';
import assert from 'node:assert/strict';
import { loadJsdom, openPage } from './helpers/page.js';

const JSDOM = await loadJsdom();
const ICON = '<svg viewBox="0 0 20 20"><desc aria-hidden="true"><p>SVGs not supported by this browser.</p></desc><title>info</title><use href="#i"></use></svg>';
const PAGE = `<form>
  <label><span id="first_label"><strong>First name</strong></span><span>${ICON}</span><input id="first" name="first" aria-labelledby="first_label" required></label>
  <label><span><strong>Address</strong></span><span>${ICON}</span><input id="address" name="address" required></label>
  <div><label>Postcode${ICON}</label><div><input id="postcode" name="postcode"></div></div>
  <div><div class="field-label">Town${ICON}</div><div><textarea id="town" name="town"></textarea></div></div>
  <div role="radiogroup"><span>Relocate?${ICON}</span>
    <label><input type="radio" name="move" id="move-yes" value="y">Yes${ICON}</label><label><input type="radio" name="move" id="move-no" value="n">No</label></div>
  <div role="radiogroup" aria-label="Pick"><div role="radio" id="r1" aria-labelledby="r1-words"></div><span id="r1-words">Hybrid${ICON}</span></div>
</form>`;

test('every label reader leaves out an icon\'s undrawn words', { skip: !JSDOM }, () => {
  const window = openPage(JSDOM, PAGE);
  const kit = window.__jobPilottoFillKit, byId = id => window.document.getElementById(id);
  const readers = {
    'the label element (el.labels)': kit.labelOf(byId('address')),
    'aria-labelledby': kit.labelOf(byId('first')),
    'a loose label tied to no control': kit.looseLabel(byId('postcode')),
    'a title block beside the box': kit.labelOf(byId('town')),
    'a group\'s first title': kit.questionOf(byId('move-yes')),
    'the words reader itself': window.__jobPilottoRequired.read(byId('r1-words')),
  };
  for (const [reader, words] of Object.entries(readers)) {
    assert.ok(words, `${reader}: read something`);
    assert.doesNotMatch(words, /SVGs|info/, `${reader}: "${words}"`);
  }
  assert.equal(readers['the label element (el.labels)'], 'Address');
});

test('a place box whose label holds an icon still takes the saved place over the page\'s guess', { skip: !JSDOM }, async () => {
  const window = openPage(JSDOM, PAGE);
  window.document.getElementById('address').value = 'Des Moines, United States of America';   // the page's own guess from the visitor's IP
  await window.__jobPilottoExtensionFill([], {first_name: 'Ada', street: 'Musterstrasse 12', location: 'Zurich, Switzerland'}, null, '', false);
  assert.equal(window.document.getElementById('first').value, 'Ada');
  assert.equal(window.document.getElementById('address').value, 'Musterstrasse 12');
});
