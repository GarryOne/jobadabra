// Scrubs a network record ON DISK before it is published for the PR replay (records-publish.mjs): every text response body, and the record's text files (app.log, asks.jsonl, model-memo.json),
// lose the person's own values and any e-mail address that is not an example one, by the one set of definitions the product's report scrub uses (lib/report-scrub.js scrubPersonal). A body that
// changed gets its new hash (the file bodies/<hash>, the entry's hash and size); one that did not is untouched, so a replay serves exactly what the site sent. gateRecordDir() then searches
// everything again, in every decoded form; a hit means the row is not published. Kinds and counts only, never a value. Guard: e2e/test/record/record-scrub.test.mjs.
import fs from 'node:fs';
import path from 'node:path';
import {personalHits, scrubPersonal} from '../../lib/report-scrub.js';
import {EMAIL} from '../../lib/live-capture.js';
import {sha} from '../../lib/net-keep.js';

const TEXT_FILES = ['app.log', 'asks.jsonl', 'model-memo.json'], TEXT = /^(text\/|application\/([\w.+-]*\+)?(json|xml)\b|application\/(x-)?(javascript|ecmascript|x-www-form-urlencoded)\b)/i;
// A file the site serves as a font, an image or media (by its type, or by its first bytes when the type is generic) is bytes, not text: its random bytes can spell "x@hZ.B", which is not a person's address.
const BINARY_TYPE = /^(font\/|image\/|audio\/|video\/|application\/(x-)?(font|vnd\.ms-fontobject))/i;
const MAGIC = [[0, 1, 0, 0], [0x4f, 0x54, 0x54, 0x4f], [0x77, 0x4f, 0x46, 0x46], [0x77, 0x4f, 0x46, 0x32], [0x89, 0x50, 0x4e, 0x47], [0xff, 0xd8, 0xff], [0x47, 0x49, 0x46, 0x38], [0x52, 0x49, 0x46, 0x46], [0, 0, 1, 0]];   // ttf, otf, woff, woff2, png, jpeg, gif, riff (webp), ico
const isBinaryFile = (entry, body) => BINARY_TYPE.test(typeOf(entry)) || MAGIC.some(bytes => bytes.every((byte, at) => body[at] === byte));
const read = file => { try { return fs.readFileSync(file); } catch { return null; } };
const typeOf = entry => entry.headers?.['content-type'] || '';

// -> {bodies, files, own, contacts, phones}: how many bodies and files changed, and what was taken out (counts by kind).
export function scrubRecordDir(dir, values = new Map()) {
  const recordFile = path.join(dir, 'record.json'), record = JSON.parse(fs.readFileSync(recordFile, 'utf8')), total = {bodies: 0, files: 0, own: 0, contacts: 0, phones: 0};
  const add = counts => { total.own += counts.own; total.contacts += counts.contacts; total.phones += counts.phones; };
  const moved = new Map();   // old hash -> {hash, size} or null (unchanged)
  for (const entry of record.entries || []) {
    if (!entry.hash) continue;
    if (!moved.has(entry.hash)) {
      const body = read(path.join(dir, 'bodies', entry.hash)), got = body && scrubPersonal(body.toString('utf8'), {type: typeOf(entry), url: entry.url, values});
      if (got && (got.counts.own || got.counts.contacts || got.counts.phones)) {
        const next = Buffer.from(got.text), hash = sha(next);
        fs.writeFileSync(path.join(dir, 'bodies', hash), next);
        moved.set(entry.hash, {hash, size: next.length}); total.bodies += 1; add(got.counts);
      } else moved.set(entry.hash, null);
    }
    const now = moved.get(entry.hash);
    if (now) { entry.hash = now.hash; entry.size = now.size; }
  }
  for (const [old, now] of moved) if (now && now.hash !== old && !record.entries.some(entry => entry.hash === old)) fs.rmSync(path.join(dir, 'bodies', old), {force: true});   // an old body no entry refers to
  if (total.bodies) fs.writeFileSync(recordFile, JSON.stringify(record));
  for (const name of TEXT_FILES) {
    const file = path.join(dir, name), body = read(file), got = body && scrubPersonal(body.toString('utf8'), {type: 'text/plain', url: name, values});
    if (got && (got.counts.own || got.counts.contacts || got.counts.phones)) { fs.writeFileSync(file, got.text); total.files += 1; add(got.counts); }
  }
  return total;
}

// What is left after the scrub, everywhere a person's value could be: -> [{kind, in}] ('body' | 'file' | 'url'); empty = clear. Text bodies and files are searched in every decoded form; any other body for an
// e-mail address only (a font or an image has no names to find, and decoding it as base64 would only cost time).
export function gateRecordDir(dir, values = new Map()) {
  const hits = [], seen = new Set(), add = (kind, where) => { if (!seen.has(kind + where)) { seen.add(kind + where); hits.push({kind, in: where}); } };
  const record = JSON.parse(fs.readFileSync(path.join(dir, 'record.json'), 'utf8'));
  for (const kind of personalHits(`${record.url || ''} ${record.name || ''}`, {values})) add(kind, 'url');
  for (const entry of record.entries || []) {
    for (const kind of personalHits(entry.url || '', {values})) add(kind, 'url');
    const body = entry.hash ? read(path.join(dir, 'bodies', entry.hash)) : null;
    if (!body) continue;
    if (TEXT.test(typeOf(entry))) for (const kind of personalHits(body.toString('utf8'), {code: /javascript|ecmascript|text\/css/i.test(typeOf(entry)), values})) add(kind, 'body');
    else if (!isBinaryFile(entry, body)) { EMAIL.lastIndex = 0; if ((body.toString('latin1').match(EMAIL) || []).some(email => !/@example\.(com|org|net)$/i.test(email))) add('email', 'body'); }
  }
  for (const name of TEXT_FILES) { const body = read(path.join(dir, name)); if (body) for (const kind of personalHits(body.toString('utf8'), {values})) add(kind, 'file'); }
  return hits;
}
