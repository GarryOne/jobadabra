// A box's label when the page's <label for> names no box: the label right before it names it (page/label-before.js), and a class that says "required" counts as required.
// 12 Oct 2026, a French form: "Prénom" / "Nom" labels naming no box, the boxes named surname / name by the page (the wrong way round): "Nom" stayed empty, "Prénom" got the family name,
// and the panel said "No required fields". Two pages, one shape: the capture's own and a variant in other languages, other ids, names, wrappers and tags.
import test from 'node:test';
import assert from 'node:assert/strict';
import { loadJsdom, openPage } from './helpers/page.js';

const JSDOM = await loadJsdom();
const skip = JSDOM ? false : 'jsdom is not installed here (run npm install in worker/)';

const FLAT = `<form><input type="hidden" name="job_id">
  <label for="civility">Civilité : Mlle / Mme / M</label>
  <input class="validate[required]" type="text" name="JOBAPPLICATION[civility]">
  <div></div>
  <label style="clear:both" for="prenom">Prénom</label>
  <input class="validate[required]" type="text" name="JOBAPPLICATION[surname]" id="form-validation-field-0">
  <div></div>
  <label for="nom">Nom</label>
  <input class="validate[required]" type="text" name="JOBAPPLICATION[name]">
  <div></div>
  <label for="mail">E-mail</label>
  <input class="validate[required,custom[email]]" type="text" name="JOBAPPLICATION[email]" id="form-validation-field-1"></form>`;
// Same shape, everything incidental changed: German and Spanish, each box in its own wrapper, a label ids a box of ANOTHER field, names that point the other way.
const WRAPPED = `<form>
  <p class="q"><label for="x-family">Nachname</label><br><input name="vorname_feld" id="a1" class="is-required"></p>
  <p class="q"><label for="x-given">Vorname</label><span class="hint"></span><input name="familyName" id="a2" aria-required="true"></p>
  <div class="q"><label for="gone">Teléfono</label><div class="wrap"><input name="surname" type="tel" id="a3"></div></div>
  <div class="q"><label for="a4">Notizen</label><textarea name="n" id="a4"></textarea></div></form>`;

const labels = (window) => [...window.document.querySelectorAll('input, textarea')].filter((el) => el.type !== 'hidden').map((el) => window.__jobadabraFillKit.labelOf(el));

test('the label before a box names it when its `for` names no box (flat form)', { skip }, () => {
  const window = openPage(JSDOM, FLAT);
  assert.deepEqual(labels(window), ['Civilité : Mlle / Mme / M', 'Prénom', 'Nom', 'E-mail']);
  const pairs = Object.fromEntries(['Prénom', 'Nom'].map((label) => [label, window.__jobadabraFillKit.PROFILE_LABELS.find(([, pattern]) => pattern.test(label))?.[0] || '']));
  assert.equal(pairs['Prénom'], 'first_name', 'a label read as "Prénom" is the first name whatever the box is named');
});

test('variant: other languages, wrappers, tags and names pointing the wrong way', { skip }, () => {
  const window = openPage(JSDOM, WRAPPED);
  assert.deepEqual(labels(window), ['Nachname', 'Vorname', 'Teléfono', 'Notizen']);
  assert.equal(window.__jobadabraFillKit.PROFILE_LABELS.find(([, pattern]) => pattern.test('Vorname'))[0], 'first_name');
});

test('a label tied to another box is not borrowed, and a label past other text or a box is not either', { skip }, () => {
  const window = openPage(JSDOM, `<form><label for="b">Eins</label><input id="b"><input id="c"> <label>Zwei</label> Text <input id="d"><label for="zz">Drei</label><div><input id="e"><input id="f"></div></form>`);
  const before = (id) => window.__jobadabraLabelBefore(window.document.getElementById(id));
  assert.equal(before('c'), '', 'the label before it belongs to the box before');
  assert.equal(before('d'), '', 'text sits between');
  assert.equal(before('e'), '', 'a wrapper with two boxes is no one box');
});

test('a class or attribute that says "required" marks the box; a lookalike word does not', { skip }, () => {
  const window = openPage(JSDOM, `<input id="a" class="validate[required]"><input id="b" class="validate[required,custom[email]]"><input id="c" class="is-required"><input id="d" aria-required="true"><input id="e" class="not-requiredish unrequired"><input id="f" class="validate[custom[email]]">`);
  const marked = (id) => window.__jobadabraRequired.marked(window.document.getElementById(id));
  assert.deepEqual(['a', 'b', 'c', 'd', 'e', 'f'].map(marked), [true, true, true, true, false, false]);
});

test('the describe-form read shows both pages\' boxes as required with their labels', { skip }, async () => {
  for (const [html, want] of [[FLAT, ['Prénom', 'Nom']], [WRAPPED, ['Nachname', 'Vorname']]]) {
    const window = openPage(JSDOM, html);
    const rows = (await window.__jobadabraDescribeForm(false));
    for (const label of want) assert.equal(rows.find((row) => row.label === label)?.required, true, label);
  }
});

test('the Playwright audit reads the same required mark as the panel and the fill (a class that says required)', { skip }, () => {
  const required = (html, id) => openPage(JSDOM, html).__jobPilottoAuditVisibleFields().find((row) => row.field === id)?.required;
  assert.equal(required(FLAT, 'form-validation-field-0'), true, 'validate[required] on a flat form');
  assert.equal(required(FLAT, 'form-validation-field-1'), true, 'validate[required,custom[email]]');
  assert.equal(required(WRAPPED, 'a1'), true, 'is-required');
  assert.equal(required(WRAPPED, 'a2'), true, 'aria-required');
  assert.equal(required(WRAPPED, 'a4'), false, 'a box with no mark stays optional');
});

