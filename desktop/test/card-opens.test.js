// The class "compact card with one main action": its empty area presses that action, an inner control does only its own thing (owner, 19 Oct 2026).
// Loops over every listed card; a new compact card with one primary button that is not listed here (and not marked) fails the scan.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {test} from 'node:test';
import {install} from './tiny-dom.js';

const body = install();
const {cardOpens} = await import('../renderer/components.js');
const html = fs.readFileSync(new URL('../renderer/index.html', import.meta.url), 'utf8');

// card id → its main action's id. Left out on purpose: the Actions task cards (Run starts a paid or long task: a stray click must not start it)
// and cards with two equal actions.
// Why (insights PR 1c, 28 Oct 2026): the drawers' and the cover letter's cards (the last three) became rows of the Jobs bar and Focus (renderer/question-entries.js); a new compact card is listed here.
const CARDS = {};

// Scanned but left out, with the reason: a live status banner with Stop, View activity and a log link (several equal actions).
const LEFT_OUT = {'run-banner': 'a progress banner: Stop, View activity and View log are equal actions'};

const build = (cardId, mainId) => {
  const card = globalThis.document.createElement('section'), main = globalThis.document.createElement('button');
  card.id = cardId; main.id = mainId; main.className = 'primary';
  const text = globalThis.document.createElement('p'), other = globalThis.document.createElement('button'), link = globalThis.document.createElement('a');
  other.className = 'secondary'; link.className = 'link'; link.href = '#';
  card.append(text, main, other, link); body.append(card);
  let ran = 0; main.addEventListener('click', () => { ran++; });
  cardOpens(card, main);
  return {card, text, main, other, link, ran: () => ran};
};

for (const [cardId, mainId] of Object.entries({...CARDS, 'a-card': 'a-card-main'})) {   // the listed cards, and one generic card so cardOpens itself stays tested
  test(`${cardId}: the empty area runs ${mainId}, an inner control does not`, () => {
    if (cardId in CARDS) assert.match(html, new RegExp(`id="${cardId}"`), 'the card exists in index.html');
    const t = build(cardId, mainId);
    t.card.dispatch('click', {target: t.text});   // the tiny DOM does not bubble: the event reaches the card with its target
    assert.equal(t.ran(), 1, 'a click on the empty area ran the main action');
    t.card.dispatch('click', {target: t.card});
    assert.equal(t.ran(), 2, 'a click on the card itself ran it');
    const before = t.ran();
    t.card.dispatch('click', {target: t.other}); t.card.dispatch('click', {target: t.link});
    assert.equal(t.ran(), before, 'an inner button or link ran only itself');
    t.card.dispatch('click', {target: t.main});   // the main button's own click is not run twice through the card
    assert.equal(t.ran(), before, 'the card never runs the main button a second time');
    assert.ok(t.card.classList.contains('is-card-opens'), 'the hover and cursor class');
  });
}

test('a text selection is not a click', () => {
  const t = build('sel', 'sel-main');
  globalThis.getSelection = () => ({toString: () => 'some words'});
  t.card.dispatch('click', {target: t.text});
  delete globalThis.getSelection;
  assert.equal(t.ran(), 0);
});

test('every compact card with one primary button in index.html is listed (or marked), and has no link beside its button', () => {
  const blocks = [...html.matchAll(/<(section|div) class="card [^"]*"[^>]*id="([^"]+)"[^>]*>([\s\S]*?)<\/\1>/g)];
  const compact = blocks.filter(([, , , inner]) => inner.split('\n').length <= 14 && (inner.match(/<button class="primary"/g) || []).length === 1);
  for (const [, , id, inner] of compact.filter(([, , id]) => !(id in LEFT_OUT))) {
    assert.ok(id in CARDS, `#${id} is a compact card with one primary action: add it to cardOpens (pages/…) and to CARDS here`);
    assert.doesNotMatch(inner, /class="link|<a /, `#${id}: no link under the one button; a second action moves into what the button opens`);
  }
  for (const id of ['questions', 'learned', 'letter-setup']) assert.doesNotMatch(html, new RegExp(`id="${id}"`), `#${id} is a row of the Jobs bar and Focus now (question-entries.js), not a card`);
});

test('the drawer header opens the What we learned tab, never a Saved answers box (owner, 28 Oct 2026)', () => {
  const src = fs.readFileSync(new URL('../renderer/pages/question-review.js', import.meta.url), 'utf8');
  assert.match(src, /review-learned-tab/);
  assert.doesNotMatch(src, /'Saved answers'/);
  assert.doesNotMatch(src, /button\('Manage saved answers'/);
});
