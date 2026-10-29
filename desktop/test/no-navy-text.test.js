// --navy is a surface colour that turns near-black in dark mode (renderer/tokens.css), so no rule may use it as a text colour: dark text on a dark page was unreadable (.message.waiting, .device-code).
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {test} from 'node:test';

const renderer = new URL('../renderer/', import.meta.url).pathname;
const css = fs.readdirSync(renderer).filter(name => name.endsWith('.css') && name !== 'tokens.css');

test('no rule colours text with --navy', () => {
  const found = [];
  for (const name of css) {
    fs.readFileSync(path.join(renderer, name), 'utf8').split('\n').forEach((line, index) => {
      if (/(^|[^-\w])color:\s*var\(--navy(-hover|-active|-line)?\)/.test(line)) found.push(`${name}:${index + 1}`);
    });
  }
  assert.deepEqual(found, [], 'use var(--ink) for text; --navy is for surfaces');
});

test('the token that replaces it flips with the theme', () => {
  const tokens = fs.readFileSync(path.join(renderer, 'tokens.css'), 'utf8');
  const inks = [...tokens.matchAll(/--ink:\s*(#[0-9a-f]+)/gi)].map(match => match[1].toLowerCase());
  assert.ok(inks.length >= 2 && new Set(inks).size >= 2, 'light and dark define different --ink values');
});
