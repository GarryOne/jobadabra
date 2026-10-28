// One Edit button for every card, at the right of the card's title line (owner, 18 Oct 2026: "I don't like the Edit button position"), quiet since the UI redesign
// the same day (D1: "a compact pencil + Edit button ... with a neutral outline"): drawn by components.js cardEdit or, in static markup, with the same classes. A test fails when a card draws its own Edit outside it; a row's own action is listed with its reason.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {test} from 'node:test';
import {install} from './tiny-dom.js';

install();
const {cardEdit} = await import('../renderer/components.js');
const root = new URL('../renderer/', import.meta.url);
const files = dir => fs.readdirSync(new URL(dir, root), {withFileTypes: true}).flatMap(entry => entry.isDirectory() ? (entry.name === 'vendor' ? [] : files(`${dir}${entry.name}/`)) : /\.js$/.test(entry.name) ? [`${dir}${entry.name}`] : []);
const source = file => fs.readFileSync(new URL(file, root), 'utf8');

// Row actions that are not a card's Edit, each with why.
const ROW_ACTIONS = {
  'job-drawer/job-letter.js': 'Edit sits among Copy / Write again / Open PDF and turns into Save',
  'gallery-kinds.js': 'a table header word, not a button',
  'components.js': 'the shared card Edit itself',
};
const BUTTON_WORD = /(?:el\('(?:button|a)',\s*'[^']*',\s*[^)]*'(?:Edit|Add)'|button\('Edit')/;

test('cardEdit is quiet (outline, pencil + word), small, labelled for the screen reader and clicks', () => {
  let clicks = 0;
  const button = cardEdit('Edit', 'summary', () => { clicks++; });
  assert.match(button.className, /\bsecondary\b.*\bsmall-btn\b.*\bwith-icon\b.*\bcard-edit\b/);
  assert.doesNotMatch(button.className, /\bprimary\b/, 'filled orange is for Save, never a card\'s Edit');
  assert.equal(button.textContent, 'Edit');
  assert.equal(button.children[0].tagName, 'SVG', 'the pencil comes first');
  assert.equal(button.getAttribute('aria-label'), 'Edit summary');
  button.listeners.click.forEach(fn => fn({}));
  assert.equal(clicks, 1);
});

test('class: every card draws its Edit through the shared button; static markup uses its classes', () => {
  const html = source('index.html');
  const staticEdits = [...html.matchAll(/<(button|a)\b([^>]*)>(?:\s*<i data-icon="edit"><\/i>\s*<span>)?\s*Edit\s*(?:<\/span>)?\s*<\/\1>/g)];
  assert.ok(staticEdits.length >= 2, 'Reminders and Professional links');
  for (const [tag] of staticEdits) {
    assert.match(tag, /class="secondary small-btn with-icon card-edit"[^>]*><i data-icon="edit"><\/i><span>Edit<\/span>/, `a static Edit that is not the shared button: ${tag}`);
    assert.match(tag, /aria-label="(Edit|Done)[^"]+"/, `an Edit with no name for the screen reader: ${tag}`);
  }
  const own = files('').filter(file => !(file in ROW_ACTIONS) && BUTTON_WORD.test(source(file)));
  assert.deepEqual(own, [], `these draw their own Edit/Add button; use cardEdit from components.js (or list it in ROW_ACTIONS with the reason): ${own}`);
  for (const [file, why] of Object.entries(ROW_ACTIONS)) assert.ok(why && fs.existsSync(new URL(file, root)), file);
  const classed = files('').filter(file => file !== 'components.js' && /card-edit(?![\w-])/.test(source(file)));
  assert.deepEqual(classed, [], 'only components.js writes the card-edit classes in code');
});

test('the card Edit sits last in its title line, pushed right, and the one-part panel gives it a slot next to its title', () => {
  const css = source('card-shell.css');
  assert.match(css, /button\.card-edit \{ margin-left: auto;/);
  assert.match(css, /\.is-editing \.card-edit \{ display: none; \}/, 'Edit hides while its card is edited');
  assert.match(source('index.html'), /<h3>Voluntary surveys <span class="ui-pill tone-neutral">Optional<\/span><\/h3><p class="muted small">[^<]+<\/p><\/div><\/div><span id="details-profile-edit"><\/span>/);
});
