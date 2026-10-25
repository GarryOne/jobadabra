// Which e2e suites reach a helper file through their imports (plan.mjs suitesFor, so a changed helper runs the suites that use it, not only the settings smoke). Tests: test/import-graph.test.mjs.
import fs from 'node:fs';
import path from 'node:path';

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
