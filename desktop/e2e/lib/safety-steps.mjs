// The steps a suite marks as SAFETY steps: ctx.run(name, fn, {safety: true}) (or step(...) from independent(ctx)). A safety step proves the Full automation confirmation,
// that nothing is posted, sent or pressed on an application, or Stop. It is never suspended: lib/runner.mjs fails it even when lanes.json lists it, tools/suspend-flip.mjs
// refuses to propose it, and tools/lanes-check.mjs refuses a `steps` entry for it. This file is the static side: it finds the marked steps by reading the suites' source.
// Why (31 Oct 2026, owner: "Never suspend safety steps (Full automation confirmation, nothing posted, Stop): a flaky one blocks the beta and is fixed the same day"): #2703 and
// #2704 were suspended as flaky on 31 Oct; a suspended step shows its result but blocks nothing, which for these steps means a posting bug could ship while the proof is grey.
// Invariants: a step name is matched by the text before its first interpolation (`'...' + expected + '...'` and `${}` names keep their literal start); the scan skips strings,
// comments, regex literals and template text, so a `safety: true` inside a callback body or a string is not a mark.
// Tests: test/safety-steps.test.mjs
// Job: report health
import fs from 'node:fs';
import path from 'node:path';

const HERE = path.dirname(new URL(import.meta.url).pathname);
const START = /(?:ctx\.run|\bstep|\brun)\(\s*(?=['"`])/g;

// Source text with comments, regex literals and the insides of string and template literals blanked out (same length), so brackets and keywords can be matched by position.
// Template `${...}` expressions stay as code: `depth` counts braces and `openAt` remembers the depth each `${` opened at, so its closing `}` resumes the template text.
function blankLiterals(text) {
  const out = text.split(''), n = text.length;
  const blank = (from, to) => { for (let i = from; i < to; i++) if (out[i] !== '\n') out[i] = ' '; };
  const openAt = [];
  let i = 0, depth = 0, last = '';   // last: the last significant character, to tell a regex `/` from a division
  // Reads template text from `from` to its closing backtick or its next `${`; -> the index to continue at.
  const template = from => {
    let j = from;
    while (j < n && text[j] !== '`' && !(text[j] === '$' && text[j + 1] === '{')) j += text[j] === '\\' ? 2 : 1;
    blank(from, Math.min(j, n));
    if (text[j] === '$') { openAt.push(depth++); last = '{'; return j + 2; }
    last = '`';
    return j + 1;
  };
  while (i < n) {
    const c = text[i], next = text[i + 1];
    if (c === '/' && next === '/') { const end = text.indexOf('\n', i); const to = end < 0 ? n : end; blank(i, to); i = to; continue; }
    if (c === '/' && next === '*') { const end = text.indexOf('*/', i + 2); const to = end < 0 ? n : end + 2; blank(i, to); i = to; continue; }
    if (c === '\'' || c === '"') {
      let j = i + 1;
      while (j < n && text[j] !== c && text[j] !== '\n') j += text[j] === '\\' ? 2 : 1;
      blank(i + 1, j); i = j + 1; last = c; continue;
    }
    if (c === '`') { i = template(i + 1); continue; }
    if (c === '/' && ('(,=:[!&|?{};+-*%<>~^'.includes(last || '(') || /(?:^|[^\w$])(?:return|typeof|case|of|in|delete|void|throw|new|else|do|yield|await)\s*$/.test(text.slice(Math.max(0, i - 12), i)))) {   // a regex literal
      let j = i + 1, inClass = false;
      while (j < n && text[j] !== '\n' && (inClass || text[j] !== '/')) { if (text[j] === '\\') j++; else if (text[j] === '[') inClass = true; else if (text[j] === ']') inClass = false; j++; }
      blank(i + 1, j); i = j + 1; last = '/'; continue;
    }
    if (c === '{') depth++;
    if (c === '}') { depth--; if (openAt.length && openAt[openAt.length - 1] === depth) { openAt.pop(); i = template(i + 1); continue; } }
    if (!/\s/.test(c)) last = c;
    i++;
  }
  return out.join('');
}

// The index of the `)` closing the `(` at `open`, in blanked text.
function closeOf(blanked, open) {
  let depth = 0;
  for (let i = open; i < blanked.length; i++) {
    if (blanked[i] === '(') depth++;
    else if (blanked[i] === ')' && --depth === 0) return i;
  }
  return -1;
}

// The literal start of a call's first argument: the text of its first string or template literal up to an interpolation or the closing quote.
function literalStart(text, at) {
  const quote = text[at];
  let value = '';
  for (let i = at + 1; i < text.length && text[i] !== quote; i++) {
    if (quote === '`' && text[i] === '$' && text[i + 1] === '{') break;
    if (text[i] === '\\') { i++; value += text[i]; continue; }
    value += text[i];
  }
  return value;
}

// The last top-level argument of the call opening at `open` (closing at `close`), as blanked text.
function lastArgument(blanked, open, close) {
  let depth = 0, from = open + 1;
  for (let i = open + 1; i < close; i++) {
    if ('([{'.includes(blanked[i])) depth++;
    else if (')]}'.includes(blanked[i])) depth--;
    else if (blanked[i] === ',' && depth === 0) from = i + 1;
  }
  return blanked.slice(from, close);
}

/**
 * The literal starts of the step names marked `{safety: true}` in one source text. A name built with `+` or `${}` is returned up to its first interpolation, so it matches by prefix.
 * @param {string} text a suite or lib source file
 * @returns {string[]}
 */
export function safetyNamesIn(text) {
  const blanked = blankLiterals(text), names = [];
  for (const match of blanked.matchAll(START)) {
    const open = match.index + match[0].indexOf('(');
    const close = closeOf(blanked, open);
    if (close < 0) continue;
    const last = lastArgument(blanked, open, close);
    if (/^\s*\{[^]*\bsafety\s*:\s*true\b[^]*\}\s*$/.test(last)) names.push(literalStart(text, match.index + match[0].length));
  }
  return names;
}

/**
 * Every safety step name (prefix) marked in desktop/e2e/suites and desktop/e2e/lib, sorted.
 * @param {string} [e2eDir] the desktop/e2e folder (default: this one)
 * @returns {string[]}
 */
export function safetyStepNames(e2eDir = path.join(HERE, '..')) {
  const names = new Set();
  for (const dir of ['suites', 'lib']) {
    if (!fs.existsSync(path.join(e2eDir, dir))) continue;   // a repo without this folder (a temp repo in a test) has no marks
    for (const file of fs.readdirSync(path.join(e2eDir, dir)).filter(name => name.endsWith('.mjs'))) {
      for (const name of safetyNamesIn(fs.readFileSync(path.join(e2eDir, dir, file), 'utf8'))) names.add(name);
    }
  }
  return [...names].sort();
}

/**
 * Whether step `name` is one of the marked safety steps.
 * @param {string} name a step's exact name (a lanes.json `steps` key)
 * @param {string[]} safety the output of safetyStepNames
 */
export const isSafetyStep = (name, safety) => safety.some(prefix => prefix && String(name).startsWith(prefix));
