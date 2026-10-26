// Every press the extension makes goes through the press floor (extension/page/submit-press.js `press`: it refuses a control that deletes data or an account, withdraws an application, signs out,
// or declines in a dialog that is no cookie notice; 15 Oct 2026: a closer pressed "Decline" on a privacy statement and opened "Delete All Data"). Loops over every `.click()` in extension/**/*.js: it is
// `globalThis.__jobPilottoPress?.(el) || el.click()` or it is on the list of presses that are not the page's (the extension's own panel). A press at coordinates (debugger mouse events) or a dispatched
// MouseEvent / requestSubmit cannot ask the floor about an element: they are listed as OPEN so a new one fails until it is looked at.
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {readFileSync} from 'node:fs';
import {join} from 'node:path';
import {test} from 'node:test';
import {fileURLToPath} from 'node:url';

const repo = fileURLToPath(new URL('../..', import.meta.url));
const SOURCES = () => execFileSync('git', ['ls-files', '-z', 'extension'], {cwd: repo}).toString().split('\0').filter(file => file.endsWith('.js'));
const code = line => line.replace(/\/\/.*$/, '');

// A click through the floor: __jobPilottoPress?.(x) || x.click(), on the same expression.
export const floorClicks = source => source.split('\n').flatMap((line, i) => {
  const text = code(line);
  return [...text.matchAll(/([\w$.\]\[]+|\([^()]*\))\.click\(\)/g)].filter(m => !text.slice(0, m.index).includes('__jobPilottoPress?.(')).map(() => i + 1);
});
// Presses that are not an element's `.click()` (a debugger mouse event at a point, a dispatched MouseEvent, requestSubmit). OPEN: nobody has looked at them (the list is empty; a new one fails until it is
// routed). ROUTED: the file's presses ask the floor first, and the marker proves it (markAt = the point's control is checked, false = no click; refused = the element is checked; searchSubmit = only a search-shaped form is sent).
export const OPEN = {};
export const ROUTED = {
  'extension/fill-verify.js': /markAt\([^)]*\)[^\n]*=== false/, 'extension/press-real.js': /markAt\([^)]*\)[^\n]*=== false/, 'extension/flow.js': /markAt\([^)]*\)[^\n]*=== false/, 'extension/ladder/fill-climb.js': /markAt\([^)]*\)[^\n]*\.result === false|result === false/,
  'extension/visit-page.js': /^(?=[\s\S]*const searchSubmit = form =>)(?=[\s\S]*__jobPilottoSubmitPress\?\.refused\(option\))/,
};
const OPEN_PRESS = /Input\.dispatchMouseEvent|dispatchEvent\(new (?:Mouse|Pointer)Event|\.requestSubmit\??\.?\(/;
// Not the page's controls: the floor itself, and the guard that wraps the page's own requestSubmit.
const NOT_PAGE = new Set(['extension/page/submit-press.js', 'extension/page/browser-submit-guard.js']);

test('the checker finds a click that skips the floor', () => {
  assert.deepEqual(floorClicks('(globalThis.__jobPilottoPress?.(el) || el.click());'), []);
  assert.deepEqual(floorClicks('\nbutton.click();'), [2]);
});

test('every .click() in the extension goes through the press floor', () => {
  const found = SOURCES().filter(file => !NOT_PAGE.has(file)).flatMap(file => floorClicks(readFileSync(join(repo, file), 'utf8')).map(n => `${file}:${n}`));
  assert.deepEqual(found, []);
});

test('presses that are not an element click ask the floor first, or are on the OPEN list', () => {
  const seen = {};
  for (const file of SOURCES().filter(name => !NOT_PAGE.has(name))) {
    const n = readFileSync(join(repo, file), 'utf8').split('\n').filter(line => OPEN_PRESS.test(code(line))).length;
    if (n) seen[file] = n;
  }
  const routed = Object.fromEntries(Object.entries(seen).filter(([file]) => ROUTED[file]));
  for (const file of Object.keys(routed)) { assert.match(readFileSync(join(repo, file), 'utf8'), ROUTED[file], `${file} asks the floor before its press`); delete seen[file]; }
  assert.deepEqual(seen, OPEN);
});
