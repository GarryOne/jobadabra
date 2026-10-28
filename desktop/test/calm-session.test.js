// The Applying page stays calm (owner, 27 Oct 2026: "here is too much yellow backgrounds"; option A of the sketch): colour = a state or the ONE
// next action, never a fill for a whole list or card. Need rows are plain with a thin amber edge, their buttons outlined; the only amber fill
// is the next-step card's one primary. Rule: docs/rules/desktop-ui.md "Colour marks, never fills a list".
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {test} from 'node:test';
import {fileURLToPath} from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const renderer = path.join(here, '..', 'renderer');
const read = file => fs.readFileSync(path.join(renderer, file), 'utf8');

// -> the renderer files that draw a need row's buttons (smallButton from session-needs.js), so a new one is checked too.
const rowFiles = () => fs.readdirSync(path.join(renderer, 'pages')).filter(name => name.endsWith('.js'))
  .map(name => `pages/${name}`).filter(file => /\bsmallButton\(/.test(read(file)));

test('need rows: every row button is outlined, never the amber primary', () => {
  const files = rowFiles();
  for (const file of ['pages/session-needs.js', 'pages/need-proposal.js']) assert.ok(files.includes(file), `${file} draws need rows`);
  for (const file of files) {
    const primaries = read(file).split('\n').filter(line => /smallButton\([^;]*?,\s*['"`][^'"`]*\bprimary\b/.test(line));
    assert.deepEqual(primaries, [], `${file}: a need row's button is filled amber; use 'secondary' (one primary per card: the next step's)`);
  }
});

// -> [selector, body] for every rule of a stylesheet (flat: the session rules are not nested in @media).
const rules = css => [...css.replace(/\/\*[\s\S]*?\*\//g, '').matchAll(/([^{}]+)\{([^{}]*)\}/g)].map(m => [m[1].trim(), m[2]]);
const TINT = /background(?:-color)?:[^;]*(?:-soft\b|--amber-rgb|--next\b)/;

test('rows and cards that wait for you: no tone-tinted fill (state is an edge or a pill)', () => {
  // The blocks that are a whole row, list or card on the page: the session list's row, the next step, the needs card and its rows.
  // Also the same class on other screens (27 Oct 2026 follow-up): Gmail cards, the next-step band, Your focus, Add-a-lead fields (Focus's Insight box left, 28 Oct 2026).
  const BLOCK = /^\.(?:ss-(?:row|next|needs?)|mail-(?:confirm|ai|ask|question)|insight-next|focus-summary|lead-field)(?:\.[\w-]+|\[[^\]]+\])*$/;
  const tinted = [...rules(read('style.css')), ...rules(read('components.css'))].flatMap(([selectors, body]) => selectors.split(',').map(s => s.trim())
    .filter(s => BLOCK.test(s) && TINT.test(body)));
  assert.deepEqual(tinted, [], 'a row or card that waits for you is filled with a tone tint again');
});

test('the needs count is neutral: the rows carry the state', () => {
  assert.match(read('pages/session-needs.js'), /remaining`, 'neutral'/);
});

test('a button\'s solid fill is amber, never green (owner, 27 Oct 2026: "let\'s revert here to amber color"; green is a done state, not an action)', () => {
  const css = read('style.css') + read('components.css');
  const green = [...css.matchAll(/([^{}]*button[^{}]*)\{([^}]*)\}/g)].filter(([, , body]) => /background:\s*var\(--good\)/.test(body)).map(([, selector]) => selector.trim());
  assert.deepEqual(green, [], 'a button filled green');
  assert.match(read('style.css'), /\.ss-need-button\.is-answer \{[^}]*background: var\(--signal-solid\);[^}]*color: var\(--on-signal\)/);
});
