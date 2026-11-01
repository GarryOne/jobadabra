// A required mark drawn as an aria-hidden star with its spoken twin ("Required", in the page's language) in a visually hidden element after it: the label's text reads
// "Name*Required", which ends in no star. The mark is the star element itself; the question's words leave the star and its twin out. Shapes, not sites: two different forms.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { loadJsdom, openPage } from './helpers/page.js';

const SHEET = `<form><fieldset><legend><span class="block">Are you based in the city?<sup aria-hidden="true">*</sup><span class="sr-only">Required</span></span></legend>
  <input type="radio" name="q1" id="y"><label for="y">Yes</label><input type="radio" name="q1" id="n"><label for="n">No</label></fieldset>
  <div><label for="fn">First name<sup aria-hidden="true">*</sup><span class="sr-only">Required</span></label><input id="fn"></div>
  <div><label for="ln">Last name</label><input id="ln"></div></form>`;
const VARIANT = `<div><div role="radiogroup" aria-labelledby="g"><b id="g">Arbeitsbewilligung vorhanden?<i aria-hidden="true">✱</i><em class="vh">Pflichtfeld</em></b>
  <span><input type="radio" name="a" id="a1" aria-label="Ja"></span><span><input type="radio" name="a" id="a2" aria-label="Nein"></span></div>
  <p><input id="vn" name="vn" aria-labelledby="vl"><span id="vl">Vorname <abbr aria-hidden="true">*</abbr><s class="vh">Pflichtfeld</s></span></p>
  <p><label>Telefon <input id="tel"></label></p></div>`;

const fieldsOf = async (html) => {
  const JSDOM = await loadJsdom();
  if (!JSDOM) return null;
  const window = openPage(JSDOM, html);
  return { window, rows: Array.from(await window.__jobPilottoDescribeForm(true)) };
};

for (const [name, html, required, optional] of [['a legend and labels', SHEET, /based in the city|First name/, /Last name/],
  ['another language, other tags, a labelled group', VARIANT, /Arbeitsbewilligung|Vorname/, /Telefon/]]) {
  test(`the star element marks a field required and its spoken twin stays out of the question: ${name}`, async () => {
    const page = await fieldsOf(html);
    if (!page) return;
    const rows = page.rows;
    assert.ok(rows.length >= 3, `the form is read: ${JSON.stringify(rows)}`);
    for (const row of rows.filter((r) => required.test(r.label))) {
      assert.equal(row.required, true, `required: ${row.label}`);
      assert.doesNotMatch(row.label, /\*|✱|Required|Pflichtfeld/, `the question reads clean: ${row.label}`);
    }
    for (const row of rows.filter((r) => optional.test(r.label))) assert.equal(row.required, false, `optional: ${row.label}`);
    assert.equal(page.window.__jobPilottoRequired.starred(page.window.document), 2);
  });
}
