// The pool's row names, for the "Pool-row:" trailer: the public desktop/e2e/smoke-sites.json plus this Mac's own list (RECORD_SITES, or the QA folder of desktop/e2e/record-sites.mjs),
// a row's capture-folder slug (desktop/e2e/lib/replay-candidate.mjs slug), the row a slug stands for, and the closest name to suggest.
// Read by tools/rung-trailer.mjs (commit hook and push gate refuse a value that is no row name), tools/claim-shape.mjs (a claim names a row) and desktop/e2e/lib/fix-ledger.mjs (a slug becomes its row).
// Guard: desktop/test/commit-trailers.test.js, desktop/test/claim-shape.test.js, desktop/e2e/test/pool/fix-ledger.test.mjs.
import fs from 'node:fs';
import {recordVar} from './record-env.mjs';
import os from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const LOCAL_POOL = path.join(os.homedir(), 'Library/Application Support/Job Pilotto QA/smoke-sites.json');   // record-sites.mjs QA_DIR, never in the repo

const shapesOf = file => { const data = JSON.parse(fs.readFileSync(file, 'utf8')); return (Array.isArray(data) ? data : data.shapes || []).map(item => String(item?.shape || '').trim()).filter(Boolean); };

// -> {names, complete}. complete: false when this machine has no own list (CI, another Mac): the row names are then not all known.
export function poolRowNames({root = ROOT, env = process.env} = {}) {
  const names = new Set();
  try { shapesOf(path.join(root, 'desktop/e2e/smoke-sites.json')).forEach(name => names.add(name)); } catch { return {names: [], complete: false}; }
  try { shapesOf(recordVar('SITES', env) || LOCAL_POOL).forEach(name => names.add(name)); } catch { return {names: [...names], complete: false}; }
  return {names: [...names], complete: true};
}

export const slugOf = text => String(text).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60);

// The row a trailer value names: itself when it is a row, the one row whose slug it is, else ''.
export function rowFor(value, names) {
  const text = String(value || '').trim();
  if (names.includes(text)) return text;
  const bySlug = names.filter(name => slugOf(name) === text);
  return bySlug.length === 1 ? bySlug[0] : '';
}

const distance = (a, b) => {
  let last = Array.from({length: b.length + 1}, (_, i) => i);
  for (let i = 1; i <= a.length; i += 1) {
    const next = [i];
    for (let j = 1; j <= b.length; j += 1) next[j] = Math.min(last[j] + 1, next[j - 1] + 1, last[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    last = next;
  }
  return last[b.length];
};

// The row name closest to a value (compared as slugs, so case and punctuation do not count). '' when there are no names.
export const closestRow = (value, names) => names.reduce((best, name) => {
  const score = distance(slugOf(value), slugOf(name));
  return score < best.score ? {name, score} : best;
}, {name: '', score: Infinity}).name;

// '' when value is a row name, else why not, with the row it most likely means. pool: {names, complete}; an incomplete pool refuses only a slug of a known row.
// label: what the value is written after ("Pool-row: "), repeated in the suggestion.
export function rowNameProblem(value, {names = [], complete = false} = {}, label = '') {
  if (names.includes(value) || !(complete || rowFor(value, names))) return '';
  const near = rowFor(value, names) || closestRow(value, names);
  return `"${label}${value}" is not a row name of the pool (desktop/e2e/smoke-sites.json and this Mac's own list)${near ? `: did you mean "${label}${near}"?` : ''}`;
}
