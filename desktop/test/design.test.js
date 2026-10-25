// The design system's guard: colours, corner radii, font sizes and font families come from
// renderer/tokens.css. Any other stylesheet using a raw one fails here, with its file and line, so the UI
// can't drift back into one-off values (see docs/rules/desktop-ui.md).
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {test} from 'node:test';
import {fileURLToPath} from 'node:url';

const renderer = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'renderer');
const sheets = fs.readdirSync(renderer).filter(file => file.endsWith('.css') && file !== 'tokens.css');

// Each rule: what's not allowed, and what to use instead.
const RULES = [
  {name: 'raw colour', find: /#[0-9a-f]{3,8}\b|\b(?:rgba?|hsla?)\((?!\s*var\()/gi, use: 'a colour token, e.g. var(--muted)'},
  {name: 'raw corner radius', find: /border(?:-[a-z]+)*-radius:\s*[^;}]*\d+(?:\.\d+)?(?:px|rem|em)/g, use: 'var(--r-sm|md|lg|pill), 0 or 50%'},
  {name: 'raw font size', find: /font-size:\s*\d+(?:\.\d+)?(?:px|rem|pt)|font:[^;}]*?\b\d+(?:\.\d+)?(?:px|rem|pt)\b/g, use: 'var(--fs-…)'},
  {name: 'raw font family', find: /-apple-system|\bMenlo\b|\bmonospace\b|\bsans-serif\b/g, use: 'var(--font-sans) or var(--font-mono)'},
];

export function violations(css) {
  const found = [];
  const clean = css.replace(/\/\*[\s\S]*?\*\//g, match => match.replace(/[^\n]/g, ' '));  // comments don't count; lines stay
  // Selectors don't count either: an id such as #add-open or #bed-list is not the hex colour #add or #bed (25 Oct 2026, #1899).
  const blank = text => text.replace(/[^\n]/g, ' ');
  const code = clean.replace(/[^{};]*\{/g, match => blank(match));
  code.split('\n').forEach((line, i) => {
    for (const rule of RULES) {
      for (const match of line.matchAll(rule.find)) found.push({line: i + 1, rule: rule.name, text: match[0].trim(), use: rule.use});
    }
  });
  return found;
}

test('every stylesheet takes its colours, radii, font sizes and fonts from tokens.css', () => {
  assert.ok(sheets.includes('style.css'));
  const report = sheets.flatMap(file => violations(fs.readFileSync(path.join(renderer, file), 'utf8'))
    .map(v => `${file}:${v.line} ${v.rule} "${v.text}" → use ${v.use}`));
  assert.deepEqual(report, [], `\n${report.join('\n')}`);
});

test('the guard catches raw values and lets tokens through', () => {
  const bad = violations('.a { color: #fff; border-radius: 8px; font-size: 13px; }\n.b { font: 600 12px Menlo, monospace; box-shadow: 0 0 1px rgba(0,0,0,.2); }');
  assert.deepEqual([...new Set(bad.map(v => v.rule))].sort(), ['raw colour', 'raw corner radius', 'raw font family', 'raw font size']);
  const good = violations('.a { color: var(--muted); border-radius: var(--r-md); font-size: var(--fs-sm); box-shadow: 0 1px 2px rgb(var(--shadow-rgb) / .1); }\n/* #fff 12px */ .b { border-radius: 50%; font: 600 var(--fs-md) var(--font-mono); }');
  assert.deepEqual(good, []);
});

test('an id selector that starts with hex letters is not a colour; the same word in a value still is', () => {
  assert.deepEqual(violations('#add-open { display: flex; }\n.row #bed .x,\n#fade { color: var(--muted); }\n@media (min-width: 1px) { #add-open .icon { width: 16px; } }'), []);
  assert.deepEqual(violations('#add-open { color: #add; }').map(v => v.rule), ['raw colour']);
});

test('the index page loads the tokens before the screens\' styles', () => {
  const html = fs.readFileSync(path.join(renderer, 'index.html'), 'utf8');
  assert.ok(html.indexOf('href="tokens.css"') > -1 && html.indexOf('href="tokens.css"') < html.indexOf('href="style.css"'));
});
