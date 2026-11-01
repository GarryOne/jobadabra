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

/** -> the text with comments blanked (same length) and string/template contents kept, so offsets stay valid. */
export function blankComments(src) {
  let out = '', i = 0;
  while (i < src.length) {
    const c = src[i], n = src[i + 1];
    if (c === '/' && n === '/') { while (i < src.length && src[i] !== '\n') { out += ' '; i++; } continue; }
    if (c === '/' && n === '*') { while (i < src.length && !(src[i] === '*' && src[i + 1] === '/')) { out += src[i] === '\n' ? '\n' : ' '; i++; } out += '  '; i += 2; continue; }
    if (c === '\'' || c === '"' || c === '`') {
      const q = c; out += c; i++;
      while (i < src.length && src[i] !== q) { if (src[i] === '\\') { out += src[i++]; } out += src[i++]; }
      out += q; i++; continue;
    }
    out += c; i++;
  }
  return out;
}

/** -> index of the bracket closing the one at `open` (strings and templates skipped), or -1. */
function closing(src, open) {
  const pairs = {'(': ')', '{': '}', '[': ']'}, stack = [];
  for (let i = open; i < src.length; i++) {
    const c = src[i];
    if (c === '\'' || c === '"' || c === '`') { const q = c; i++; while (i < src.length && src[i] !== q) { if (src[i] === '\\') i++; i++; } continue; }
    if (pairs[c]) stack.push(pairs[c]);
    else if (c === ')' || c === '}' || c === ']') { if (stack.pop() !== c) return -1; if (!stack.length) return i; }
  }
  return -1;
}

/** -> {keys: [name], spread: bool} of an object literal's top-level entries. */
export function objectKeys(literal) {
  const inner = literal.slice(1, -1), parts = [];
  let depth = 0, start = 0;
  for (let i = 0; i < inner.length; i++) {
    const c = inner[i];
    if (c === '\'' || c === '"' || c === '`') { const q = c; i++; while (i < inner.length && inner[i] !== q) { if (inner[i] === '\\') i++; i++; } continue; }
    if ('({['.includes(c)) depth++; else if (')}]'.includes(c)) depth--;
    else if (c === ',' && depth === 0) { parts.push(inner.slice(start, i)); start = i + 1; }
  }
  parts.push(inner.slice(start));
  const keys = []; let spread = false;
  for (const raw of parts.map(p => p.trim()).filter(Boolean)) {
    if (raw.startsWith('...')) { spread = true; continue; }
    const m = /^(?:\[[^\]]*\]|'([^']+)'|"([^"]+)"|([A-Za-z_$][\w$]*))\s*(?::|$|\()/.exec(raw);
    if (m) keys.push(m[1] || m[2] || m[3]); else spread = true;   // a shape we can't read counts as unknown, never as "no keys"
  }
  return {keys, spread};
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
      const at = m.index, route = m[1];
      const ahead = src.slice(at, at + 900), next = ahead.indexOf('/extension/', m[0].length), window = next > 0 ? ahead.slice(0, next) : ahead;
      const post = /method:\s*'POST'/.test(window.slice(0, window.search(/\n\s*\n|;\s*\n/) > 0 ? window.search(/;\s*\n/) : window.length));
      const call = {route, file, line: raw.slice(0, at).split('\n').length, method: post ? 'POST' : 'GET', body: null};
      if (post) {
        const j = window.indexOf('JSON.stringify(');
        if (j < 0) call.body = /body:\s*'\{\}'/.test(window) ? {keys: [], spread: false} : {dynamic: true};
        else {
          const open = at + j + 'JSON.stringify'.length, end = closing(src, open);
          const arg = src.slice(open + 1, end).trim();
          call.body = arg.startsWith('{') && closing(arg, 0) === arg.length - 1 ? {...objectKeys(arg), text: arg} : {dynamic: true};
        }
      }
      calls.push(call);
    }
  }
  return calls;
}
