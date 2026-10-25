// A short window in the icon rail gives the page list the room (owner, 25 Oct 2026: "the sidebar menu collapsed is broken": at 528 css px the list had 117 px,
// two pages, the third sliced). What steps aside must stay reachable: feedback in ⌘K (it is a .nav), the theme in Settings → Appearance; collapse only where it cannot act.
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {test} from 'node:test';

const read = file => readFileSync(new URL(`../renderer/${file}`, import.meta.url), 'utf8');
const css = read('menu.css'), html = read('index.html');
const block = query => (css.match(new RegExp(`@media \\(${query.replace(/[()]/g, '\\$&')}\\)\\s*\\{([\\s\\S]*?)\\n\\}`)) || [])[1] || '';

test('under 880 px tall the rail hides feedback, the theme switch and the plan bar, and tightens its rows', () => {
  const short = block('max-height: 880px');
  for (const part of ['#nav-feedback', '#theme-toggle', '.allowance-chip']) assert.match(short, new RegExp(`\\.app\\.rail ${part.replace('.', '\\.')}[^{]*\\{[^}]*display: none|\\.app\\.rail ${part.replace('.', '\\.')},`), `${part} steps aside in a short rail`);
  assert.match(short, /\.app\.rail \.sidebar \.nav \{ padding:/, 'the rows tighten');
  // The badge/dot row is 14 px tall on the button's top edge (menu.css top): a top padding under it puts the marker over the icon (the interactions suite, beta of 25 Oct 2026).
  assert.ok(Number(short.match(/\.app\.rail \.sidebar \.nav \{ padding: (\d+)px/)[1]) >= 15, 'the top padding keeps the icon clear of the badge row');
  assert.doesNotMatch(short, /#rail-toggle/, 'collapse stays in a wide window: the way back from a collapsed menu');
  assert.match(css, /@media \(max-height: 880px\) and \(max-width: 1179px\) \{ \.app\.rail #rail-toggle \{ display: none; \} \}/, 'only where the rail is forced by the width');
});

test('what steps aside stays reachable: feedback is a menu .nav (listed in ⌘K), the theme has its Settings control', () => {
  assert.match(html, /<button class="nav" id="nav-feedback"/);
  assert.match(read('pages/theme.js'), /Settings → Appearance/);
});
