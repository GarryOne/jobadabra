// Which e2e suites reach a helper file through their imports (plan.mjs suitesFor, so a changed helper runs the suites that use it, not only the settings smoke). Tests: test/import-graph.test.mjs.
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const IMPORT = /(?:from\s+|import\s*\(\s*)['"](\.{1,2}\/[^'"]+)['"]/g;

// {file: [suite, ...]} for every .mjs under `root` (paths relative to root, '/'), a suite being suites/<name>.mjs; `files` = {relative path: source} when the sources are already read.
export function suitesUsing(root, files = readTree(root)) {
  const edges = new Map();
  for (const [file, source] of Object.entries(files)) {
    const targets = [];
    for (const [, spec] of source.matchAll(IMPORT)) { const target = path.posix.normalize(path.posix.join(path.posix.dirname(file), spec)); if (target in files) targets.push(target); }
    edges.set(file, targets);
  }
  const used = {};
  for (const file of Object.keys(files)) {
    const suite = /^suites\/([^/]+)\.mjs$/.exec(file)?.[1];
    if (!suite) continue;
    const seen = new Set([file]), queue = [file];
    while (queue.length) for (const next of edges.get(queue.pop()) || []) if (!seen.has(next)) { seen.add(next); queue.push(next); }
    for (const reached of seen) (used[reached] ||= []).push(suite);
  }
  return used;
}

function readTree(root, dir = '', out = {}) {
  for (const entry of fs.readdirSync(path.join(root, dir), {withFileTypes: true})) {
    const rel = dir ? `${dir}/${entry.name}` : entry.name;
    if (entry.isDirectory()) { if (!['node_modules', 'artifacts', 'recorded', 'fixtures'].includes(entry.name)) readTree(root, rel, out); }
    else if (entry.name.endsWith('.mjs')) out[rel] = fs.readFileSync(path.join(root, rel), 'utf8');
  }
  return out;
}

// A suite's `watches` (plan.mjs) plus the Python files a watched .py file imports from its own folder, followed through: #2043 changed src/ai/schema_notes.py,
// which score.py (quality watches it) imports, and quality never ran. Only its own folder (src/ai/ for the prompts): followed into src/, score.py reaches 165
// files through the store, and every engine change would run quality. `read(path)` -> the file's text, or null when there is none.
const PY_FROM = /^\s*from\s+(\.+|src\.)([\w.]*)\s+import\s+(\([^)]*\)|[^\n#]+)/gm;
export function watchesWithImports(watches, read = file => { try { return fs.readFileSync(path.join(REPO, file), 'utf8'); } catch { return null; } }) {
  const moduleFile = base => [`${base}.py`, `${base}/__init__.py`].find(file => read(file) != null);
  const importsOf = file => {
    const out = [], text = read(file) || '';
    for (const [, dots, module, names] of text.matchAll(PY_FROM)) {
      let base = dots === 'src.' ? 'src' : path.posix.dirname(file);
      if (dots !== 'src.') for (let up = 1; up < dots.length; up++) base = path.posix.dirname(base);
      const at = module ? path.posix.join(base, ...module.split('.')) : base;
      const own = module && moduleFile(at);
      if (own) out.push(own);
      for (const name of names.replace(/[()]/g, '').split(',').map(part => part.trim().split(/\s+as\s+/)[0]).filter(Boolean)) {
        const sub = moduleFile(path.posix.join(at, name));   // `from . import cost` / `from .pkg import sub`: a module, not a name inside one
        if (sub) out.push(sub);
      }
    }
    return out;
  };
  const result = {};
  for (const [suite, paths] of Object.entries(watches || {})) {
    const seen = new Set(paths), queue = paths.filter(file => file.endsWith('.py')).map(file => [file, path.posix.dirname(file) + '/']);
    while (queue.length) {
      const [file, home] = queue.pop();
      for (const next of importsOf(file)) if (next.startsWith(home) && !seen.has(next)) { seen.add(next); queue.push([next, home]); }
    }
    result[suite] = [...seen];
  }
  return result;
}
