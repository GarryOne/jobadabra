// Roomy cards (owner, 18 Oct 2026, mockup 03 approved: "Look at the cards with chips how roomier they are"): the shared parts keep their shape, and every
// Strategy card sits in the .roomy-cards container with its header from card-shell.js cardHead, so a new card gets the look without its own CSS.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {test} from 'node:test';
import {install} from './tiny-dom.js';

install();
const {document} = globalThis;
const {cardHead, factColumns, readRows} = await import('../renderer/card-shell.js');
const {summaryTiles} = await import('../renderer/page-parts.js');
const read = file => fs.readFileSync(new URL(`../renderer/${file}`, import.meta.url), 'utf8');
const classes = node => String(node.className).split(/\s+/);
const text = node => node.textContent;

test('the roomy stylesheet loads after style.css (its rules win over the older .review/.card ones), in the app and the gallery', () => {
  for (const page of ['index.html', 'gallery.html']) {
    const links = [...read(page).matchAll(/href="([^"]+\.css)"/g)].map(match => match[1]);
    assert.ok(links.indexOf('roomy-cards.css') > links.indexOf('style.css'), `${page}: roomy-cards.css after style.css`);
  }
});

test('class: every Strategy card is inside .roomy-cards and draws its header with cardHead', () => {
  const html = read('index.html'), live = html.slice(html.indexOf('id="strategy-live"') - 80);
  assert.match(live, /^[\s\S]*?class="review strategy-live roomy-cards" id="strategy-live"/);
  const yours = html.slice(html.indexOf('id="strategy-yours"'), html.indexOf('id="strategy-suggestions"'));
  // Static card heads (the conflict card) have the cardHead shape: tile, then the words.
  for (const head of yours.match(/<div class="card-head[^"]*">[\s\S]*?<\/div><\/div>/g) || []) {
    if (/job-prefs-head/.test(head)) continue;   // replaced by cardHeader at load (job-preferences.js strategyCard)
    assert.match(head, /^<div class="card-head"><span class="ui-tile tone-\w+">.*?<div class="card-words"><h3>/, head);
  }
  assert.match(read('pages/strategy-cards.js'), /return cardHead\(\{glyph, tone, title, lead, badge, action\}\);/);
  assert.match(yours, /class="roomy-pair card-grid"/, 'Locations beside Job preferences through the shared pair');
  assert.doesNotMatch(read('strategy-cards.css'), /\.strategy-pair\b/, 'no page-only copy of the pair');
});

test('cardHead: icon tile, title with its status pill, one-line lead, the action last', () => {
  const action = document.createElement('button'), badge = document.createElement('span');
  badge.textContent = 'Unsaved';
  const head = cardHead({glyph: 'pin', tone: 'teal', title: 'Locations', lead: 'Where you want to work.', badge, action});
  assert.deepEqual(head.children.map(child => classes(child)[0] || child.tagName), ['ui-tile', 'card-words', 'BUTTON']);
  assert.ok(classes(head.children[0]).includes('tone-teal'));
  assert.equal(text(head.children[1].children[0]), 'LocationsUnsaved');
  assert.equal(text(head.children[1].children[1]), 'Where you want to work.');
});

