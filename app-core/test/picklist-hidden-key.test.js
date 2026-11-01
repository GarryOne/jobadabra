// A type-to-search picklist (SuccessFactors) keeps its choice in a labelled hidden input as a key ("688"), and shows the chosen option's words in its own box.
// The one reader (extension/page/read-back.js) compared that key with the option the fill picked and called every correct pick "mismatch" (14 Oct 2026, the pool's
// Breitling row: Country and preferred language left as "the page changed what was typed"). The markup is the capture's own, cut to the field.
import test from 'node:test';
import assert from 'node:assert/strict';
import {loadJsdom, openPage} from './helpers/page.js';

const JSDOM = await loadJsdom();

const PICKLIST = `<table><tr><th><label id="label_tor__fcountry" for="tor__fcountry" title="Required">Country<span class="required">*</span></label></th><td>
  <div class="displayInlineBlock" id="picklist_country"><span id="8:" class="sfCascadingPicklist"><div id="9:_selectContainer" class="paginatedPicklistContainer fd-input-group">
  <input aria-label="Country" autocomplete="off" type="text" placeholder="No Selection" aria-owns="10:_listSelect" role="combobox" aria-required="true" class="rcmpaginatedselectinput" id="9:_input">
  <button aria-label="Country" tabindex="-1" class="rcmpaginatedselectbutton" type="button" id="9:_selectButton"></button></div></span></div>
  <input id="tor__fcountry" name="tor__fcountry" type="hidden" aria-hidden="true" class=" appFieldRequired">
  </td></tr></table>`;

test('a picklist whose hidden input holds a key is read by what its box shows, never by the key', {skip: !JSDOM}, () => {
  const window = openPage(JSDOM, PICKLIST, {url: 'https://career5.successfactors.eu/careers'});
  const box = window.document.getElementById('9:_input'), key = window.document.getElementById('tor__fcountry');
  const state = () => window.__jobPilottoReadBack.stateOf(box);
  assert.equal(state(), 'empty', 'untouched: no key, an empty box');
  box.setAttribute('data-jobpilotto-picked', 'switzerland');   // the fill's own pick (page/fill-menus.js)
  assert.equal(state(), 'empty', 'picked, but the page kept no key: not filled');
  box.value = 'Switzerland'; key.value = '688';
  assert.equal(state(), 'committed', 'the box shows the picked option; its key is no other choice');
  box.value = 'Afghanistan'; key.value = '1';
  assert.equal(state(), 'mismatch', 'set back to the page\'s default option');
  box.value = 'Germany'; key.value = '412';
  assert.equal(state(), 'mismatch', 'a key for another option: the box shows that option');
  box.value = ''; key.value = '688';
  assert.equal(state(), 'mismatch', 'a key and an empty box: no proof the pick was kept');
  window.close();
});

test('the other readings keep their compare: a chip by its text, a native menu by its option', {skip: !JSDOM}, () => {
  const window = openPage(JSDOM, `<div class="select__container"><div class="select__single-value">Germany</div><input id="chip" role="combobox"></div>
    <select id="menu"><option value="">Pick</option><option value="CH">Switzerland</option><option value="DE">Germany</option></select>`);
  const {stateOf} = window.__jobPilottoReadBack, chip = window.document.getElementById('chip'), menu = window.document.getElementById('menu');
  chip.setAttribute('data-jobpilotto-picked', 'switzerland');
  assert.equal(stateOf(chip), 'mismatch');
  menu.setAttribute('data-jobpilotto-picked', 'switzerland'); menu.value = 'DE';
  assert.equal(stateOf(menu), 'mismatch');
  menu.value = 'CH';
  assert.equal(stateOf(menu), 'committed');
  window.close();
});
