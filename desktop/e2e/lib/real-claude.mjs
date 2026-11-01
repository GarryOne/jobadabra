// The harness runs the Claude Code install itself, never a wrapper a terminal put first on PATH (owner, 11 Oct 2026: a terminal's `claude` was a shell script that
// added its session's settings and hooks, which carry the owner's identity, to every `claude -p`; asked a form's "Full name" for the fake applicant it answered with the
// owner's real name). By structure, no tool names: a `claude` on PATH that is a shell script (#! sh, bash, zsh, ksh, dash) is a wrapper; the install is a native binary
// or a node script. Used by every place that starts the app under test or `claude` (the list is in e2e/test/replay/real-claude.test.mjs, which fails on a new one).
import fs from 'node:fs';
import path from 'node:path';

const SHELL = /^#!\s*(?:\S*\/)?(?:env\s+)?(?:ba|z|k|da)?sh\b/;

// -> true when the file is a shell script (a wrapper). A missing file, a binary, a node script: false. Windows has no shebang wrappers here (claude.cmd is the install's own).
export function isWrapper(file) {
  if (!file || process.platform === 'win32') return false;
  try {
    const fd = fs.openSync(file, 'r'), head = Buffer.alloc(120);
    const read = fs.readSync(fd, head, 0, head.length, 0);
    fs.closeSync(fd);
    return SHELL.test(head.subarray(0, read).toString('latin1'));
  } catch { return false; }
}

// -> the env with every PATH folder whose `claude` is a wrapper left out (the rest of PATH, and every other variable, unchanged).
export function withoutWrappers(env = process.env) {
  const dirs = String(env.PATH || '').split(path.delimiter).filter(dir => !isWrapper(path.join(dir, 'claude')));
  return {...env, PATH: dirs.join(path.delimiter)};
}

// -> the `claude` the env resolves to once wrappers are left out, or '' (none installed).
export function realClaude(env = process.env) {
  for (const dir of withoutWrappers(env).PATH.split(path.delimiter).filter(Boolean)) {
    const file = path.join(dir, 'claude');
    try { fs.accessSync(file, fs.constants.X_OK); return file; } catch { /* the next folder */ }
  }
  return '';
}

// A Claude Code path saved into the test app's settings (claudeCode.path): refused when it is a wrapper, before anything starts.
export function refuseWrapper(file) {
  if (isWrapper(file)) throw new Error(`refusing a claude wrapper script for the test app: ${file} (it carries a terminal session's settings; use the Claude Code install itself)`);
}
