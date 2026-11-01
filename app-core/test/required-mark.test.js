// The required mark: a label that ends "Label*:", "Label *:" or "Label* :" (table forms, older ATS pages, German/French forms) is required.
// Every reader asks the one helper (extension/page/required-mark.js), so the panel, the fill and the coverage agree.
// 10 Oct 2026, live: a Migros/umantis form marked six questions "Anrede*:" and the panel said "No required fields".
import test from 'node:test';
import assert from 'node:assert/strict';
import { loadJsdom, openPage } from './helpers/page.js';

const JSDOM = await loadJsdom();
// A table form: the question is a text cell, the radio options sit in the next cell; labels end "*:".
const TABLE = `<form><table>
  <tr><td>Anrede*:</td><td><input type="radio" name="sal" id="s1"><label for="s1">Frau</label>
    <input type="radio" name="sal" id="s2"><label for="s2">Herr</label></td></tr>
  <tr><td><label for="fn">Vorname *:</label></td><td><input id="fn"></td></tr>
  <tr><td><label for="em">E-Mail-Adresse/Login*:</label></td><td><input id="em" type="email"></td></tr>
  <tr><td><label for="ph">Telefon:</label></td><td><input id="ph"></td></tr>
</table></form>`;

test('the helper sees a mark before a trailing colon, and none where there is none', { skip: !JSDOM }, () => {
  const window = openPage(JSDOM, TABLE);
  const mark = window.__jobPilottoRequired;
  assert.ok(mark, 'page/required-mark.js is injected');
  for (const text of ['Anrede*:', 'Vorname *:', 'E-Mail*: ', 'Name *', 'Nom* :', 'Name ∗', 'Name＊：', '* Name']) assert.equal(mark.has(text), true, text);
  for (const text of ['Telefon:', 'Mit * markierte Felder sind Pflichtfelder.', 'Notes (optional)', '']) assert.equal(mark.has(text), false, text);
  assert.equal(mark.clean('Anrede*:'), 'Anrede');
  assert.equal(mark.clean('Vorname *:'), 'Vorname');
  assert.equal(mark.clean('Telefon:'), 'Telefon');
});

test('a "Label*:" form lists its required question that cannot be read, and counts the others', { skip: !JSDOM }, async () => {
  const window = openPage(JSDOM, TABLE);
  const summary = await window.__jobPilottoExtensionFill([{ field: 'fn', value: 'Ada', source: 'kit' }, { field: 'em', value: 'ada@example.test', source: 'kit' }], {}, null, '', false);
  const left = Array.from(summary.trace).filter((r) => r.outcome === 'left' && r.required);
  assert.ok(left.some((r) => /Anrede/.test(r.label)), `Anrede is listed as a required question left: ${JSON.stringify(left.map((r) => r.label))}`);
  assert.equal(Array.from(summary.trace).find((r) => /Telefon/.test(r.label))?.required, false, 'Telefon stays optional');
  assert.ok(summary.unfilledRequired >= 1);
});

// The star glued to the label's last word, then a short tail of the page's own words (12 Oct 2026, a German one-page form: "Gehaltsvorstellung* (erforderlich)",
// and a hosted careers form: "First name*Required"). The tail's meaning is not needed: a star glued to a word, then a tail with no star of its own, is the mark;
// a legend sentence has a space before its star and stays unmarked. Any language, any tail wording.
test('a star glued to the label word then a short tail of words is the mark, in any language; a legend is not', { skip: !JSDOM }, () => {
  const mark = openPage(JSDOM, TABLE).__jobPilottoRequired;
  for (const text of ['Gehaltsvorstellung* (erforderlich)', 'First name*Required', 'Prétentions salariales* (obligatoire)', 'Telefono*obbligatorio', 'Nombre* (campo obligatorio)', 'E-Mail* (erforderlich):'])
    assert.equal(mark.has(text), true, text);
  for (const text of ['Mit * markierte Felder sind Pflichtfelder.', 'Fields marked with * are required', 'Notes (optional)', 'Rating 5* hotels or better, any city in the region you prefer to work in'])
    assert.equal(mark.has(text), false, text);
  assert.equal(mark.clean('Gehaltsvorstellung* (erforderlich)'), 'Gehaltsvorstellung (erforderlich)');
  assert.equal(mark.clean('Prétentions salariales*Obligatoire'), 'Prétentions salariales Obligatoire', 'no glued words once the star is gone');
});

