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

test('session rows and cards: no tone-tinted fill (state is an edge or a pill)', () => {
  // The blocks that are a whole row, list or card on the page: the session list's row, the next step, the needs card and its rows.
  const BLOCK = /^\.ss-(?:row|next|needs?)(?:\.[\w-]+|\[[^\]]+\])*$/;
  const tinted = rules(read('style.css')).flatMap(([selectors, body]) => selectors.split(',').map(s => s.trim())
    .filter(s => BLOCK.test(s) && TINT.test(body)));
  assert.deepEqual(tinted, [], 'a session row or card is filled with a tone tint again');
});

test('the needs count is neutral: the rows carry the state', () => {
  assert.match(read('pages/session-needs.js'), /remaining`, 'neutral'/);
});
