// Solid buttons only (owner, 27 Oct 2026: "Let's have always just solid buttons in the app"): a button always has its own box (primary, secondary,
// danger, danger-outline), never text-only (`ghost`, `link`): a text-only button beside or under a boxed one sits misaligned and does not look pressable.
// Every text-only button the window draws today is counted per file in text-buttons-allowed.json; a file that draws more fails here, so the count
// only shrinks while the existing ones are made solid. Rule: docs/rules/desktop-ui.md "Buttons are solid".
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {test} from 'node:test';
import {fileURLToPath} from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const renderer = path.join(here, '..', 'renderer');
const ALLOWED = JSON.parse(fs.readFileSync(path.join(here, 'text-buttons-allowed.json'), 'utf8'));

// A class string holding `ghost`, or `link` on a line that makes a button (el('button', ...), a button(...) helper, a <button>).
const GHOST = /['"`][^'"`\n]*\bghost\b[^'"`\n]*['"`]/;
const LINK = /['"`](?:[\w-]+ )*link(?: [\w-]+)*['"`]/;
const MAKES_BUTTON = /['"]button['"]|\bbutton\(|Button\(/;
// -> how many lines of a script draw a text-only button (one line = one button).
export const jsTextButtons = source => source.replace(/\/\/.*$/gm, '').split('\n')
  .filter(line => GHOST.test(line) || (MAKES_BUTTON.test(line) && LINK.test(line))).length;
// -> how many <button> in the markup carry a text-only class.
export const htmlTextButtons = source => (source.replace(/<!--[\s\S]*?-->/g, '').match(/<button\b[^>]*\bclass="[^"]*\b(?:ghost|link)\b[^"]*"/g) || []).length;

export function counts() {
  const out = {};
  const walk = dir => {
    for (const entry of fs.readdirSync(dir, {withFileTypes: true})) {
      const full = path.join(dir, entry.name), rel = path.relative(renderer, full).split(path.sep).join('/');
      if (entry.isDirectory()) { if (entry.name !== 'assets') walk(full); continue; }
      const n = entry.name.endsWith('.js') ? jsTextButtons(fs.readFileSync(full, 'utf8')) : entry.name.endsWith('.html') ? htmlTextButtons(fs.readFileSync(full, 'utf8')) : 0;
      if (n) out[rel] = n;
    }
  };
  walk(renderer);
  return out;
}

test('no screen adds a text-only button beyond today\'s count (buttons are solid)', () => {
  const over = Object.entries(counts()).filter(([file, n]) => n > (ALLOWED[file] ?? 0))
    .map(([file, n]) => `renderer/${file}: ${n} text-only buttons (ghost/link), ${ALLOWED[file] ?? 0} allowed`);
  assert.deepEqual(over, [], `\n${over.join('\n')}
A button is always solid (owner, 27 Oct 2026): use 'secondary' (or 'primary' for the card's one main action, 'danger-outline' for a destructive one),
and put it in the same row as its siblings (docs/rules/desktop-ui.md "Buttons are solid"). Never raise a count in test/text-buttons-allowed.json.`);
});

test('the counter sees text-only buttons and skips solid ones', () => {
  const js = [
    "links.append(button('a', 'Change e-mail', 'ghost'));",
    "button('Cancel', 'link', () => {});",
    "const b = el('button', 'link small', 'Undo');",
    "const s = el('button', 'secondary', 'Turn on');",
    "const a = el('a', 'link', 'Open');            // an <a> is a link, not a button",
    "// el('button', 'ghost')",
  ].join('\n');
  assert.equal(jsTextButtons(js), 3);
  assert.equal(htmlTextButtons('<button class="ghost" id="x">X</button><button class="secondary">Y</button><button id="z" class="link small">Z</button><!-- <button class="ghost"> -->'), 2);
});
