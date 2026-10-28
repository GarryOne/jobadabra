// Your details read first (owner's review, 18 Oct 2026, item 5; pages/details-read.js): every Your details card that holds fields shows a compact read view, a
// quiet Edit opens its editor in place, Done leaves an editor with no change, a CV proposal opens its card's editor, and the voluntary surveys start closed
// and marked Optional. The markup check loops over every Your details card, so a new card with fields fails until it gets the shell.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {test} from 'node:test';
import {install} from './tiny-dom.js';

const body = install();
const read = file => fs.readFileSync(new URL(`../renderer/${file}`, import.meta.url), 'utf8');
const html = read('index.html');
const {CONTACT_LINES, contactView, linksView, initDetailsRead, closeDetailsEditors} = await import('../renderer/pages/details-read.js');
const {el} = await import('../renderer/components.js');

// Each Your details card's markup, from its opening line to the next card.
const cards = () => html.split(/(?=<div class="setting[ "])/).filter(part => /data-profile-panel="details"/.test(part.split('\n')[0]));

test('class: every Your details card with fields has a read view, a quiet Edit, an editor and a Done slot', () => {
  const withFields = cards().filter(part => /data-contact="|data-facts="/.test(part));
  assert.ok(withFields.length >= 5, 'contact, links, eligibility, availability, languages');
  for (const part of withFields) {
    const id = part.match(/id="([^"]+)"/)[1];
    assert.match(part, /class="card-read"/, `${id}: a read view`);
    assert.match(part, /class="card-editor"/, `${id}: its fields in an editor`);
    assert.match(part, /class="secondary small-btn with-icon card-edit"[^>]*aria-label="Edit [^"]+"/, `${id}: a quiet Edit with its name`);
    assert.match(part, /data-done-slot/, `${id}: a Done slot`);
    assert.ok(part.indexOf('card-read') < part.indexOf('card-editor'), `${id}: read first`);
    assert.doesNotMatch(part, /<button[^>]*class="primary/, `${id}: no filled button of its own (the page bar saves)`);
  }
  const listed = [...read('pages/details-read.js').matchAll(/\{id: '(setting-[\w-]+)'/g)].map(match => match[1]);
  assert.deepEqual(withFields.map(part => part.match(/id="([^"]+)"/)[1]), listed, 'pages/details-read.js CARDS lists every one, in page order');
});

test('the voluntary surveys start closed and say Optional', () => {
  const surveys = cards().find(part => /id="setting-details-profile"/.test(part));
  assert.match(surveys, /<h3>Voluntary surveys <span class="ui-pill tone-neutral">Optional<\/span><\/h3>/);
  assert.match(read('pages/profile.js'), /foldProfilePanels\(\{closed: new Set\(\[[^\]]*'setting-details-profile'/);
});

// Mockup 05 (owner approved, 18 Oct 2026): Contact as columns, the name over the location | email, phone | address, date of birth; every detail shows,
// an empty one as "<label> not set"; a hidden field (Place of origin outside Switzerland) left out.
test('contact columns: the name (salutation before it) over the location, every other detail an icon line, an empty one said', () => {
  const values = {first_name: 'Alex', last_name: 'Morgan', salutation: 'Mr', email: 'alex@example.com', location: 'London'};
  const view = contactView(key => values[key] || '', key => key !== 'place_of_origin');
  const cols = view.children;
  assert.equal(view.className, 'fact-cols');
  assert.equal(cols.length, 1 + CONTACT_LINES.length);
  assert.match(cols[0].textContent, /^Mr Alex MorganLondon$/);
  assert.match(cols[1].textContent, /alex@example\.com.*Phone not set/);
  assert.match(cols[2].textContent, /Address not set.*Date of birth not set/);
  assert.doesNotMatch(view.textContent, /Place of origin/, 'hidden outside Switzerland');
  const half = contactView(key => ({postal_code: 'SW1A 1AA'})[key] || '', () => true).textContent;
  assert.match(half, /SW1A 1AA· Street not set/, 'a line of two details says the missing one');
  const none = contactView(() => '', () => true).textContent;
  for (const words of ['Name not set', 'Location not set', 'Salutation not set', 'Email not set', 'Place of origin not set']) assert.ok(none.includes(words), words);
});

test('links columns: the site, its address in the link colour, "Not added" when empty, GitHub only while its box shows', () => {
  const view = linksView(key => ({linkedin: 'https://www.linkedin.com/in/alex/'})[key] || '', key => key !== 'github');
  assert.deepEqual(view.children.map(col => col.textContent), ['LinkedInlinkedin.com/in/alex', 'WebsiteNot added']);
  assert.equal(view.querySelectorAll('.link-text').length, 1);
});

test('Edit opens the editor in place; Done closes it only while nothing changed; Save all / Discard all close the unchanged ones', () => {
  const card = el('div', 'setting panel');
  card.id = 'setting-contact';
  const edit = el('button', 'secondary small-btn with-icon card-edit', 'Edit');
  const readBox = el('div', 'card-read');
  readBox.id = 'contact-read';
  const editor = el('div', 'card-editor'), slot = el('span');
  slot.dataset.doneSlot = '1';
  const label = el('label', '', 'Email'), input = el('input');
  input.dataset.contact = 'email';
  input.value = 'alex@example.com';
  label.append(input);
  editor.append(label, slot);
  card.append(edit, readBox, editor);
  body.append(card);
  const saved = {email: 'alex@example.com'};   // what was read; the drafts module's count, stood in
  initDetailsRead({contact: keys => keys.filter(key => key in saved && globalThis.document.querySelector(`[data-contact="${key}"]`).value !== saved[key]).length, facts: () => 0});
  globalThis.document.dispatchEvent({type: 'details-changed'});
  assert.match(readBox.textContent, /alex@example\.com/, 'the read view shows the box\'s value');
  edit.click();
  assert.ok(card.classList.contains('is-editing'));
  const done = slot.children[0];
  assert.equal(done.textContent, 'Done');
  input.value = 'sam@example.com';   // differs from what was read
  globalThis.document.dispatchEvent({type: 'details-changed'});
  assert.equal(done.hidden, true, 'with a change the page bar decides');
  closeDetailsEditors();
  assert.ok(card.classList.contains('is-editing'), 'a card with drafts stays open after Save all / Discard all (a failed save keeps them)');
  input.value = 'alex@example.com';
  globalThis.document.dispatchEvent({type: 'details-changed'});
  assert.equal(done.hidden, false);
  done.click();
  assert.equal(card.classList.contains('is-editing'), false);
});

test('a proposal from the CV opens its card\'s editor (it is checked there, never hidden behind the read view)', () => {
  assert.match(read('pages/contact-proposals.js'), /editDetailsCard\(input\.closest\('\.setting'\)\?\.id\)/);
});

test('the facts\' skeleton also stands in the read views while they are read, so "Nothing yet" never shows for unread lines', () => {
  const facts = read('pages/details-facts.js');
  assert.match(facts, /loading: \(\) => skeletons\(true\)/);
  assert.match(facts, /const paintFacts = \(result, kept\) => \{\n {2}skeletons\(false\);/);
  assert.match(read('pages/details-read.js'), /into\.dataset\.loading\) return;/);
});
