// What a user's data folder holds, as one flat map of hashes, and the compare that says whether an update lost or changed any of it (upgrade + data test, spec 2026-11-01-upgrade-data-test-design.md).
// Report only: the daily job reads the result, nothing blocks on it. Pure apart from reading the folder it is given; never reads secrets.json, logs or Chromium's own files.
// Guard: desktop/test/data-fingerprint.test.js.
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import {createRequire} from 'node:module';

export const SQLITE_FILES = ['data/tracker.sqlite', 'data/jobs.sqlite'];
export const TEXT_FILES = ['profile.md', 'answers.md', 'knowledge.md'];    // kept whole: an update must not rewrite what the person wrote
export const JSON_FILES = ['settings.json', 'config/search.json', 'config/preferences.json', 'config/sources.json', 'config/scout_seeds.json'];   // kept per top-level key: an update may add keys
export const FOLDERS = ['cv'];                                              // every file in them, whole
const sqlite = () => createRequire(import.meta.url)('node:sqlite');

const hash = value => crypto.createHash('sha256').update(typeof value === 'string' || Buffer.isBuffer(value) ? value : JSON.stringify(value) ?? 'undefined').digest('hex').slice(0, 16);
const canonical = value => (Array.isArray(value) ? value.map(canonical) : value && typeof value === 'object' ? Object.fromEntries(Object.keys(value).sort().map(key => [key, canonical(value[key])])) : value);
const read = (dir, rel) => { try { return fs.readFileSync(path.join(dir, rel)); } catch { return null; } };
const walk = (dir, rel) => { try { return fs.readdirSync(path.join(dir, rel), {withFileTypes: true}).flatMap(entry => (entry.isDirectory() ? walk(dir, path.join(rel, entry.name)) : [path.join(rel, entry.name)])); } catch { return []; } };

// One cell per row and column, keyed by the table's primary key (the rowid when it has none): an added column or table is only "new", a renamed or dropped one is "lost".
function sqliteCells(dir, rel, out) {
  const file = path.join(dir, rel);
  if (!fs.existsSync(file)) return;
  let db;
  try {
    db = new (sqlite().DatabaseSync)(file, {readOnly: true});
    for (const {name} of db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'").all()) {
      const info = db.prepare(`PRAGMA table_info("${name.replace(/"/g, '""')}")`).all(), keys = info.filter(column => column.pk).sort((a, b) => a.pk - b.pk).map(column => column.name);
      for (const row of db.prepare(`SELECT rowid AS __rowid, * FROM "${name.replace(/"/g, '""')}"`).all()) {
        const id = (keys.length ? keys.map(key => row[key]) : [row.__rowid]).join('|');
        for (const column of info) out[`sqlite:${rel}:${name}:${id}:${column.name}`] = hash(typeof row[column.name] === 'bigint' ? String(row[column.name]) : row[column.name]);
      }
    }
  } catch (error) { out[`sqlite:${rel}:unreadable`] = hash(String(error.message)); }   // a store the new build cannot open is a change, not silence
  finally { try { db?.close(); } catch { /* already closed */ } }
}

/** {key: hash} for a data folder: sqlite cells, whole text files, JSON files per top-level key, and every file under cv/. Keys read `kind:path[:detail]`. */
export function fingerprintFolder(dir) {
  const out = {};
  for (const rel of SQLITE_FILES) sqliteCells(dir, rel, out);
  for (const rel of [...TEXT_FILES, ...FOLDERS.flatMap(folder => walk(dir, folder))]) { const bytes = read(dir, rel); if (bytes) out[`file:${rel.split(path.sep).join('/')}`] = hash(bytes); }
  for (const rel of JSON_FILES) {
    const bytes = read(dir, rel);
    if (!bytes) continue;
    try { const value = JSON.parse(bytes.toString('utf8')); for (const key of Object.keys(value)) out[`json:${rel}:${key}`] = hash(canonical(value[key])); } catch { out[`json:${rel}:unreadable`] = hash(bytes); }
  }
  return out;
}

// Why (1 Nov 2026): a star may stand anywhere in an expected key, so a migration that rewrites one column is allowed for that column only, never for the whole table.
const matches = (entry, key) => new RegExp(`^${entry.key.split('*').map(part => part.replace(/[.+?^${}()|[\]\\]/g, '\\$&')).join('.*')}$`).test(key);

/**
 * before, after: fingerprints. expected: [{key (exact; `*` matches any text), reason, pr}], the changes a migration makes on purpose.
 * -> {ok, lost: [key], changed: [{key, before, after}], added: [key], allowed: [{key, reason, pr}], stale: [expected entries nothing matched], counts: {before, after}}.
 * ok = nothing lost and nothing changed outside `expected`. Added keys never fail: an update may add columns, tables and settings.
 */
export function compare(before, after, expected = []) {
  const result = {ok: true, lost: [], changed: [], added: [], allowed: [], stale: [], counts: {before: Object.keys(before).length, after: Object.keys(after).length}};
  const used = new Set();
  const allow = (key, found) => { const entry = expected.find(item => matches(item, key)); if (entry) { used.add(entry); result.allowed.push({key, reason: entry.reason, pr: entry.pr}); } else found(); };
  for (const key of Object.keys(before).sort()) {
    if (!(key in after)) allow(key, () => result.lost.push(key));
    else if (after[key] !== before[key]) allow(key, () => result.changed.push({key, before: before[key], after: after[key]}));
  }
  result.added = Object.keys(after).filter(key => !(key in before)).sort();
  result.stale = expected.filter(entry => !used.has(entry));
  result.ok = !result.lost.length && !result.changed.length;
  return result;
}

/** The positive control: `fingerprint` without one entry (the first key of a kind). If compare does not call that a loss, the compare is blind and the run must say so. */
export function withoutOne(fingerprint, kind = 'sqlite') {
  const key = Object.keys(fingerprint).sort().find(item => item.startsWith(`${kind}:`)) || Object.keys(fingerprint).sort()[0];
  const {[key]: _dropped, ...rest} = fingerprint;
  return {key, fingerprint: rest};
}

/** The report's lines: a short sentence per problem, hashes only (never a value). */
export const describe = result => [
  `${result.ok ? 'kept everything' : 'DATA LOST OR CHANGED'}: ${result.counts.before} entries before, ${result.counts.after} after, ${result.added.length} new, ${result.allowed.length} allowed changes`,
  ...result.lost.map(key => `lost ${key}`), ...result.changed.map(item => `changed ${item.key} (${item.before} -> ${item.after})`),
  ...result.stale.map(entry => `stale expected entry ${entry.key} (nothing matched; remove it)`)];
