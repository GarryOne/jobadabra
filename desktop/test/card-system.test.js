// The card system as a class (owner, 18 Oct 2026, UI redesign; docs/rules/desktop-ui.md "Cards: read → Edit → editor"): no card's Edit is filled orange, and no
// card draws its own Save / Cancel / Discard beside the page's one save bar (renderer/save-bar.js). Every renderer file and the Profile + Strategy markup are
// scanned, so a new card fails here. KNOWN_LEFT are the cards the redesign sessions are moving onto the page bar: it may only shrink (an entry that no longer
// matches fails too, so it is taken off when its card moves). NOT_A_CARD lists the dialogs and rows that keep their own buttons, each with why.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {test} from 'node:test';

const root = new URL('../renderer/', import.meta.url);
const files = dir => fs.readdirSync(new URL(dir, root), {withFileTypes: true}).flatMap(entry => entry.isDirectory() ? (entry.name === 'vendor' ? [] : files(`${dir}${entry.name}/`)) : /\.js$/.test(entry.name) ? [`${dir}${entry.name}`] : []);
const source = file => fs.readFileSync(new URL(file, root), 'utf8');

// A button whose words are a card's own save step, drawn in code.
const OWN_SAVE = /(?:el\('button',\s*'[^']*',\s*'(?:Save|Save changes|Cancel|Discard|Discard changes)'|button\('(?:Save|Save changes|Cancel|Discard|Discard changes)'|textContent = 'Save changes')/;
const NOT_A_CARD = {
  'save-bar.js': 'the page save bar itself',
  'gallery.js': 'the component gallery shows every button kind',
  'claude-offer.js': 'Cancel a pending Claude offer, a row of the session page',
  'pages/actions-board.js': 'Cancel a queued task on the Actions board',
  'pages/ready-confirm.js': 'the Fill now confirm dialog',
  'pages/ready-pick.js': 'the Fill now count dialog',
  'pages/employers-paste.js': 'the Add employers dialog',
  'pages/plan-waitlist.js': 'the Pro waitlist dialog',
  'pages/plan-promo.js': 'the promo code dialog',
  'pages/settings.js': 'Delete for good / Cancel confirm on Data & backup',
  'job-drawer/tab-description.js': 'the job drawer\'s description editor, not a Profile or Strategy card',
  'pages/session-live.js': 'the live view\'s choose-one and file prompts: Cancel declines the page\'s own question, not a save step',
};
// Cards still on their own Save, each with the session moving it onto the page bar (UI redesign A-D, 18 Oct 2026).
const KNOWN_LEFT = {
  'goal-tiles.js': 'B: the setup review\'s goal tiles (pages/strategy-review.js); Strategy itself moved to Main goals on its page bar',
};
// The Profile page and the Strategy view in the markup: a card there with its own Save, by button id.
const MARKUP_LEFT = {};
const between = (html, start, end) => { const from = html.indexOf(start); const to = html.indexOf(end, from + start.length); return from < 0 ? '' : html.slice(from, to < 0 ? undefined : to); };

test('class: no card draws its own Save, Cancel or Discard beside the page bar (code)', () => {
  const own = files('').filter(file => OWN_SAVE.test(source(file)) && !(file in NOT_A_CARD) && !(file in KNOWN_LEFT));
  assert.deepEqual(own, [], `these draw their own save step; register a source with the page bar (save-bar.js) instead, or list a dialog in NOT_A_CARD with why: ${own}`);
  for (const [file, why] of Object.entries({...NOT_A_CARD, ...KNOWN_LEFT})) {
    assert.ok(why && fs.existsSync(new URL(file, root)), `${file} is gone: take it off the list`);
    if (file !== 'save-bar.js') assert.match(source(file), OWN_SAVE, `${file} no longer draws its own save step: take it off the list (it may only shrink)`);
  }
});

test('class: the Profile page and the Strategy view hold no card Save of their own (markup)', () => {
  const html = source('index.html');
  const pages = between(html, 'data-settings-page="profile"', 'data-settings-page="') + between(html, 'data-view="strategy" hidden>', '<div class="view');
  assert.ok(pages.length > 1000, 'found both pages in index.html');
  const ids = [...pages.matchAll(/<button\b[^>]*\bid="([^"]+)"[^>]*>\s*(?:Save|Save changes|Cancel|Discard|Discard changes)\s*<\/button>/g)].map(match => match[1]);
  const own = ids.filter(id => !(id in MARKUP_LEFT));
  assert.deepEqual(own, [], `a card Save in the markup: use the page bar (save-bar.js): ${own}`);
  for (const id of Object.keys(MARKUP_LEFT)) assert.ok(ids.includes(id), `#${id} is no longer a card Save: take it off MARKUP_LEFT (it may only shrink)`);
});

test('class: no card Edit is filled orange (code and markup)', () => {
  const filledEdit = /el\('button',\s*'[^']*\bprimary\b[^']*',\s*'(?:Edit|Add)'\)|class="primary[^"]*card-edit/;
  const found = [...files(''), 'index.html'].filter(file => filledEdit.test(source(file)));
  assert.deepEqual(found, [], `a filled Edit: use components.js cardEdit (quiet): ${found}`);
});

// Every outline tab saves through its page's one bar (D's swap, 18 Oct 2026): a new caller without `bar:` would fall back to a bar in its own card.
test('every outlineTab caller names its page bar', () => {
  const callers = files('').filter(file => /outlineTab\('/.test(source(file)) && file !== 'pages/outline-tab.js');
  assert.ok(callers.length >= 2, `found ${callers}`);   // Why (#2328): Writing preferences left outlineTab for its own file (pages/letter-style.js)
  for (const file of callers) assert.match(source(file), /outlineTab\('[^']+',[\s\S]*?bar: [\w.]+\(\)/, `${file} passes its page bar`);   // profileBar(), strategyBarNow(), Strategy's barFor()
});
