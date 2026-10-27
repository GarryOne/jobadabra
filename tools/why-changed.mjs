#!/usr/bin/env node
// The Why gate (docs/rules/files.md "Comments" → "Why comments"): a push that deletes or rewrites a line guarded by a `Why (<PR or date>[, owner]): <reason>` comment says so on purpose:
//   Why-changed: <which Why> — <reason>        (in any commit message of the push; tools/commit-trailers.mjs checks its value at commit time)
// Guarded: the Why comment's own lines (it and the comment lines right under it); the first code line under them (not under a file's header comment); the code line a
// trailing Why sits on. A Why that quotes `three or more words` found in its own block's code (to the next Why, at most 80 lines) guards those words instead of the line
// under it: a prompt sentence (a comment cannot sit inside the string). A backticked name or path (`retryCount`) is not a sentence: the line under it stays guarded.
// Free: a new Why, a pure move or re-indent (the same lines come back elsewhere in the push), any edit nowhere near a Why.
// Usage: node tools/why-changed.mjs [--base origin/main]   exit 1 with the guarded lines when the trailer is missing. Guard: desktop/test/why-changed.test.js.
import {execFileSync} from 'node:child_process';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

// Only `Why:` and `Why (…):` mark a decision; "// Why a job has no score" describes a function and guards nothing.
export const WHY = /(?:^|\s)(?:\/\/|#)\s*Why(?:\s*\([^\n]*?\))?:\s*\S/;
const CODE_FILE = /\.(m?js|cjs|ts|py|sh|ya?ml)$/;
const isComment = line => /^\s*(\/\/|#)/.test(line);
// A comment line that starts another part of a header ("Usage:", "Tests:", "Used by ...") ends the Why's lines: editing it is not editing the reason.
const NEW_PART = /^\s*(\/\/|#)\s*([A-Z][A-Za-z-]*(?: [A-Za-z-]+){0,2}:\s|Used by\b|Guards?\b|Tests?\b)/;
const ANCHOR = /`([^`\n]{8,})`/g;
const SENTENCE = /\S+\s+\S+\s+\S/;   // Why (#2217 review): a quoted name like `retryCount` would else unguard the line it names
const REACH = 80;
const TRAILER = /^Why-changed:[ \t]*(\S.{8,})$/m;
const HOW = 'If the change is on purpose (you read the Why and its PR), add to a commit message of the push:\n  Why-changed: <which Why> — <why it no longer holds, or what replaces it>\nA pure move or re-indent needs nothing: keep the lines the same. (docs/rules/files.md "Comments" → "Why comments")';

// text -> [{line, why, guarded, comments, code: [line numbers], anchors: [{text, lines}]}] for each Why of a file (1-based lines). comments: the Why's own lines; code:
// the code line it guards (a trailing Why's line is in both); anchors: each quoted sentence and the code lines of its block that hold it.
export function whyBlocks(text) {
  const lines = String(text).split('\n'), blocks = [];
  for (let i = 0; i < lines.length; i++) {
    if (!WHY.test(lines[i])) continue;
    const block = {line: i + 1, why: lines[i].trim(), guarded: [i + 1], comments: [i + 1], code: [], anchors: []};
    if (isComment(lines[i])) {
      let end = i;
      while (end + 1 < lines.length && isComment(lines[end + 1]) && !WHY.test(lines[end + 1]) && !NEW_PART.test(lines[end + 1])) { block.guarded.push(++end + 1); block.comments.push(end + 1); }
      const header = lines.slice(0, i).every(line => !line.trim() || isComment(line) || line.startsWith('#!'));
      let next = end + 1;
      while (next < lines.length && !lines[next].trim()) next++;
      const reach = [];   // the block's code lines: to the next Why, at most REACH lines
      for (let n = next; n < Math.min(lines.length, next + REACH) && !WHY.test(lines[n]); n++) if (!isComment(lines[n])) reach.push(n + 1);
      for (const n of block.comments) for (const found of lines[n - 1].matchAll(ANCHOR)) {
        const held = reach.filter(at => lines[at - 1].includes(found[1]));
        if (SENTENCE.test(found[1]) && held.length) block.anchors.push({text: found[1], lines: held});
      }
      if (!header && !block.anchors.length && next < lines.length && !isComment(lines[next])) { block.guarded.push(next + 1); block.code.push(next + 1); }   // quoted words guard only themselves
      i = end;
    } else block.code.push(i + 1);
    blocks.push(block);
  }
  return blocks;
}

// A `git diff -U0` -> {files: [{oldPath, newPath, removed: Map(oldLine -> text)}], added: Set of every added line, trimmed}.
export function parseDiff(diff) {
  const files = [], added = new Set();
  let file = null, oldLine = 0;
  for (const line of String(diff).split('\n')) {
    if (line.startsWith('diff --git ')) { file = {oldPath: null, newPath: null, removed: new Map()}; files.push(file); continue; }
    if (!file) continue;
    if (line.startsWith('--- ')) { file.oldPath = line === '--- /dev/null' ? null : line.slice(6); continue; }
    if (line.startsWith('+++ ')) { file.newPath = line === '+++ /dev/null' ? null : line.slice(6); continue; }
    const hunk = /^@@ -(\d+)(?:,\d+)? \+\d+(?:,\d+)? @@/.exec(line);
    if (hunk) { oldLine = Number(hunk[1]); continue; }
    if (line.startsWith('-')) file.removed.set(oldLine++, line.slice(1));
    else if (line.startsWith('+')) added.add(line.slice(1).trim());
  }
  return {files, added};
}

// -> the guarded changes, [{where, stale}] (empty when none). oldText(path): a file's content before the push ('' when there is none).
// stale: the code (or the quoted prompt words) changed and the Why above it did not: an outdated Why misleads the next session more than none (owner, 27 Oct 2026).
export function guardedChanges(diff, oldText) {
  const {files, added} = parseDiff(diff), hits = [];
  const addedText = [...added];
  for (const file of files) {
    if (!file.oldPath || !CODE_FILE.test(file.oldPath)) continue;
    const before = oldText(file.oldPath);
    if (!WHY.test(before)) continue;
    const old = before.split('\n');
    for (const block of whyBlocks(before)) {
      const comment = n => (n === block.line ? old[n - 1].slice(old[n - 1].search(WHY)) : old[n - 1]).trim();   // a trailing Why: only its comment part
      const whyEdited = block.comments.some(n => file.removed.has(n) && !addedText.some(line => line.includes(comment(n))));
      const codeGone = block.code.some(n => file.removed.has(n) && !added.has(file.removed.get(n).trim()));
      // Lost: a line of the block that held the words is removed and no added code line brings them back (the same words elsewhere in the file do not count).
      const lost = block.anchors.filter(anchor => anchor.lines.some(n => file.removed.has(n)) && !addedText.some(line => !isComment(line) && line.includes(anchor.text))).map(anchor => anchor.text);
      if (!whyEdited && !codeGone && !lost.length) continue;
      const where = `${file.oldPath}:${block.line} ${block.why}${lost.length ? ` (its guarded words are gone: "${lost[0]}")` : ''}`;
      hits.push({where, stale: (codeGone || lost.length > 0) && !whyEdited});
    }
  }
  return hits;
}

// -> '' when fine, else the message. messages: the push's commit messages. A stale Why is refused even with the trailer: update or remove it in the same push.
export function missingWhyChanged(hits, messages) {
  const list = items => `  ${items.slice(0, 10).map(hit => hit.where).join('\n  ')}${items.length > 10 ? `\n  … ${items.length - 10} more` : ''}`;
  const stale = hits.filter(hit => hit.stale);
  if (stale.length) return `this push changes the line${stale.length > 1 ? 's' : ''} under ${stale.length} Why comment${stale.length > 1 ? 's' : ''} and leaves the Why as it was:\n${list(stale)}\nUpdate the Why to the new reason (or remove it when no decision is left) in the same push, then say it: "Why-changed: <which Why> — <reason>". An outdated Why misleads more than none.`;
  if (!hits.length || messages.some(message => TRAILER.test(String(message)))) return '';
  return `this push changes ${hits.length} line${hits.length > 1 ? 's' : ''} guarded by a Why comment, and no commit says "Why-changed:":\n${list(hits)}\n${HOW}`;
}

// -> '' or the message for the push base..HEAD of the repo at root.
export function checkPush({root, base = 'origin/main'}) {
  const git = (...rest) => execFileSync('git', ['-C', root, ...rest], {encoding: 'utf8', maxBuffer: 256 << 20, stdio: ['ignore', 'pipe', 'ignore']});
  const show = rev => file => { try { return git('show', `${rev}:${file}`); } catch { return ''; } };
  let from, diff, messages;
  try {
    from = git('merge-base', base, 'HEAD').trim();
    diff = git('diff', '-U0', '-M', '--no-color', '--no-ext-diff', '--src-prefix=a/', '--dst-prefix=b/', from, 'HEAD');
    messages = git('log', '--format=%B%x00', `${base}..HEAD`).split('\0');
  } catch { return ''; }   // no base to compare with (a fresh clone without origin/main): nothing to say
  return missingWhyChanged(guardedChanges(diff, show(from)), messages);
}

function main() {
  const base = process.argv.includes('--base') ? process.argv[process.argv.indexOf('--base') + 1] : 'origin/main';
  const why = checkPush({root: path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..'), base});
  if (why) { console.error(why); return 1; }
  return 0;
}
if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) process.exit(main());