// Owner, 18 Oct 2026: "Either we're fully inline, either we're fully on the new line" (picked: all on a new line); "the chips should be aligned with
// normal text properly". The class: every lined row of every roomy card, and the conflict card's row.
test('one layout: every label on its own line over its value, no heading-over-chips block or inline label column beside it', () => {
  const css = read('roomy-cards.css') + read('strategy-cards.css');
  assert.match(css, /\.roomy-cards \.summary-rows\.is-lined, \.roomy-cards \.summary-rows\.is-lined\.has-icons \{ grid-template-columns: minmax\(0, 1fr\);/);
  assert.match(css, /\.which-row \{ display: grid; grid-template-columns: minmax\(0, 1fr\);/);
  assert.doesNotMatch(css, /label-col|setting-block|pref-read-head/, 'no inline label column, list block or section heading left');
  for (const file of ['pages/strategy-targets.js', 'pages/job-preferences.js', 'pages/main-goals.js', 'gallery-cards.js']) {
    assert.doesNotMatch(read(file), /settingBlock|pref-read-head/, file);
  }
});

test('chip text and a state pill start where plain text starts (pulled left by their own padding)', () => {
  const css = read('roomy-cards.css');
  assert.match(css, /is-lined > dd > :is\(\.chips, \.read-values, \.chip-list\) \{ margin: 0 0 0 calc\(-1 \* \(var\(--chip-pad-x\) \+ 1px\)\); \}/);
  assert.match(css, /is-lined > dd > \.ui-pill:first-child \{ margin-left: -9px; \}/);
  assert.match(read('components.css'), /\.ui-pill \{[^}]*padding: 2px 9px;/, 'the pill shift follows its padding');
  assert.match(read('tokens.css'), /--chip-pad: 5px var\(--chip-pad-x\);/, 'the chip shift follows its padding');
});

test('readRows with icons: the icon in the label cell, the list marked has-icons; without, unchanged', () => {
  const rows = readRows([{icon: 'clock', label: 'Workload', value: '80 – 100%'}], {lined: true});
  assert.ok(classes(rows).includes('has-icons') && classes(rows).includes('is-lined'));
  assert.equal(rows.children[0].children[0].tagName, 'SVG');
  assert.equal(text(rows.children[0]), 'Workload');
  assert.ok(!classes(readRows([{label: 'Workload', value: 'Any'}])).includes('has-icons'));
});

test('divided tiles: "+N more" and a status badge sit inside the value, never as a line under it', () => {
  const box = summaryTiles([{key: 'roles', icon: 'briefcase', label: 'Target roles', value: 'A · B', more: '+2 more'},
    {key: 'salary', icon: 'coins', label: 'Minimum salary', value: 'CHF 1', badge: {text: 'As written', title: 'Edit to pick its currency'}}], {divided: true});
  assert.ok(classes(box).includes('is-divided'));
  for (const tile of box.children) {
    const words = tile.children[1];
    assert.equal(words.children.length, 2, 'label and value only: nothing under the value');
  }
  assert.equal(text(box.children[0].children[1].children[1]), 'A · B +2 more');
  assert.match(text(box.children[1].children[1].children[1]), /^CHF 1As written$/);
});

// Owner, 25 Oct 2026: "the content is too crowded. Let's have it one column per row, instead of two" (Main goals broke words mid-word in a narrow window).
// The class is every rule that lays out the divided tiles: none may name a second column, at any width.
test('class: divided summary tiles are one column at every width, no rule gives them two or more', () => {
  const rules = read('roomy-cards.css').split('}').filter(rule => rule.includes('.summary-tiles.is-divided'));
  assert.ok(rules.length >= 3, 'the divided-tiles rules are found');
  for (const rule of rules) {
    for (const match of rule.matchAll(/grid-template-columns:\s*([^;]+);/g)) assert.equal(match[1].trim(), 'minmax(0, 1fr)', `one column: ${rule.trim().slice(0, 80)}`);
    assert.ok(!/border-left|nth-child\(odd\)/.test(rule), `no column divider: ${rule.trim().slice(0, 80)}`);
  }
});

// Profile tabs restyled from the mockups (owner approved 18 Oct 2026: Your details 05, Experience 09/06, CV 08, Application answers 02/04/10, Cover letter 07): the class is every panel of those tabs;
// a new one fails until it has the roomy header. Every Profile tab is in ROOMY_TABS now; a new tab joins it.
const ROOMY_TABS = {details: 7, experience: 3, cv: 1, answers: 1, letter: 2};   // answers: one card since 28 Oct 2026 (no Profile facts used in forms)
test('class: every panel of a restyled Profile tab is .panel.roomy with the cardHead shape (teal tile, title over its lead), no lead line outside the header', () => {
  const html = read('index.html');
  for (const [tab, least] of Object.entries(ROOMY_TABS)) {
    const cards = html.split(/(?=<div class="setting[ "])/).filter(part => new RegExp(`class="setting panel[ "].*data-profile-panel="${tab}"`).test(part.split('\n')[0]));
    assert.ok(cards.length >= least, `${tab}: ${cards.length} panels`);
    for (const part of cards) {
      const id = part.match(/id="([^"]+)"/)[1];
      assert.match(part.split('\n')[0], /class="setting panel roomy[ "]/, id);
      assert.match(part, /<div class="summary-head card-head"><span class="ui-tile tone-teal"><i data-icon="[\w-]+"><\/i><\/span><div class="card-words"><h3>[^<]+(<span[^>]*>[^<]*<\/span>)?<\/h3><p class="muted small">[^<]+<\/p><\/div><\/div>/, id);
      assert.doesNotMatch(part.split(/(?=<div class="setting[ "])/)[0], /panel-lead/, `${id}: the lead is in the header`);
    }
  }
});

test('factColumns: one column per fact, icon · label over value, the note on hover with an info mark, a badge after the value, "Not set" when empty', () => {
  const badge = document.createElement('span');
  badge.textContent = 'Check';
  const box = factColumns([{icon: 'coins', label: 'Salary', value: 'CHF 1', note: 'gross', badge}, {label: 'Notice', value: ''}, {body: Object.assign(document.createElement('b'), {textContent: 'Alex'})}]);
  assert.equal(box.className, 'fact-cols');
  const [salary, notice, who] = box.children;
  assert.equal(salary.children[0].tagName, 'SVG');
  assert.equal(salary.children[1].children[1].title, 'gross');
  assert.match(text(salary), /^SalaryCHF 1Check$/);
  assert.match(text(notice), /^NoticeNot set$/);
  assert.equal(text(who), 'Alex');
});
