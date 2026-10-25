// A sticky page save bar never covers another bar or a button (owner, 18 Oct 2026; the Profile save bar slid over Expand all / Collapse all on a short tab):
// Profile's fold bar and save bar sit in one sticky dock, stacked; every page's save bar sticks at the bottom edge, never lifted for a bar that is not there.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {test} from 'node:test';

const read = file => fs.readFileSync(new URL(`../renderer/${file}`, import.meta.url), 'utf8');

test('Profile: the fold bar and the save bar share one sticky dock, neither sticky on its own inside it', () => {
  const html = read('index.html'), dock = html.indexOf('id="profile-dock"');
  assert.ok(dock > 0 && html.indexOf('id="profile-foldbar"') > dock, 'the fold bar sits inside the dock');
  assert.match(read('pages/profile-save-bar.js'), /host: document\.getElementById\('profile-dock'\)/, 'the save bar is put in the same dock');
  assert.match(read('card-shell.css'), /\.page-dock > \.foldbar \{[^}]*position: static;/);
  assert.match(read('card-shell.css'), /\.page-dock > \.save-bar \{ display: contents; \}/, 'the save bar adds no box of its own inside the dock: one row');
});

test('class: every page that makes a save bar (pageSaveBar) gets it at the bottom edge; only a dock stacks it with another bar', () => {
  assert.match(read('style.css'), /\.save-bar \{ position: sticky; bottom: 0;/, 'no offset for a bar some pages do not have');
  const sticky = ['components.css', 'style.css', 'card-shell.css', 'roomy-cards.css', 'strategy-cards.css'].flatMap(file => read(file).split('\n').filter(line => /^\.[\w-]*bar\b[^{]*\{[^}]*position: sticky; bottom:/.test(line)).map(line => `${file}: ${line.slice(0, 40)}`));
  assert.deepEqual(sticky.map(line => line.split(':')[0]).sort(), ['components.css', 'style.css'], `the fold bar and the save bar are the only bottom bars; a new one docks with them: ${sticky}`);
});

// One row, set apart from the cards (owner, 25 Oct 2026: "the same background … impossible to distinguish what stays on top … one single bar/row").
test('class: every page with a save bar or a fold bar uses the shared one-row dock look: --bg tray, shadow up, words left, buttons right', () => {
  const pages = {'Profile': ['pages/profile-save-bar.js', 'pageSaveBar('], 'Strategy': ['pages/strategy-cards.js', 'pageSaveBar('], 'Outline cards': ['pages/outline-tab.js', 'pageSaveBar('], 'Design system': ['gallery-cards.js', 'pageSaveBar(']};
  for (const [page, [file, call]] of Object.entries(pages)) assert.ok(read(file).includes(call), `${page} builds its bar with the shared pageSaveBar`);
  const bar = read('style.css').split('\n').filter(line => line.startsWith('.save-bar {') || line.startsWith('  padding: var(--sp-3) var(--sp-5)')).join(' ');
  assert.match(bar, /background: var\(--bg\)/, 'a different background than the cards (--surface)');
  assert.match(bar, /box-shadow: var\(--shadow-up\)/);
  assert.match(read('save-bar.js'), /save-bar-actions/, 'the buttons sit together at the right');
  const dock = read('card-shell.css');
  assert.match(dock, /\.page-dock \{[^}]*background: var\(--bg\)[^}]*box-shadow: var\(--shadow-up\)/);
  assert.match(dock, /grid-template-columns: minmax\(0, 1fr\) auto minmax\(0, 1fr\)/, 'words | fold controls centred | buttons');
  for (const file of ['components.css', 'style.css', 'card-shell.css', 'roomy-cards.css', 'strategy-cards.css'])
    assert.doesNotMatch(read(file), /\.(strategy|profile)[\w-]* \.(save-bar|foldbar)\s*\{/, `${file}: no page-only rule for the shared bars`);
  assert.equal(read('index.html').match(/class="foldbar"/g)?.length, 1, 'the only fold bar is Profile\'s, inside the dock');
});
