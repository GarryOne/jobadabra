// Finds every pop-up and notification call in desktop/ (renderer toastMessage, main notify, toasts sent to the window) and says which name no place.
// Used by test/toast-targets.test.js; pure string scanning, no imports of the app.
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {NO_PLACE} from '../renderer/targets.js';

const DESKTOP = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const jsFiles = dir => fs.readdirSync(path.join(DESKTOP, dir), {withFileTypes: true}).flatMap(entry =>
  entry.isDirectory() ? jsFiles(path.join(dir, entry.name)) : entry.name.endsWith('.js') ? [path.join(dir, entry.name)] : []);

// The text between a call's parentheses, from the index just after "(": strings, template literals (with ${…}) and nesting skipped over.
export function callArgs(source, from) {
  const stack = [')'];
  for (let i = from; i < source.length; i++) {
    const c = source[i], top = stack[stack.length - 1];
    if (top === '`') {
      if (c === '\\') i++;
      else if (c === '`') stack.pop();
      else if (c === '$' && source[i + 1] === '{') { stack.push('}'); i++; }
      continue;
    }
    if (c === "'" || c === '"') { for (i++; i < source.length && source[i] !== c; i++) if (source[i] === '\\') i++; continue; }
    if (c === '`') { stack.push('`'); continue; }
    if (c === '/' && source[i + 1] === '/') { i = source.indexOf('\n', i); continue; }
    if ('([{'.includes(c)) stack.push({'(': ')', '[': ']', '{': '}'}[c]);
    else if (c === top) { stack.pop(); if (!stack.length) return source.slice(from, i); }
  }
  throw new Error(`unclosed call at ${from}`);
}

// The arguments at depth 0 (split on top-level commas), same skipping as above.
export function topLevel(args) {
  const parts = [];
  let depth = 0, start = 0;
  for (let i = 0; i < args.length; i++) {
    const c = args[i];
    if (c === "'" || c === '"') { for (i++; i < args.length && args[i] !== c; i++) if (args[i] === '\\') i++; continue; }
    if (c === '`') { let inner = 0; for (i++; i < args.length; i++) { if (args[i] === '\\') { i++; continue; } if (args[i] === '$' && args[i + 1] === '{') { inner++; i++; } else if (args[i] === '}' && inner) inner--; else if (args[i] === '`' && !inner) break; } continue; }
    if ('([{'.includes(c)) depth++;
    else if (')]}'.includes(c)) depth--;
    else if (c === ',' && depth === 0) { parts.push(args.slice(start, i).trim()); start = i + 1; }
  }
  if (args.slice(start).trim()) parts.push(args.slice(start).trim());
  return parts;
}

// -> null when the call names its place, else why not.
export function missing(args) {
  if (/\bNO_PLACE\.(\w+)/.test(args)) {
    const reason = args.match(/\bNO_PLACE\.(\w+)/)[1];
    return NO_PLACE[reason] ? null : `NO_PLACE.${reason} is not one of ${Object.keys(NO_PLACE).join(', ')}`;
  }
  const parts = topLevel(args);
  if (parts.length === 1 && /^[A-Za-z_$][\w$]*$/.test(parts[0])) return null;   // forwards a toast built elsewhere (its maker is checked where it is written)
  const objects = parts.filter(part => part.startsWith('{'));
  if (objects.some(object => /[{,]\s*target\s*[:,}]/.test(object))) return null;
  if (parts.length >= 3 && !parts[0].startsWith('{')) return null;   // (title, body, target)
  return 'no target and no NO_PLACE reason';
}

// The calls that raise a pop-up or a notification: in the window toastMessage; in main notify (a macOS notification, or a toast when macOS blocks it),
// a toast sent to the window, and the toast callbacks lib modules are given.
const CALLS = [
  {dirs: ['renderer'], pattern: /\btoastMessage\(/g, skip: /export function toastMessage\(/},
  {dirs: ['renderer'], pattern: /\bsayRefused\(/g, skip: /export function sayRefused\(/},   // (title, result, place)
  {dirs: ['lib'], files: ['main.js'], pattern: /(?<![.\w])notify\(/g, skip: /function notify\(/},
  {dirs: ['lib'], files: ['main.js'], pattern: /toWindow\('toast',/g},
  {dirs: ['lib'], files: ['main.js'], pattern: /(?<![.\w])toast\(\{/g},
];

export function sites() {
  const found = [];
  for (const {dirs, files = [], pattern, skip} of CALLS) {
    for (const file of [...files, ...dirs.flatMap(jsFiles)]) {
      const source = fs.readFileSync(path.join(DESKTOP, file), 'utf8');
      for (const match of source.matchAll(pattern)) {
        const lineStart = source.lastIndexOf('\n', match.index) + 1, line = source.slice(lineStart, source.indexOf('\n', match.index));
        if (skip?.test(line) || /^\s*(\/\/|\*)/.test(line)) continue;
        const from = match.index + match[0].length - (match[0].endsWith('{') ? 1 : 0);
        const args = callArgs(source, from).trim();
        found.push({where: `${file}:${source.slice(0, match.index).split('\n').length}`, args});
      }
    }
  }
  return found;
}
