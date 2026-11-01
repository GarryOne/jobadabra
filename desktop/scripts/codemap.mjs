// The code map, live: every source file and what it's for, from its own first comment (JS) or docstring (Python). Nothing is written to disk
// (11 Oct 2026: the committed CODEMAP.md went stale on every new file and conflicted on rebases), so it can never be out of date:
//   node desktop/scripts/codemap.mjs <word> [<word>…]   files whose path or purpose has every word (case-insensitive)
//   node desktop/scripts/codemap.mjs                    the whole map
// test/codemap.test.js: every listed file has a header that says what it does.
import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '..', '..');
const GROUPS = [
  ['Desktop app: main process', 'desktop', /^(main\.js|preload\.cjs|start\.js)$/],
  ['Desktop app: main-process modules', 'desktop/lib', /\.js$/],
  ['Desktop window: pages', 'desktop/renderer/pages', /\.js$/],
  ['Desktop window: shared modules', 'desktop/renderer', /\.js$/],
  ['Desktop scripts', 'desktop/scripts', /\.(mjs|cjs|js)$/],
  ['Chrome extension', 'extension', /\.js$/],
  ['Python pipeline', 'src', /\.py$/, true],
  ['Telegram bot (worker)', 'app-core/src', /\.js$/],
  ['Tools', 'tools', /\.(py|sh|mjs)$/],
];

export function purpose(file) {
  const text = fs.readFileSync(file, 'utf8');
  const own = path.basename(file).replace(/[.+*?^${}()|[\]\\]/g, '\\$&');
  const bare = line => line.replace(new RegExp(`^${own}( \\[[^\\]]*\\])?\\s*[—:-]+\\s*`), '');
  const lines = text.split('\n');
  if (file.endsWith('.py')) {
    const doc = text.match(/^(?:#![^\n]*\n)?(?:#[^\n]*\n)*\s*(?:"""|''')\s*([^\n]*)/);
    if (doc?.[1]?.trim()) return bare(doc[1].trim());
  }
  const comment = lines.find(line => /^\s*(\/\/|#(?!!))/.test(line) && !/eslint|@ts-|noqa|coding[:=]/.test(line));
  const first = lines.findIndex(line => line.trim() && !/^#!/.test(line) && !/^['"]use strict/.test(line));
  if (comment && lines.indexOf(comment) <= Math.max(first, 0) + 1) return bare(comment.replace(/^\s*(\/\/|#)\s*/, '').trim());
  return '(no header comment: add one)';
}

function walk(dir, pattern, deep) {
  const full = path.join(root, dir);
  if (!fs.existsSync(full)) return [];
  return fs.readdirSync(full, {withFileTypes: true}).sort((a, b) => a.name.localeCompare(b.name)).flatMap(entry => {
    const rel = `${dir}/${entry.name}`;
    if (entry.isDirectory()) return (deep || entry.name === 'ladder') && !/^(__pycache__|node_modules)$/.test(entry.name) ? walk(rel, pattern, deep) : [];   // the ladder's rung folders too
    return pattern.test(entry.name) && entry.name !== '__init__.py' ? [rel] : [];
  });
}

export function codemap() {
  const out = ['# Code map', '',
    'Live from each file\'s first comment or docstring (`node desktop/scripts/codemap.mjs <word>`). Find the file here, then read only that file.',
    'Rules and workflow: CLAUDE.md,',
    'skill `desktop-change` (the edit → check → push loop and known traps), skill `ui-look-and-feel` (screens).', ''];
  for (const [title, dir, pattern, deep] of GROUPS) {
    const found = walk(dir, pattern, deep);
    if (!found.length) continue;
    out.push(`## ${title}`, '');
    for (const file of found) out.push(`- \`${file}\` — ${purpose(path.join(root, file)).slice(0, 200)}`);
    out.push('');
  }
  return out.join('\n');
}

// The map's lines that have every word, in the path or the purpose (case-insensitive); no words: the whole map.
export function search(words, map = codemap()) {
  const wanted = words.map(word => word.toLowerCase()).filter(Boolean);
  if (!wanted.length) return map;
  return map.split('\n').filter(line => line.startsWith('- `') && wanted.every(word => line.toLowerCase().includes(word))).join('\n');
}

if (process.argv[1] === import.meta.filename) {
  const found = search(process.argv.slice(2));
  console.log(found || `nothing matches ${process.argv.slice(2).join(' ')}`);
}