test('the independent star count sees the starred labels, not the legend, and no other text', { skip: !JSDOM }, () => {
  const window = openPage(JSDOM, `<p>Mit * markierte Felder sind Pflichtfelder.</p>${TABLE}`);
  assert.equal(window.__jobPilottoRequired.starred(window.document), 3);   // Anrede, Vorname, E-Mail: the legend and "Telefon:" are not
  const plain = openPage(JSDOM, '<form><label for="a">Name</label><input id="a"></form>');
  assert.equal(plain.__jobPilottoRequired.starred(plain.document), 0);
});

// A lone consent checkbox with its own label sits in a grid ("row") that also holds other fields: its question is its own label, never the first
// label of the field before it (12 Oct 2026, a Swiss job board's form: "Vorname: Ich habe die Datenschutzerklärung gelesen"). Two shapes, same class:
// a Bootstrap-like grid of <label for> fields; a div/span grid whose captions are no <label> at all, the box before its label, another language.
const GRID = `<form><div class="row">
  <div class="col"><label for="fn">Vorname</label><input id="fn" type="text" required></div>
  <div class="col"><label for="em">E-Mail</label><input id="em" type="email" required></div>
  <div class="col"><input type="checkbox" id="ok" name="ok" required><label for="ok">Ich habe die Datenschutzerklärung gelesen</label></div>
</div></form>`;
const SPANS = `<section class="form-row"><div class="fld"><span class="field-title">Prénom</span><input id="p" name="p" type="text"></div>
  <div class="fld"><span class="field-title">Courriel</span><input id="c" name="c" type="email"></div>
  <p class="agree"><label><span class="cap">J'accepte les conditions</span><input type="checkbox" name="agree"></label></p></section>`;

for (const [name, html, pick, wanted] of [['a grid of labelled fields', GRID, '#ok', /Datenschutz/], ['a row of captioned fields (no <label>)', SPANS, '[name=agree]', /accepte/]]) {
  test(`a lone checkbox with its own label is not titled by another field's caption: ${name}`, { skip: !JSDOM }, () => {
    const window = openPage(JSDOM, html);
    const box = window.document.querySelector(pick);
    const title = window.__jobPilottoRequired.rowTitle(box);
    assert.ok(!title || wanted.test(title.textContent), `title taken from another field: ${title?.textContent}`);
    const asked = window.__jobPilottoFillKit.questionOf(box);
    assert.ok(!asked || wanted.test(asked), `question read as "${asked}"`);
  });
}

test('a radio group in a table row keeps its row title even when the row holds a text field', { skip: !JSDOM }, () => {
  const window = openPage(JSDOM, `<table><tr><td>Anrede</td><td><input type="radio" name="s" id="a"><label for="a">Frau</label><input type="radio" name="s" id="b"><label for="b">Herr</label> <input type="text" name="other" aria-label="other"></td></tr></table>`);
  assert.equal(window.__jobPilottoFillKit.questionOf(window.document.getElementById('a')), 'Anrede');
});

// A star the page keeps hidden until its script says the section is required (15 Oct 2026, a hosted careers form: <h3>Work History<span class="ng-hide required">*</span></h3>, a repeating
// section with no box of its own, its "Experience Summary" box (optional) further down the same section). The hidden star made the coverage list the section as a required question,
// climbed to the box and called it "question on the page not read". A star that is not shown is no mark; the same star shown is. Any way of hiding: a class's rule, hidden, inline style.
for (const [name, hide] of [['a class whose rule hides it', 'class="gone required"'], ['the hidden attribute', 'hidden class="required"'], ['an inline display:none', 'style="display:none" class="required"']]) {
  test(`a required star the page hides is not a mark (${name}); shown, it is`, { skip: !JSDOM }, () => {
    const page = star => `<style>.gone{display:none !important}</style><form><div class="section"><div class="section-header"><h3><span>Work History</span><span ${star}>*</span></h3></div>
      <ul></ul><a href="">Add Position</a><div class="section-header"><h3>Experience Summary</h3></div><textarea name="summary"></textarea></div></form>`;
    const audit = (html) => { const window = openPage(JSDOM, html); return window.__jobPilottoCoverage.audit(window.document, [], () => true).map((item) => String(item.question)).join('|'); };
    assert.equal(audit(page(hide)), '', 'a hidden star marks nothing');
    assert.equal(audit(page('class="required"')), 'Work History', 'the same star shown is the mark');
  });
}