// A group's title (12 Oct 2026, widget zoo segmented-toggle-1): its own accessible name wins, else the NEAREST title before it that no other control owns; never the first
// label of its form, never a title after it. Two fields never share one label (the toggle named "First name" left the real First name box "empty again at the end").
const TOGGLE = (groupAttrs, between = '') => `<form>
  <label for="first">First name</label> <input id="first" name="first_name" required>
  <label for="mail">Email</label> <input id="mail" name="email" type="email" required>
  ${between}
  <div class="toggle" role="group" ${groupAttrs}><button type="button" aria-pressed="false">Yes</button><button type="button" aria-pressed="false">No</button></div>
  <label>A title after the group</label>
</form>`;

test('a group is named by its own accessible name, else the nearest title before it that is no other box\'s label', {skip}, () => {
  const name = (html) => { const window = openPage(JSDOM, html); const group = window.document.querySelector('[role=group]'); const found = window.__jobadabraGroupTitle(group); window.close(); return found?.text || ''; };
  assert.equal(name(TOGGLE('aria-labelledby="q"', '<label id="q">Are you open to occasional business travel?</label>')), 'Are you open to occasional business travel?', 'aria-labelledby');
  assert.equal(name(TOGGLE('aria-label="Do you need a visa?"')), 'Do you need a visa?', 'aria-label alone');
  assert.equal(name(TOGGLE('', '<label>Willing to relocate?</label>')), 'Willing to relocate?', 'no aria: the nearest free title before it');
  assert.equal(name(TOGGLE('')), '', 'only other boxes\' labels before it, a title after it: no name, never "First name"');
});

test('on the toggle page every field has its own label: the group its question, First name its box', {skip}, async () => {
  const window = openPage(JSDOM, TOGGLE('aria-labelledby="q"', '<label id="q">Are you open to occasional business travel?</label>'));
  const labels = (await window.__jobadabraDescribeForm()).map(row => row.label);
  assert.equal(new Set(labels).size, labels.length, `two fields share one label: ${labels.join(' | ')}`);
  assert.ok(labels.includes('Are you open to occasional business travel?'), labels.join(' | '));
  assert.ok(labels.includes('First name'));
  window.close();
});

// cc's review of #515 (12 Oct 2026): a title owns a group only if no other control lies between them: "Do you need a visa?" took "Are you fluent in English?" (the
// previous question's title) and a toggle took "Notice period" (a text box's). With no title of its own kind, the text right before the group in its row names it.
const ROWS = `<form>
  <div class="field-title">Are you fluent in English?</div><div role="group" id="g1"><button type="button" aria-pressed="false">Yes</button><button type="button" aria-pressed="false">No</button></div>
  <p>Do you need a visa to work here?</p><div role="group" id="g2"><button type="button" aria-pressed="false">Yes</button><button type="button" aria-pressed="false">No</button></div>
  <div class="field-title">Notice period</div><input id="notice">
  <p>Willing to relocate?</p><div role="group" id="g3"><button type="button" aria-pressed="false">Yes</button><button type="button" aria-pressed="false">No</button></div>
</form>`;

test('a group never takes a title that another control sits between: the previous question\'s, a text box\'s; its own row\'s text names it', {skip}, async () => {
  const window = openPage(JSDOM, ROWS);
  const name = id => window.__jobadabraGroupTitle(window.document.getElementById(id))?.text || '';
  assert.equal(name('g1'), 'Are you fluent in English?');
  assert.equal(name('g2'), 'Do you need a visa to work here?', 'not the fluency question before the first group');
  assert.equal(name('g3'), 'Willing to relocate?', 'not the notice period box\'s title');
  const labels = (await window.__jobadabraDescribeForm()).map(row => row.label).filter(Boolean);
  assert.equal(new Set(labels).size, labels.length, `two fields share one label: ${labels.join(' | ')}`);
  window.close();
});

// 17 Oct 2026, Breezy HR: the question is a bare <h3> above its box; a salary block is one heading over a currency menu and an amount box.
const HEADINGS = `<form>
  <div class="desired-salary"><h3><span>Desired Salary</span><span class="required">*</span></h3>
    <select name="salaryCurrency"><option>US Dollar</option><option>Swiss Franc</option></select><input name="cSalary"></div>
  <ul><li><div><h3>Provide your city and state of residence*</h3><input name="section_1774295790652_question_5"></div></li>
  <li><div><h3>LinkedIn Profile link</h3><div class="question-body"><p><br></p></div><input name="section_1774295790652_question_0"></div></li></ul></form>`;
// A section title over labelled boxes, and over many boxes, is not any one box's name.
const SECTIONS = `<form><div><h3>Contact</h3>
  <label for="e">Email</label><input id="e" name="email"><input name="phone"><input name="zip"><input name="town"></div>
  <div><h3>Personal</h3><label for="n">Name</label><input id="n" name="n"><input name="nick"></div></form>`;

test('a heading right above a box with no label of its own names it', { skip }, () => {
  const window = openPage(JSDOM, HEADINGS);
  const all = [...window.document.querySelectorAll('input, select')].map((el) => window.__jobadabraFillKit.labelOf(el));
  assert.deepEqual(all, ['Desired Salary', 'Desired Salary', 'Provide your city and state of residence', 'LinkedIn Profile link']);
});

test('a section heading over labelled boxes or over more than three boxes names none of them', { skip }, () => {
  const window = openPage(JSDOM, SECTIONS);
  const all = [...window.document.querySelectorAll('input')].map((el) => window.__jobadabraFillKit.labelOf(el));
  assert.deepEqual(all, ['Email', 'phone', 'zip', 'town', 'Name', 'nick']);
});
