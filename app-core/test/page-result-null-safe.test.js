// A page result is never read unguarded (15 Oct 2026: "Cannot read properties of null (reading 'trace')" from flow.js reading the page fill's result). executeScript hands back
// undefined or null when the page went away or the script threw, so every value an extension file takes from the page (inPage / page / run / ask / look ...) is either given a
// fallback where it is read, or guarded before its first member read. This loops over every such read in extension/**/*.js.
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {readFileSync} from 'node:fs';
import {join} from 'node:path';
import {test} from 'node:test';
import {fileURLToPath} from 'node:url';

const repo = fileURLToPath(new URL('../..', import.meta.url));
const READERS = 'inPage|page|run|ask|look|lookFrames|state\\.inPage|chrome\\.scripting\\.executeScript';
const START = new RegExp(`^\\s*(?:const|let)\\s+([A-Za-z_$][\\w$]*)\\s*=\\s*\\(?await\\s+(?:${READERS})\\(`);
const FALLBACK = /\|\||\?\?|\.catch\(\s*\(\)\s*=>\s*(?!\{\s*\}|undefined|void)[^)\s]/;   // a value that is not undefined stands in when the page said nothing
const SOURCES = () => execFileSync('git', ['ls-files', '-z', 'extension'], {cwd: repo}).toString().split('\0').filter(file => file.endsWith('.js'));

export function unguardedReads(source) {
  const lines = source.split('\n'), found = [];
  for (let i = 0; i < lines.length; i++) {
    const match = START.exec(lines[i]);
    if (!match) continue;
    const name = match[1];
    let end = i, depth = 0;   // the statement: until its brackets close (a call spread over lines)
    for (; end < lines.length; end++) {
      const code = lines[end].replace(/\/\/.*$/, '').replace(/(['"`])(?:\\.|(?!\1).)*\1/g, '');
      for (const char of code) depth += '([{'.includes(char) ? 1 : ')]}'.includes(char) ? -1 : 0;
      if (depth <= 0 && !/^\s*\./.test(lines[end + 1] || '')) break;   // a chained .then / .catch on the next line is part of it
    }
    const whole = lines.slice(i, end + 1).join(' '), open = START.exec(whole)[0].length;
    let depth2 = 1, at = open;
    while (at < whole.length && depth2 > 0) { depth2 += whole[at] === '(' ? 1 : whole[at] === ')' ? -1 : 0; at++; }
    if (FALLBACK.test(whole.slice(at)) || /^\s*\)?\s*(?:\|\||\?\?)/.test(whole.slice(at))) continue;   // only what follows the call counts: the arguments may hold || of their own
    const id = name.replace(/\$/g, '\\$');
    const member = new RegExp(`\\b${id}(?:\\.|\\[)`);   // ?. alone is not a guard: the next plain read crashes (the 15 Oct crash read summary?.held first)
    const guard = new RegExp(`\\bif\\s*\\(\\s*${id}\\s*(?:\\)|&&)|\\bif\\s*\\(.*(?:!\\s*${id}\\b|\\b${id}\\s*[!=]==?\\s*(?:null|undefined)|!Array\\.isArray\\(${id}\\))|\\b${id}\\s*(?:\\?\\?|\\|\\|)=|\\b${id}\\s*=\\s*${id}\\s*(?:\\?\\?|\\|\\|)`);
    for (let j = end + 1; j < Math.min(lines.length, end + 40); j++) {
      const code = lines[j].replace(/\/\/.*$/, '');
      if (new RegExp(`\\b(?:const|let)\\s+${id}\\b`).test(code)) break;   // another variable of that name begins
      if (guard.test(code)) break;
      if (member.test(code)) { found.push(`${name} (line ${i + 1}) read unguarded on line ${j + 1}`); break; }
    }
  }
  return found;
}

test('the checker finds an unguarded read and accepts a guarded one', () => {
  assert.equal(unguardedReads('const summary = await inPage(tab.id, f);\nreturn summary.trace;').length, 1);
  assert.equal(unguardedReads('const summary = await inPage(tab.id, f);\nif (!summary) return;\nreturn summary.trace;').length, 0);
  assert.equal(unguardedReads('const summary = await inPage(tab.id, f);\nif (summary?.held) return;\nreturn summary.trace;').length, 1, 'summary?.held is not a null check');
  assert.equal(unguardedReads('const summary = await inPage(tab.id, f).catch(() => null);\nreturn summary?.trace;').length, 0);
  assert.equal(unguardedReads('const rows = await inPage(tab.id, f) || [];\nreturn rows.length;').length, 0);
});

test('every value read from a page (inPage / executeScript result) is guarded or has a fallback before a member is read', () => {
  const found = SOURCES().flatMap(file => unguardedReads(readFileSync(join(repo, file), 'utf8')).map(line => `${file}: ${line}`));
  assert.deepEqual(found, []);
});
