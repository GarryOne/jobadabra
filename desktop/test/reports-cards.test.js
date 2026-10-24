// Reports: each insight and each funnel part is a card of its own (no many-items-in-one-box), and a mouse click leaves no focus ring on a tab (owner, 17 Oct 2026).
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {test} from 'node:test';

const read = name => readFileSync(new URL(`../renderer/${name}`, import.meta.url), 'utf8');

test('every list of items on a Reports tab is cards on a plain body', () => {
  const js = read('pages/reports.js'), css = read('style.css');
  assert.match(js, /el\('section', 'card iv-moments-group reports-insight'\)/);   // Insights: one per insight
  assert.equal((js.match(/el\('section', 'card'\)/g) || []).length, 2);          // Funnel: the steps, the "Where to improve"
  assert.match(js, /classList\.toggle\('is-plain', \['insights', 'funnel', 'searches'\]\.includes\(state\.tab\)\)/);
  assert.match(css, /\.card\.is-plain \{ background: none; border: 0; padding: 0;/);
  assert.doesNotMatch(css, /\.reports-insight \{[^}]*border-bottom/);
});

test('focus rings show for the keyboard only, on every tab bar and button', () => {
  const css = read('style.css');
  assert.match(css, /^:focus-visible \{ outline: 3px solid/m);
  assert.match(css, /^:focus:not\(:focus-visible\) \{ outline: none; \}/m);
  assert.doesNotMatch(read('components.css'), /\.tabs button:focus[^-]/);
});
