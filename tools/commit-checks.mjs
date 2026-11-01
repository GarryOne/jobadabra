#!/usr/bin/env node
// The commit-message and comment checks of a push, run together so one push lists every refusal at once (prune audit 2/4, owner, 1 Nov 2026: "First 3 rows").
// Each check stays its own tool with its own guard test; this only runs them side by side and prints the numbered refusals. Every rule stays.
//   node tools/commit-checks.mjs [--base origin/main] [--skip <check>[,<check>]]    exit 1 with every refusal, 0 when none
// Why (1 Nov 2026, owner, "Owner-report (Recommended), Prompt-case (Recommended)"): the Owner-report/Escaped-e2e and Prompt-case trailers are no longer asked at a push
// (21 and 2 stops in 30 days, every trailer "none"); prompt-cases.yml still replays the set and the PR's "New test pages fail on the old build" still holds.
import {spawn} from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

/** The checks, in the order their refusals are listed: [name, tool file under tools/]. */
export const CHECKS = [
  ['recorded cases', 'recorded-cases.mjs'],
  ['rung trailer', 'rung-trailer.mjs'],
  ['why comments', 'why-changed.mjs'],
  ['new code comments', 'new-code-comments.mjs'],
  ['spec proof', 'spec-proof.mjs'],
  ['e2e issue links', 'e2e-issue-links.mjs'],
  ['e2e cause trailer', 'e2e-cause-trailer.mjs'],
];

/** Numbered list of every refusal: [{name, text}] -> text; '' when none. */
export function listRefusals(refusals) {
  if (!refusals.length) return '';
  const head = `this push is refused by ${refusals.length} commit check${refusals.length > 1 ? 's' : ''}:`;
  return [head, ...refusals.map((refusal, i) => `\n[${i + 1}/${refusals.length}] ${refusal.name}\n${refusal.text.trim()}`)].join('\n');
}

const run = (file, base) => new Promise(resolve => {
  const child = spawn(process.execPath, [path.join(ROOT, 'tools', file), '--base', base], {cwd: ROOT});
  let text = '';
  child.stdout.on('data', chunk => { text += chunk; });
  child.stderr.on('data', chunk => { text += chunk; });
  child.on('error', error => resolve({code: 1, text: `${file} did not start: ${error.message}`}));
  child.on('close', code => resolve({code, text}));
});

async function main(argv) {
  const at = name => argv.indexOf(name);
  const base = at('--base') >= 0 ? argv[at('--base') + 1] : 'origin/main';
  const skip = new Set(at('--skip') >= 0 ? argv[at('--skip') + 1].split(',') : []);
  const wanted = CHECKS.filter(([name, file]) => !skip.has(name) && fs.existsSync(path.join(ROOT, 'tools', file)));   // a repo without a tool (the hook's own fixtures) has nothing to check
  const results = await Promise.all(wanted.map(([, file]) => run(file, base)));
  const refusals = wanted.map(([name], i) => ({name, ...results[i]})).filter(result => result.code !== 0);
  const text = listRefusals(refusals);
  if (text) console.error(text);
  return text ? 1 : 0;
}
if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) main(process.argv.slice(2)).then(code => process.exit(code));
