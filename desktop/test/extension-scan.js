// Reads the extension's source and says, per /extension/ route, which files call it and which JSON keys each call sends (statically; no browser).
import fs from 'node:fs';
import path from 'node:path';

export const REPO = new URL('../../', import.meta.url).pathname;

/** -> the file's source with comments blanked (strings kept), for word searches that must not match prose. */
const kept = new Map();
export const codeOf = file => { if (!kept.has(file)) kept.set(file, blankComments(fs.readFileSync(path.join(REPO, file), 'utf8'))); return kept.get(file); };

/** -> whether `name` stands as a word (property, key, string) in the code of any of the files. */
export const readsWord = (files, name) => files.some(file => new RegExp(`(^|[^\\w$])${name.replace(/[$]/g, '\\$&')}([^\\w$]|$)`).test(codeOf(file)));
const ROUTE = /(\/extension\/[a-z][a-z-]*)(?=[?'"`])/g;

/** -> {files: [repo-relative path]} of the extension's own source (no tests, no README). */
export function extensionFiles(dir = 'extension') {
  return fs.readdirSync(path.join(REPO, dir), {recursive: true}).filter(f => /\.(js|mjs)$/.test(f)).map(f => `${dir}/${String(f).split(path.sep).join('/')}`).sort();
}

const QUOTES = '\'"`';

/** -> index just past the string or template that opens at `i` (src[i] is its quote). */
function pastQuoted(src, i) {
  let j = i + 1;
  while (j < src.length && src[j] !== src[i]) j += src[j] === '\\' ? 2 : 1;
  return j + 1;
}

/** -> index of the end of the comment that starts at `i`, or `i` when none starts there. */
function commentEnd(src, i) {
  if (src[i] !== '/') return i;
  if (src[i + 1] === '/') { const nl = src.indexOf('\n', i); return nl < 0 ? src.length : nl; }
  if (src[i + 1] === '*') { const close = src.indexOf('*/', i + 2); return close < 0 ? src.length : close + 2; }
  return i;
}

/** -> the text with comments blanked (same length, newlines kept) and string/template contents kept, so offsets stay valid. */
export function blankComments(src) {
  let out = '', i = 0;
  while (i < src.length) {
    const quoted = QUOTES.includes(src[i]), end = quoted ? pastQuoted(src, i) : commentEnd(src, i);
    if (end === i) { out += src[i++]; continue; }
    const piece = src.slice(i, end);
    out += quoted ? piece : piece.replace(/[^\n]/g, ' ');
    i = end;
  }
  return out;
}

/** -> index of the bracket closing the one at `open` (strings and templates skipped), or -1. */
function closing(src, open) {
  const pairs = {'(': ')', '{': '}', '[': ']'}, stack = [];
  for (let i = open; i < src.length; i++) {
    const c = src[i];
    if (QUOTES.includes(c)) { i = pastQuoted(src, i) - 1; continue; }
    if (pairs[c]) stack.push(pairs[c]);
    else if (')}]'.includes(c)) {
      if (stack.pop() !== c) return -1;
      if (!stack.length) return i;
    }
  }
  return -1;
}

/** -> the comma-separated entries at the top level of an object literal's inside. */
function splitTop(inner) {
  const parts = [];
  let depth = 0, start = 0;
  for (let i = 0; i < inner.length; i++) {
    const c = inner[i];
    if (QUOTES.includes(c)) { i = pastQuoted(inner, i) - 1; continue; }
    if ('({['.includes(c)) depth++;
    else if (')}]'.includes(c)) depth--;
    else if (c === ',' && depth === 0) { parts.push(inner.slice(start, i)); start = i + 1; }
  }
  parts.push(inner.slice(start));
  return parts;
}

/** -> {keys: [name], spread: bool} of an object literal's top-level entries. */
export function objectKeys(literal) {
  const keys = []; let spread = false;
  for (const raw of splitTop(literal.slice(1, -1)).map(p => p.trim()).filter(Boolean)) {
    const m = raw.startsWith('...') ? null : /^(?:\[[^\]]*\]|'([^']+)'|"([^"]+)"|([A-Za-z_$][\w$]*))\s*(?::|$|\()/.exec(raw);
    if (m) keys.push(m[1] || m[2] || m[3]); else spread = true;   // a spread or a shape we can't read counts as unknown, never as "no keys"
  }
  return {keys, spread};
}

/** -> the call's body: {keys, spread, text} for a JSON object literal built in place, {keys: [], spread: false} for '{}', else {dynamic: true}. */
function bodyOf(src, at, window) {
  const j = window.indexOf('JSON.stringify(');
  if (j < 0) return /body:\s*'\{\}'/.test(window) ? {keys: [], spread: false} : {dynamic: true};
  const open = at + j + 'JSON.stringify'.length, arg = src.slice(open + 1, closing(src, open)).trim();
  return arg.startsWith('{') && closing(arg, 0) === arg.length - 1 ? {...objectKeys(arg), text: arg} : {dynamic: true};
}

/** -> the text of this call alone: from the route to the next route or 900 characters. */
function windowOf(src, at, routeLength) {
  const ahead = src.slice(at, at + 900), next = ahead.indexOf('/extension/', routeLength);
  return next > 0 ? ahead.slice(0, next) : ahead;
}

/**
 * -> [{route, file, line, method, body}] one per call site. body: {keys, spread} when the call sends a JSON object literal built in place,
 * {dynamic: true} when the body is built elsewhere, null when the call sends none (a GET).
 */
export function extensionCalls(files = extensionFiles()) {
  const calls = [];
  for (const file of files) {
    const raw = fs.readFileSync(path.join(REPO, file), 'utf8'), src = blankComments(raw);
    for (const m of src.matchAll(ROUTE)) {
      const window = windowOf(src, m.index, m[0].length), statementEnd = window.search(/;\s*\n/);
      const post = /method:\s*'POST'/.test(statementEnd > 0 ? window.slice(0, statementEnd) : window);
      calls.push({route: m[1], file, line: raw.slice(0, m.index).split('\n').length, method: post ? 'POST' : 'GET', body: post ? bodyOf(src, m.index, window) : null});
    }
  }
  return calls;
}
