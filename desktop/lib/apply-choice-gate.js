// The one gate before any fill starts (owner, 26 Oct 2026, hybrid fill step 2): until the person chose how Jobadabra applies (the first-Apply dialog or
// Settings → Apply → Confirm; renderer/apply-settings-model.js applyChosen), every action in APPLY_ACTIONS answers CHOOSE_FIRST and opens nothing.
// main.js wraps ipcMain.handle with guard() once, so every handler file is covered by name; preload.cjs holds the pressed call and runs it again after
// the choice. Not gated: the extension's own Fill in Chrome (the person is already looking at the form). Guard: test/apply-choice-gate.test.js.
import {applyChosen} from '../renderer/apply-settings-model.js';

export const APPLY_ACTIONS = Object.freeze(['apply', 'applyOne', 'applyWithClaude', 'sessionRestart', 'sessionReopen', 'sessionResume',
  'readySend', 'readyRun', 'readyOpen', 'readyAgain']);
// A handler that starts a fill but is left out, and why (the class test reads this).
export const NOT_GATED = Object.freeze({
  takeOverClaude: 'the form panel\'s own "let Claude finish" on a form the person already has open (off for now, SHOW_RESUME_CLAUDE)',
});
export const CHOOSE_FIRST = Object.freeze({ok: false, needsApplyChoice: true, error: 'Choose how Jobadabra applies for you first.'});

const GATED = new Set(APPLY_ACTIONS);
// guard(handle, getStorage, log) -> a handle(name, fn) that answers CHOOSE_FIRST for a gated name until the choice is saved.
export function guard(handle, getStorage, log = () => {}) {
  return (name, fn) => handle(name, GATED.has(name) ? (...args) => {
    if (applyChosen(getStorage()?.settings?.())) return fn(...args);
    log('apply', 'choose how to apply first', {action: name});
    return {...CHOOSE_FIRST};
  } : fn);
}

// For the class test: what starts a fill inside a handler's body (an apply, a form tab, Claude, a Ready send or run).
export const STARTS_A_FILL = /\b(apply\.(start|applyOne|openOne|claudeOne|resumeSession)|applyOne|restartAs|startClaude|takeOver|sendPlanned|sendTonight|runTop|site\.(runNow|again))\s*\(/;

// [[name, body]] of each `.handle('name', ...)` in a source file: strings and comments removed first (a word in a comment is not a call), the body
// read up to the call's closing parenthesis.
export function handlerBodies(source) {
  let code = '', i = 0;
  while (i < source.length) {
    const c = source[i], next = source[i + 1];
    if (c === '/' && next === '/') { while (i < source.length && source[i] !== '\n') i++; continue; }
    if (c === '/' && next === '*') { i = source.indexOf('*/', i + 2) + 2 || source.length; continue; }
    if (c === '\'' || c === '"' || c === '`') {
      let j = i + 1;
      while (j < source.length && source[j] !== c) j += source[j] === '\\' ? 2 : 1;
      const text = source.slice(i + 1, j);
      code += /^\w+$/.test(text) ? `'${text}'` : '\'\'';   // a handler's name stays readable
      i = j + 1;
      continue;
    }
    code += c;
    i++;
  }
  const out = [];
  for (const match of code.matchAll(/\.handle\('(\w+)',/g)) {
    let depth = 1, j = match.index + match[0].length;
    while (j < code.length && depth) { if (code[j] === '(') depth++; else if (code[j] === ')') depth--; j++; }
    out.push([match[1], code.slice(match.index + match[0].length, j)]);
  }
  return out;
}
