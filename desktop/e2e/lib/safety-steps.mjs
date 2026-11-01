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
// Why (31 Oct 2026, clean-code on #2723): one reader per token kind, each -> the index to continue at or -1 ("not mine"); the scanner state `s` is {text, n, out, i, depth, openAt, last}.
// `last` is the last significant character, to tell a regex `/` from a division.
const REGEX_AFTER_WORD = /(?:^|[^\w$])(?:return|typeof|case|of|in|delete|void|throw|new|else|do|yield|await)\s*$/;

function blankRange(s, from, to) {
  for (let i = from; i < to; i++) if (s.out[i] !== '\n') s.out[i] = ' ';
}

function readComment(s) {
  const {text, i} = s;
  if (text[i] !== '/' || (text[i + 1] !== '/' && text[i + 1] !== '*')) return -1;
  const line = text[i + 1] === '/', end = text.indexOf(line ? '\n' : '*/', line ? i : i + 2);
  const to = end < 0 ? s.n : end + (line ? 0 : 2);
  blankRange(s, i, to);
  return to;
}

function readString(s) {
  const quote = s.text[s.i];
  if (quote !== '\'' && quote !== '"') return -1;
  let j = s.i + 1;
  while (j < s.n && s.text[j] !== quote && s.text[j] !== '\n') j += s.text[j] === '\\' ? 2 : 1;
  blankRange(s, s.i + 1, j);
  s.last = quote;
  return j + 1;
}

// Reads template text from `from` to its closing backtick or its next `${`.
function readTemplateText(s, from) {
  let j = from;
  while (j < s.n && s.text[j] !== '`' && !(s.text[j] === '$' && s.text[j + 1] === '{')) j += s.text[j] === '\\' ? 2 : 1;
  blankRange(s, from, Math.min(j, s.n));
  if (s.text[j] === '$') { s.openAt.push(s.depth++); s.last = '{'; return j + 2; }
  s.last = '`';
  return j + 1;
}

const readBacktick = s => (s.text[s.i] === '`' ? readTemplateText(s, s.i + 1) : -1);

// A `/` starts a regex literal after an operator, an opening bracket or a keyword, and is a division after a value.
const regexAllowed = s => '(,=:[!&|?{};+-*%<>~^'.includes(s.last || '(') || REGEX_AFTER_WORD.test(s.text.slice(Math.max(0, s.i - 12), s.i));

// The index of the `/` closing the regex literal whose opening `/` is at `open` (end of line if unclosed).
function regexEnd(s, open) {
  let j = open + 1, inClass = false;
  while (j < s.n && s.text[j] !== '\n' && (inClass || s.text[j] !== '/')) {
    if (s.text[j] === '\\') j++;
    else if (s.text[j] === '[') inClass = true;
    else if (s.text[j] === ']') inClass = false;
    j++;
  }
  return j;
}

function readRegex(s) {
  if (s.text[s.i] !== '/' || !regexAllowed(s)) return -1;
  const end = regexEnd(s, s.i);
  blankRange(s, s.i + 1, end);
  s.last = '/';
  return end + 1;
}

// Braces only count depth; the `}` closing a template's `${` resumes the template text.
function readBrace(s) {
  if (s.text[s.i] === '{') s.depth++;
  else if (s.text[s.i] === '}') {
    s.depth--;
    if (s.openAt.length && s.openAt[s.openAt.length - 1] === s.depth) { s.openAt.pop(); return readTemplateText(s, s.i + 1); }
  }
  return -1;
}

const READERS = [readComment, readString, readBacktick, readRegex, readBrace];

function blankLiterals(text) {
  const s = {text, n: text.length, out: text.split(''), i: 0, depth: 0, openAt: [], last: ''};
  while (s.i < s.n) {
    let next = -1;
    for (const read of READERS) if ((next = read(s)) >= 0) break;
    if (next < 0) { if (!/\s/.test(s.text[s.i])) s.last = s.text[s.i]; next = s.i + 1; }
    s.i = next;
  }
  return s.out.join('');
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
 * The literal starts of the step names marked `{<key>: true}` in one source text. A name built with `+` or `${}` is returned up to its first interpolation, so it matches by prefix.
 * Why (1 Nov 2026, owner: "Auto-retry in betas only"): one reader for both marks, `safety` and `data`: neither kind of step gets the beta's retry (lib/beta-retry.mjs).
 * @param {string} text a suite or lib source file
 * @param {'safety'|'data'} key the option that marks the step
 * @returns {string[]}
 */
export function markedNamesIn(text, key) {
  const blanked = blankLiterals(text), names = [], mark = new RegExp(`^\\s*\\{[^]*\\b${key}\\s*:\\s*true\\b[^]*\\}\\s*$`);
  for (const match of blanked.matchAll(START)) {
    const open = match.index + match[0].indexOf('(');
    const close = closeOf(blanked, open);
    if (close < 0) continue;
    if (mark.test(lastArgument(blanked, open, close))) names.push(literalStart(text, match.index + match[0].length));
  }
  return names;
}

/** The literal starts of the step names marked `{safety: true}` in one source text. */
export const safetyNamesIn = text => markedNamesIn(text, 'safety');

/** The literal starts of the step names marked `{data: true}` in one source text (a store write, export/import/move, backup). */
export const dataNamesIn = text => markedNamesIn(text, 'data');

/**
 * Every step name (prefix) marked with `key` in desktop/e2e/suites and desktop/e2e/lib, sorted.
 * @param {'safety'|'data'} key
 * @param {string} [e2eDir] the desktop/e2e folder (default: this one)
 * @returns {string[]}
 */
export function markedStepNames(key, e2eDir = path.join(HERE, '..')) {
  const names = new Set();
  for (const dir of ['suites', 'lib']) {
    if (!fs.existsSync(path.join(e2eDir, dir))) continue;   // a repo without this folder (a temp repo in a test) has no marks
    for (const file of fs.readdirSync(path.join(e2eDir, dir)).filter(name => name.endsWith('.mjs'))) {
      for (const name of markedNamesIn(fs.readFileSync(path.join(e2eDir, dir, file), 'utf8'), key)) names.add(name);
    }
  }
  return [...names].sort();
}

/** Every safety step name (prefix) marked in desktop/e2e/suites and desktop/e2e/lib, sorted. */
export const safetyStepNames = e2eDir => markedStepNames('safety', e2eDir);

/** Every data step name (prefix) marked in desktop/e2e/suites and desktop/e2e/lib, sorted. */
export const dataStepNames = e2eDir => markedStepNames('data', e2eDir);

/**
 * Whether step `name` is one of the marked steps.
 * @param {string} name a step's exact name (a lanes.json `steps` key)
 * @param {string[]} marked the output of safetyStepNames or dataStepNames
 */
export const isSafetyStep = (name, marked) => marked.some(prefix => prefix && String(name).startsWith(prefix));
export const isDataStep = isSafetyStep;
